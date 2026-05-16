import { describe, it, expect, vi, beforeEach } from 'vitest';
const rm = vi.fn(), u = vi.fn();
vi.mock('../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerMenuItem: rm, unregisterPlugin: u })) } }));
import { mountLaneDetectPlugin } from './lane-detect-beta.plugin';
describe('lane-detect-beta.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountLaneDetectPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers menu item', () => { const c = mountLaneDetectPlugin(); expect(rm).toHaveBeenCalled(); c(); });
  it('unregisters', () => { const c = mountLaneDetectPlugin(); c(); expect(u).toHaveBeenCalledWith('lane-detect'); });
});
