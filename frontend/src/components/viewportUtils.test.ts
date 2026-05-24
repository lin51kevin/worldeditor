import { beforeEach, describe, expect, it } from 'vitest';
import type { Junction, Project, Road } from '../services/platform';
import { resetIdCounter } from '../plugins/editing/templates/engine';
import {
  AXIS_COLOR_X,
  AXIS_COLOR_Y,
  DRAG_THRESHOLD_SQ,
  GRID_COLOR,
  HOVER_HIGHLIGHT_COLOR,
  HOVER_HIGHLIGHT_Z_LIFT,
  MULTI_SELECT_HIGHLIGHT_COLOR,
  SELECT_HIGHLIGHT_COLOR,
  buildEditableSpline,
  exceededDragThreshold,
  findSplineControlPointHit,
  junctionIntersectsAABB,
  liftMeshZ,
  makeSplineKnot,
  mergeFloat32Arrays,
  nextSplineRoadId,
  roadIntersectsAABB,
  splineToRendererFormat,
  tangentFromHandlePosition,
} from './viewportUtils';

function makeRoad(overrides: Partial<Road> = {}): Road {
  return {
    id: 'r1',
    name: 'Main Road',
    length: 10,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }],
    elevation_profile: [],
    lane_sections: [],
    ...overrides,
  };
}

function makeProject(roads: Road[] = []): Project {
  return {
    name: 'Test',
    header: {
      rev_major: 1,
      rev_minor: 6,
      name: '',
      date: '',
      north: 0,
      south: 0,
      east: 0,
      west: 0,
      geo_reference: null,
    },
    roads,
    junctions: [],
    signals: [],
    objects: [],
  };
}

