import { describe, it, expect } from 'vitest';
import {
  buildLineGeometry,
  buildArcGeometry,
  buildSpiralGeometry,
  buildRoadFromGeometry,
  buildMultiLineGeometries,
  buildMultiArcGeometries,
  buildMultiSpiralGeometries,
  buildRoadFromGeometries,
  sampleGeometryPoints,
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

// ─── buildArcGeometry (direct) ────────────────────────────────────────────

describe('buildArcGeometry', () => {
  it('produces arc geo_type for non-collinear points', () => {
    const geo = buildArcGeometry([0, 0, 0], [5, 5, 0], [10, 0, 0]);
    expect(typeof geo.geo_type).toBe('object');
    if (typeof geo.geo_type === 'object' && 'Arc' in geo.geo_type) {
      expect(Math.abs(geo.geo_type.Arc.curvature)).toBeGreaterThan(0);
    }
  });

  it('falls back to line for collinear points', () => {
    const geo = buildArcGeometry([0, 0, 0], [5, 0, 0], [10, 0, 0]);
    expect(geo.geo_type).toBe('Line');
  });

  it('produces CW arc for clockwise point arrangement', () => {
    // Cross product: (bx-ax)*(cy-ay) - (by-ay)*(cx-ax)
    // (5-0)*(0-0) - (5-0)*(10-0) = 0 - 50 = -50 → CW → negative curvature
    const geo = buildArcGeometry([0, 0, 0], [5, 5, 0], [10, 0, 0]);
    // This is actually CCW, so curvature is positive. Let's do reversed:
    // (10,0)→(5,5)→(0,0): cross = (5-10)*(0-0) - (5-0)*(0-10) = 0+50 = 50 → still CCW
    // True CW: (0,0)→(5,-5)→(10,0): cross = 5*0 - (-5)*10 = 50 → still CCW!
    // Actually cross = (bx-ax)*(cy-ay) - (by-ay)*(cx-ax) = (5)*(0) - (-5)*(10) = 50 → CCW
    // Need cross < 0: try (0,0)→(-5,-5)→(0,-10)
    // cross = (-5)(-10) - (-5)(0) = 50 → still positive
    // (0,0)→(5,5)→(0,10): cross = 5*10 - 5*0 = 50 → still pos
    // Use known CW: p0=(1,0), p1=(0,-1), p2=(-1,0) (unit circle going CW)
    const geoCW = buildArcGeometry([1, 0, 0], [0, -1, 0], [-1, 0, 0]);
    expect(typeof geoCW.geo_type).toBe('object');
    if (typeof geoCW.geo_type === 'object' && 'Arc' in geoCW.geo_type) {
      expect(geoCW.geo_type.Arc.curvature).toBeLessThan(0);
    }
    expect(geoCW.length).toBeGreaterThan(0);
  });

  it('handles arc where sweep angle wraps past PI', () => {
    // Large arc: start → midpoint across more than 180°
    const geo = buildArcGeometry([10, 0, 0], [0, 10, 0], [-10, 0, 0]);
    expect(typeof geo.geo_type).toBe('object');
    if (typeof geo.geo_type === 'object' && 'Arc' in geo.geo_type) {
      expect(Math.abs(geo.geo_type.Arc.curvature)).toBeGreaterThan(0);
    }
    expect(geo.length).toBeGreaterThan(10);
  });
});

// ─── buildSpiralGeometry (direct) ────────────────────────────────────────

describe('buildSpiralGeometry', () => {
  it('produces a spiral geometry', () => {
    const geo = buildSpiralGeometry([0, 0, 0], [10, 0, 0]);
    expect(typeof geo.geo_type).toBe('object');
    if (typeof geo.geo_type === 'object' && 'Spiral' in geo.geo_type) {
      expect(geo.geo_type.Spiral.curv_start).toBe(0);
      expect(geo.geo_type.Spiral.curv_end).toBeGreaterThan(0);
    }
    expect(geo.length).toBeCloseTo(10, 5);
  });
});

// ─── buildRoadFromGeometry (singular) ────────────────────────────────────

describe('buildRoadFromGeometry', () => {
  it('creates a road with correct id and geometry', () => {
    const geo = buildLineGeometry([0, 0, 0], [20, 0, 0]);
    const road = buildRoadFromGeometry('road-1', geo);
    expect(road.id).toBe('road-1');
    expect(road.length).toBeCloseTo(20, 5);
    expect(road.plan_view).toHaveLength(1);
  });

  it('has one lane section with left/center/right lanes', () => {
    const geo = buildLineGeometry([0, 0, 0], [10, 0, 0]);
    const road = buildRoadFromGeometry('r', geo);
    expect(road.lane_sections).toHaveLength(1);
    expect(road.lane_sections[0]!.left).toHaveLength(1);
    expect(road.lane_sections[0]!.center).toHaveLength(1);
    expect(road.lane_sections[0]!.right).toHaveLength(1);
  });
});

// ─── sampleGeometryPoints ─────────────────────────────────────────────────

describe('sampleGeometryPoints', () => {
  it('returns numSamples+1 points for a line', () => {
    const geo = buildLineGeometry([0, 0, 0], [10, 0, 0]);
    const pts = sampleGeometryPoints(geo, 10);
    expect(pts).toHaveLength(11);
  });

  it('first point equals geometry start', () => {
    const geo = buildLineGeometry([5, 3, 0], [15, 3, 0]);
    const pts = sampleGeometryPoints(geo, 5);
    expect(pts[0]![0]).toBeCloseTo(5, 4);
    expect(pts[0]![1]).toBeCloseTo(3, 4);
  });

  it('last point equals geometry end for a straight line', () => {
    const geo = buildLineGeometry([0, 0, 0], [10, 0, 0]);
    const pts = sampleGeometryPoints(geo, 10);
    expect(pts[10]![0]).toBeCloseTo(10, 4);
    expect(pts[10]![1]).toBeCloseTo(0, 4);
  });

  it('samples arc geometry without error', () => {
    const geo = buildArcGeometry([0, 0, 0], [5, 5, 0], [10, 0, 0]);
    const pts = sampleGeometryPoints(geo, 8);
    expect(pts).toHaveLength(9);
    for (const p of pts) {
      expect(isNaN(p[0])).toBe(false);
      expect(isNaN(p[1])).toBe(false);
    }
  });

  it('samples spiral geometry without error', () => {
    const geo = buildSpiralGeometry([0, 0, 0], [10, 0, 0]);
    const pts = sampleGeometryPoints(geo, 8);
    expect(pts).toHaveLength(9);
    for (const p of pts) {
      expect(isNaN(p[0])).toBe(false);
    }
  });
});
