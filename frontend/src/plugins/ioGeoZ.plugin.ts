/**
 * GeoZ import plugin.
 * Registers the GeoZ importer contribution.
 */

import { importGeoZ } from './geoz/parser';
import { usePluginContribStore } from '../stores/pluginContribStore';

export { buildGeoZProtoRoot, geoToProject, importGeoZ } from './geoz/parser';

const PLUGIN_ID = 'io-geoz';
const IMPORTER_ID = `${PLUGIN_ID}:importer`;

export function mountIoGeoZPlugin(): () => void {
  const { registerImporter, unregisterPlugin } = usePluginContribStore.getState();

  registerImporter({
    id: IMPORTER_ID,
    pluginId: PLUGIN_ID,
    formatName: 'GeoZ Map',
    extensions: ['.geoz', '.zip'],
    disabled: false,
    onImport: (fileContent, fileName) => importGeoZ(fileContent, fileName),
  });

  return () => unregisterPlugin(PLUGIN_ID);
}
