import { describe, it, expect, vi, beforeEach } from 'vitest';
const m = vi.fn(), e = vi.fn(), u = vi.fn();
vi.mock('../../../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerImporter: m, registerExporter: e, unregisterPlugin: u })) } }));
import { mountIoXodrExtPlugin } from './io-xodr-ext-stub.plugin';
describe('io-xodr-ext-stub.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountIoXodrExtPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers importer with .xodr', () => { const c = mountIoXodrExtPlugin(); const call = m.mock.calls[0]; expect(call?.[0].extensions).toContain('.xodr'); c(); });
  it('registers exporter', () => { const c = mountIoXodrExtPlugin(); expect(e).toHaveBeenCalled(); c(); });
  it('unregisters', () => { const c = mountIoXodrExtPlugin(); c(); expect(u).toHaveBeenCalledWith('io-xodr-ext-stub'); });
});
