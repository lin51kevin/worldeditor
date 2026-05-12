/**
 * plugin-io-osm: OpenStreetMap XML export plugin.
 * Export only — generates OSM XML from road network data.
 */
import { usePluginContribStore } from '../stores/pluginContribStore';
import type { Project } from '../services/platform';

const PLUGIN_ID = 'io-osm';

function exportToOsm(project: Project): Promise<void> {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="WorldEditor Next">\n';
  let nodeId = -1;
  const roadNodes: Array<{ roadId: string; startId: number; endId: number }> = [];

  for (const road of project.roads) {
    const g = road.plan_view[0];
    const sx = g?.x ?? 0;
    const sy = g?.y ?? 0;
    const ex = sx + road.length * Math.cos(g?.hdg ?? 0);
    const ey = sy + road.length * Math.sin(g?.hdg ?? 0);
    xml += `  <node id="${nodeId}" lat="${sy}" lon="${sx}"/>\n`;
    const startId = nodeId--;
    xml += `  <node id="${nodeId}" lat="${ey}" lon="${ex}"/>\n`;
    const endId = nodeId--;
    roadNodes.push({ roadId: road.id, startId, endId });
  }

  let wayId = -1001;
  for (const { roadId, startId, endId } of roadNodes) {
    xml += `  <way id="${wayId--}">\n    <nd ref="${startId}"/>\n    <nd ref="${endId}"/>\n    <tag k="highway" v="residential"/>\n    <tag k="ref" v="${roadId}"/>\n  </way>\n`;
  }
  xml += '</osm>\n';

  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name || 'export'}.osm`;
  a.click();
  URL.revokeObjectURL(url);
  return Promise.resolve();
}

export function mountIoOsmPlugin(): () => void {
  const { registerExporter, unregisterPlugin } = usePluginContribStore.getState();
  registerExporter({ id: `${PLUGIN_ID}:exporter`, pluginId: PLUGIN_ID, formatName: 'OpenStreetMap XML', onExport: exportToOsm });
  return () => unregisterPlugin(PLUGIN_ID);
}
