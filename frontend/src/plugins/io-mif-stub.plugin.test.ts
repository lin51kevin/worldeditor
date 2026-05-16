import { describe, it, expect, vi, beforeEach } from 'vitest';
const m = vi.fn(), e = vi.fn(), u = vi.fn();
vi.mock('../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerImporter: m, registerExporter: e, unregisterPlugin: u })) } }));
import { mountIoMifPlugin } from './io-mif-stub.plugin';
describe('io-mif-stub.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountIoMifPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers importer', () => { const c = mountIoMifPlugin(); expect(m).toHaveBeenCalled(); c(); });
  it('registers exporter', () => { const c = mountIoMifPlugin(); expect(e).toHaveBeenCalled(); c(); });
  it('unregisters', () => { const c = mountIoMifPlugin(); c(); expect(u).toHaveBeenCalledWith('io-mif-stub'); });
});
