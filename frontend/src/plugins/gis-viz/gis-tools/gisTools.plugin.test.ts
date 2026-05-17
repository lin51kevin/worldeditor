import { describe, it, expect, vi, beforeEach } from 'vitest';
const rp = vi.fn(), u = vi.fn();
vi.mock('../../../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerPanel: rp, unregisterPlugin: u })) } }));
import { mountGisToolsPlugin } from './gisTools.plugin';
describe('gisTools.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountGisToolsPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers panel', () => { const c = mountGisToolsPlugin(); expect(rp).toHaveBeenCalled(); c(); });
  it('unregisters', () => { const c = mountGisToolsPlugin(); c(); expect(u).toHaveBeenCalledWith('gis-tools'); });
});
