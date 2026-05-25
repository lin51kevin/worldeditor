import { deployCrosswalks, deployStopLines, deploySidewalks, applyStandardMarkings, evalRoadAtS, findClosestSOnRoad, resampleRoad, splitRoadAt, weldRoads } from './roadEdit';
import type { Road, Geometry, GeometryType, LaneSection, Project } from '../services/platform';

function makeRoad(
  geo: Geometry[],
  length: number,
  lane_sections?: LaneSection[],
  overrides?: Partial<Road>,
): Road {
  return {
    id: 'r1',
    name: 'test',
    length,
    junction_id: null,
    plan_view: geo,
    elevation_profile: [],
    lane_sections: lane_sections ?? [
      {
        s: 0,
        single_side: false,
        left: [],
        right: [
          {
            id: -1,
            lane_type: 'Driving',
            level: 0,
            link: null,
            width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }],
            road_marks: [],
          },
        ],
        center: [],
      },
    ],
    link: { predecessor: null, successor: null },
    ...overrides,
  };
}

function makeLaneSection(s: number, width: number): LaneSection {
  return {
    s,
    single_side: false,
    left: [],
    center: [],
    right: [{ id: -1, lane_type: 'Driving', level: 0, link: null, width: [{ s_offset: 0, a: width, b: 0, c: 0, d: 0 }], road_marks: [] }],
  };
}

// ─── evalGeometryAtS tests (via splitRoadAt behavior) ────────────────────────

describe('splitRoadAt', () => {
  // ── Line ─────────────────────────────────────────────────────────────────
  it('splits a Line road at correct position', () => {
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
      100,
    );
    const { road1, road2, junction } = splitRoadAt(road, 40);

    expect(road1.length).toBe(40);
    expect(road2.length).toBe(60);
    // split point should be at (40, 0)
    expect(road2.plan_view[0].x).toBeCloseTo(40, 4);
    expect(road2.plan_view[0].y).toBeCloseTo(0, 4);
  });

  // ── Arc ─────────────────────────────────────────────────────────────────
  it('splits an Arc road at correct curved position', () => {
    const curvature = 0.01; // radius = 100
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: { Arc: { curvature } } }],
      100,
    );
    const { road1, road2 } = splitRoadAt(road, 50);

    expect(road1.length).toBe(50);
    expect(road2.length).toBe(50);

    // The split point should NOT be at (50, 0) — that would be the line approximation.
    // For arc with κ=0.01, ds=50: θ=0.5, lx=sin(0.5)/0.01≈47.94, ly=(1-cos(0.5))/0.01≈12.19
    const pv2 = road2.plan_view[0];
    expect(pv2.x).toBeCloseTo(47.94, 0);
    expect(pv2.y).toBeCloseTo(12.19, 0);
    expect(pv2.hdg).toBeCloseTo(0.5, 4); // hdg0 + κ*ds
  });

  it('Arc split point differs from line approximation', () => {
    const curvature = 0.02;
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: { Arc: { curvature } } }],
      100,
    );
    const { road2 } = splitRoadAt(road, 50);
    const pv2 = road2.plan_view[0];

    // Line approximation would give x=50, y=0 — arc should differ significantly
    expect(pv2.y).toBeGreaterThan(5); // should be far from 0
    expect(pv2.x).not.toBeCloseTo(50, 0);
  });

  // ── Spiral ──────────────────────────────────────────────────────────────
  it('splits a Spiral road at reasonable position', () => {
    const road = makeRoad(
      [
        {
          s: 0,
          x: 0,
          y: 0,
          hdg: 0,
          length: 100,
          geo_type: { Spiral: { curv_start: 0, curv_end: 0.01 } },
        },
      ],
      100,
    );
    const { road2 } = splitRoadAt(road, 50);
    const pv2 = road2.plan_view[0];

    // Spiral should produce a non-trivial y offset (but less than arc with same curvature)
    expect(pv2.y).toBeGreaterThan(0);
    expect(pv2.hdg).toBeGreaterThan(0); // heading should increase
  });

  // ── Poly3 ───────────────────────────────────────────────────────────────
  it('splits a Poly3 road at correct position', () => {
    const road = makeRoad(
      [
        {
          s: 0,
          x: 0,
          y: 0,
          hdg: 0,
          length: 100,
          geo_type: { Poly3: { a: 0, b: 0, c: 0.001, d: 0 } },
        },
      ],
      100,
    );
    const { road2 } = splitRoadAt(road, 50);
    const pv2 = road2.plan_view[0];

    // y_local at ds=50: c*50^2 = 0.001*2500 = 2.5
    // global: X = 50*cos(0) - 2.5*sin(0) = 50, Y = 50*sin(0) + 2.5*cos(0) = 2.5
    expect(pv2.x).toBeCloseTo(50, 1);
    expect(pv2.y).toBeCloseTo(2.5, 1);
  });

  // ── contact_point ───────────────────────────────────────────────────────
  it('road1 successor contact_point is End', () => {
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
      100,
    );
    const { road1 } = splitRoadAt(road, 50);
    expect(road1.link?.successor?.contact_point).toBe('End');
  });

  it('road2 predecessor contact_point is Start', () => {
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
      100,
    );
    const { road2 } = splitRoadAt(road, 50);
    expect(road2.link?.predecessor?.contact_point).toBe('Start');
  });

  // ── Edge cases ──────────────────────────────────────────────────────────
  it('throws if splitS <= 0', () => {
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
      100,
    );
    expect(() => splitRoadAt(road, 0)).toThrow();
    expect(() => splitRoadAt(road, -1)).toThrow();
  });

  it('throws if splitS >= road.length', () => {
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
      100,
    );
    expect(() => splitRoadAt(road, 100)).toThrow();
  });

  // ── Multi-segment ───────────────────────────────────────────────────────
  it('handles multi-segment road split in second segment', () => {
    const road = makeRoad(
      [
        { s: 0, x: 0, y: 0, hdg: 0, length: 30, geo_type: 'Line' },
        { s: 30, x: 30, y: 0, hdg: 0, length: 70, geo_type: 'Line' },
      ],
      100,
    );
    const { road1, road2 } = splitRoadAt(road, 50);
    expect(road1.plan_view).toHaveLength(2);
    expect(road2.plan_view).toHaveLength(1);
    expect(road2.plan_view[0].s).toBe(0);
    expect(road2.plan_view[0].x).toBeCloseTo(50, 4);
  });
});

