/**
 * plugin-io-signals: JSON signal import + HD Map XML export plugin.
 */
import { usePluginContribStore } from '../stores/pluginContribStore';
import type { Project } from '../services/platform';

const PLUGIN_ID = 'io-signals';

async function importSignals(content: string | ArrayBuffer): Promise<Project> {
  const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
  // Validate JSON structure
  const signals = JSON.parse(text) as unknown[];
  if (!Array.isArray(signals)) throw new Error('Expected JSON array of signal entries');
  // Signals are not stored in Project yet — return empty project
  return { name: 'Signal Import', header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null }, roads: [], junctions: [] };
}

function exportHdMapXml(project: Project): Promise<void> {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<hdmap>\n';
  for (const road of project.roads) {
    xml += `  <road id="${road.id}" length="${road.length}"/>\n`;
  }
  xml += '</hdmap>\n';
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name || 'export'}_hdmap.xml`;
  a.click();
  URL.revokeObjectURL(url);
  return Promise.resolve();
}

export function mountIoSignalsPlugin(): () => void {
  const { registerImporter, registerExporter, unregisterPlugin } = usePluginContribStore.getState();
  registerImporter({ id: `${PLUGIN_ID}:importer`, pluginId: PLUGIN_ID, formatName: 'Signal JSON', extensions: ['.json'], onImport: importSignals });
  registerExporter({ id: `${PLUGIN_ID}:exporter`, pluginId: PLUGIN_ID, formatName: 'HD Map XML', onExport: exportHdMapXml });
  return () => unregisterPlugin(PLUGIN_ID);
}
