/** plugin-io-lanelet2: Lanelet2 OSM-XML import/export plugin. Stub — Phase 3. */
import { createIOPluginStub } from './ioPluginFactory';

export const mountIoLanelet2Plugin = createIOPluginStub({
  pluginId: 'io-lanelet2-stub',
  formatName: 'Lanelet2 OSM-XML',
  extensions: ['.osm', '.xml'],
  phase: 3,
});
