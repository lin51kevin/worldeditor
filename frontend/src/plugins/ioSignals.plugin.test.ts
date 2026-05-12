import { describe, it, expect, vi, beforeEach } from 'vitest';
const m = vi.fn(), e = vi.fn(), u = vi.fn();
vi.mock('../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerImporter: m, registerExporter: e, unregisterPlugin: u })) } }));
import { mountIoSignalsPlugin } from './ioSignals.plugin';
describe('ioSignals.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountIoSignalsPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers importer with .json extension', () => { const c = mountIoSignalsPlugin(); const call = m.mock.calls[0]; expect(call?.[0].extensions).toContain('.json'); c(); });
  it('registers exporter', () => { const c = mountIoSignalsPlugin(); expect(e).toHaveBeenCalled(); c(); });
  it('unregisters', () => { const c = mountIoSignalsPlugin(); c(); expect(u).toHaveBeenCalledWith('io-signals'); });
});
