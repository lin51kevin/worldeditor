import { describe, it, expect, vi, beforeEach } from 'vitest';
const rp = vi.fn(), rm = vi.fn(), ro = vi.fn(), u = vi.fn();
vi.mock('../../../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerPanel: rp, registerMenuItem: rm, registerViewportOverlay: ro, unregisterPlugin: u })) } }));
import { mountSatellitePlugin } from './satellite-beta.plugin';
describe('satellite-beta.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountSatellitePlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers panel', () => { const c = mountSatellitePlugin(); expect(rp).toHaveBeenCalled(); c(); });
  it('registers menu item', () => { const c = mountSatellitePlugin(); expect(rm).toHaveBeenCalled(); c(); });
  it('registers viewport overlay', () => { const c = mountSatellitePlugin(); expect(ro).toHaveBeenCalled(); c(); });
  it('unregisters', () => { const c = mountSatellitePlugin(); c(); expect(u).toHaveBeenCalledWith('satellite-beta'); });
});
