import { splitRoadAt, weldRoads } from './roadEdit';
import type { Road, Geometry, GeometryType, LaneSection } from '../services/platform';

function makeRoad(geo: Geometry[], length: number, lane_sections?: LaneSection[]): Road {
  return {
    id: 'r1',
    name: 'test',
    length,
    plan_view: geo,
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
    type: '',
    junction: '',
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
