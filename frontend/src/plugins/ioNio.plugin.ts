/** plugin-io-nio: NIO ProtoBuf import/export plugin. Stub — Phase 3. */
import { usePluginContribStore } from '../stores/pluginContribStore';
const PLUGIN_ID = 'io-nio';
export function mountIoNioPlugin(): () => void {
  const { registerImporter, registerExporter, unregisterPlugin } = usePluginContribStore.getState();
  registerImporter({ id: `${PLUGIN_ID}:importer`, pluginId: PLUGIN_ID, formatName: 'NIO ProtoBuf', extensions: ['.pb', '.bin'], disabled: true, onImport: () => Promise.reject(new Error('NIO import requires Phase 3')) });
  registerExporter({ id: `${PLUGIN_ID}:exporter`, pluginId: PLUGIN_ID, formatName: 'NIO ProtoBuf', disabled: true, onExport: () => Promise.reject(new Error('NIO export requires Phase 3')) });
  return () => unregisterPlugin(PLUGIN_ID);
}
