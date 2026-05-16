import { describe, it, expect, vi, beforeEach } from 'vitest';
const rp = vi.fn(), rm = vi.fn(), u = vi.fn();
vi.mock('../../../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerPanel: rp, registerMenuItem: rm, unregisterPlugin: u })) } }));
import { mountValidationPlugin } from './validation.plugin';
describe('validation.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountValidationPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers panel', () => { const c = mountValidationPlugin(); expect(rp).toHaveBeenCalled(); c(); });
  it('registers menu items', () => { const c = mountValidationPlugin(); expect(rm.mock.calls.length).toBeGreaterThanOrEqual(2); c(); });
  it('unregisters', () => { const c = mountValidationPlugin(); c(); expect(u).toHaveBeenCalledWith('validation'); });
});
