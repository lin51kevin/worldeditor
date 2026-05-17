import { describe, expect, it, vi } from 'vitest';

const registerImporter = vi.fn();
const registerExporter = vi.fn();
const unregisterPlugin = vi.fn();

vi.mock('../../../stores/pluginContribStore', () => ({
  usePluginContribStore: {
    getState: () => ({ registerImporter, registerExporter, unregisterPlugin }),
  },
}));

import { mountIoDxfPlugin } from './ioDxf.plugin';

describe('ioDxf.plugin', () => {
  it('mounts and unregisters cleanly', () => {
    const dispose = mountIoDxfPlugin();
    expect(registerImporter).toHaveBeenCalledOnce();
    expect(registerExporter).toHaveBeenCalledOnce();
    dispose();
    expect(unregisterPlugin).toHaveBeenCalledWith('io-dxf');
  });
});