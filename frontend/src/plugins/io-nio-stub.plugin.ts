/** plugin-io-nio: NIO ProtoBuf import/export plugin. Stub — Phase 3. */
import { createIOPluginStub } from './ioPluginFactory';

export const mountIoNioPlugin = createIOPluginStub({
  pluginId: 'io-nio-stub',
  formatName: 'NIO ProtoBuf',
  extensions: ['.pb', '.bin'],
  phase: 3,
});

