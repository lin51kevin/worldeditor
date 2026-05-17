/**
 * plugin-io-signals: JSON signal import + HD Map XML export plugin.
 */
import type { Project } from '../../../services/platform';
import { downloadBlob } from '../../../utils/download';
import { createIOPlugin } from '../../core/ioPluginFactory';

async function importSignals(content: string | ArrayBuffer): Promise<Project> {
  const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
  const wasm = await import('../../../../wasm/pkg/we_wasm');

  // Parse signal JSON via Rust WASM backend
  const signalsJson = wasm.import_signals_from_json(text);
  const signals = JSON.parse(signalsJson) as Array<{
    road_id: string;
    id: string;
    name: string;
    signal_type: string;
    signal_subtype: string;
    s: number;
    t: number;
    z_offset: number;
    h_offset: number;
    width: number;
    height: number;
    value: string;
    orientation: string;
    is_dynamic: boolean;
  }>;

  // Group signals by road_id
  const roadSignalMap = new Map<string, typeof signals>();
  for (const sig of signals) {
    const roadId = sig.road_id || 'default';
    const existing = roadSignalMap.get(roadId) ?? [];
    existing.push(sig);
    roadSignalMap.set(roadId, existing);
  }

  // Build roads from grouped signals
  const roads = Array.from(roadSignalMap.entries()).map(([roadId, sigs]) => ({
    id: roadId,
    name: '',
    length: Math.max(10, ...sigs.map((s) => s.s + 1)),
    junction_id: null,
    render_hidden: false,
    link: null,
    plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: Math.max(10, ...sigs.map((s) => s.s + 1)), geo_type: 'Line' as const }],
    elevation_profile: [],
    lane_sections: [],
    lane_offsets: [],
    lateral_profile: { superelevations: [], crossfalls: [] },
    bridges: [],
    tunnels: [],
    signals: sigs.map((s) => ({
      id: s.id,
      name: s.name || '',
      signal_type: s.signal_type || '',
      signal_subtype: s.signal_subtype || '',
      s: s.s,
      t: s.t,
      z_offset: s.z_offset,
      h_offset: s.h_offset,
      width: s.width,
      height: s.height,
      value: s.value || '',
      orientation: s.orientation || '+',
      is_dynamic: s.is_dynamic ?? false,
    })),
    objects: [],
  }));

  return {
    name: 'Signal Import',
    header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
    roads,
    junctions: [],
    signals: [],
    objects: [],
  };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function generateHdMapXml(project: Project): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<hdmap>\n';
  for (const road of project.roads) {
    xml += `  <road id="${escapeXml(road.id)}" length="${road.length}">\n`;
    const sigs = (road.signals ?? []).slice().sort((a, b) => a.s - b.s);
    if (sigs.length > 0) {
      xml += '    <signals>\n';
      for (const sig of sigs) {
        xml += `      <signal id="${escapeXml(sig.id)}" name="${escapeXml(sig.name)}" type="${escapeXml(sig.signal_type)}" subtype="${escapeXml(sig.signal_subtype)}" s="${sig.s}" t="${sig.t}" z_offset="${sig.z_offset}" h_offset="${sig.h_offset}" width="${sig.width}" height="${sig.height}" value="${sig.value ?? ''}" orientation="${escapeXml(sig.orientation)}" dynamic="${sig.is_dynamic}"/>\n`;
      }
      xml += '    </signals>\n';
    }
    const objs = ((road.objects ?? []) as any[]).slice().sort((a: any, b: any) => a.sPosition - b.sPosition);
    if (objs.length > 0) {
      xml += '    <objects>\n';
      for (const obj of objs) {
        xml += `      <object id="${escapeXml(obj.id)}" type="${escapeXml(obj.type)}" s="${obj.sPosition}" lane="${obj.laneId}" validity="${escapeXml(obj.validity)}"/>\n`;
      }
      xml += '    </objects>\n';
    }
    xml += '  </road>\n';
  }
  xml += '</hdmap>\n';
  return xml;
}

function exportHdMapXml(project: Project): Promise<void> {
  const xml = generateHdMapXml(project);
  const blob = new Blob([xml], { type: 'application/xml' });
  downloadBlob(blob, `${project.name || 'export'}_hdmap.xml`);
  return Promise.resolve();
}

export const mountIoSignalsPlugin = createIOPlugin({
  pluginId: 'io-signals',
  importer: {
    formatName: 'Signal JSON',
    extensions: ['.json'],
    onImport: importSignals,
  },
  exporter: {
    formatName: 'HD Map XML',
    onExport: exportHdMapXml,
  },
});
