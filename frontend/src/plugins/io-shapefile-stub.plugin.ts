/** plugin-io-shapefile: Shapefile import/export plugin. Stub — Phase 3. */
import { createIOPluginStub } from './ioPluginFactory';

export const mountIoShapefilePlugin = createIOPluginStub({
  pluginId: 'io-shapefile-stub',
  formatName: 'Shapefile',
  extensions: ['.shp'],
  phase: 3,
});

