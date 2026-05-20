import { useCallback, useRef, type MutableRefObject, type RefObject, type TouchEvent } from 'react';
import type { ViewportRenderer } from '../viewport/renderer';

interface TouchPoint {
  id: number;
  x: number;
  y: number;
}

interface TouchState {
  touches: TouchPoint[];
  lastPinchDist: number | null;
}

interface UseViewportTouchParams {
  rendererRef: RefObject<ViewportRenderer | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

interface UseViewportTouchReturn {
  touchStateRef: MutableRefObject<TouchState>;
  handleTouchStart: (e: TouchEvent<HTMLCanvasElement>) => void;
  handleTouchMove: (e: TouchEvent<HTMLCanvasElement>) => void;
  handleTouchEnd: (e: TouchEvent<HTMLCanvasElement>) => void;
}

export function useViewportTouch({
  rendererRef,
  canvasRef,
}: UseViewportTouchParams): UseViewportTouchReturn {
  const touchStateRef = useRef<TouchState>({ touches: [], lastPinchDist: null });

  const handleTouchStart = useCallback((e: TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const touches = Array.from(e.touches).map((touch) => ({
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
    }));
    touchStateRef.current.touches = touches;
    if (touches.length === 2) {
      const dx = touches[1]!.x - touches[0]!.x;
      const dy = touches[1]!.y - touches[0]!.y;
      touchStateRef.current.lastPinchDist = Math.sqrt(dx * dx + dy * dy);
    } else {
      touchStateRef.current.lastPinchDist = null;
    }
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!renderer || !canvas) return;

    const previousTouches = touchStateRef.current.touches;
    const currentTouches = Array.from(e.touches).map((touch) => ({
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
    }));
    touchStateRef.current.touches = currentTouches;

    if (currentTouches.length === 1 && previousTouches.length === 1) {
      const previousTouch = previousTouches[0]!;
      const currentTouch = currentTouches[0]!;
      renderer.applyPan(canvas, [previousTouch.x, previousTouch.y], [currentTouch.x, currentTouch.y]);
      return;
    }

    if (currentTouches.length === 2 && previousTouches.length >= 2) {
      const dx = currentTouches[1]!.x - currentTouches[0]!.x;
      const dy = currentTouches[1]!.y - currentTouches[0]!.y;
      const newDistance = Math.sqrt(dx * dx + dy * dy);
      const oldDistance = touchStateRef.current.lastPinchDist;
      if (oldDistance && oldDistance > 0) {
        renderer.applyZoomFactor(oldDistance / newDistance);
      }
      touchStateRef.current.lastPinchDist = newDistance;
    }
  }, [canvasRef, rendererRef]);

  const handleTouchEnd = useCallback((e: TouchEvent<HTMLCanvasElement>) => {
    const currentTouches = Array.from(e.touches).map((touch) => ({
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
    }));
    touchStateRef.current.touches = currentTouches;
    if (currentTouches.length < 2) {
      touchStateRef.current.lastPinchDist = null;
    }
  }, []);

  return {
    touchStateRef,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}
