import { describe, it, expect, vi, beforeEach } from 'vitest';
const rp = vi.fn(), u = vi.fn();
vi.mock('../../../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerPanel: rp, unregisterPlugin: u })) } }));
import { mountConverterPlugin } from './converter.plugin';
describe('converter.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountConverterPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers panel', () => { const c = mountConverterPlugin(); expect(rp).toHaveBeenCalled(); c(); });
  it('unregisters', () => { const c = mountConverterPlugin(); c(); expect(u).toHaveBeenCalledWith('converter'); });
});
