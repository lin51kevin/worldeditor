import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { ViewportRenderer } from '../viewport/renderer';
import { emitCursorMove } from '../viewport/cursorEvents';
import { getPlatformService } from '../services';
import { useProjectStore } from '../stores/projectStore';
import { useViewportStore } from '../stores/viewportStore';
import {
  buildEditableSpline,
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

/** Recolor all vertices in a Float32Array (7 floats per vertex) to the given RGBA. */
function recolorVertices(data: Float32Array, r: number, g: number, b: number, a: number): Float32Array {
  const result = new Float32Array(data);
  for (let i = 0; i < result.length; i += 7) {
    result[i + 3] = r;
    result[i + 4] = g;
    result[i + 5] = b;
    result[i + 6] = a;
  }
  return result;
}

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
  const geometryEditRoadId = useViewportStore((state) => state.geometryEditRoadId);
  const project = useProjectStore((state) => state.project);
  const { enterGeometryEditMode, finalizeGeometryEdit } = useSplineOperations();

  /** The knot last clicked/inserted in edit mode. Persists after mouse-up for Delete key. */
  const selectedEditKnotRef = useRef<SplineControlPoint | null>(null);
  /** Flag to suppress the undo-sync effect right after our own commit. */
  const selfCommitRef = useRef(false);

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

  /** Tracks the spline snapshot that was last sent to previewEditedRoad. */
  const previewedSplineRef = useRef<ReturnType<typeof useViewportStore.getState>['geometryEditSpline']>(null);

  const previewEditedRoad = useCallback((roadId: string, splineJson: ReturnType<typeof useViewportStore.getState>['geometryEditSpline'], resolution = 2.0) => {
    const renderer = rendererRef.current;
    if (!renderer || !splineJson) {
      return;
    }

    isPreviewingRoadRef.current = true;
    previewedSplineRef.current = splineJson;
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
        const singleProject = { ...currentProject, roads: [previewRoad] };
        const [singleRoadVerts, singleLaneLineVerts, centerLineVerts, highlightVerts] = await Promise.all([
          service.generateSingleRoadVertices(previewRoad, resolution, [0.35, 0.35, 0.35, 1.0]),
          service.generateLaneLineVertices(singleProject, resolution),
          service.generateCenterLineVertices(singleProject, 2.0),
          service.generateSingleRoadVertices(previewRoad, resolution, [0.95, 0.18, 0.18, 0.82]),
        ]);
        rendererRef.current?.uploadRoadVertices(singleRoadVerts);
        rendererRef.current?.uploadLaneLineVertices(singleLaneLineVerts);
        if (highlightVerts.length > 0) {
          rendererRef.current?.uploadHighlightVertices(highlightVerts);
        }
        // Upload center line as the spline curve (recolored to yellow/orange #F5A623)
        if (centerLineVerts.length > 0) {
          const recolored = recolorVertices(centerLineVerts, 0.961, 0.651, 0.137, 1.0);
          rendererRef.current?.setCurveFromVertexData(recolored);
        }
      } catch {
        // Ignore preview errors during drag.
      } finally {
        isPreviewingRoadRef.current = false;
        // If the spline has changed since we started this preview, trigger another
        // preview to catch up with the latest state.
        const latestSpline = useViewportStore.getState().geometryEditSpline;
        if (latestSpline && latestSpline !== previewedSplineRef.current) {
          previewEditedRoad(roadId, latestSpline, resolution);
        }
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
    // In geometry-edit mode (road exists), skip the Hermite curve — the actual road
    // center line is uploaded separately via setCurveFromVertexData.
    const skipCurve = !!geometryEditRoadId;
    renderer.setSplinePreviewKnots(knots, tangentOverrides, false, skipCurve);
    renderer.refreshSplineMarkers(hoveredControlPointRef.current, selectedEditKnotRef.current);
  }, [clearGeometryEditHover, geometryEditSpline, geometryEditRoadId, rendererRef, status]);

  // ── Sync geometry edit spline on undo/redo ──────────────────────────────
  // When the project changes externally (undo/redo), re-derive the editing
  // spline from the road's persisted spline_edit_data so control points stay
  // in sync with the actual road geometry.
  const lastSyncedRoadRef = useRef<unknown>(null);
  useEffect(() => {
    if (!geometryEditRoadId) return;
    const road = project.roads.find((r) => r.id === geometryEditRoadId);
    if (!road) {
      // Road was deleted (e.g., undo of an addRoad) — exit edit mode.
      useViewportStore.getState().exitGeometryEdit();
      return;
    }
    // Skip if the road reference hasn't changed (the edit was done by us).
    if (road === lastSyncedRoadRef.current) return;
    lastSyncedRoadRef.current = road;

    // Skip if this change was triggered by our own mouseup commit.
    if (selfCommitRef.current) {
      selfCommitRef.current = false;
      return;
    }

    // Only sync if we're not currently dragging (to avoid overwriting mid-drag state).
    const { draggingKnot } = useViewportStore.getState();
    if (draggingKnot) return;

    if (road.spline_edit_data && road.spline_edit_data.length >= 2) {
      const restoredSpline = buildEditableSpline(road.spline_edit_data);
      useViewportStore.getState().setGeometryEditSpline(restoredSpline);
    }
  }, [geometryEditRoadId, project]);

  // ── Compute initial center line when entering geometry edit mode ──────────
  // On first entry (geometryEditRoadId becomes set), compute the road's center
  // line from its existing plan_view and upload as the curve mesh.
  const initialCurveComputedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!geometryEditRoadId) {
      initialCurveComputedRef.current = null;
      return;
    }
    // Only compute once per road edit session.
    if (initialCurveComputedRef.current === geometryEditRoadId) return;
    initialCurveComputedRef.current = geometryEditRoadId;

    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready') return;

    const road = project.roads.find((r) => r.id === geometryEditRoadId);
    if (!road || !road.plan_view || road.plan_view.length === 0) return;

    void (async () => {
      try {
        const service = await getPlatformService();
        const currentProject = useProjectStore.getState().project;
        const singleProject = { ...currentProject, roads: [road] };
        const centerLineVerts = await service.generateCenterLineVertices(singleProject, 2.0);
        if (centerLineVerts.length > 0) {
          const recolored = recolorVertices(centerLineVerts, 0.961, 0.651, 0.137, 1.0);
          rendererRef.current?.setCurveFromVertexData(recolored);
        }
      } catch {
        // Ignore — the curve will be computed on first drag preview.
      }
    })();
  }, [geometryEditRoadId, project, rendererRef, status]);

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
          const tangentOut = tangentFromHandlePosition(
            spline.knots[drag.index]!.position,
            worldPos,
            drag.type,
          );
          updatedSpline = {
            ...spline,
            knots: spline.knots.map((knot, index) => (
              index === drag.index
                ? {
                    ...knot,
                    // Rust spline fitting expects manual in/out tangents to be
                    // stored with the same direction at a knot.
                    tangent_in: tangentOut,
                    tangent_out: tangentOut,
                    tangent_mode: 'Manual' as const,
                  }
                : knot
            )),
          };
        }

        // Always update the spline state so control point markers track the mouse.
        viewState.setGeometryEditSpline(updatedSpline);
        // Only trigger road mesh preview if no preview is currently in-flight.
        // When the in-flight preview finishes, it will catch up with the latest spline.
        if (viewState.geometryEditRoadId && !isPreviewingRoadRef.current) {
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
      selectedEditKnotRef.current = bestHit;
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
      // Insert a new Key knot at the nearest curve point.
      // Interpolate s between adjacent knots based on segment-local t.
      const prevS = spline.knots[nearest.segIndex]?.s ?? 0;
      const nextS = spline.knots[nearest.segIndex + 1]?.s ?? prevS;
      const interpS = prevS + (nextS - prevS) * nearest.t;
      const newKnot: SplineKnot = {
        position: nearest.pos,
        tangent_in: [0, 0, 0],
        tangent_out: [0, 0, 0],
        tangent_mode: 'Auto',
        knot_type: 'Key',
        s: interpS,
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
        // Mark that the upcoming project change is from our own commit (not undo/redo).
        selfCommitRef.current = true;
        const currentProject = useProjectStore.getState().project;
        const baseRoad = currentProject.roads.find((r) => r.id === roadId);
        if (baseRoad) {
          const commitRoad = { ...baseRoad, plan_view: geometries, length: totalLength };
          const singleProject = { ...currentProject, roads: [commitRoad] };
          // Update center line to reflect the final committed geometry.
          const centerLineVerts = await service.generateCenterLineVertices(singleProject, 2.0);
          if (centerLineVerts.length > 0) {
            const recolored = recolorVertices(centerLineVerts, 0.961, 0.651, 0.137, 1.0);
            rendererRef.current?.setCurveFromVertexData(recolored);
          }
        }
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
