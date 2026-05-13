import { useCallback, useEffect, type MutableRefObject, type RefObject } from 'react';
import { ViewportRenderer } from '../viewport/renderer';
import { emitCursorMove } from '../viewport/cursorEvents';
import { useEditorViewStore } from '../stores/editorViewStore';
import {
  findSplineControlPointHit,
  tangentFromHandlePosition,
  type SplineControlPoint,
} from '../components/viewportUtils';
import { useSplineOperations } from './useSplineOperations';

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
  const geometryEditSpline = useEditorViewStore((state) => state.geometryEditSpline);
  const { finalizeSplineCreation, finalizeDrawGeometry } = useSplineOperations();

  const syncCursor = useCallback((worldPos: WorldPosition) => {
    emitCursorMove(worldPos.x, worldPos.y);
    pendingCursorRef.current = worldPos;
  }, [pendingCursorRef]);

  const clearSplineDrawHover = useCallback(() => {
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
          void finalizeSplineCreation();
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
  }, [editMode, geometryEditSpline, rendererRef, splineKnots, splineTangentOverrides, status]);

  const handleSplineDrawMouseMove = useCallback((worldPos: WorldPosition, canvas: HTMLCanvasElement, renderer: ViewportRenderer): boolean => {
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
        } else if (viewState.editMode === 'spline') {
          viewState.setSplineTangentOverride(
            drag.index,
            tangentFromHandlePosition(knots[drag.index]!, worldPos, drag.type),
          );
        }
      }
      syncCursor(worldPos);
      return true;
    }

    if (viewState.splineKnots.length === 0) {
      clearSplineDrawHover();
      canvas.style.cursor = 'crosshair';
      return false;
    }

    const nextHover = findSplineControlPointHit(
      worldPos,
      viewState.splineKnots,
      renderer.getMetersPerPixel(),
      viewState.splineTangentOverrides,
      viewState.editMode === 'spline',
    );
    updateHoveredControlPoint(renderer, nextHover);
    canvas.style.cursor = nextHover ? 'grab' : 'crosshair';
    return false;
  }, [clearSplineDrawHover, syncCursor, updateHoveredControlPoint]);

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
      viewState.editMode === 'spline',
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

    const point: [number, number, number] = [worldPos.x, worldPos.y, 0];
    const nextKnots: Array<[number, number, number]> = [...viewState.splineKnots, point];
    viewState.setSplineKnots(nextKnots);

    if (e.detail < 2) {
      return true;
    }

    if (viewState.editMode === 'spline') {
      if (nextKnots.length >= 2) {
        await finalizeSplineCreation(nextKnots);
      }
      return true;
    }

    const minPoints = viewState.editMode === 'arc' ? 3 : 2;
    if (nextKnots.length >= minPoints) {
      await finalizeDrawGeometry(viewState.editMode, nextKnots);
    }
    return true;
  }, [finalizeDrawGeometry, finalizeSplineCreation]);

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

  return {
    clearSplineDrawHover,
    handleSplineDrawMouseMove,
    handleSplineDrawMouseDown,
    handleSplineDrawClick,
    handleSplineDrawMouseUp,
  };
}
