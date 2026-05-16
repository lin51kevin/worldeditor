import { describe, it, expect, vi, beforeEach } from 'vitest';
const mockRegisterImporter = vi.fn();
const mockRegisterExporter = vi.fn();
const mockUnregisterPlugin = vi.fn();
vi.mock('../../../stores/pluginContribStore', () => ({
  usePluginContribStore: { getState: vi.fn(() => ({ registerImporter: mockRegisterImporter, registerExporter: mockRegisterExporter, unregisterPlugin: mockUnregisterPlugin })) },
}));
import { mountIoLanelet2Plugin } from './io-lanelet2-stub.plugin';
describe('io-lanelet2-stub.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts and returns cleanup', () => { const c = mountIoLanelet2Plugin(); expect(typeof c).toBe('function'); c(); });
  it('registers importer', () => { const c = mountIoLanelet2Plugin(); expect(mockRegisterImporter).toHaveBeenCalled(); c(); });
  it('registers exporter', () => { const c = mountIoLanelet2Plugin(); expect(mockRegisterExporter).toHaveBeenCalled(); c(); });
  it('unregisters on cleanup', () => { const c = mountIoLanelet2Plugin(); c(); expect(mockUnregisterPlugin).toHaveBeenCalledWith('io-lanelet2-stub'); });
});
