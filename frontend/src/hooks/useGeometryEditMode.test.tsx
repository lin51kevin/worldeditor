import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlatformService } from '../services';
import type { EditableSpline, Geometry, PlatformService, Project, Road } from '../services/platform';
import { useProjectStore } from '../stores/projectStore';
import { DEFAULT_DISPLAY, useViewportStore } from '../stores/viewportStore';
import { useGeometryEditMode } from './useGeometryEditMode';

vi.mock('../services', () => ({
  getPlatformService: vi.fn(),
}));

vi.mock('./useSplineOperations', () => ({
  useSplineOperations: () => ({
    enterGeometryEditMode: vi.fn(),
    finalizeGeometryEdit: vi.fn(),
  }),
}));

function makeRoad(id: string): Road {
  return {
    id,
    name: id,
    length: 20,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [
      { s: 0, x: 0, y: 0, hdg: 0, length: 20, geo_type: 'Line' },
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
    name: 'Geometry Edit Hook Project',
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

function makeSpline(): EditableSpline {
  return {
    knots: [
      {
        position: [0, 0, 0],
        tangent_in: [0, 0, 0],
        tangent_out: [0, 0, 0],
        s: 0,
        knot_type: 'Key',
        tangent_mode: 'Auto',
      },
      {
        position: [10, 0, 0],
        tangent_in: [0, 0, 0],
        tangent_out: [0, 0, 0],
        s: 10,
        knot_type: 'Key',
        tangent_mode: 'Auto',
      },
      {
        position: [20, 0, 0],
        tangent_in: [0, 0, 0],
        tangent_out: [0, 0, 0],
        s: 20,
        knot_type: 'Key',
        tangent_mode: 'Auto',
      },
    ],
  };
}

describe('useGeometryEditMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    act(() => {
      useProjectStore.setState({
        project: makeProject(),
        selectedRoadId: null,
        selectedJunctionId: null,
        selectedObjectType: null,
        selectedSceneNode: null,
      });
      useViewportStore.setState({
        display: { ...DEFAULT_DISPLAY },
        viewMode: 'solid',
        editMode: 'default',
        geometryEditRoadId: 'road-1',
        geometryEditSpline: makeSpline(),
        draggingKnot: { index: 1, type: 'knot' },
      });
    });
  });

  it('keeps other roads in the generated preview project while dragging a knot', async () => {
    const updatedSpline = makeSpline();
    updatedSpline.knots[1] = {
      ...updatedSpline.knots[1]!,
      position: [12, 4, 0],
    };

    const geometries: Geometry[] = [
      { s: 0, x: 0, y: 0, hdg: 0, length: 24, geo_type: 'Line' },
    ];

    const platform = {
      moveSplineKnot: vi.fn().mockResolvedValue(updatedSpline),
      splineToGeometries: vi.fn().mockResolvedValue(geometries),
      generateRoadVertices: vi.fn().mockResolvedValue(new Float32Array([1, 2, 3])),
      generateLaneBoundaryVertices: vi.fn().mockResolvedValue(new Float32Array()),
      generateLaneLineVertices: vi.fn().mockResolvedValue(new Float32Array([4, 5, 6])),
      generateCenterLineVertices: vi.fn().mockResolvedValue(new Float32Array()),
      generateSingleRoadVertices: vi.fn().mockResolvedValue(new Float32Array([7, 8, 9])),
    } as unknown as Pick<PlatformService,
      'moveSplineKnot'
      | 'splineToGeometries'
      | 'generateRoadVertices'
      | 'generateLaneBoundaryVertices'
      | 'generateLaneLineVertices'
      | 'generateCenterLineVertices'
      | 'generateSingleRoadVertices'
    >;
    vi.mocked(getPlatformService).mockResolvedValue(platform as PlatformService);

    const renderer = {
      uploadRoadVertices: vi.fn(),
      uploadLaneLineVertices: vi.fn(),
      uploadHighlightVertices: vi.fn(),
      setSplinePreviewKnots: vi.fn(),
      refreshSplineMarkers: vi.fn(),
      getMetersPerPixel: vi.fn().mockReturnValue(0.1),
      setCurveFromVertexData: vi.fn(),
    };

    const canvas = document.createElement('canvas');
    const { result } = renderHook(() =>
      useGeometryEditMode({
        canvasRef: { current: canvas },
        rendererRef: { current: renderer as never },
        isPreviewingRoadRef: { current: false },
        pendingCursorRef: { current: null },
        hoveredControlPointRef: { current: null },
        status: 'ready',
      }),
    );

    await act(async () => {
      const handled = await result.current.handleGeometryEditMouseMove(
        { x: 12, y: 4 },
        canvas,
        renderer as never,
      );
      expect(handled).toBe(true);
    });

    await waitFor(() => {
      expect((platform.generateRoadVertices as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
      expect((platform.generateLaneLineVertices as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });

    const previewProject = (platform.generateRoadVertices as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Project;
    expect(previewProject.roads.map((road) => road.id)).toEqual(['road-1', 'road-2']);
    expect(previewProject.roads[0]?.length).toBe(24);

    const lineProject = (platform.generateLaneLineVertices as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Project;
    expect(lineProject.roads.map((road) => road.id)).toEqual(['road-1', 'road-2']);
    expect(renderer.uploadLaneLineVertices).toHaveBeenCalled();
  });
});