import { describe, it, expect } from 'vitest';
import {
  buildLineGeometry,
  buildMultiLineGeometries,
  buildMultiArcGeometries,
  buildMultiSpiralGeometries,
  buildRoadFromGeometries,
} from './geometryBuilder';

// ─── buildMultiLineGeometries ──────────────────────────────────────────────

describe('buildMultiLineGeometries', () => {
  it('returns empty array for fewer than 2 points', () => {
    expect(buildMultiLineGeometries([])).toEqual([]);
    expect(buildMultiLineGeometries([[0, 0, 0]])).toEqual([]);
  });

  it('returns one segment for exactly 2 points', () => {
    const p0: [number, number, number] = [0, 0, 0];
    const p1: [number, number, number] = [10, 0, 0];
    const segs = buildMultiLineGeometries([p0, p1]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.s).toBe(0);
    expect(segs[0]!.length).toBeCloseTo(10, 5);
    expect(segs[0]!.geo_type).toBe('Line');
  });

  it('returns N-1 segments for N points with cumulative s values', () => {
    const pts: Array<[number, number, number]> = [
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
      [20, 10, 0],
    ];
    const segs = buildMultiLineGeometries(pts);
    expect(segs).toHaveLength(3);
    expect(segs[0]!.s).toBeCloseTo(0, 5);
    expect(segs[1]!.s).toBeCloseTo(10, 5);
    expect(segs[2]!.s).toBeCloseTo(20, 5);
    // All are Line type
    segs.forEach((seg) => expect(seg.geo_type).toBe('Line'));
  });

  it('correctly positions each segment start point', () => {
    const pts: Array<[number, number, number]> = [
      [0, 0, 0],
      [5, 0, 0],
      [5, 5, 0],
    ];
    const segs = buildMultiLineGeometries(pts);
    expect(segs[0]!.x).toBeCloseTo(0, 5);
    expect(segs[0]!.y).toBeCloseTo(0, 5);
    expect(segs[1]!.x).toBeCloseTo(5, 5);
    expect(segs[1]!.y).toBeCloseTo(0, 5);
  });
});

// ─── buildMultiArcGeometries ───────────────────────────────────────────────

describe('buildMultiArcGeometries', () => {
  it('returns empty array for fewer than 3 points', () => {
    expect(buildMultiArcGeometries([])).toEqual([]);
    expect(buildMultiArcGeometries([[0, 0, 0]])).toEqual([]);
    expect(buildMultiArcGeometries([[0, 0, 0], [5, 0, 0]])).toEqual([]);
  });

  it('returns one arc segment for exactly 3 points', () => {
    const p0: [number, number, number] = [0, 0, 0];
    const p1: [number, number, number] = [5, 5, 0];
    const p2: [number, number, number] = [10, 0, 0];
    const segs = buildMultiArcGeometries([p0, p1, p2]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.s).toBe(0);
    expect(segs[0]!.length).toBeGreaterThan(0);
    expect(typeof segs[0]!.geo_type).toBe('object');
    if (typeof segs[0]!.geo_type === 'object' && 'Arc' in segs[0]!.geo_type) {
      expect(segs[0]!.geo_type.Arc.curvature).not.toBe(0);
    }
  });

  it('returns two arc segments for 5 points', () => {
    const pts: Array<[number, number, number]> = [
      [0, 0, 0],
      [5, 5, 0],
      [10, 0, 0],
      [15, 5, 0],
      [20, 0, 0],
    ];
    const segs = buildMultiArcGeometries(pts);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.s).toBeCloseTo(0, 5);
    expect(segs[1]!.s).toBeCloseTo(segs[0]!.length, 5);
  });

  it('ignores trailing dangling point for even N', () => {
    // 4 points → 1 arc (groups [0,1,2]; point 3 is ignored)
    const pts: Array<[number, number, number]> = [
      [0, 0, 0],
      [5, 5, 0],
      [10, 0, 0],
      [15, 5, 0], // dangling
    ];
    const segs = buildMultiArcGeometries(pts);
    expect(segs).toHaveLength(1);
  });

  it('falls back to line when points are collinear', () => {
    const pts: Array<[number, number, number]> = [
      [0, 0, 0],
      [5, 0, 0],
      [10, 0, 0],
    ];
    const segs = buildMultiArcGeometries(pts);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.geo_type).toBe('Line');
  });
});

// ─── buildMultiSpiralGeometries ────────────────────────────────────────────

describe('buildMultiSpiralGeometries', () => {
  it('returns empty array for fewer than 2 points', () => {
    expect(buildMultiSpiralGeometries([])).toEqual([]);
    expect(buildMultiSpiralGeometries([[0, 0, 0]])).toEqual([]);
  });

  it('returns one spiral for exactly 2 points', () => {
    const p0: [number, number, number] = [0, 0, 0];
    const p1: [number, number, number] = [10, 0, 0];
    const segs = buildMultiSpiralGeometries([p0, p1]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.s).toBe(0);
    expect(typeof segs[0]!.geo_type).toBe('object');
    if (typeof segs[0]!.geo_type === 'object' && 'Spiral' in segs[0]!.geo_type) {
      expect(segs[0]!.geo_type.Spiral.curv_start).toBe(0);
    }
  });

  it('returns N-1 spirals for N points with cumulative s values', () => {
    const pts: Array<[number, number, number]> = [
      [0, 0, 0],
      [10, 0, 0],
      [20, 0, 0],
      [30, 0, 0],
    ];
    const segs = buildMultiSpiralGeometries(pts);
    expect(segs).toHaveLength(3);
    expect(segs[0]!.s).toBeCloseTo(0, 5);
    expect(segs[1]!.s).toBeCloseTo(segs[0]!.length, 5);
    expect(segs[2]!.s).toBeCloseTo(segs[0]!.length + segs[1]!.length, 5);
  });
});

// ─── buildRoadFromGeometries ───────────────────────────────────────────────

describe('buildRoadFromGeometries', () => {
  it('creates a road with the correct total length', () => {
    const pts: Array<[number, number, number]> = [[0, 0, 0], [5, 0, 0], [5, 5, 0]];
    const geoms = buildMultiLineGeometries(pts);
    const road = buildRoadFromGeometries('test-road', geoms);
    expect(road.id).toBe('test-road');
    expect(road.plan_view).toHaveLength(2);
    expect(road.length).toBeCloseTo(10, 5); // 5 + 5
  });

  it('assigns correct plan_view with cumulative s', () => {
    const pts: Array<[number, number, number]> = [[0, 0, 0], [10, 0, 0], [20, 0, 0]];
    const geoms = buildMultiLineGeometries(pts);
    const road = buildRoadFromGeometries('r1', geoms);
    expect(road.plan_view[0]!.s).toBeCloseTo(0, 5);
    expect(road.plan_view[1]!.s).toBeCloseTo(10, 5);
  });

  it('creates exactly one lane section with left, center, right lanes', () => {
    const geoms = buildMultiLineGeometries([[0, 0, 0], [5, 0, 0]]);
    const road = buildRoadFromGeometries('r2', geoms);
    expect(road.lane_sections).toHaveLength(1);
    expect(road.lane_sections[0]!.left).toHaveLength(1);
    expect(road.lane_sections[0]!.center).toHaveLength(1);
    expect(road.lane_sections[0]!.right).toHaveLength(1);
  });

  it('handles a single geometry segment', () => {
    const geo = buildLineGeometry([0, 0, 0], [10, 0, 0]);
    const road = buildRoadFromGeometries('r3', [geo]);
    expect(road.length).toBeCloseTo(10, 5);
    expect(road.plan_view).toHaveLength(1);
  });
});
