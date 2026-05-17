import { describe, expect, it, vi } from 'vitest';

const registerImporter = vi.fn();
const registerExporter = vi.fn();
const unregisterPlugin = vi.fn();

vi.mock('../../../stores/pluginContribStore', () => ({
  usePluginContribStore: {
    getState: () => ({ registerImporter, registerExporter, unregisterPlugin }),
  },
}));

import { mountIoShapefilePlugin } from './ioShapefile.plugin';

describe('ioShapefile.plugin', () => {
  it('mounts and unregisters cleanly', () => {
    const dispose = mountIoShapefilePlugin();
    expect(registerImporter).toHaveBeenCalledOnce();
    expect(registerExporter).toHaveBeenCalledOnce();
    dispose();
    expect(unregisterPlugin).toHaveBeenCalledWith('io-shapefile');
  });
});