describe('weldRoads', () => {
  it('welds compatible end-to-start roads without changing direction', () => {
    const road1 = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 50, geo_type: 'Line' }],
      50,
      [makeLaneSection(0, 3.5)],
      { id: 'r1', name: 'Road 1' },
    );
    const road2 = makeRoad(
      [{ s: 0, x: 50, y: 0, hdg: 0, length: 30, geo_type: 'Line' }],
      30,
      [makeLaneSection(0, 3.5)],
      { id: 'r2', name: 'Road 2' },
    );

    const welded = weldRoads(road1, road2);

    expect(welded.length).toBe(80);
  expect(welded.junction_id).toBeNull();
    expect(welded.plan_view).toHaveLength(2);
    expect(welded.plan_view[1]?.s).toBe(50);
    expect(welded.plan_view[1]?.x).toBeCloseTo(50, 6);
    expect(welded.plan_view[1]?.hdg).toBeCloseTo(0, 6);
  });

  it('auto-reverses road2 when its end matches the weld point', () => {
    const road1 = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 50, geo_type: 'Line' }],
      50,
      [makeLaneSection(0, 3.5)],
      { id: 'r1', name: 'Road 1' },
    );
    const road2 = makeRoad(
      [{ s: 0, x: 80, y: 0, hdg: Math.PI, length: 30, geo_type: 'Line' }],
      30,
      [makeLaneSection(0, 3.5), makeLaneSection(10, 3.5)],
      { id: 'r2', name: 'Road 2' },
    );

    const welded = weldRoads(road1, road2);

    expect(welded.plan_view[1]?.x).toBeCloseTo(50, 6);
    expect(welded.plan_view[1]?.y).toBeCloseTo(0, 6);
    expect(welded.plan_view[1]?.hdg).toBeCloseTo(0, 6);
    expect(welded.lane_sections.map((section) => section.s)).toEqual([0, 50, 70]);
  });

  it('throws when road endpoints are too far apart', () => {
    const road1 = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 50, geo_type: 'Line' }],
      50,
      [makeLaneSection(0, 3.5)],
    );
    const road2 = makeRoad(
      [{ s: 0, x: 55, y: 2, hdg: 0, length: 30, geo_type: 'Line' }],
      30,
      [makeLaneSection(0, 3.5)],
      { id: 'r2' },
    );

    expect(() => weldRoads(road1, road2)).toThrow(/too far apart/i);
  });

  it('uses the larger default weld tolerance for near-miss endpoints', () => {
    const road1 = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 50, geo_type: 'Line' }],
      50,
      [makeLaneSection(0, 3.5)],
      { id: 'r1' },
    );
    const road2 = makeRoad(
      [{ s: 0, x: 50.35, y: 0, hdg: 0, length: 30, geo_type: 'Line' }],
      30,
      [makeLaneSection(0, 3.5)],
      { id: 'r2' },
    );

    expect(() => weldRoads(road1, road2)).not.toThrow();
  });

  it('accepts custom weld tolerances', () => {
    const road1 = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 50, geo_type: 'Line' }],
      50,
      [makeLaneSection(0, 3.5)],
      { id: 'r1' },
    );
    const road2 = makeRoad(
      [{ s: 0, x: 50, y: 0, hdg: Math.PI / 8, length: 30, geo_type: 'Line' }],
      30,
      [makeLaneSection(0, 3.5)],
      { id: 'r2' },
    );

    expect(() => weldRoads(road1, road2, { headingTolerance: Math.PI / 6 })).not.toThrow();
    expect(() => weldRoads(road1, road2, { headingTolerance: Math.PI / 16 })).toThrow(/headings are incompatible/i);
  });

  it('throws when road headings are incompatible at the weld point', () => {
    const road1 = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 50, geo_type: 'Line' }],
      50,
      [makeLaneSection(0, 3.5)],
    );
    const road2 = makeRoad(
      [{ s: 0, x: 50, y: 0, hdg: Math.PI / 2, length: 30, geo_type: 'Line' }],
      30,
      [makeLaneSection(0, 3.5)],
      { id: 'r2' },
    );

    expect(() => weldRoads(road1, road2)).toThrow(/headings are incompatible/i);
  });

  it('throws when lane topologies are incompatible at the weld point', () => {
    const road1 = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 50, geo_type: 'Line' }],
      50,
      [makeLaneSection(0, 3.5)],
    );
    const road2 = makeRoad(
      [{ s: 0, x: 50, y: 0, hdg: 0, length: 30, geo_type: 'Line' }],
      30,
      [{
        s: 0,
        single_side: false,
        left: [],
        center: [],
        right: [
          { id: -1, lane_type: 'Driving', level: 0, link: null, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] },
          { id: -2, lane_type: 'Driving', level: 0, link: null, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] },
        ],
      }],
      { id: 'r2' },
    );

    expect(() => weldRoads(road1, road2)).toThrow(/lane layouts are incompatible/i);
  });
});

