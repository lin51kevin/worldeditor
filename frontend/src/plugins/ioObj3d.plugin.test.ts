import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRegisterExporter = vi.fn();
const mockUnregisterPlugin = vi.fn();

vi.mock('../stores/pluginContribStore', () => ({
  usePluginContribStore: {
    getState: vi.fn(() => ({
      registerExporter: mockRegisterExporter,
      unregisterPlugin: mockUnregisterPlugin,
    })),
  },
}));

import { mountIoObj3dPlugin } from './ioObj3d.plugin';

describe('ioObj3d.plugin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should mount and return a cleanup function', () => {
    const cleanup = mountIoObj3dPlugin();
    expect(typeof cleanup).toBe('function');
    cleanup();
  });

  it('should register an OBJ exporter', () => {
    const cleanup = mountIoObj3dPlugin();
    expect(mockRegisterExporter).toHaveBeenCalled();
    const contrib = mockRegisterExporter.mock.calls[0]?.[0];
    expect(contrib.formatName).toContain('OBJ');
    cleanup();
  });

  it('should unregister on cleanup', () => {
    const cleanup = mountIoObj3dPlugin();
    cleanup();
    expect(mockUnregisterPlugin).toHaveBeenCalledWith('io-obj3d');
  });
});
