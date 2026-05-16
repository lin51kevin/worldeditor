import { describe, it, expect, vi, beforeEach } from 'vitest';
const m = vi.fn(), e = vi.fn(), u = vi.fn();
vi.mock('../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerImporter: m, registerExporter: e, unregisterPlugin: u })) } }));
import { mountIoNioPlugin } from './io-nio-stub.plugin';
describe('io-nio-stub.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountIoNioPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers importer', () => { const c = mountIoNioPlugin(); expect(m).toHaveBeenCalled(); c(); });
  it('registers exporter', () => { const c = mountIoNioPlugin(); expect(e).toHaveBeenCalled(); c(); });
  it('unregisters', () => { const c = mountIoNioPlugin(); c(); expect(u).toHaveBeenCalledWith('io-nio-stub'); });
});