// ─── ParamPoly3 split (Bug 2 / Bug 3 regression) ─────────────────────────────

describe('splitRoadAt — ParamPoly3', () => {
  /** A simple S-curve: u(p)=p, v(p)=p^2 (Normalized p) */
  const paramPoly3Type: GeometryType = {
    ParamPoly3: {
      a_u: 0, b_u: 1, c_u: 0, d_u: 0,
      a_v: 0, b_v: 0, c_v: 1, d_v: 0,
      p_range: 'Normalized',
    },
  };

  it('split point is NOT a line approximation for ParamPoly3', () => {
    const L = 100;
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: L, geo_type: paramPoly3Type }],
      L,
    );
    const { road2 } = splitRoadAt(road, 50);
    const pv2 = road2.plan_view[0];

    // At p=0.5 (Normalized, ds=50 of 100): u=0.5, v=0.25
    // Global (hdg0=0): X=0.5, Y=0.25 — NOT (50, 0) as line approx would give
    expect(pv2.x).toBeCloseTo(0.5, 3);
    expect(pv2.y).toBeCloseTo(0.25, 3);
  });

  it('second half: a_u/a_v are 0 and polynomial starts tangent in local frame', () => {
    const L = 100;
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: L, geo_type: paramPoly3Type }],
      L,
    );
    const { road2 } = splitRoadAt(road, 50);
    const pv2 = road2.plan_view[0];
    if (!('ParamPoly3' in pv2.geo_type)) throw new Error('expected ParamPoly3');
    const t = (pv2.geo_type as { ParamPoly3: Record<string, number> }).ParamPoly3;
    // a_u, a_v must be 0 (absorbed into split2X/Y)
    expect(t['a_u']).toBeCloseTo(0, 10);
    expect(t['a_v']).toBeCloseTo(0, 10);
    // After frame rotation to split2Hdg, the polynomial must be tangent in the
    // local frame: b_v should be ~0 (no initial lateral movement in new frame).
    // split2Hdg at p=0.5 for u=p,v=p^2 is atan2(1,1)=π/4; β = 0-π/4 = -π/4
    // B_u=0.5, B_v=0.5 (pre-rotation); rotated: b_u = (B_u-B_v·tan)/... = 1/√2, b_v=0
    expect(t['b_v']).toBeCloseTo(0, 4);
    expect(t['b_u']).toBeGreaterThan(0);
  });

  it('first half heading is re-parametrized correctly', () => {
    const L = 100;
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: L, geo_type: paramPoly3Type }],
      L,
    );
    const { road1 } = splitRoadAt(road, 50);
    const pv1 = road1.plan_view[0];
    if (!('ParamPoly3' in pv1.geo_type)) throw new Error('expected ParamPoly3');
    const t = (pv1.geo_type as { ParamPoly3: Record<string, number> }).ParamPoly3;
    // p0 = 0.5, beta1 = 0.5:  b_u1 = 1 * 0.5 = 0.5, c_v1 = 1 * 0.25 = 0.25
    expect(t['b_u']).toBeCloseTo(0.5, 6);
    expect(t['c_v']).toBeCloseTo(0.25, 6);
  });
});

// ─── Spiral geometry split (Bug 4 regression) ────────────────────────────────

describe('splitRoadAt — Spiral curv_start/end', () => {
  it('first half curv_end equals curvature at split point', () => {
    const L = 100;
    const c0 = 0, c1 = 0.02;
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: L, geo_type: { Spiral: { curv_start: c0, curv_end: c1 } } }],
      L,
    );
    const { road1 } = splitRoadAt(road, 50);
    const pv1 = road1.plan_view[0];
    if (!('Spiral' in pv1.geo_type)) throw new Error('expected Spiral');
    const cMid = c0 + (c1 - c0) * 50 / L; // 0.01
    expect(pv1.geo_type.Spiral.curv_start).toBeCloseTo(c0, 10);
    expect(pv1.geo_type.Spiral.curv_end).toBeCloseTo(cMid, 6);
  });

  it('second half curv_start equals curvature at split point', () => {
    const L = 100;
    const c0 = 0, c1 = 0.02;
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: L, geo_type: { Spiral: { curv_start: c0, curv_end: c1 } } }],
      L,
    );
    const { road2 } = splitRoadAt(road, 50);
    const pv2 = road2.plan_view[0];
    if (!('Spiral' in pv2.geo_type)) throw new Error('expected Spiral');
    const cMid = c0 + (c1 - c0) * 50 / L; // 0.01
    expect(pv2.geo_type.Spiral.curv_start).toBeCloseTo(cMid, 6);
    expect(pv2.geo_type.Spiral.curv_end).toBeCloseTo(c1, 10);
  });
});

