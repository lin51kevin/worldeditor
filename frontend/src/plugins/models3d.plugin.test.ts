import { describe, it, expect, vi, beforeEach } from 'vitest';
const rp = vi.fn(), ri = vi.fn(), u = vi.fn();
vi.mock('../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerPanel: rp, registerImporter: ri, unregisterPlugin: u })) } }));
import { mountModels3dPlugin } from './models3d.plugin';
describe('models3d.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountModels3dPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers panel', () => { const c = mountModels3dPlugin(); expect(rp).toHaveBeenCalled(); c(); });
  it('registers importer with .obj', () => { const c = mountModels3dPlugin(); expect(ri.mock.calls[0]?.[0].extensions).toContain('.obj'); c(); });
  it('unregisters', () => { const c = mountModels3dPlugin(); c(); expect(u).toHaveBeenCalledWith('3d-models'); });
});
