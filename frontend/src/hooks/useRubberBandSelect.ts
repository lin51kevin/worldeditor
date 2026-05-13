import { useRef, type RefObject } from 'react';
import { ViewportRenderer } from '../viewport/renderer';
import { useEditorStore } from '../stores/editorStore';
import { DRAG_THRESHOLD_SQ, roadIntersectsAABB, junctionIntersectsAABB } from '../components/viewportUtils';

interface RubberBandState {
  startClientX: number;
  startClientY: number;
  active: boolean;
}

/**
 * Handles rubber-band (shift+drag) box selection of roads/junctions.
 */
export function useRubberBandSelect(
  rendererRef: RefObject<ViewportRenderer | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
) {
  const rubberBandRef = useRef<RubberBandState | null>(null);
  const rubberBandOverlayRef = useRef<HTMLDivElement>(null);

  /** Start rubber-band drag. Returns true if started. */
  const startRubberBand = (e: React.MouseEvent, renderer: ViewportRenderer): boolean => {
    rubberBandRef.current = { startClientX: e.clientX, startClientY: e.clientY, active: false };
    renderer.lockCamera();
    return true;
  };

  /** Update rubber-band overlay during mouse move. Returns true if handled. */
  const updateRubberBand = (e: React.MouseEvent, canvas: HTMLCanvasElement): boolean => {
    const rubberBand = rubberBandRef.current;
    if (!rubberBand) return false;

    const dx = e.clientX - rubberBand.startClientX;
    const dy = e.clientY - rubberBand.startClientY;
    if (dx * dx + dy * dy > DRAG_THRESHOLD_SQ) {
      rubberBand.active = true;
      const overlay = rubberBandOverlayRef.current;
      if (overlay) {
        const canvasRect = canvas.getBoundingClientRect();
        const x0 = rubberBand.startClientX - canvasRect.left;
        const y0 = rubberBand.startClientY - canvasRect.top;
        const x1 = e.clientX - canvasRect.left;
        const y1 = e.clientY - canvasRect.top;
        overlay.style.display = 'block';
        overlay.style.left = `${Math.min(x0, x1)}px`;
        overlay.style.top = `${Math.min(y0, y1)}px`;
        overlay.style.width = `${Math.abs(x1 - x0)}px`;
        overlay.style.height = `${Math.abs(y1 - y0)}px`;
      }
    }
    return true;
  };

  /** Commit rubber-band selection on mouse up. Returns true if handled. */
  const commitRubberBand = (e: React.MouseEvent): boolean => {
    const rubberBand = rubberBandRef.current;
    if (!rubberBand) return false;

    rubberBandRef.current = null;
    const overlay = rubberBandOverlayRef.current;
    if (overlay) overlay.style.display = 'none';
    const renderer = rendererRef.current;
    if (renderer) renderer.unlockCamera();

    if (rubberBand.active) {
      const canvas = canvasRef.current;
      if (canvas && renderer) {
        const canvasRect = canvas.getBoundingClientRect();
        const dpr = devicePixelRatio;
        const sx0 = (rubberBand.startClientX - canvasRect.left) * dpr;
        const sy0 = (rubberBand.startClientY - canvasRect.top) * dpr;
        const sx1 = (e.clientX - canvasRect.left) * dpr;
        const sy1 = (e.clientY - canvasRect.top) * dpr;
        const tl = renderer.unprojectToGround(Math.min(sx0, sx1), Math.min(sy0, sy1));
        const br = renderer.unprojectToGround(Math.max(sx0, sx1), Math.max(sy0, sy1));
        if (tl && br) {
          const minX = Math.min(tl.x, br.x);
          const maxX = Math.max(tl.x, br.x);
          const minY = Math.min(tl.y, br.y);
          const maxY = Math.max(tl.y, br.y);
          const { project } = useEditorStore.getState();
          const roadIds = project.roads
            .filter((r) => roadIntersectsAABB(r, minX, minY, maxX, maxY))
            .map((r) => r.id);
          const junctionIds = project.junctions
            .filter((j) => junctionIntersectsAABB(j, project, minX, minY, maxX, maxY))
            .map((j) => j.id);
          useEditorStore.getState().selectMultiple(roadIds, junctionIds);
        }
      }
    }
    return true;
  };

  return {
    rubberBandRef,
    rubberBandOverlayRef,
    startRubberBand,
    updateRubberBand,
    commitRubberBand,
  };
}
