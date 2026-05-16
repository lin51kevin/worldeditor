import { useCallback, useEffect, type MutableRefObject, type RefObject } from 'react';
import { ViewportRenderer } from '../viewport/renderer';
import { emitCursorMove } from '../viewport/cursorEvents';
import { getPlatformService } from '../services';
import { useProjectStore } from '../stores/projectStore';
import { useViewportStore } from '../stores/viewportStore';
import {
  findSplineControlPointHit,
  splineToRendererFormat,
  tangentFromHandlePosition,
  type SplineControlPoint,
} from '../components/viewportUtils';
import { useSplineOperations } from './useSplineOperations';

type ViewportStatus = 'loading' | 'ready' | 'unsupported';

type WorldPosition = { x: number; y: number };

interface UseGeometryEditModeOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: RefObject<ViewportRenderer | null>;
  isPreviewingRoadRef: MutableRefObject<boolean>;
  pendingCursorRef: MutableRefObject<WorldPosition | null>;
  hoveredControlPointRef: MutableRefObject<SplineControlPoint | null>;
  status: ViewportStatus;
}

function isDrawMode(mode: string): mode is 'spline' {
  return mode === 'spline';
}

/**
 * Encapsulates geometry-edit mode keyboard and pointer interaction.
 */
export function useGeometryEditMode({
  canvasRef,
  rendererRef,
  isPreviewingRoadRef,
  pendingCursorRef,
  hoveredControlPointRef,
  status,
}: UseGeometryEditModeOptions) {
  const geometryEditSpline = useViewportStore((state) => state.geometryEditSpline);
  const { enterGeometryEditMode, finalizeGeometryEdit } = useSplineOperations();

  const syncCursor = useCallback((worldPos: WorldPosition) => {
    emitCursorMove(worldPos.x, worldPos.y);
    pendingCursorRef.current = worldPos;
  }, [pendingCursorRef]);

  const clearGeometryEditHover = useCallback(() => {
    if (hoveredControlPointRef.current === null) {
      return;
    }
    hoveredControlPointRef.current = null;
    rendererRef.current?.refreshSplineMarkers(null, undefined);
  }, [hoveredControlPointRef, rendererRef]);

  const updateHoveredControlPoint = useCallback((renderer: ViewportRenderer, nextHover: SplineControlPoint | null) => {
    const prevHover = hoveredControlPointRef.current;
    const changed = nextHover?.index !== prevHover?.index || nextHover?.type !== prevHover?.type;
    if (!changed) {
      return;
    }
    hoveredControlPointRef.current = nextHover;
    renderer.refreshSplineMarkers(nextHover, undefined);
  }, [hoveredControlPointRef]);

  const previewEditedRoad = useCallback((roadId: string, splineJson: ReturnType<typeof useViewportStore.getState>['geometryEditSpline']) => {
    const renderer = rendererRef.current;
    if (!renderer || !splineJson) {
      return;
    }

    isPreviewingRoadRef.current = true;
    void (async () => {
      try {
        const service = await getPlatformService();
        const geometries = await service.splineToGeometries(splineJson);
        const totalLength = geometries.reduce((sum, geometry) => sum + geometry.length, 0);
        const currentProject = useProjectStore.getState().project;
        const baseRoad = currentProject.roads.find((road) => road.id === roadId);
        if (!baseRoad) {
          return;
        }
        const previewRoad = { ...baseRoad, plan_view: geometries, length: totalLength };
        const singleRoadVerts = await service.generateSingleRoadVertices(previewRoad, 2.0, [0.35, 0.35, 0.35, 1.0]);
        const singleProject = { ...currentProject, roads: [previewRoad] };
        const singleLaneLineVerts = await service.generateLaneLineVertices(singleProject, 2.0);
        rendererRef.current?.uploadRoadVertices(singleRoadVerts);
        rendererRef.current?.uploadLaneLineVertices(singleLaneLineVerts);
      } catch {
        // Ignore preview errors during drag.
      } finally {
        isPreviewingRoadRef.current = false;
      }
    })();
  }, [isPreviewingRoadRef, rendererRef]);

  useEffect(() => {
    if (!geometryEditSpline) {
      clearGeometryEditHover();
      return;
    }
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready') {
      return;
    }
    const { knots, tangentOverrides } = splineToRendererFormat(geometryEditSpline);
    renderer.setSplinePreviewKnots(knots, tangentOverrides);
  }, [clearGeometryEditHover, geometryEditSpline, rendererRef, status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const viewState = useViewportStore.getState();
      if (event.key === 'Escape' && viewState.geometryEditRoadId) {
        void finalizeGeometryEdit();
        return;
      }

      if ((event.key === 'e' || event.key === 'E') && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (viewState.geometryEditRoadId || isDrawMode(viewState.editMode) || viewState.editMode === 'move-road' || viewState.editMode === 'rotate-road') {
          return;
        }
        const { selectedRoadId } = useProjectStore.getState();
        if (selectedRoadId) {
          void enterGeometryEditMode(selectedRoadId);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enterGeometryEditMode, finalizeGeometryEdit]);

  const handleGeometryEditMouseMove = useCallback(async (worldPos: WorldPosition, canvas: HTMLCanvasElement, renderer: ViewportRenderer): Promise<boolean> => {
    const viewState = useViewportStore.getState();
    const spline = viewState.geometryEditSpline;
    if (!spline) {
      return false;
    }

    const drag = viewState.draggingKnot;
    if (drag) {
      if (isPreviewingRoadRef.current) {
        syncCursor(worldPos);
        return true;
      }

      let updatedSpline = spline;
      if (drag.index >= 0 && drag.index < spline.knots.length) {
        if (drag.type === 'knot') {
          try {
            const service = await getPlatformService();
            updatedSpline = await service.moveSplineKnot(
              spline,
              drag.index,
              worldPos.x,
              worldPos.y,
              spline.knots[drag.index]!.position[2],
            );
          } catch {
            syncCursor(worldPos);
            return true;
          }
        } else {
          const tangentOut = tangentFromHandlePosition(spline.knots[drag.index]!.position, worldPos, drag.type);
          updatedSpline = {
            ...spline,
            knots: spline.knots.map((knot, index) => (
              index === drag.index
                ? {
                    ...knot,
                    tangent_in: [-tangentOut[0], -tangentOut[1], 0],
                    tangent_out: tangentOut,
                  }
                : knot
            )),
          };
        }

        viewState.setGeometryEditSpline(updatedSpline);
        if (viewState.geometryEditRoadId) {
          previewEditedRoad(viewState.geometryEditRoadId, updatedSpline);
        }
      }

      syncCursor(worldPos);
      return true;
    }

    const { knots, tangentOverrides } = splineToRendererFormat(spline);
    const nextHover = findSplineControlPointHit(
      worldPos,
      knots,
      renderer.getMetersPerPixel(),
      tangentOverrides,
      true,
    );
    updateHoveredControlPoint(renderer, nextHover);
    canvas.style.cursor = nextHover ? 'grab' : 'crosshair';
    return false;
  }, [isPreviewingRoadRef, previewEditedRoad, syncCursor, updateHoveredControlPoint]);

  const handleGeometryEditMouseDown = useCallback((e: React.MouseEvent, canvas: HTMLCanvasElement, renderer: ViewportRenderer): boolean => {
    const spline = useViewportStore.getState().geometryEditSpline;
    if (!spline) {
      return false;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = (e.clientX - rect.left) * devicePixelRatio;
    const screenY = (e.clientY - rect.top) * devicePixelRatio;
    const worldPos = renderer.unprojectToGround(screenX, screenY);
    if (!worldPos) {
      return false;
    }

    const { knots, tangentOverrides } = splineToRendererFormat(spline);
    const bestHit = findSplineControlPointHit(
      worldPos,
      knots,
      renderer.getMetersPerPixel(),
      tangentOverrides,
      true,
    );
    if (!bestHit) {
      return false;
    }

    useViewportStore.getState().setDraggingKnot(bestHit);
    renderer.lockCamera();
    canvas.style.cursor = 'grabbing';
    hoveredControlPointRef.current = null;
    renderer.refreshSplineMarkers(null, bestHit);
    return true;
  }, [hoveredControlPointRef]);

  const handleGeometryEditMouseUp = useCallback(async (): Promise<boolean> => {
    const viewState = useViewportStore.getState();
    if (!viewState.geometryEditSpline || !viewState.draggingKnot) {
      return false;
    }

    viewState.setDraggingKnot(null);
    const renderer = rendererRef.current;
    if (renderer) {
      renderer.unlockCamera();
      renderer.refreshSplineMarkers(null, null);
    }
    hoveredControlPointRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = '';
    }

    const { geometryEditRoadId: roadId, geometryEditSpline: spline } = viewState;
    if (roadId && spline) {
      try {
        const service = await getPlatformService();
        const geometries = await service.splineToGeometries(spline);
        const totalLength = geometries.reduce((sum, geometry) => sum + geometry.length, 0);
        useProjectStore.getState().updateRoadGeometry(roadId, geometries, totalLength);
      } catch (err) {
        console.error('[Viewport] Failed to update road geometry:', err);
      }
    }

    return true;
  }, [canvasRef, hoveredControlPointRef, rendererRef]);

  const handleRoadDoubleClick = useCallback((roadId: string | null, detail: number): boolean => {
    const { geometryEditRoadId } = useViewportStore.getState();
    const { selectedRoadId } = useProjectStore.getState();
    if (geometryEditRoadId || detail < 2 || !roadId || roadId !== selectedRoadId) {
      return false;
    }
    void enterGeometryEditMode(roadId);
    return true;
  }, [enterGeometryEditMode]);

  return {
    clearGeometryEditHover,
    enterGeometryEditMode,
    handleGeometryEditMouseMove,
    handleGeometryEditMouseDown,
    handleGeometryEditMouseUp,
    handleRoadDoubleClick,
  };
}