// ─── Lane section distribution (Bug 1 regression) ────────────────────────────

describe('splitRoadAt — lane section distribution', () => {
  function makeLaneSection(s: number, width: number): LaneSection {
    return {
      s,
      single_side: false,
      left: [],
      right: [{ id: -1, lane_type: 'Driving', level: 0, link: null, width: [{ s_offset: 0, a: width, b: 0, c: 0, d: 0 }], road_marks: [] }],
      center: [],
    };
  }

  it('road2 always starts with s=0 lane section (single section)', () => {
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
      100,
    );
    const { road2 } = splitRoadAt(road, 50);
    expect(road2.lane_sections[0].s).toBe(0);
  });

  it('road2 starts at s=0 even when sections exist before AND after split', () => {
    // Sections at s=0, 30, 60; split at 50 — previously road2 had first section at s=10
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
      100,
      [makeLaneSection(0, 3.5), makeLaneSection(30, 4.0), makeLaneSection(60, 3.0)],
    );
    const { road2 } = splitRoadAt(road, 50);
    expect(road2.lane_sections[0].s).toBe(0);
    // The section at s=60 should be re-based to s=10
    const second = road2.lane_sections.find((ls) => ls.s > 0);
    expect(second?.s).toBe(10);
  });

  it('road2 boundary section width is evaluated at split offset, not section start', () => {
    // Section at s=0 with linearly growing width: a=3.0, b=0.02 → width(50) = 3.0+0.02*50 = 4.0
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
      100,
      [{
        s: 0,
        single_side: false,
        left: [],
        right: [{ id: -1, lane_type: 'Driving', level: 0, link: null, width: [{ s_offset: 0, a: 3.0, b: 0.02, c: 0, d: 0 }], road_marks: [] }],
        center: [],
      }],
    );
    const { road2 } = splitRoadAt(road, 50);
    const w = road2.lane_sections[0].right[0]?.width[0];
    expect(w?.a).toBeCloseTo(4.0, 4); // 3.0 + 0.02*50
    expect(w?.b).toBe(0);             // baked to constant
  });
});

// ─── ParamPoly3 frame rotation (Bug 3b regression) ────────────────────────────

describe('splitRoadAt — ParamPoly3 frame rotation', () => {
  /**
   * Curve: u(p)=p, v(p)=p^2 (Normalized).
   * Heading at p: atan2(dv/dp, du/dp) = atan2(2p, 1).
   * At midpoint p0=0.5: heading offset = atan2(1,1) = π/4.
   * So split2Hdg = hdg0 + π/4 ≈ π/4 when hdg0=0.
   */
  const paramType: GeometryType = {
    ParamPoly3: {
      a_u: 0, b_u: 1, c_u: 0, d_u: 0,
      a_v: 0, b_v: 0, c_v: 1, d_v: 0,
      p_range: 'Normalized',
    },
  };
  const L = 100;

  it('road2 start heading matches split point heading', () => {
    const road = makeRoad([{ s: 0, x: 0, y: 0, hdg: 0, length: L, geo_type: paramType }], L);
    const { road2 } = splitRoadAt(road, 50);
    const expectedHdg = Math.atan2(1, 1); // atan2(2*0.5, 1) = π/4
    expect(road2.plan_view[0].hdg).toBeCloseTo(expectedHdg, 3);
  });

  it('road2 polynomial has zero lateral start component (tangent to curve)', () => {
    // After rotation fix: in road2's local frame (split2Hdg), the polynomial
    // must start tangent to the curve, i.e. b_v2 ≈ 0 (no lateral component at p'=0).
    const road = makeRoad([{ s: 0, x: 0, y: 0, hdg: 0, length: L, geo_type: paramType }], L);
    const { road2 } = splitRoadAt(road, 50);
    const pv2 = road2.plan_view[0];
    if (!('ParamPoly3' in pv2.geo_type)) throw new Error('expected ParamPoly3');
    const pp3 = (pv2.geo_type as { ParamPoly3: Record<string, number> }).ParamPoly3;
    // a_v must be 0 (curve starts at split point, no lateral offset)
    expect(pp3['a_v']).toBeCloseTo(0, 10);
    // b_v must be 0 in road2's local frame (tangent to curve direction)
    expect(pp3['b_v']).toBeCloseTo(0, 4);
    // b_u must be positive (curve continues forward)
    expect(pp3['b_u']).toBeGreaterThan(0);
  });
});

