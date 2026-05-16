import { describe, it, expect, vi, beforeEach } from 'vitest';
const m = vi.fn(), e = vi.fn(), u = vi.fn();
vi.mock('../../../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerImporter: m, registerExporter: e, unregisterPlugin: u })) } }));
import { mountIoDxfPlugin } from './io-dxf-stub.plugin';
describe('io-dxf-stub.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountIoDxfPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers importer', () => { const c = mountIoDxfPlugin(); expect(m).toHaveBeenCalled(); c(); });
  it('registers exporter', () => { const c = mountIoDxfPlugin(); expect(e).toHaveBeenCalled(); c(); });
  it('unregisters', () => { const c = mountIoDxfPlugin(); c(); expect(u).toHaveBeenCalledWith('io-dxf-stub'); });
});
