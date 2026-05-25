import type { SplineControlPoint } from '../components/viewportUtils';
import type { Project, Road, SplineKnot } from '../services/platform';
import { buildRenderableProject, type SceneVisibilityState } from '../utils/sceneGraph';

interface GeometryEditViewStateLike {
  geometryEditRoadId: string | null;
}

export function recolorVertices(data: Float32Array, r: number, g: number, b: number, a: number): Float32Array {
  const result = new Float32Array(data);
  for (let i = 0; i < result.length; i += 7) {
    result[i + 3] = r;
    result[i + 4] = g;
    result[i + 5] = b;
    result[i + 6] = a;
  }
  return result;
}

export function shouldEnterGeometryEditMode(
  key: string,
  modifiers: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey'>,
  viewState: GeometryEditViewStateLike,
  selectedRoadId: string | null,
): boolean {
  const isEnterShortcut = (key === 'e' || key === 'E')
    && !modifiers.ctrlKey
    && !modifiers.metaKey
    && !modifiers.altKey;

  if (!isEnterShortcut) {
    return false;
  }

  if (viewState.geometryEditRoadId) {
    return false;
  }

  return selectedRoadId !== null;
}

export function isKnotControlPoint(
  selectedKnot: SplineControlPoint | null,
): selectedKnot is SplineControlPoint & { type: 'knot' } {
  return selectedKnot?.type === 'knot';
}

export function canDeleteSelectedKnot(
  selectedKnot: SplineControlPoint & { type: 'knot' },
  spline: { knots: SplineKnot[] },
): boolean {
  if (selectedKnot.index === 0 || selectedKnot.index === spline.knots.length - 1) {
    return false;
  }

  return spline.knots.length > 2;
}

export function shouldEnterGeometryEditOnDoubleClick(
  geometryEditRoadId: string | null,
  roadId: string | null,
  detail: number,
  selectedRoadId: string | null,
): boolean {
  if (geometryEditRoadId || detail < 2 || !roadId) {
    return false;
  }

  return roadId === selectedRoadId;
}

export function buildGeometryEditPreviewProject(
  project: Project,
  visibility: SceneVisibilityState,
  previewRoad: Road,
): Project {
  const visibleProject = buildRenderableProject(project, visibility);

  return {
    ...visibleProject,
    roads: visibleProject.roads.map((road) => (
      road.id === previewRoad.id
        ? {
            ...road,
            plan_view: previewRoad.plan_view,
            length: previewRoad.length,
          }
        : road
    )),
  };
}