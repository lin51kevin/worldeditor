import { describe, it, expect, vi, beforeEach } from 'vitest';
const e = vi.fn(), u = vi.fn();
vi.mock('../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerExporter: e, unregisterPlugin: u })) } }));
import { mountIoOsmPlugin } from './ioOsm.plugin';
describe('ioOsm.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountIoOsmPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers exporter', () => { const c = mountIoOsmPlugin(); expect(e).toHaveBeenCalled(); c(); });
  it('exporter format is OSM', () => { const c = mountIoOsmPlugin(); expect(e.mock.calls[0]?.[0].formatName).toContain('OpenStreetMap'); c(); });
  it('unregisters', () => { const c = mountIoOsmPlugin(); c(); expect(u).toHaveBeenCalledWith('io-osm'); });
});
