import { describe, it, expect, vi, beforeEach } from 'vitest';
const rp = vi.fn(), rm = vi.fn(), u = vi.fn();
vi.mock('../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerPanel: rp, registerMenuItem: rm, unregisterPlugin: u })) } }));
import { mountEcosystemPlugin } from './ecosystem-beta.plugin';
describe('ecosystem-beta.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountEcosystemPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers panel', () => { const c = mountEcosystemPlugin(); expect(rp).toHaveBeenCalled(); c(); });
  it('unregisters', () => { const c = mountEcosystemPlugin(); c(); expect(u).toHaveBeenCalledWith('ecosystem'); });
});
