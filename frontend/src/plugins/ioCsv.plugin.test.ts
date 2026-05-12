import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRegisterImporter = vi.fn();
const mockRegisterExporter = vi.fn();
const mockUnregisterPlugin = vi.fn();

vi.mock('../stores/pluginContribStore', () => ({
  usePluginContribStore: {
    getState: vi.fn(() => ({
      registerImporter: mockRegisterImporter,
      registerExporter: mockRegisterExporter,
      unregisterPlugin: mockUnregisterPlugin,
    })),
  },
}));

import { mountIoCsvPlugin } from './ioCsv.plugin';

describe('ioCsv.plugin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should mount and return a cleanup function', () => {
    const cleanup = mountIoCsvPlugin();
    expect(typeof cleanup).toBe('function');
    cleanup();
  });

  it('should register an importer', () => {
    const cleanup = mountIoCsvPlugin();
    expect(mockRegisterImporter).toHaveBeenCalled();
    cleanup();
  });

  it('should register an exporter', () => {
    const cleanup = mountIoCsvPlugin();
    expect(mockRegisterExporter).toHaveBeenCalled();
    cleanup();
  });

  it('should call unregisterPlugin on cleanup', () => {
    const cleanup = mountIoCsvPlugin();
    cleanup();
    expect(mockUnregisterPlugin).toHaveBeenCalledWith('io-csv');
  });

  it('should register importer with correct extensions', () => {
    const cleanup = mountIoCsvPlugin();
    const call = mockRegisterImporter.mock.calls[0]?.[0];
    expect(call.extensions).toContain('.csv');
    cleanup();
  });
});
