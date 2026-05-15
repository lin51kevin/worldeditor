import { useCallback, useEffect, type MutableRefObject, type RefObject } from 'react';
import { ViewportRenderer } from '../viewport/renderer';
import { emitCursorMove } from '../viewport/cursorEvents';
import { useEditorViewStore } from '../stores/editorViewStore';
import { useEditorStore } from '../stores/editorStore';
import {
  findSplineControlPointHit,
  type SplineControlPoint,
} from '../components/viewportUtils';
import { applyHandleDrag, inferConstraint, type DragConstraint } from '../viewport/tangentHandleController';
import { useSplineOperations } from './useSplineOperations';
import { getPlatformService } from '../services';

type ViewportStatus = 'loading' | 'ready' | 'unsupported';

type WorldPosition = { x: number; y: number };

interface UseSplineDrawModeOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: RefObject<ViewportRenderer | null>;
  pendingCursorRef: MutableRefObject<WorldPosition | null>;
  hoveredControlPointRef: MutableRefObject<SplineControlPoint | null>;
  status: ViewportStatus;
}

function isDrawMode(mode: string): mode is 'spline' | 'line' | 'arc' | 'spiral' {
  return mode === 'spline' || mode === 'line' || mode === 'arc' || mode === 'spiral';
}

/**
 * Encapsulates spline/line/arc/spiral draw-mode keyboard and pointer interaction.
 */
