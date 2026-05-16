import { useRef, type MutableRefObject, type RefObject } from 'react';
import { ViewportRenderer } from '../viewport/renderer';
import { emitCursorMove } from '../viewport/cursorEvents';
import { useProjectStore } from '../stores/projectStore';
import { useViewportStore } from '../stores/viewportStore';
import { getPlatformService } from '../services';
import type { MoveRotateDragState } from '../components/viewportUtils';

/**
 * Handles move-road / rotate-road drag interaction.
 */
export function useMoveRotateMode(
  rendererRef: RefObject<ViewportRenderer | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  isPreviewingRoadRef: MutableRefObject<boolean>,
  pendingCursorRef: MutableRefObject<{ x: number; y: number } | null>,
) {
  const moveRotateDragRef = useRef<MoveRotateDragState | null>(null);

  /** Start move/rotate drag. Returns true if started. */
  const startMoveRotateDrag = (
    e: React.MouseEvent,
    renderer: ViewportRenderer,
    canvas: HTMLCanvasElement,
  ): boolean => {
    const viewState = useViewportStore.getState();
    if (viewState.editMode !== 'move-road' && viewState.editMode !== 'rotate-road') return false;

    const selRoadId = useProjectStore.getState().selectedRoadId;
    const road = selRoadId ? useProjectStore.getState().project.roads.find((r) => r.id === selRoadId) : null;
    if (!road || road.plan_view.length === 0) return false;

    const rect = canvas.getBoundingClientRect();
    const screenX = (e.clientX - rect.left) * devicePixelRatio;
    const screenY = (e.clientY - rect.top) * devicePixelRatio;
    const worldPos = renderer.unprojectToGround(screenX, screenY);
    if (!worldPos) return false;

    const cx = road.plan_view.reduce((sum, g) => sum + g.x, 0) / road.plan_view.length;
    const cy = road.plan_view.reduce((sum, g) => sum + g.y, 0) / road.plan_view.length;
    moveRotateDragRef.current = {
      mode: viewState.editMode,
      roadId: selRoadId!,
      startWorldX: worldPos.x,
      startWorldY: worldPos.y,
      centroidX: cx,
      centroidY: cy,
      currentDx: 0,
      currentDy: 0,
      currentAngle: 0,
    };
    renderer.lockCamera();
    canvas.style.cursor = viewState.editMode === 'move-road' ? 'move' : 'crosshair';
    return true;
  };

  /** Update move/rotate preview during mouse move. Returns true if handled. */
  const updateMoveRotateDrag = (worldPos: { x: number; y: number }): boolean => {
    const moveRotateDrag = moveRotateDragRef.current;
    if (!moveRotateDrag) return false;

    const { mode, roadId, startWorldX, startWorldY, centroidX, centroidY } = moveRotateDrag;
    const { project: currentProject } = useProjectStore.getState();
    const road = currentProject.roads.find((r) => r.id === roadId);
    if (road) {
      let previewRoad: typeof road;
      if (mode === 'move-road') {
        const dx = worldPos.x - startWorldX;
        const dy = worldPos.y - startWorldY;
        moveRotateDrag.currentDx = dx;
        moveRotateDrag.currentDy = dy;
        previewRoad = {
          ...road,
          plan_view: road.plan_view.map((g) => ({ ...g, x: g.x + dx, y: g.y + dy })),
        };
      } else {
        const startAngle = Math.atan2(startWorldY - centroidY, startWorldX - centroidX);
        const currentAngle = Math.atan2(worldPos.y - centroidY, worldPos.x - centroidX);
        const angleDelta = currentAngle - startAngle;
        moveRotateDrag.currentAngle = angleDelta;
        const cosA = Math.cos(angleDelta);
        const sinA = Math.sin(angleDelta);
        previewRoad = {
          ...road,
          plan_view: road.plan_view.map((g) => {
            const rx = g.x - centroidX;
            const ry = g.y - centroidY;
            return {
              ...g,
              x: centroidX + rx * cosA - ry * sinA,
              y: centroidY + rx * sinA + ry * cosA,
              hdg: g.hdg + angleDelta,
            };
          }),
        };
      }

      if (!isPreviewingRoadRef.current) {
        isPreviewingRoadRef.current = true;
        const liveRenderer = rendererRef.current;
        if (liveRenderer) {
          void (async () => {
            try {
              const service = await getPlatformService();
              const verts = await service.generateSingleRoadVertices(
                previewRoad, 2.0, [0.95, 0.60, 0.10, 0.85],
              );
              rendererRef.current?.uploadHighlightVertices(verts);
            } catch { /* ignore preview errors */ }
            finally { isPreviewingRoadRef.current = false; }
          })();
        }
      }
    }
    emitCursorMove(worldPos.x, worldPos.y);
    pendingCursorRef.current = worldPos;
    return true;
  };

  /** Commit move/rotate to store on mouse up. Returns true if handled. */
  const commitMoveRotateDrag = (): boolean => {
    const moveRotateDrag = moveRotateDragRef.current;
    if (!moveRotateDrag) return false;

    moveRotateDragRef.current = null;
    const renderer = rendererRef.current;
    if (renderer) {
      renderer.unlockCamera();
      renderer.clearHighlight();
    }
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = '';
    const { mode, roadId, currentDx, currentDy, currentAngle, centroidX, centroidY } = moveRotateDrag;
    const store = useProjectStore.getState();
    if (mode === 'move-road' && (currentDx !== 0 || currentDy !== 0)) {
      store.moveRoad(roadId, currentDx, currentDy);
    } else if (mode === 'rotate-road' && currentAngle !== 0) {
      store.rotateRoad(roadId, currentAngle, centroidX, centroidY);
    }
    return true;
  };

  return {
    moveRotateDragRef,
    startMoveRotateDrag,
    updateMoveRotateDrag,
    commitMoveRotateDrag,
  };
}
