/**
 * GeoZ import plugin.
 * Registers the GeoZ importer contribution.
 */

import { importGeoZ } from './parser';
import { createIOPlugin } from '../../core/ioPluginFactory';

export { buildGeoZProtoRoot, geoToProject, importGeoZ } from './parser';

export const mountIoGeoZPlugin = createIOPlugin({
  pluginId: 'io-geoz-import',
  importer: {
    formatName: 'GeoZ Map',
    extensions: ['.geoz', '.zip'],
    onImport: (fileContent, fileName) => importGeoZ(fileContent, fileName),
  },
});

