/** plugin-io-lanelet2: Lanelet2 OSM-XML import/export plugin.
 * Stub — Phase 3 will wire WASM backend.
 */
import { usePluginContribStore } from '../stores/pluginContribStore';

const PLUGIN_ID = 'io-lanelet2';

export function mountIoLanelet2Plugin(): () => void {
  const { registerImporter, registerExporter, unregisterPlugin } = usePluginContribStore.getState();

  registerImporter({
    id: `${PLUGIN_ID}:importer`,
    pluginId: PLUGIN_ID,
    formatName: 'Lanelet2 OSM-XML',
    extensions: ['.osm', '.xml'],
    disabled: true,
    onImport: (_content, _fileName) =>
      Promise.reject(new Error('Lanelet2 import requires Phase 3 WASM integration')),
  });

  registerExporter({
    id: `${PLUGIN_ID}:exporter`,
    pluginId: PLUGIN_ID,
    formatName: 'Lanelet2 OSM-XML',
    disabled: true,
    onExport: (_project) =>
      Promise.reject(new Error('Lanelet2 export requires Phase 3 WASM integration')),
  });

  return () => unregisterPlugin(PLUGIN_ID);
}