describe('viewportUtils', () => {
  beforeEach(() => {
    resetIdCounter(0);
  });

  it('exports the expected constants', () => {
    expect(DRAG_THRESHOLD_SQ).toBe(9);
    expect(HOVER_HIGHLIGHT_COLOR).toHaveLength(4);
    expect(SELECT_HIGHLIGHT_COLOR).toHaveLength(4);
    expect(MULTI_SELECT_HIGHLIGHT_COLOR).toHaveLength(4);
    expect(GRID_COLOR).toHaveLength(4);
    expect(AXIS_COLOR_X).toHaveLength(4);
    expect(AXIS_COLOR_Y).toHaveLength(4);
    expect(HOVER_HIGHLIGHT_Z_LIFT).toBeGreaterThan(0);
  });

  it('merges Float32Arrays and reuses empty inputs', () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([3, 4]);

    expect(Array.from(mergeFloat32Arrays(a, b))).toEqual([1, 2, 3, 4]);
    expect(mergeFloat32Arrays(a, new Float32Array())).toBe(a);
    expect(mergeFloat32Arrays(new Float32Array(), b)).toBe(b);
  });

  it('lifts every z vertex in a mesh stride and keeps empty meshes unchanged', () => {
    const vertices = new Float32Array([
      1, 2, 3, 0, 0, 0, 1,
      4, 5, 6, 0, 0, 0, 1,
    ]);

    expect(Array.from(liftMeshZ(vertices, 0.5))).toEqual([
      1, 2, 3.5, 0, 0, 0, 1,
      4, 5, 6.5, 0, 0, 0, 1,
    ]);
    expect(liftMeshZ(new Float32Array(), 1)).toBeInstanceOf(Float32Array);
    expect(Array.from(vertices)).toEqual([1, 2, 3, 0, 0, 0, 1, 4, 5, 6, 0, 0, 0, 1]);
  });

  it('detects drag threshold strictly greater than the squared threshold', () => {
    expect(exceededDragThreshold(0, 0, 3, 0)).toBe(false);
    expect(exceededDragThreshold(0, 0, 4, 0)).toBe(true);
    expect(exceededDragThreshold(10, 10, 12, 12)).toBe(false);
  });

  it('builds spline knots and editable splines with cumulative stations and anchors', () => {
    const knot = makeSplineKnot([1, 2, 3], 7);
    const spline = buildEditableSpline([
      [0, 0, 0],
      [3, 4, 0],
      [3, 4, 12],
    ]);
    const singlePointSpline = buildEditableSpline([[5, 6, 7]]);

    expect(knot).toEqual({
      position: [1, 2, 3],
      tangent_in: [0, 0, 0],
      tangent_out: [0, 0, 0],
      s: 7,
      knot_type: 'Key',
      tangent_mode: 'Auto',
    });

    expect(spline.knots.map((item) => item.s)).toEqual([0, 5, 17]);
    expect(spline.knots.map((item) => item.knot_type)).toEqual(['Anchor', 'Key', 'Anchor']);
    expect(singlePointSpline.knots[0]?.knot_type).toBe('Anchor');
  });

  it('detects road and junction intersections with an AABB', () => {
    const insideRoad = makeRoad();
    const endPointRoad = makeRoad({
      id: 'r2',
      plan_view: [{ s: 0, x: -10, y: 5, hdg: 0, length: 15, geo_type: 'Line' }],
    });
    const outsideRoad = makeRoad({
      id: 'r3',
      plan_view: [{ s: 0, x: 20, y: 20, hdg: 0, length: 5, geo_type: 'Line' }],
    });
    const project = makeProject([insideRoad, outsideRoad]);
    const junction: Junction = {
      id: 'j1',
      name: 'Junction 1',
      connections: [{ id: 'c1', incoming_road: 'missing', connecting_road: 'r1', contact_point: 'Start', lane_links: [] }],
    };

    expect(roadIntersectsAABB(insideRoad, -1, -1, 1, 1)).toBe(true);
    expect(roadIntersectsAABB(endPointRoad, 4, 4, 6, 6)).toBe(true);
    expect(roadIntersectsAABB(outsideRoad, -1, -1, 1, 1)).toBe(false);
    expect(junctionIntersectsAABB(junction, project, -1, -1, 1, 1)).toBe(true);
    expect(junctionIntersectsAABB(junction, makeProject([outsideRoad]), -1, -1, 1, 1)).toBe(false);
  });

  it('generates the next spline road id from existing numeric ids', () => {
    expect(nextSplineRoadId(['2', '10', 'abc'])).toBe('11');
    expect(nextSplineRoadId([])).toBe('12');
  });

  it('converts splines to renderer format and computes tangents from handle positions', () => {
    const spline = buildEditableSpline([
      [0, 0, 0],
      [3, 4, 0],
    ]);
    spline.knots[0] = { ...spline.knots[0]!, tangent_out: [10, 20, 0], tangent_mode: 'Manual' };
    spline.knots[1] = { ...spline.knots[1]!, tangent_out: [-5, -6, 0], tangent_mode: 'Manual' };

    expect(splineToRendererFormat(spline)).toEqual({
      knots: [[0, 0, 0], [3, 4, 0]],
      tangentOverrides: {
        0: [10, 20, 0],
        1: [-5, -6, 0],
      },
    });
    expect(tangentFromHandlePosition([0, 0, 0], { x: 8, y: 0 }, 'out')).toEqual([1, 0, 0]);
    const tangentIn = tangentFromHandlePosition([0, 0, 0], { x: -8, y: 0.8 }, 'in');
    expect(tangentIn[0]).toBeCloseTo(0.9950371902099892);
    expect(tangentIn[1]).toBeCloseTo(-0.09950371902099892);
    expect(tangentIn[2]).toBe(0);
  });

  it('keeps tangent direction stable when dragging along the same ray', () => {
    expect(tangentFromHandlePosition([0, 0, 0], { x: 8.8, y: 0 }, 'out')).toEqual([1, 0, 0]);
    expect(tangentFromHandlePosition([0, 0, 0], { x: 7.2, y: 0 }, 'out')).toEqual([1, 0, 0]);
    expect(tangentFromHandlePosition([0, 0, 0], { x: -8.8, y: 0 }, 'in')).toEqual([1, -0, 0]);
  });

  it('returns zero tangent when the dragged handle collapses onto the knot', () => {
    expect(tangentFromHandlePosition([0, 0, 0], { x: 0, y: 0 }, 'out')).toEqual([0, 0, 0]);
  });

  it('excludes Auto-mode knot tangents from renderer tangentOverrides', () => {
    const spline = buildEditableSpline([[0, 0, 0], [3, 4, 0]]);
    // Default tangent_mode is 'Auto' — neither knot should appear in overrides
    const result = splineToRendererFormat(spline);
    expect(result.tangentOverrides).toEqual({});
  });

  it('includes only Manual knots in tangentOverrides for a mixed spline', () => {
    const spline = buildEditableSpline([[0, 0, 0], [3, 4, 0], [6, 0, 0]]);
    // knot 0: Auto (default), knot 1: Manual, knot 2: Auto
    spline.knots[1] = { ...spline.knots[1]!, tangent_out: [1, 2, 0], tangent_mode: 'Manual' };

    const result = splineToRendererFormat(spline);
    expect(Object.keys(result.tangentOverrides)).toEqual(['1']);
    expect(result.tangentOverrides[1]).toEqual([1, 2, 0]);
  });

  it('finds knot and handle hits with optional handle suppression', () => {
    const knots: Array<[number, number, number]> = [[0, 0, 0], [10, 0, 0]];
    // With mpp=0.1, handle scale = clamp(80*0.1, 0.5, 60)/tangentLen = 8/10 = 0.8
    // So knot 0 'out' handle is at (0 + 10*0.8, 0) = (8, 0)
    expect(findSplineControlPointHit({ x: 0.2, y: 0.2 }, knots, 0.1)).toEqual({ index: 0, type: 'knot' });
    expect(findSplineControlPointHit({ x: 8.05, y: 0 }, knots, 0.1)).toEqual({ index: 0, type: 'out' });
    expect(findSplineControlPointHit({ x: 8.05, y: 0 }, knots, 0.1, undefined, false)).toBeNull();
    expect(findSplineControlPointHit({ x: 50, y: 50 }, knots, 0.1)).toBeNull();
  });

  it('detects in/out tangent handles at camera-adaptive positions', () => {
    const knots: Array<[number, number, number]> = [[0, 0, 0], [20, 0, 0], [40, 0, 0]];
    const mpp = 0.05;
    // Middle knot tangent (Catmull-Rom): 0.5 * (knots[2] - knots[0]) = [20, 0, 0], len=20
    // computeHandleScale(20, 0.05): targetDist = max(80*0.05, 0.5) = 4; scale = 4/20 = 0.2
    // 'out' handle at (20 + 20*0.2, 0) = (24, 0)
    // 'in' handle at (20 - 20*0.2, 0) = (16, 0)
    expect(findSplineControlPointHit({ x: 24.0, y: 0 }, knots, mpp)).toEqual({ index: 1, type: 'out' });
    expect(findSplineControlPointHit({ x: 16.0, y: 0 }, knots, mpp)).toEqual({ index: 1, type: 'in' });
    // Old position (fixed formula) should NOT hit — verifies camera-adaptive formula is used
    // Old: scale = min(4/20, 0.3) = 0.2 → same in this case, try different mpp
    const mpp2 = 0.5;
    // computeHandleScale(20, 0.5): targetDist = max(80*0.5, 0.5) = 40; scale = 40/20 = 2
    // 'out' handle at (20 + 20*2, 0) = (60, 0) — clamped: min(40,60)=40 → scale = 40/20=2 → (60,0)
    // Wait, let me recalculate: clamped = min(targetDist, 60) = min(40, 60) = 40; scale=40/20=2
    // 'out' at (20 + 20*2, 0) = (60, 0)
    expect(findSplineControlPointHit({ x: 60.0, y: 0 }, knots, mpp2)).toEqual({ index: 1, type: 'out' });
    // With old formula (fixed), handle would be at (20 + 20*0.2, 0)=(24,0) — a miss at (60,0)
  });

  it('detects tangent handles with overrides', () => {
    const knots: Array<[number, number, number]> = [[0, 0, 0], [10, 0, 0]];
    const mpp = 0.1;
    // Override tangent for knot 0: [0, 5, 0] (pointing up), len=5
    // computeHandleScale(5, 0.1): targetDist=max(8,0.5)=8; scale=8/5=1.6
    // 'out' handle at (0 + 0*1.6, 0 + 5*1.6) = (0, 8)
    const overrides: Record<number, [number, number, number]> = { 0: [0, 5, 0] };
    expect(findSplineControlPointHit({ x: 0, y: 8.0 }, knots, mpp, overrides)).toEqual({ index: 0, type: 'out' });
    // 'in' handle at (0 - 0*1.6, 0 - 5*1.6) = (0, -8)
    expect(findSplineControlPointHit({ x: 0, y: -8.0 }, knots, mpp, overrides)).toEqual({ index: 0, type: 'in' });
  });
});
