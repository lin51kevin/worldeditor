import { describe, it, expect, vi, beforeEach } from 'vitest';
const mockRegisterImporter = vi.fn(), mockRegisterExporter = vi.fn(), mockUnregisterPlugin = vi.fn();
vi.mock('../../../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerImporter: mockRegisterImporter, registerExporter: mockRegisterExporter, unregisterPlugin: mockUnregisterPlugin })) } }));
import { mountIoShapefilePlugin } from './io-shapefile-stub.plugin';
describe('io-shapefile-stub.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountIoShapefilePlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers importer', () => { const c = mountIoShapefilePlugin(); expect(mockRegisterImporter).toHaveBeenCalled(); c(); });
  it('registers exporter', () => { const c = mountIoShapefilePlugin(); expect(mockRegisterExporter).toHaveBeenCalled(); c(); });
  it('unregisters', () => { const c = mountIoShapefilePlugin(); c(); expect(mockUnregisterPlugin).toHaveBeenCalledWith('io-shapefile-stub'); });
});