describe('splitRoadAt — rich properties (lateral, objects, signals, bridges)', () => {
  it('distributes objects, signals, bridges, tunnels, and lateral_profile across split', () => {
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
      100,
      undefined,
      {
        objects: [
          { id: 'o1', object_type: 'Pole', position: { x: 30, y: 0 }, hdg: 0, orientation: 0, height: 3, length: 0, width: 0, radius: 0, zOffset: 0, corners: [{ x: 30, y: 0 }], validity: null, repeat: null },
          { id: 'o2', object_type: 'Barrier', position: { x: 70, y: 1 }, hdg: 0, orientation: 0, height: 1, length: 5, width: 0.5, radius: 0, zOffset: 0, corners: [{ x: 70, y: 1 }], validity: { from_lane: -1, to_lane: -1 }, repeat: null },
        ],
        signals: [
          { id: 's1', s: 20, t: 0, dynamic: false, orientation: '+', country: '', type: '1000001', subtype: '-1', value: 0, text: '', width: 0.5, height: 2, zOffset: 3, name: '' },
          { id: 's2', s: 80, t: 2, dynamic: true, orientation: '-', country: '', type: '206', subtype: '-1', value: 0, text: '', width: 0.4, height: 1.5, zOffset: 2.5, name: '' },
        ],
        bridges: [{ s: 10, length: 30, id: 'b1', type: 'concrete', name: 'Bridge 1' }],
        tunnels: [{ s: 60, length: 20, id: 't1', type: 'standard', name: 'Tunnel 1' }],
        lateral_profile: {
          superelevation: [{ s: 0, a: 0, b: 0.01, c: 0, d: 0 }],
          crossfall: [{ s: 0, a: 0, b: 0, c: 0, d: 0 }],
          superelevations: [{ s: 0, a: 0, b: 0.01, c: 0, d: 0 }],
          crossfalls: [{ s: 0, a: 0, b: 0, c: 0, d: 0 }],
        },
      },
    );
    const { road1, road2 } = splitRoadAt(road, 50);
    expect(road1.length).toBeCloseTo(50);
    expect(road2.length).toBeCloseTo(50);
    // Object o1 at s=30 goes to road1, o2 at s=70 goes to road2
    expect(road1.objects!.some((o) => o.id === 'o1')).toBe(true);
    expect(road2.objects!.some((o) => o.id === 'o2')).toBe(true);
    // Signal s1 at s=20 goes to road1, s2 at s=80 goes to road2
    expect(road1.signals!.some((s) => s.id === 's1')).toBe(true);
    expect(road2.signals!.some((s) => s.id === 's2')).toBe(true);
    // Bridge at s=10,len=30 should be in road1
    expect(road1.bridges!.length).toBeGreaterThan(0);
    // Tunnel at s=60,len=20 should be in road2
    expect(road2.tunnels!.length).toBeGreaterThan(0);
    // Lateral profile should exist in both
    expect(road1.lateral_profile).toBeDefined();
    expect(road2.lateral_profile).toBeDefined();
  });
});

describe('findClosestSOnRoad', () => {
  it('returns the nearest station on a straight road', () => {
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
      100,
    );

    expect(findClosestSOnRoad(road, { x: 37, y: 5 })).toBeCloseTo(37, 1);
  });

  it('handles multi-segment roads', () => {
    const road = makeRoad(
      [
        { s: 0, x: 0, y: 0, hdg: 0, length: 40, geo_type: 'Line' },
        { s: 40, x: 40, y: 0, hdg: Math.PI / 2, length: 60, geo_type: 'Line' },
      ],
      100,
    );

    expect(findClosestSOnRoad(road, { x: 43, y: 18 })).toBeCloseTo(58, 1);
  });
});

describe('resampleRoad', () => {
  it('rebuilds a road as piecewise line segments with recomputed length', () => {
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: { Arc: { curvature: 0.01 } } }],
      100,
      [
        {
          s: 0,
          single_side: false,
          left: [],
          right: [{ id: -1, lane_type: 'Driving', level: 0, link: null, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] }],
          center: [],
        },
        {
          s: 120,
          single_side: false,
          left: [],
          right: [{ id: -1, lane_type: 'Driving', level: 0, link: null, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] }],
          center: [],
        },
      ],
    );

    const resampled = resampleRoad(road, 25);
    const totalSegmentLength = resampled.plan_view.reduce((sum, geometry) => sum + geometry.length, 0);

    expect(resampled).not.toBe(road);
    expect(resampled.plan_view).toHaveLength(4);
    expect(resampled.plan_view.every((geometry) => geometry.geo_type === 'Line')).toBe(true);
    expect(resampled.length).toBeCloseTo(totalSegmentLength, 8);
    expect(resampled.length).toBeLessThan(road.length);
    expect(resampled.lane_sections[1]?.s).toBeCloseTo(resampled.length, 8);
  });

  it('updates spline edit data to match sampled points', () => {
    const road = {
      ...makeRoad([{ s: 0, x: 0, y: 0, hdg: 0, length: 30, geo_type: 'Line' }], 30),
      spline_edit_data: [[0, 0, 1], [30, 0, 2]] as [number, number, number][],
    };

    const resampled = resampleRoad(road, 10);

    expect(resampled.spline_edit_data).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [20, 0, 0],
      [30, 0, 0],
    ]);
  });
});

// ─── deploySidewalks ──────────────────────────────────────────────────────────

