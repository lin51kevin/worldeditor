/** plugin-io-shapefile: Shapefile import/export plugin. Stub — Phase 3. */
import { createIOPluginStub } from '../../core/ioPluginFactory';

export const mountIoShapefilePlugin = createIOPluginStub({
  pluginId: 'io-shapefile-stub',
  formatName: 'Shapefile',
  extensions: ['.shp'],
  phase: 3,
});

