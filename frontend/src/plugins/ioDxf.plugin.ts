/** plugin-io-dxf: DXF CAD import/export plugin. Stub — Phase 3. */
import { usePluginContribStore } from '../stores/pluginContribStore';
const PLUGIN_ID = 'io-dxf';
export function mountIoDxfPlugin(): () => void {
  const { registerImporter, registerExporter, unregisterPlugin } = usePluginContribStore.getState();
  registerImporter({ id: `${PLUGIN_ID}:importer`, pluginId: PLUGIN_ID, formatName: 'DXF CAD', extensions: ['.dxf'], disabled: true, onImport: () => Promise.reject(new Error('DXF import requires Phase 3')) });
  registerExporter({ id: `${PLUGIN_ID}:exporter`, pluginId: PLUGIN_ID, formatName: 'DXF CAD', disabled: true, onExport: () => Promise.reject(new Error('DXF export requires Phase 3')) });
  return () => unregisterPlugin(PLUGIN_ID);
}
