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
    spline.knots[0] = { ...spline.knots[0]!, tangent_out: [10, 20, 0] };
    spline.knots[1] = { ...spline.knots[1]!, tangent_out: [-5, -6, 0] };

    expect(splineToRendererFormat(spline)).toEqual({
      knots: [[0, 0, 0], [3, 4, 0]],
      tangentOverrides: {
        0: [10, 20, 0],
        1: [-5, -6, 0],
      },
    });
    expect(tangentFromHandlePosition([1, 1, 0], { x: 4, y: 7 }, 'out')).toEqual([10, 20, 0]);
    expect(tangentFromHandlePosition([1, 1, 0], { x: 4, y: 7 }, 'in')).toEqual([-10, -20, 0]);
  });

  it('finds knot and handle hits with optional handle suppression', () => {
    const knots: Array<[number, number, number]> = [[0, 0, 0], [10, 0, 0]];

    expect(findSplineControlPointHit({ x: 0.2, y: 0.2 }, knots, 0.1)).toEqual({ index: 0, type: 'knot' });
    expect(findSplineControlPointHit({ x: 3.05, y: 0 }, knots, 0.1)).toEqual({ index: 0, type: 'out' });
    expect(findSplineControlPointHit({ x: 3.05, y: 0 }, knots, 0.1, undefined, false)).toBeNull();
    expect(findSplineControlPointHit({ x: 50, y: 50 }, knots, 0.1)).toBeNull();
  });
});
