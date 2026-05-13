import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRegisterExporter = vi.fn();
const mockUnregisterPlugin = vi.fn();

vi.mock('../stores/pluginContribStore', () => ({
  usePluginContribStore: {
    getState: vi.fn(() => ({
      registerExporter: mockRegisterExporter,
      unregisterPlugin: mockUnregisterPlugin,
    })),
  },
}));

vi.mock('../utils/download', () => ({ downloadBlob: vi.fn() }));

import { mountIoObj3dPlugin, generateObjContent } from './ioObj3d.plugin';
import type { Project } from '../services/platform';

function makeProject(roads: Project['roads'] = []): Project {
  return { name: 'test', roads, signals: [], objects: [], junctions: [], header: { rev_major: 1, rev_minor: 1, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null } } as Project;
}

describe('ioObj3d.plugin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should mount and return a cleanup function', () => {
    const cleanup = mountIoObj3dPlugin();
    expect(typeof cleanup).toBe('function');
    cleanup();
  });

  it('should register an OBJ exporter', () => {
    const cleanup = mountIoObj3dPlugin();
    expect(mockRegisterExporter).toHaveBeenCalled();
    const contrib = mockRegisterExporter.mock.calls[0]?.[0];
    expect(contrib.formatName).toContain('OBJ');
    cleanup();
  });

  it('should unregister on cleanup', () => {
    const cleanup = mountIoObj3dPlugin();
    cleanup();
    expect(mockUnregisterPlugin).toHaveBeenCalledWith('io-obj3d');
  });
});

describe('generateObjContent', () => {
  it('empty project produces valid OBJ header', () => {
    const obj = generateObjContent(makeProject());
    expect(obj.startsWith('# WorldEditor')).toBe(true);
    expect(obj).toContain('# Roads: 0');
  });

  it('single-segment road produces 4 vertices and 2 faces', () => {
    const project = makeProject([{
      id: 'r1', name: '', length: 10, junction_id: null,
      plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }],
      lane_sections: [],
      link: { predecessor: null, successor: null },
      elevation_profile: [],
    } as any]);
    const obj = generateObjContent(project);
    const verts = obj.match(/^v /gm);
    const faces = obj.match(/^f /gm);
    expect(verts).toHaveLength(4);
    expect(faces).toHaveLength(2);
  });

  it('multi-segment road produces more vertices than single segment', () => {
    const project = makeProject([{
      id: 'r2', name: '', length: 20, junction_id: null,
      plan_view: [
        { s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' },
        { s: 10, x: 10, y: 0, hdg: 0, length: 10, geo_type: 'Line' },
      ],
      lane_sections: [],
      link: { predecessor: null, successor: null },
      elevation_profile: [],
    } as any]);
    const obj = generateObjContent(project);
    const verts = obj.match(/^v /gm);
    expect(verts).toHaveLength(8);
  });

  it('uses lane_sections width when available', () => {
    const project = makeProject([{
      id: 'r3', name: '', length: 10, junction_id: null,
      plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }],
      lane_sections: [{
        s: 0, single_side: false,
        left: [{ id: 1, lane_type: 'driving', level: 0, link: { predecessor: null, successor: null }, width: [{ s_offset: 0, a: 4, b: 0, c: 0, d: 0 }], road_marks: [] }],
        center: [],
        right: [],
      }],
      link: { predecessor: null, successor: null },
      elevation_profile: [],
    } as any]);
    const obj = generateObjContent(project);
    // Default width would give offset 1.75; lane width 4 gives offset 2
    // Check that vertices are wider than default
    const coords = obj.match(/v ([\d.\-]+) ([\d.\-]+) 0/g)!;
    // Left side x should be 2.0 (half of 4), not 1.75
    expect(coords[0]).toContain(' 2 ');
  });

  it('output starts with # WorldEditor header', () => {
    const obj = generateObjContent(makeProject());
    expect(obj).toMatch(/^# WorldEditor Next/);
  });

  it('road with no plan_view entries is skipped', () => {
    const project = makeProject([{
      id: 'r4', name: '', length: 10, junction_id: null,
      plan_view: [],
      lane_sections: [],
      link: { predecessor: null, successor: null },
      elevation_profile: [],
    } as any]);
    const obj = generateObjContent(project);
    const verts = obj.match(/^v /gm);
    expect(verts ?? []).toHaveLength(0);
  });
});
