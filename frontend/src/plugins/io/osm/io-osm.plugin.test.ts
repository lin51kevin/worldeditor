import { describe, it, expect, vi, beforeEach } from 'vitest';
const e = vi.fn(), u = vi.fn();
vi.mock('../../../stores/pluginContribStore', () => ({ usePluginContribStore: { getState: vi.fn(() => ({ registerExporter: e, unregisterPlugin: u })) } }));
vi.mock('../../../utils/download', () => ({ saveExport: vi.fn() }));
import { mountIoOsmPlugin } from './io-osm.plugin';
import type { Project } from '../../../services/platform';

function makeProject(roads: Project['roads'] = []): Project {
  return { name: 'test', roads, junctions: [], signals: [], objects: [], road_marks: [] } as any;
}

function makeRoad(id: string, planView: any[]): any {
  return { id, plan_view: planView, length: planView.reduce((s, g) => s + (g.length ?? 0), 0) };
}

function getExporter() {
  mountIoOsmPlugin();
  return e.mock.calls[0]![0]!.onExport;
}

function parseXml(xml: string) {
  const nodeIds = [...xml.matchAll(/<node id="([^"]+)"/g)].map(m => m[1]);
  const ways = [...xml.matchAll(/<way id="([^"]+)">([\s\S]*?)<\/way>/g)].map(m => ({
    id: m[1],
    nds: [...m[2]!.matchAll(/<nd ref="([^"]+)"/g)].map(n => n[1]),
  }));
  return { nodeIds, ways };
}

describe('io-osm.plugin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mounts', () => { const c = mountIoOsmPlugin(); expect(typeof c).toBe('function'); c(); });
  it('registers exporter', () => { const c = mountIoOsmPlugin(); expect(e).toHaveBeenCalled(); c(); });
  it('exporter format is OSM', () => { const c = mountIoOsmPlugin(); expect(e.mock.calls[0]![0].formatName).toContain('OpenStreetMap'); c(); });
  it('unregisters', () => { const c = mountIoOsmPlugin(); c(); expect(u).toHaveBeenCalledWith('io-osm-export'); });

  describe('exportToOsm', () => {
    it('empty project produces valid OSM with no nodes/ways', async () => {
      const xml = await captureXml(makeProject([]));
      expect(xml).toContain('<osm version="0.6"');
      expect(xml).toContain('</osm>');
      const { nodeIds, ways } = parseXml(xml);
      expect(nodeIds).toHaveLength(0);
      expect(ways).toHaveLength(0);
    });

    it('single-segment road produces 2 nodes and 1 way', async () => {
      const road = makeRoad('r1', [{ x: 0, y: 0, hdg: 0, length: 100, s: 0 }]);
      const xml = await captureXml(makeProject([road]));
      const { nodeIds, ways } = parseXml(xml);
      expect(nodeIds).toHaveLength(2);
      expect(ways).toHaveLength(1);
      expect(ways[0]!.nds).toHaveLength(2);
    });

    it('multi-segment road produces correct nodes and 1 way', async () => {
      const road = makeRoad('r2', [
        { x: 0, y: 0, hdg: 0, length: 50, s: 0 },
        { x: 50, y: 0, hdg: 0, length: 50, s: 50 },
        { x: 100, y: 0, hdg: 0, length: 50, s: 100 },
      ]);
      const xml = await captureXml(makeProject([road]));
      const { nodeIds, ways } = parseXml(xml);
      // 3 segments → start + 3 endpoints = 4 nodes (adjacent segments share endpoints)
      expect(nodeIds).toHaveLength(4);
      expect(ways).toHaveLength(1);
      expect(ways[0]!.nds).toHaveLength(4);
    });

    it('way nd refs match node ids', async () => {
      const road = makeRoad('r3', [
        { x: 10, y: 20, hdg: 0, length: 30, s: 0 },
        { x: 40, y: 20, hdg: 0, length: 30, s: 30 },
      ]);
      const xml = await captureXml(makeProject([road]));
      const { nodeIds, ways } = parseXml(xml);
      const nodeSet = new Set(nodeIds);
      for (const nd of ways[0]!.nds) {
        expect(nodeSet.has(nd)).toBe(true);
      }
    });

    it('multi-road project produces multiple ways', async () => {
      const roads = [
        makeRoad('ra', [{ x: 0, y: 0, hdg: 0, length: 10, s: 0 }]),
        makeRoad('rb', [{ x: 5, y: 5, hdg: 0, length: 10, s: 0 }]),
      ];
      const xml = await captureXml(makeProject(roads));
      const { ways } = parseXml(xml);
      expect(ways).toHaveLength(2);
    });

    it('way contains ref tag with road id', async () => {
      const road = makeRoad('myroad', [{ x: 0, y: 0, hdg: 0, length: 10, s: 0 }]);
      const xml = await captureXml(makeProject([road]));
      expect(xml).toContain('v="myroad"');
    });

    it('escapes special characters in road id', async () => {
      const road = makeRoad('road&1<2>3"4\'5', [{ x: 0, y: 0, hdg: 0, length: 10, s: 0 }]);
      const xml = await captureXml(makeProject([road]));
      expect(xml).toContain('v="road&amp;1&lt;2&gt;3&quot;4&apos;5"');
      expect(xml).not.toContain('v="road&1<2>3"');
    });
  });
});

async function captureXml(project: Project): Promise<string> {
  const { saveExport } = await import('../../../utils/download');
  const exporter = getExporter();
  await exporter(project);
  const call = (saveExport as ReturnType<typeof vi.fn>).mock.calls[0]!;
  const blob = call[0] as Blob;
  // Use FileReader polyfill since Blob.text() may not be available in test env
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}
