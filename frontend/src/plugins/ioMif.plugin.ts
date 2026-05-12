/** plugin-io-mif: MapInfo MIF import/export plugin. Stub — Phase 3. */
import { usePluginContribStore } from '../stores/pluginContribStore';
const PLUGIN_ID = 'io-mif';
export function mountIoMifPlugin(): () => void {
  const { registerImporter, registerExporter, unregisterPlugin } = usePluginContribStore.getState();
  registerImporter({ id: `${PLUGIN_ID}:importer`, pluginId: PLUGIN_ID, formatName: 'MapInfo MIF', extensions: ['.mif'], onImport: () => Promise.reject(new Error('MIF import requires Phase 3')) });
  registerExporter({ id: `${PLUGIN_ID}:exporter`, pluginId: PLUGIN_ID, formatName: 'MapInfo MIF', onExport: () => Promise.reject(new Error('MIF export requires Phase 3')) });
  return () => unregisterPlugin(PLUGIN_ID);
}
