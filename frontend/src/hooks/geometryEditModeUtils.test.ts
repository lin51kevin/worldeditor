import { describe, expect, it } from 'vitest';
import type { Project, Road } from '../services/platform';
import { DEFAULT_DISPLAY } from '../stores/viewportStore';
import {
  buildGeometryEditPreviewProject,
  canDeleteSelectedKnot,
  isKnotControlPoint,
  recolorVertices,
  shouldEnterGeometryEditMode,
  shouldEnterGeometryEditOnDoubleClick,
} from './geometryEditModeUtils';

function makeRoad(id: string, length = 20): Road {
  return {
    id,
    name: id,
    length,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [
      { s: 0, x: 0, y: 0, hdg: 0, length, geo_type: 'Line' },
    ],
    elevation_profile: [],
    lane_offsets: [],
    lane_sections: [],
    signals: [],
    objects: [],
  };
}

function makeProject(): Project {
  return {
    name: 'Geometry Edit Project',
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
    roads: [makeRoad('road-1'), makeRoad('road-2')],
    junctions: [],
    signals: [],
    objects: [],
  };
}

describe('geometryEditModeUtils', () => {
  it('recolors each vertex without mutating the original array', () => {
    const source = new Float32Array([
      0, 1, 2, 0.1, 0.2, 0.3, 0.4,
      3, 4, 5, 0.5, 0.6, 0.7, 0.8,
    ]);

    const result = recolorVertices(source, 0.9, 0.8, 0.7, 0.6);

    Array.from(source.slice(3, 7)).forEach((value, index) => {
      expect(value).toBeCloseTo([0.1, 0.2, 0.3, 0.4][index]!, 5);
    });
    Array.from(result.slice(3, 7)).forEach((value, index) => {
      expect(value).toBeCloseTo([0.9, 0.8, 0.7, 0.6][index]!, 5);
    });
    Array.from(result.slice(10, 14)).forEach((value, index) => {
      expect(value).toBeCloseTo([0.9, 0.8, 0.7, 0.6][index]!, 5);
    });
  });

  it('allows entering geometry edit mode only on plain E with a selected road', () => {
    expect(
      shouldEnterGeometryEditMode(
        'E',
        { ctrlKey: false, metaKey: false, altKey: false },
        { geometryEditRoadId: null },
        'road-1',
      ),
    ).toBe(true);

    expect(
      shouldEnterGeometryEditMode(
        'E',
        { ctrlKey: true, metaKey: false, altKey: false },
        { geometryEditRoadId: null },
        'road-1',
      ),
    ).toBe(false);

    // move-road and rotate-road no longer block E — allowed from any mode
    expect(
      shouldEnterGeometryEditMode(
        'E',
        { ctrlKey: false, metaKey: false, altKey: false },
        { geometryEditRoadId: null },
        'road-1',
      ),
    ).toBe(true);

    // Already in geometry edit → blocked
    expect(
      shouldEnterGeometryEditMode(
        'E',
        { ctrlKey: false, metaKey: false, altKey: false },
        { geometryEditRoadId: 'road-1' },
        'road-1',
      ),
    ).toBe(false);

    // No road selected → blocked
    expect(
      shouldEnterGeometryEditMode(
        'E',
        { ctrlKey: false, metaKey: false, altKey: false },
        { geometryEditRoadId: null },
        null,
      ),
    ).toBe(false);
  });

  it('deletes only interior knot selections when at least three knots exist', () => {
    const spline = {
      knots: [
        { position: [0, 0, 0], tangent_in: [0, 0, 0], tangent_out: [0, 0, 0], tangent_mode: 'Auto', knot_type: 'Key', s: 0 },
        { position: [1, 0, 0], tangent_in: [0, 0, 0], tangent_out: [0, 0, 0], tangent_mode: 'Auto', knot_type: 'Key', s: 1 },
        { position: [2, 0, 0], tangent_in: [0, 0, 0], tangent_out: [0, 0, 0], tangent_mode: 'Auto', knot_type: 'Key', s: 2 },
      ],
    };
    const middleKnot = { index: 1, type: 'knot' } as const;

    expect(isKnotControlPoint(middleKnot)).toBe(true);
    expect(canDeleteSelectedKnot(middleKnot, spline)).toBe(true);
    expect(canDeleteSelectedKnot({ index: 0, type: 'knot' }, spline)).toBe(false);
    expect(isKnotControlPoint({ index: 1, type: 'tangent-out' })).toBe(false);
    expect(canDeleteSelectedKnot(middleKnot, { knots: spline.knots.slice(0, 2) })).toBe(false);
  });

  it('enters geometry edit on double click only for the selected road when not already editing', () => {
    expect(shouldEnterGeometryEditOnDoubleClick(null, 'road-1', 2, 'road-1')).toBe(true);
    expect(shouldEnterGeometryEditOnDoubleClick('road-1', 'road-1', 2, 'road-1')).toBe(false);
    expect(shouldEnterGeometryEditOnDoubleClick(null, 'road-2', 2, 'road-1')).toBe(false);
    expect(shouldEnterGeometryEditOnDoubleClick(null, 'road-1', 1, 'road-1')).toBe(false);
  });

  it('replaces the edited road while keeping other visible roads in the preview project', () => {
    const project = makeProject();
    const previewRoad = { ...project.roads[0]!, length: 42 };

    const previewProject = buildGeometryEditPreviewProject(project, DEFAULT_DISPLAY, previewRoad);

    expect(previewProject.roads).toHaveLength(2);
    expect(previewProject.roads[0]?.id).toBe('road-1');
    expect(previewProject.roads[0]?.length).toBe(42);
    expect(previewProject.roads[1]?.id).toBe('road-2');
  });

  it('keeps hidden roads excluded from the geometry edit preview project', () => {
    const project = makeProject();
    const previewRoad = { ...project.roads[0]!, length: 42 };

    const previewProject = buildGeometryEditPreviewProject(
      project,
      { ...DEFAULT_DISPLAY, hiddenRoadIds: ['road-2'] },
      previewRoad,
    );

    expect(previewProject.roads).toHaveLength(1);
    expect(previewProject.roads[0]?.id).toBe('road-1');
    expect(previewProject.roads[0]?.length).toBe(42);
  });
});