describe('deploySidewalks', () => {
  it('adds sidewalk lanes on both sides', () => {
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 20, geo_type: 'Line' }],
      20,
      [{
        s: 0,
        single_side: false,
        left: [{ id: 1, lane_type: 'Driving', level: 0, link: null, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] }],
        center: [],
        right: [{ id: -1, lane_type: 'Driving', level: 0, link: null, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] }],
      }],
    );
    const result = deploySidewalks(road);
    const section = result.lane_sections[0]!;
    expect(section.left.some((l) => l.lane_type === 'Sidewalk')).toBe(true);
    expect(section.right.some((l) => l.lane_type === 'Sidewalk')).toBe(true);
  });

  it('does not add duplicate sidewalk if already present', () => {
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }],
      10,
      [{
        s: 0,
        single_side: false,
        left: [
          { id: 1, lane_type: 'Driving', level: 0, link: null, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] },
          { id: 2, lane_type: 'Sidewalk', level: 0, link: null, width: [{ s_offset: 0, a: 2.0, b: 0, c: 0, d: 0 }], road_marks: [] },
        ],
        center: [],
        right: [
          { id: -1, lane_type: 'Driving', level: 0, link: null, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] },
          { id: -2, lane_type: 'Sidewalk', level: 0, link: null, width: [{ s_offset: 0, a: 2.0, b: 0, c: 0, d: 0 }], road_marks: [] },
        ],
      }],
    );
    const result = deploySidewalks(road);
    const section = result.lane_sections[0]!;
    expect(section.left.filter((l) => l.lane_type === 'Sidewalk')).toHaveLength(1);
    expect(section.right.filter((l) => l.lane_type === 'Sidewalk')).toHaveLength(1);
  });

  it('uses custom width', () => {
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }],
      10,
    );
    const result = deploySidewalks(road, 3.0);
    const section = result.lane_sections[0]!;
    const rightSidewalk = section.right.find((l) => l.lane_type === 'Sidewalk');
    expect(rightSidewalk?.width[0]?.a).toBe(3.0);
  });

  it('does not mutate original road', () => {
    const road = makeRoad([{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }], 10);
    const originalLen = road.lane_sections[0]!.right.length;
    deploySidewalks(road);
    expect(road.lane_sections[0]!.right.length).toBe(originalLen);
  });
});

// ─── applyStandardMarkings ────────────────────────────────────────────────────

describe('applyStandardMarkings', () => {
  it('applies solid mark to outermost lanes, broken to inner', () => {
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }],
      10,
      [{
        s: 0,
        single_side: false,
        left: [
          { id: 1, lane_type: 'Driving', level: 0, link: null, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] },
          { id: 2, lane_type: 'Driving', level: 0, link: null, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] },
        ],
        center: [],
        right: [
          { id: -1, lane_type: 'Driving', level: 0, link: null, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] },
          { id: -2, lane_type: 'Driving', level: 0, link: null, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] },
        ],
      }],
    );
    const result = applyStandardMarkings(road);
    const section = result.lane_sections[0]!;
    // Left: id=2 is outermost (max), id=1 is inner
    expect(section.left.find((l) => l.id === 2)?.road_marks[0]?.mark_type).toBe('Solid');
    expect(section.left.find((l) => l.id === 1)?.road_marks[0]?.mark_type).toBe('Broken');
    // Right: id=-2 is outermost (min), id=-1 is inner
    expect(section.right.find((l) => l.id === -2)?.road_marks[0]?.mark_type).toBe('Solid');
    expect(section.right.find((l) => l.id === -1)?.road_marks[0]?.mark_type).toBe('Broken');
  });

  it('does not mutate original road', () => {
    const road = makeRoad([{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }], 10);
    applyStandardMarkings(road);
    expect(road.lane_sections[0]!.right[0]?.road_marks).toHaveLength(0);
  });
});

// ─── deployCrosswalks ─────────────────────────────────────────────────────────

