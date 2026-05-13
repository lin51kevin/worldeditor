/**
 * plugin-io-csv: CSV coordinate import/export plugin.
 *
 * Registers a CSV importer and exporter via the plugin contribution system.
 * Import: parses rows as road centre-lines (x,y,hdg columns).
 * Export: writes road geometry as CSV.
 */

import { usePluginContribStore } from '../stores/pluginContribStore';
import type { Project } from '../services/platform';

const PLUGIN_ID = 'io-csv';

function parseCsvToProject(content: string | ArrayBuffer): Promise<Project> {
  const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
  const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const dataLines = lines.slice(1); // skip header

  const roads = dataLines.map((line, i) => {
    const [x = '0', y = '0', hdg = '0', id] = line.split(',');
    return {
      id: id?.trim() || `csv_${i + 1}`,
      name: '',
      length: 10,
      junction_id: null,
      render_hidden: false,
      link: null,
      plan_view: [{ s: 0, x: parseFloat(x), y: parseFloat(y), hdg: parseFloat(hdg), length: 10, geo_type: 'Line' as const }],
      elevation_profile: [],
      lane_sections: [],
      lane_offsets: [],
      lateral_profile: { superelevations: [], crossfalls: [] },
      bridges: [],
      tunnels: [],
      signals: [],
      objects: [],
    };
  });

  return Promise.resolve({ name: 'CSV Import', header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null }, roads, junctions: [], signals: [], objects: [] });
}

function exportProjectToCsv(project: Project): Promise<void> {
  const lines = ['id,x,y,hdg,length'];
  for (const road of project.roads) {
    const g = road.plan_view[0];
    if (g) {
      lines.push(`${road.id},${g.x},${g.y},${g.hdg},${road.length}`);
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name || 'export'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return Promise.resolve();
}

export function mountIoCsvPlugin(): () => void {
  const { registerImporter, registerExporter, unregisterPlugin } =
    usePluginContribStore.getState();

  registerImporter({
    id: `${PLUGIN_ID}:importer`,
    pluginId: PLUGIN_ID,
    formatName: 'CSV Coordinates',
    extensions: ['.csv', '.txt'],
    onImport: (content, _fileName) => parseCsvToProject(content),
  });

  registerExporter({
    id: `${PLUGIN_ID}:exporter`,
    pluginId: PLUGIN_ID,
    formatName: 'CSV Coordinates',
    onExport: exportProjectToCsv,
  });

  return () => unregisterPlugin(PLUGIN_ID);
}
