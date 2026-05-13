/** plugin-io-mif: MapInfo MIF import/export plugin. Stub — Phase 3. */
import { usePluginContribStore } from '../stores/pluginContribStore';
const PLUGIN_ID = 'io-mif';
export function mountIoMifPlugin(): () => void {
  const { registerImporter, registerExporter, unregisterPlugin } = usePluginContribStore.getState();
  // TODO: [Phase 3] 待实现 — implement MapInfo MIF import via GIS pipeline
  registerImporter({ id: `${PLUGIN_ID}:importer`, pluginId: PLUGIN_ID, formatName: 'MapInfo MIF', extensions: ['.mif'], disabled: true, onImport: () => Promise.reject(new Error('MIF import requires Phase 3')) });
  // TODO: [Phase 3] 待实现 — implement MapInfo MIF export via GIS pipeline
  registerExporter({ id: `${PLUGIN_ID}:exporter`, pluginId: PLUGIN_ID, formatName: 'MapInfo MIF', disabled: true, onExport: () => Promise.reject(new Error('MIF export requires Phase 3')) });
  return () => unregisterPlugin(PLUGIN_ID);
}