describe('deployCrosswalks', () => {
  function makeProject(roads: Road[], junctions: Project['junctions'] = []): Project {
    return {
      name: 'test',
      header: { rev_major: 1, rev_minor: 0, name: 'test', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
      roads,
      junctions,
      signals: [],
      objects: [],
    };
  }

  it('returns unchanged project if junction not found', () => {
    const project = makeProject([makeRoad([{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }], 10)]);
    const result = deployCrosswalks(project, 'nonexistent');
    expect(result).toBe(project);
  });

  it('adds crosswalk objects at midpoint of each connecting road', () => {
    const conn1 = makeRoad([{ s: 0, x: 0, y: 0, hdg: 0, length: 20, geo_type: 'Line' }], 20, undefined, { id: 'conn1' });
    const conn2 = makeRoad([{ s: 0, x: 0, y: 0, hdg: 0, length: 30, geo_type: 'Line' }], 30, undefined, { id: 'conn2' });
    const project = makeProject(
      [makeRoad([{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }], 10), conn1, conn2],
      [{ id: 'j1', name: 'j1', connections: [
        { id: 'c1', incoming_road: 'r1', connecting_road: 'conn1', contact_point: 'Start' as const, lane_links: [] },
        { id: 'c2', incoming_road: 'r1', connecting_road: 'conn2', contact_point: 'Start' as const, lane_links: [] },
      ] }],
    );
    const result = deployCrosswalks(project, 'j1');
    const newObjects = result.objects.filter((o) => o.type === 'crosswalk');
    expect(newObjects).toHaveLength(2);
    expect(newObjects[0]?.sPosition).toBe(10); // midpoint of 20
    expect(newObjects[1]?.sPosition).toBe(15); // midpoint of 30
  });

  it('does not mutate original project', () => {
    const conn = makeRoad([{ s: 0, x: 0, y: 0, hdg: 0, length: 20, geo_type: 'Line' }], 20, undefined, { id: 'conn' });
    const project = makeProject(
      [makeRoad([{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }], 10), conn],
      [{ id: 'j1', name: 'j1', connections: [{ id: 'c1', incoming_road: 'r1', connecting_road: 'conn', contact_point: 'Start' as const, lane_links: [] }] }],
    );
    deployCrosswalks(project, 'j1');
    expect(project.objects).toHaveLength(0);
  });
});

// ─── deployStopLines ──────────────────────────────────────────────────────────

describe('deployStopLines', () => {
  function makeProject(roads: Road[], junctions: Project['junctions'] = []): Project {
    return {
      name: 'test',
      header: { rev_major: 1, rev_minor: 0, name: 'test', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
      roads,
      junctions,
      signals: [],
      objects: [],
    };
  }

  it('returns unchanged project if junction not found', () => {
    const project = makeProject([makeRoad([{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }], 10)]);
    const result = deployStopLines(project, 'nonexistent');
    expect(result).toBe(project);
  });

  it('adds stop line 1m before end of each unique incoming road', () => {
    const r1 = makeRoad([{ s: 0, x: 0, y: 0, hdg: 0, length: 15, geo_type: 'Line' }], 15, undefined, { id: 'r1' });
    const r2 = makeRoad([{ s: 0, x: 0, y: 0, hdg: 0, length: 20, geo_type: 'Line' }], 20, undefined, { id: 'r2' });
    const project = makeProject(
      [r1, r2, makeRoad([{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }], 10, undefined, { id: 'conn' })],
      [{ id: 'j1', name: 'j1', connections: [
        { id: 'c1', incoming_road: 'r1', connecting_road: 'conn', contact_point: 'Start' as const, lane_links: [] },
        { id: 'c2', incoming_road: 'r2', connecting_road: 'conn', contact_point: 'Start' as const, lane_links: [] },
      ] }],
    );
    const result = deployStopLines(project, 'j1');
    const stopLines = result.objects.filter((o) => o.type === 'stopline');
    expect(stopLines).toHaveLength(2);
    expect(stopLines.find((o) => o.roadId === 'r1')?.sPosition).toBe(14); // 15 - 1
    expect(stopLines.find((o) => o.roadId === 'r2')?.sPosition).toBe(19); // 20 - 1
  });

  it('deduplicates incoming roads', () => {
    const r1 = makeRoad([{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }], 10, undefined, { id: 'r1' });
    const project = makeProject(
      [r1, makeRoad([{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }], 10, undefined, { id: 'conn1' }),
        makeRoad([{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }], 10, undefined, { id: 'conn2' })],
      [{ id: 'j1', name: 'j1', connections: [
        { id: 'c1', incoming_road: 'r1', connecting_road: 'conn1', contact_point: 'Start' as const, lane_links: [] },
        { id: 'c2', incoming_road: 'r1', connecting_road: 'conn2', contact_point: 'Start' as const, lane_links: [] },
      ] }],
    );
    const result = deployStopLines(project, 'j1');
    const stopLines = result.objects.filter((o) => o.type === 'stopline');
    expect(stopLines).toHaveLength(1);
  });
});

// ─── evalRoadAtS geometry branch coverage ────────────────────────────────────

describe('evalRoadAtS geometry types', () => {
  it('evaluates Spiral geometry', () => {
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 50, geo_type: { Spiral: { curv_start: 0, curv_end: 0.02 } } }],
      50,
    );
    const pt = evalRoadAtS(road, 25);
    // Spiral should produce non-trivial curvature (not a straight line)
    expect(pt.x).toBeGreaterThan(0);
    expect(pt.hdg).toBeGreaterThan(0);
  });

  it('evaluates Poly3 geometry', () => {
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 20, geo_type: { Poly3: { a: 0, b: 0, c: 0.01, d: 0 } } }],
      20,
    );
    const pt = evalRoadAtS(road, 10);
    // y_local = 0 + 0 + 0.01*100 + 0 = 1 → rotated by hdg=0 → y=1
    expect(pt.y).toBeCloseTo(1, 4);
    expect(pt.x).toBeCloseTo(10, 4);
  });

  it('evaluates ParamPoly3 geometry (Normalized)', () => {
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: { ParamPoly3: {
        a_u: 0, b_u: 100, c_u: 0, d_u: 0,
        a_v: 0, b_v: 0, c_v: 50, d_v: 0,
        p_range: 'Normalized',
      } } }],
      100,
    );
    const pt = evalRoadAtS(road, 50);
    // p = 50/100 = 0.5; u = 100*0.5 = 50; v = 50*0.25 = 12.5
    expect(pt.x).toBeCloseTo(50, 0);
    expect(pt.y).toBeCloseTo(12.5, 0);
  });

  it('evaluates ParamPoly3 geometry (ArcLength)', () => {
    const road = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: { ParamPoly3: {
        a_u: 0, b_u: 1, c_u: 0, d_u: 0,
        a_v: 0, b_v: 0, c_v: 0.001, d_v: 0,
        p_range: 'ArcLength',
      } } }],
      100,
    );
    const pt = evalRoadAtS(road, 50);
    // p = 50 (ArcLength); u = 50; v = 0.001*2500 = 2.5
    expect(pt.x).toBeCloseTo(50, 0);
    expect(pt.y).toBeCloseTo(2.5, 0);
  });

  it('evaluates road with empty plan_view', () => {
    const road = makeRoad([], 0);
    const pt = evalRoadAtS(road, 5);
    expect(pt.x).toBe(0);
    expect(pt.y).toBe(0);
    expect(pt.hdg).toBe(0);
  });

  it('evaluates Arc with near-zero curvature (degenerates to line)', () => {
    const road = makeRoad(
      [{ s: 0, x: 10, y: 5, hdg: Math.PI / 4, length: 50, geo_type: { Arc: { curvature: 1e-15 } } }],
      50,
    );
    const pt = evalRoadAtS(road, 25);
    // Should behave like a line
    expect(pt.x).toBeCloseTo(10 + 25 * Math.cos(Math.PI / 4), 2);
    expect(pt.y).toBeCloseTo(5 + 25 * Math.sin(Math.PI / 4), 2);
  });
});

