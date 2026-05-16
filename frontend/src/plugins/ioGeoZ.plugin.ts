/**
 * GeoZ import plugin.
 * Registers the GeoZ importer contribution.
 */

import { importGeoZ } from './geoz/parser';
import { createIOPlugin } from './ioPluginFactory';

export { buildGeoZProtoRoot, geoToProject, importGeoZ } from './geoz/parser';

export const mountIoGeoZPlugin = createIOPlugin({
  pluginId: 'io-geoz-import',
  importer: {
    formatName: 'GeoZ Map',
    extensions: ['.geoz', '.zip'],
    onImport: (fileContent, fileName) => importGeoZ(fileContent, fileName),
  },
});

