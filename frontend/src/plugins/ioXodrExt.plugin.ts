/** plugin-io-xodr-ext: OpenDRIVE custom extensions import/export plugin. Stub — Phase 3. */
import { usePluginContribStore } from '../stores/pluginContribStore';
const PLUGIN_ID = 'io-xodr-ext';
export function mountIoXodrExtPlugin(): () => void {
  const { registerImporter, registerExporter, unregisterPlugin } = usePluginContribStore.getState();
  // TODO: [Phase 3] 待实现 — implement OpenDRIVE extensions import handling
  registerImporter({ id: `${PLUGIN_ID}:importer`, pluginId: PLUGIN_ID, formatName: 'OpenDRIVE Extensions', extensions: ['.xodr'], disabled: true, onImport: () => Promise.reject(new Error('OpenDRIVE Extensions import requires Phase 3')) });
  // TODO: [Phase 3] 待实现 — implement OpenDRIVE extensions export handling
  registerExporter({ id: `${PLUGIN_ID}:exporter`, pluginId: PLUGIN_ID, formatName: 'OpenDRIVE Extensions', disabled: true, onExport: () => Promise.reject(new Error('OpenDRIVE Extensions export requires Phase 3')) });
  return () => unregisterPlugin(PLUGIN_ID);
}