// ─── weldRoads with reverse (triggers reverseRoad internal branch) ───────────

describe('weldRoads reverse branch', () => {
  it('welds two roads requiring reversal of road2', () => {
    // road1 ends at (100, 0), road2 starts at (100, 0) but points backward
    const road1 = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
      100,
    );
    const road2 = makeRoad(
      [{ s: 0, x: 200, y: 0, hdg: Math.PI, length: 100, geo_type: 'Line' }],
      100,
    );
    const welded = weldRoads(road1, road2);
    expect(welded.length).toBeCloseTo(200, 0);
  });

  it('throws when roads have incompatible headings at weld point', () => {
    const road1 = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
      100,
    );
    // road2 starts at (100, 0) but pointing perpendicular — heading mismatch
    const road2 = makeRoad(
      [{ s: 0, x: 100, y: 0, hdg: Math.PI / 2, length: 50, geo_type: 'Line' }],
      50,
    );
    expect(() => weldRoads(road1, road2)).toThrow('incompatible');
  });

  it('welds roads with Spiral geometry triggering reverseGeometryType(Spiral)', () => {
    const road1 = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 50, geo_type: 'Line' }],
      50,
    );
    // road2 end is at approximately (50, 0) — road2 starts far and points back
    const road2 = makeRoad(
      [{ s: 0, x: 100, y: 0, hdg: Math.PI, length: 50, geo_type: { Spiral: { curv_start: 0, curv_end: 0 } } }],
      50,
    );
    // road2 end ≈ (50, 0); road1 end = (50, 0) → endDistance ≈ 0, triggers reverse
    const welded = weldRoads(road1, road2, { positionTolerance: 5, headingTolerance: 0.5 });
    expect(welded.length).toBeCloseTo(100, 0);
    // Reversed spiral should flip curvatures
    const spiralGeo = welded.plan_view.find((g) => typeof g.geo_type === 'object' && 'Spiral' in g.geo_type);
    expect(spiralGeo).toBeDefined();
  });

  it('welds roads with objects and signals (exercises reverseRoadObjects)', () => {
    const road1 = makeRoad(
      [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
      100,
      undefined,
      {
        objects: [{ id: 'o1', object_type: 'Pole', position: { x: 50, y: 0 }, hdg: 0, orientation: 0, height: 3, length: 0, width: 0, radius: 0, zOffset: 0, corners: [], validity: null, repeat: null }],
        signals: [{ id: 's1', s: 50, t: 0, dynamic: false, orientation: '+', country: '', type: '1000001', subtype: '-1', value: 0, text: '', width: 0.5, height: 2, zOffset: 3, name: '' }],
      },
    );
    const road2 = makeRoad(
      [{ s: 0, x: 200, y: 0, hdg: Math.PI, length: 100, geo_type: 'Line' }],
      100,
      undefined,
      {
        id: 'r2',
        objects: [{ id: 'o2', object_type: 'Barrier', position: { x: 30, y: 0 }, hdg: 0, orientation: 90, height: 1, length: 10, width: 0.5, radius: 0, zOffset: 0, corners: [{ x: 30, y: 1 }], validity: { from_lane: -1, to_lane: -2 } , repeat: null }],
        signals: [{ id: 's2', s: 80, t: 2, dynamic: true, orientation: '-', country: '', type: '206', subtype: '-1', value: 0, text: '', width: 0.4, height: 1.5, zOffset: 2.5, name: '' }],
      },
    );
    const welded = weldRoads(road1, road2);
    expect(welded.length).toBeCloseTo(200);
    expect(welded.objects!.length).toBe(2);
    expect(welded.signals!.length).toBe(2);
    // road2 was reversed, so its object at s=30 should now be at totalLength - 30 = 70 + offset
    const reversedObj = welded.objects!.find((o) => o.id === 'o2');
    expect(reversedObj).toBeDefined();
    // Validity should be swapped
    expect(reversedObj!.validity!.from_lane).toBe(2);
    expect(reversedObj!.validity!.to_lane).toBe(1);
  });
});
