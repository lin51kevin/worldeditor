import { describe, it, expect, vi, beforeEach } from 'vitest';
const rp = vi.fn(), u = vi.fn();
vi.mock('../../../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerPanel: rp, unregisterPlugin: u })) } }));
import { mountPointcloudPlugin } from './pointcloud-beta.plugin';
describe('pointcloud-beta.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountPointcloudPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers a panel', () => { const c = mountPointcloudPlugin(); expect(rp).toHaveBeenCalled(); c(); });
  it('registers panel on the left', () => { const c = mountPointcloudPlugin(); expect(rp.mock.calls[0]?.[0].position).toBe('left'); c(); });
  it('unregisters', () => { const c = mountPointcloudPlugin(); c(); expect(u).toHaveBeenCalledWith('pointcloud-beta'); });
});

