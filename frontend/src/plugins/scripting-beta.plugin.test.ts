import { describe, it, expect, vi, beforeEach } from 'vitest';
const rp = vi.fn(), rm = vi.fn(), u = vi.fn();
vi.mock('../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerPanel: rp, registerMenuItem: rm, unregisterPlugin: u })) } }));
import { mountScriptingPlugin } from './scripting-beta.plugin';
describe('scripting-beta.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountScriptingPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers panel', () => { const c = mountScriptingPlugin(); expect(rp).toHaveBeenCalled(); c(); });
  it('registers menu item', () => { const c = mountScriptingPlugin(); expect(rm).toHaveBeenCalled(); c(); });
  it('unregisters', () => { const c = mountScriptingPlugin(); c(); expect(u).toHaveBeenCalledWith('scripting-beta'); });
});
