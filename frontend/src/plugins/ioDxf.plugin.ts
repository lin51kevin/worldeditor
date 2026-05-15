/** plugin-io-dxf: DXF CAD import/export plugin. Stub — Phase 3. */
import { createIOPluginStub } from './ioPluginFactory';

export const mountIoDxfPlugin = createIOPluginStub({
  pluginId: 'io-dxf',
  formatName: 'DXF CAD',
  extensions: ['.dxf'],
  phase: 3,
});

