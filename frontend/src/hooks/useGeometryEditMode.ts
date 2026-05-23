import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
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
import { findNearestSplinePoint } from '../viewport/splineVertexBuilder';
import { useSplineOperations } from './useSplineOperations';
import type { SplineKnot } from '../services/platform';

type ViewportStatus = 'loading' | 'ready' | 'unsupported';

type WorldPosition = { x: number; y: number };

/** Screen-space pixel threshold for inserting a knot by clicking on the curve. */
const INSERT_KNOT_THRESHOLD_PX = 20;

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

  /** The knot last clicked/inserted in edit mode. Persists after mouse-up for Delete key. */
  const selectedEditKnotRef = useRef<SplineControlPoint | null>(null);

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
    renderer.refreshSplineMarkers(nextHover, selectedEditKnotRef.current);
  }, [hoveredControlPointRef]);

  const previewEditedRoad = useCallback((roadId: string, splineJson: ReturnType<typeof useViewportStore.getState>['geometryEditSpline'], resolution = 2.0) => {
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
        const singleRoadVerts = await service.generateSingleRoadVertices(previewRoad, resolution, [0.35, 0.35, 0.35, 1.0]);
        const singleProject = { ...currentProject, roads: [previewRoad] };
        const singleLaneLineVerts = await service.generateLaneLineVertices(singleProject, resolution);
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
      selectedEditKnotRef.current = null;
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

      // ── Escape: finalize edit ────────────────────────────────────────────
      if (event.key === 'Escape' && viewState.geometryEditRoadId) {
        void finalizeGeometryEdit();
        return;
      }

      // ── E: enter geometry edit mode ──────────────────────────────────────
      if ((event.key === 'e' || event.key === 'E') && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (viewState.geometryEditRoadId || isDrawMode(viewState.editMode) || viewState.editMode === 'move-road' || viewState.editMode === 'rotate-road') {
          return;
        }
        const { selectedRoadId } = useProjectStore.getState();
        if (selectedRoadId) {
          void enterGeometryEditMode(selectedRoadId);
        }
        return;
      }

      // ── Delete/Backspace: remove selected knot ───────────────────────────
      if ((event.key === 'Delete' || event.key === 'Backspace') && viewState.geometryEditRoadId) {
        const sel = selectedEditKnotRef.current;
        const spline = viewState.geometryEditSpline;
        if (!sel || sel.type !== 'knot' || !spline) return;
        // Cannot delete first or last knot, and must keep at least 2 knots.
        if (sel.index === 0 || sel.index === spline.knots.length - 1) return;
        if (spline.knots.length <= 2) return;

        const newKnots = spline.knots.filter((_, i) => i !== sel.index);
        const updatedSpline = { ...spline, knots: newKnots };
        viewState.setGeometryEditSpline(updatedSpline);
        selectedEditKnotRef.current = null;
        rendererRef.current?.refreshSplineMarkers(null, null);
        if (viewState.geometryEditRoadId) {
          previewEditedRoad(viewState.geometryEditRoadId, updatedSpline, 8.0);
        }
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enterGeometryEditMode, finalizeGeometryEdit, previewEditedRoad]);

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
                    tangent_in: [-tangentOut[0], -tangentOut[1], 0] as [number, number, number],
                    tangent_out: tangentOut,
                  }
                : knot
            )),
          };
        }

        viewState.setGeometryEditSpline(updatedSpline);
        if (viewState.geometryEditRoadId) {
          previewEditedRoad(viewState.geometryEditRoadId, updatedSpline, 8.0);
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
    const viewState = useViewportStore.getState();
    const spline = viewState.geometryEditSpline;
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

    if (bestHit) {
      // Clicked on an existing knot or tangent handle
      selectedEditKnotRef.current = bestHit.type === 'knot' ? bestHit : selectedEditKnotRef.current;
      viewState.setDraggingKnot(bestHit);
      renderer.lockCamera();
      canvas.style.cursor = 'grabbing';
      hoveredControlPointRef.current = null;
      renderer.refreshSplineMarkers(null, bestHit);
      return true;
    }

    // No knot hit — try inserting a new knot by clicking near the curve
    const mpp = renderer.getMetersPerPixel();
    const insertThreshold = INSERT_KNOT_THRESHOLD_PX * mpp;
    const nearest = findNearestSplinePoint(worldPos.x, worldPos.y, knots, tangentOverrides);
    if (nearest && nearest.dist <= insertThreshold) {
      // Insert a new Key knot at the nearest curve point
      const newKnot: SplineKnot = {
        position: nearest.pos,
        tangent_in: [0, 0, 0],
        tangent_out: [0, 0, 0],
        tangent_mode: 'Auto',
        knot_type: 'Key',
        s: 0,
      };
      const newKnots = [
        ...spline.knots.slice(0, nearest.segIndex + 1),
        newKnot,
        ...spline.knots.slice(nearest.segIndex + 1),
      ];
      const updatedSpline = { ...spline, knots: newKnots };
      viewState.setGeometryEditSpline(updatedSpline);

      const newKnotIndex = nearest.segIndex + 1;
      const dragRef: SplineControlPoint = { index: newKnotIndex, type: 'knot' };
      selectedEditKnotRef.current = dragRef;
      viewState.setDraggingKnot(dragRef);
      renderer.lockCamera();
      canvas.style.cursor = 'grabbing';
      hoveredControlPointRef.current = null;
      renderer.refreshSplineMarkers(null, dragRef);
      return true;
    }

    // Clicked on empty space — clear selection
    selectedEditKnotRef.current = null;
    renderer.refreshSplineMarkers(hoveredControlPointRef.current, null);
    return false;
  }, [hoveredControlPointRef]);

  const handleGeometryEditMouseUp = useCallback(async (): Promise<boolean> => {
    const viewState = useViewportStore.getState();
    if (!viewState.geometryEditSpline || !viewState.draggingKnot) {
      return false;
    }

    const draggedKnot = viewState.draggingKnot;
    viewState.setDraggingKnot(null);
    const renderer = rendererRef.current;
    if (renderer) {
      renderer.unlockCamera();
      // Keep the selection visible after releasing the mouse
      const sel = selectedEditKnotRef.current;
      renderer.refreshSplineMarkers(null, sel);
    }
    hoveredControlPointRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      // Restore appropriate cursor: crosshair if selected knot, else default
      canvas.style.cursor = draggedKnot ? 'grab' : '';
    }

    const { geometryEditRoadId: roadId, geometryEditSpline: spline } = viewState;
    if (roadId && spline) {
      try {
        const service = await getPlatformService();
        const geometries = await service.splineToGeometries(spline);
        const totalLength = geometries.reduce((sum, geometry) => sum + geometry.length, 0);
        const editData = spline.knots
          .filter((k) => k.knot_type !== 'Intermediate')
          .map((k) => k.position);
        useProjectStore.getState().updateRoadGeometry(roadId, geometries, totalLength, editData);
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
