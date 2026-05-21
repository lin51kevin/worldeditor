import { splitRoadAt, weldRoads } from './roadEdit';
import type { Road, Geometry } from '../services/platform';

function makeRoad(geo: Geometry[], length: number): Road {
  return {
    id: 'r1',
    name: 'test',
    length,
    plan_view: geo,
    lane_sections: [
      {
        s: 0,
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
