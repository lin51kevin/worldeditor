/** plugin-io-shapefile: Shapefile import/export plugin.
 * Stub — Phase 3 will wire WASM backend.
 */
import { usePluginContribStore } from '../stores/pluginContribStore';

const PLUGIN_ID = 'io-shapefile';

export function mountIoShapefilePlugin(): () => void {
  const { registerImporter, registerExporter, unregisterPlugin } = usePluginContribStore.getState();
  // TODO: [Phase 3] 待实现 — implement Shapefile import via GIS pipeline
  registerImporter({ id: `${PLUGIN_ID}:importer`, pluginId: PLUGIN_ID, formatName: 'Shapefile', extensions: ['.shp'], disabled: true, onImport: () => Promise.reject(new Error('Shapefile import requires Phase 3')) });
  // TODO: [Phase 3] 待实现 — implement Shapefile export via GIS pipeline
  registerExporter({ id: `${PLUGIN_ID}:exporter`, pluginId: PLUGIN_ID, formatName: 'Shapefile', disabled: true, onExport: () => Promise.reject(new Error('Shapefile export requires Phase 3')) });
  return () => unregisterPlugin(PLUGIN_ID);
}
