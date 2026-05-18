import { describe, it, expect, vi, beforeEach } from 'vitest';
const m = vi.fn(), e = vi.fn(), u = vi.fn();
vi.mock('../../../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerImporter: m, registerExporter: e, unregisterPlugin: u })) } }));
import { mountIoSignalsPlugin, generateHdMapXml } from './io-signals.plugin';

function buildProject(overrides?: { roads?: any[]; signals?: any[]; objects?: any[] }) {
  return {
    name: 'test',
    header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
    roads: overrides?.roads ?? [],
    junctions: [],
    signals: overrides?.signals ?? [],
    objects: overrides?.objects ?? [],
  };
}

function buildRoad(id: string, length: number, signals?: any[], objects?: any[]) {
  return { id, name: `Road ${id}`, length, signals: signals ?? [], objects: objects ?? [] };
}

describe('io-signals.plugin', () => {
  beforeEach(() => vi.clearAllMocks());
  it('mounts', () => { const c = mountIoSignalsPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers importer with .json extension', () => { const c = mountIoSignalsPlugin(); const call = m.mock.calls[0]; expect(call?.[0].extensions).toContain('.json'); c(); });
  it('registers exporter', () => { const c = mountIoSignalsPlugin(); expect(e).toHaveBeenCalled(); c(); });
  it('unregisters', () => { const c = mountIoSignalsPlugin(); c(); expect(u).toHaveBeenCalledWith('io-signals'); });

  describe('generateHdMapXml', () => {
    it('outputs XML header and root', () => {
      const xml = generateHdMapXml(buildProject());
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      expect(xml).toContain('<hdmap>');
      expect(xml).toContain('</hdmap>');
    });

    it('road with no signals/objects omits tags', () => {
      const xml = generateHdMapXml(buildProject({ roads: [buildRoad('r1', 100)] }));
      expect(xml).not.toContain('<signals>');
      expect(xml).not.toContain('<objects>');
      expect(xml).toContain('<road id="r1" length="100">');
      expect(xml).toContain('</road>');
    });

    it('sorts signals by s position', () => {
      const signals = [
        { id: 's2', name: 'B', s: 50, t: 0, z_offset: 0, h_offset: 0, width: 0, height: 0, signal_type: '1001', signal_subtype: '1', value: null, orientation: '+', is_dynamic: false },
        { id: 's1', name: 'A', s: 10, t: 0, z_offset: 0, h_offset: 0, width: 0, height: 0, signal_type: '1002', signal_subtype: '2', value: '1.5', orientation: '-', is_dynamic: true },
      ];
      const xml = generateHdMapXml(buildProject({ roads: [buildRoad('r1', 100, signals)] }));
      expect(xml.indexOf('id="s1"')).toBeLessThan(xml.indexOf('id="s2"'));
    });

    it('includes all signal fields', () => {
      const signals = [
        { id: 'sig1', name: 'TL1', s: 10, t: 5, z_offset: 1, h_offset: 2, width: 3, height: 4, signal_type: '1001', signal_subtype: '1', value: '0.5', orientation: '+', is_dynamic: true },
      ];
      const xml = generateHdMapXml(buildProject({ roads: [buildRoad('r1', 100, signals)] }));
      expect(xml).toContain('type="1001"');
      expect(xml).toContain('subtype="1"');
      expect(xml).toContain('value="0.5"');
      expect(xml).toContain('dynamic="true"');
      expect(xml).toContain('orientation="+"');
    });

    it('includes objects sorted by sPosition', () => {
      const objects = [
        { id: 'o2', roadId: 'r1', sPosition: 50, laneId: 2, type: 'pole', validity: 'right' },
        { id: 'o1', roadId: 'r1', sPosition: 20, laneId: 1, type: 'crosswalk', validity: 'both' },
      ];
      const xml = generateHdMapXml(buildProject({ roads: [buildRoad('r1', 100, [], objects)] }));
      expect(xml.indexOf('id="o1"')).toBeLessThan(xml.indexOf('id="o2"'));
      expect(xml).toContain('type="crosswalk"');
      expect(xml).toContain('lane="1"');
      expect(xml).toContain('validity="both"');
    });

    it('escapes XML special characters in signal name and road id', () => {
      const signals = [
        { id: 'sig1', name: 'A & B < "test"', s: 10, t: 0, z_offset: 0, h_offset: 0, width: 0, height: 0, signal_type: '1', signal_subtype: '', value: null, orientation: '+', is_dynamic: false },
      ];
      const xml = generateHdMapXml(buildProject({ roads: [{ id: 'r<"1', name: 'road', length: 100, signals, objects: [] }] }));
      expect(xml).toContain('A &amp; B &lt; &quot;test&quot;');
      expect(xml).toContain('r&lt;&quot;1');
      expect(xml).not.toContain('A & B < "test"');
    });
  });
});
