/** plugin-io-mif: MapInfo MIF import/export plugin. Stub — Phase 3. */
import { createIOPluginStub } from '../../core/ioPluginFactory';

export const mountIoMifPlugin = createIOPluginStub({
  pluginId: 'io-mif-stub',
  formatName: 'MapInfo MIF',
  extensions: ['.mif'],
  phase: 3,
});
