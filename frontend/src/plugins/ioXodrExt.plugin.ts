/** plugin-io-xodr-ext: OpenDRIVE custom extensions import/export plugin. Stub — Phase 3. */
import { createIOPluginStub } from './ioPluginFactory';

export const mountIoXodrExtPlugin = createIOPluginStub({
  pluginId: 'io-xodr-ext',
  formatName: 'OpenDRIVE Extensions',
  extensions: ['.xodr'],
  phase: 3,
});
