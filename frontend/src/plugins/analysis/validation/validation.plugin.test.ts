import { describe, it, expect, vi, beforeEach } from 'vitest';
const rp = vi.fn(), u = vi.fn();
vi.mock('../../../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerPanel: rp, unregisterPlugin: u })) } }));
import { mountValidationPlugin } from './validation.plugin';
describe('validation.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountValidationPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers panel', () => { const c = mountValidationPlugin(); expect(rp).toHaveBeenCalled(); c(); });
  it('unregisters', () => { const c = mountValidationPlugin(); c(); expect(u).toHaveBeenCalledWith('validation'); });
});
