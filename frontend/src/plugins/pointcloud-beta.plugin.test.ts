import { describe, it, expect, vi, beforeEach } from 'vitest';
const rp = vi.fn(), ri = vi.fn(), u = vi.fn();
vi.mock('../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerPanel: rp, registerImporter: ri, unregisterPlugin: u })) } }));
import { mountPointcloudPlugin } from './pointcloud-beta.plugin';
describe('pointcloud-beta.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountPointcloudPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers panel', () => { const c = mountPointcloudPlugin(); expect(rp).toHaveBeenCalled(); c(); });
  it('registers importer with .las', () => { const c = mountPointcloudPlugin(); expect(ri.mock.calls[0]?.[0].extensions).toContain('.las'); c(); });
  it('unregisters', () => { const c = mountPointcloudPlugin(); c(); expect(u).toHaveBeenCalledWith('pointcloud-beta'); });
});
