import { describe, it, expect, vi, beforeEach } from 'vitest';
const rp = vi.fn(), rm = vi.fn(), ri = vi.fn(), re = vi.fn(), u = vi.fn();
vi.mock('../../../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerPanel: rp, registerMenuItem: rm, registerImporter: ri, registerExporter: re, unregisterPlugin: u })) } }));
import { mountTrafficPlugin } from './traffic.plugin';
describe('traffic.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountTrafficPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers panel', () => { const c = mountTrafficPlugin(); expect(rp).toHaveBeenCalled(); c(); });
  it('registers menu items', () => { const c = mountTrafficPlugin(); expect(rm.mock.calls.length).toBeGreaterThanOrEqual(2); c(); });
  it('registers SUMO importer', () => { const c = mountTrafficPlugin(); expect(ri).toHaveBeenCalled(); c(); });
  it('unregisters', () => { const c = mountTrafficPlugin(); c(); expect(u).toHaveBeenCalledWith('traffic'); });
});