export function useSplineDrawMode({
  canvasRef,
  rendererRef,
  pendingCursorRef,
  hoveredControlPointRef,
  status,
}: UseSplineDrawModeOptions) {
  const editMode = useEditorViewStore((state) => state.editMode);
  const splineKnots = useEditorViewStore((state) => state.splineKnots);
  const splineTangentOverrides = useEditorViewStore((state) => state.splineTangentOverrides);
  const splineTangentInOverrides = useEditorViewStore((state) => state.splineTangentInOverrides);
  const geometryEditSpline = useEditorViewStore((state) => state.geometryEditSpline);
  const { finalizeSplineCreation, finalizeDrawGeometry } = useSplineOperations();

  const syncCursor = useCallback((worldPos: WorldPosition) => {
    emitCursorMove(worldPos.x, worldPos.y);
    pendingCursorRef.current = worldPos;
  }, [pendingCursorRef]);

  const clearSplineDrawHover = useCallback(() => {
    useEditorViewStore.getState().setCursorPreviewPos(null);
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

  useEffect(() => {
    if (!isDrawMode(editMode)) {
      useEditorViewStore.getState().clearSplineKnots();
    }
  }, [editMode]);

  useEffect(() => {
    if (isDrawMode(editMode) || geometryEditSpline) {
      return;
    }
    clearSplineDrawHover();
  }, [clearSplineDrawHover, editMode, geometryEditSpline]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const viewState = useEditorViewStore.getState();
      if (!isDrawMode(viewState.editMode)) {
        return;
      }

      if (event.key === 'Escape') {
        viewState.clearSplineKnots();
        return;
      }

      if (event.key === 'Backspace') {
        viewState.popSplineKnot();
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        if (viewState.editMode === 'spline') {
          void finalizeSplineCreation(undefined, 'parampoly3');
        } else if (viewState.editMode === 'spiral') {
          void finalizeSplineCreation(undefined, 'classify');
        } else {
          void finalizeDrawGeometry(viewState.editMode, viewState.splineKnots);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [finalizeDrawGeometry, finalizeSplineCreation]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready' || geometryEditSpline) {
      return;
    }
    const overrides = Object.keys(splineTangentOverrides).length > 0 ? splineTangentOverrides : undefined;
    renderer.setSplinePreviewKnots(isDrawMode(editMode) ? splineKnots : [], overrides);
  }, [editMode, geometryEditSpline, rendererRef, splineKnots, splineTangentOverrides, splineTangentInOverrides, status]);

  /** Fire-and-forget endpoint snap query during draw mode mouse move. */
  const queryDrawModeSnap = useCallback(async (x: number, y: number) => {
    try {
      const service = await getPlatformService();
      const { project } = useEditorStore.getState();
      const snapResult = await service.snapPoint(project, x, y, {
        grid_enabled: false,
        grid_size: 1.0,
        endpoint_enabled: true,
        endpoint_threshold: useEditorViewStore.getState().snapThreshold,
        midpoint_enabled: false,
        perpendicular_enabled: false,
      });
      if (snapResult.snapped && snapResult.snap_type === 'Endpoint') {
        useEditorViewStore.getState().setDrawSnapResult({
          x: snapResult.x,
          y: snapResult.y,
          snapped: true,
          snapType: snapResult.snap_type,
          targetId: snapResult.target_id,
          contactPoint: snapResult.contact_point,
        });
      } else {
        useEditorViewStore.getState().setDrawSnapResult(null);
      }
    } catch {
      useEditorViewStore.getState().setDrawSnapResult(null);
    }
  }, []);

  /** Inherit tangent direction from a snapped road endpoint. */
  const inheritTangentFromSnap = useCallback(async (knotIndex: number, roadId: string, contactPoint: string) => {
    try {
      const service = await getPlatformService();
      const { project } = useEditorStore.getState();
      const tangent = await service.getRoadEndpointTangent(project, roadId, contactPoint);
      if (!tangent) return;
      // Convert heading to a tangent vector with a reasonable default length
      const len = 10.0;
      const tx = Math.cos(tangent.hdg) * len;
      const ty = Math.sin(tangent.hdg) * len;
      useEditorViewStore.getState().setSplineTangentOverride(knotIndex, [tx, ty, 0]);
    } catch {
      // Silently ignore tangent inheritance errors
    }
  }, []);

  const handleSplineDrawMouseMove = useCallback((worldPos: WorldPosition, canvas: HTMLCanvasElement, renderer: ViewportRenderer, mouseEvent?: MouseEvent | React.MouseEvent): boolean => {
    const viewState = useEditorViewStore.getState();
    if (viewState.geometryEditSpline || !isDrawMode(viewState.editMode)) {
      return false;
    }

    const drag = viewState.draggingKnot;
    if (drag) {
      const knots = viewState.splineKnots;
      if (drag.index >= 0 && drag.index < knots.length) {
        if (drag.type === 'knot') {
          viewState.setSplineKnots(knots.map((knot, index) => (
            index === drag.index ? [worldPos.x, worldPos.y, knot[2]] : knot
          )));
        } else if (viewState.editMode === 'spline' || viewState.editMode === 'spiral') {
          // Use applyHandleDrag with broken tangent (Alt) and constraint (Shift) support
          const coupling = mouseEvent?.altKey ? 'broken' as const : viewState.tangentCoupling;
          const constraint: DragConstraint = inferConstraint(
            worldPos.x - knots[drag.index]![0],
            worldPos.y - knots[drag.index]![1],
            mouseEvent?.shiftKey ?? false,
          );
          const result = applyHandleDrag(
            drag,
            worldPos.x,
            worldPos.y,
            knots,
            viewState.splineTangentOverrides,
            viewState.splineTangentInOverrides,
            coupling,
            constraint,
          );
          // Batch-update out-tangent overrides
          for (const [key, val] of Object.entries(result.out)) {
            viewState.setSplineTangentOverride(Number(key), val);
          }
          // Batch-update in-tangent overrides
          for (const [key, val] of Object.entries(result.in_)) {
            viewState.setSplineTangentInOverride(Number(key), val);
          }
          // If Alt was pressed, persist broken coupling for this session
          if (mouseEvent?.altKey && viewState.tangentCoupling !== 'broken') {
            viewState.setTangentCoupling('broken');
          }
        }
      }
      syncCursor(worldPos);
      return true;
    }

    // Query endpoint snap while in draw mode (async, fire-and-forget for responsiveness)
    if (viewState.snapEnabled) {
      void queryDrawModeSnap(worldPos.x, worldPos.y);
    } else {
      viewState.setDrawSnapResult(null);
    }

    if (viewState.splineKnots.length === 0) {
      clearSplineDrawHover();
      canvas.style.cursor = 'crosshair';
      return false;
    }

    // Update the live cursor preview position for real-time road mesh preview
    viewState.setCursorPreviewPos([worldPos.x, worldPos.y, 0]);

    const nextHover = findSplineControlPointHit(
      worldPos,
      viewState.splineKnots,
      renderer.getMetersPerPixel(),
      viewState.splineTangentOverrides,
      viewState.editMode === 'spline' || viewState.editMode === 'spiral',
    );
    updateHoveredControlPoint(renderer, nextHover);
    canvas.style.cursor = nextHover ? 'grab' : 'crosshair';
    return false;
  }, [clearSplineDrawHover, queryDrawModeSnap, syncCursor, updateHoveredControlPoint]);

  const handleSplineDrawMouseDown = useCallback((e: React.MouseEvent, canvas: HTMLCanvasElement, renderer: ViewportRenderer): boolean => {
    const viewState = useEditorViewStore.getState();
    if (viewState.geometryEditSpline || !isDrawMode(viewState.editMode) || viewState.splineKnots.length === 0) {
      return false;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = (e.clientX - rect.left) * devicePixelRatio;
    const screenY = (e.clientY - rect.top) * devicePixelRatio;
    const worldPos = renderer.unprojectToGround(screenX, screenY);
    if (!worldPos) {
      return false;
    }

    const bestHit = findSplineControlPointHit(
      worldPos,
      viewState.splineKnots,
      renderer.getMetersPerPixel(),
      viewState.splineTangentOverrides,
      viewState.editMode === 'spline' || viewState.editMode === 'spiral',
    );
    if (!bestHit) {
      return false;
    }

    viewState.setDraggingKnot(bestHit);
    renderer.lockCamera();
    canvas.style.cursor = 'grabbing';
    hoveredControlPointRef.current = null;
    renderer.refreshSplineMarkers(null, bestHit);
    return true;
  }, [hoveredControlPointRef]);

  const handleSplineDrawClick = useCallback(async (e: React.MouseEvent, worldPos: WorldPosition): Promise<boolean> => {
    const viewState = useEditorViewStore.getState();
    if (viewState.geometryEditRoadId || !isDrawMode(viewState.editMode)) {
      return false;
    }

    // If snapped to an endpoint, use the snapped position instead of raw cursor
    const snap = viewState.drawSnapResult;
    const useSnap = snap?.snapped && snap.snapType === 'Endpoint' && snap.targetId && snap.contactPoint;
    const px = useSnap ? snap.x : worldPos.x;
    const py = useSnap ? snap.y : worldPos.y;

    const point: [number, number, number] = [px, py, 0];
    const knotIndex = viewState.splineKnots.length;
    const nextKnots: Array<[number, number, number]> = [...viewState.splineKnots, point];
    viewState.setSplineKnots(nextKnots);

    // Tangent inheritance: if snapped to an endpoint, query the road's heading
    // and set as tangent override for this knot
    if (useSnap && (viewState.editMode === 'spline' || viewState.editMode === 'spiral')) {
      void inheritTangentFromSnap(knotIndex, snap.targetId!, snap.contactPoint!);
    }

    // Track snapped endpoint for road linking on finalization
    if (useSnap) {
      viewState.addSnappedEndpoint({
        knotIndex,
        roadId: snap.targetId!,
        contactPoint: snap.contactPoint!,
      });
    }

    if (e.detail < 2) {
      return true;
    }

    if (viewState.editMode === 'spline') {
      if (nextKnots.length >= 2) {
        await finalizeSplineCreation(nextKnots, 'parampoly3');
      }
      return true;
    }

    if (viewState.editMode === 'spiral') {
      if (nextKnots.length >= 2) {
        await finalizeSplineCreation(nextKnots, 'classify');
      }
      return true;
    }

    const minPoints = viewState.editMode === 'arc' ? 3 : 2;
    if (nextKnots.length >= minPoints) {
      await finalizeDrawGeometry(viewState.editMode, nextKnots);
    }
    return true;
  }, [finalizeDrawGeometry, finalizeSplineCreation, inheritTangentFromSnap]);

  const handleSplineDrawMouseUp = useCallback((): boolean => {
    const viewState = useEditorViewStore.getState();
    if (viewState.geometryEditSpline || !viewState.draggingKnot || !isDrawMode(viewState.editMode)) {
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
      canvas.style.cursor = 'crosshair';
    }
    return true;
  }, [canvasRef, hoveredControlPointRef, rendererRef]);

  /**
   * Called on right-click (context-menu) while in draw mode.
   * If ≥2 knots exist, finalizes the road; otherwise cancels.
   * Returns true when the event was consumed (draw mode was active).
   */
  const handleSplineDrawRightClick = useCallback((): boolean => {
    const viewState = useEditorViewStore.getState();
    if (!isDrawMode(viewState.editMode)) {
      return false;
    }
    if (viewState.splineKnots.length >= 2) {
      if (viewState.editMode === 'spline') {
        void finalizeSplineCreation(undefined, 'parampoly3');
      } else if (viewState.editMode === 'spiral') {
        void finalizeSplineCreation(undefined, 'classify');
      } else {
        void finalizeDrawGeometry(viewState.editMode, viewState.splineKnots);
      }
    } else {
      // Not enough points — just cancel without creating a road
      viewState.clearSplineKnots();
    }
    return true;
  }, [finalizeDrawGeometry, finalizeSplineCreation]);

  return {
    clearSplineDrawHover,
    handleSplineDrawMouseMove,
    handleSplineDrawMouseDown,
    handleSplineDrawClick,
    handleSplineDrawMouseUp,
    handleSplineDrawRightClick,
  };
}
