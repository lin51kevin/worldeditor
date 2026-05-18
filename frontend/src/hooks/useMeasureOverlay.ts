import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useViewportStore } from '../stores/viewportStore';
import type { ViewportRenderer } from '../viewport/renderer';

type ViewportStatus = 'loading' | 'ready' | 'unsupported';

const POINT_RADIUS = 5;
const POINT_COLOR = '#FF6B35';
const LINE_COLOR = '#FF6B35';
const LINE_WIDTH = 2;

/**
 * Renders measure-point markers and connecting lines on a Canvas 2D overlay
 * whenever the viewport is in a measurement mode (distance / angle / area).
 *
 * Uses `renderer.projectWorldToScreen()` to convert world coordinates to
 * screen (CSS-pixel) coordinates, matching the existing WebGPU canvas.
 */
export function useMeasureOverlay({
  rendererRef,
  canvasRef,
  status,
}: {
  rendererRef: RefObject<ViewportRenderer | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  status: ViewportStatus;
}) {
  const measureMode = useViewportStore((s) => s.measureMode);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  // Create (once) and attach the overlay canvas to the WebGPU canvas parent.
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent || status !== 'ready') return;

    // Lazily create the overlay canvas on first mount
    if (!overlayRef.current) {
      const el = document.createElement('canvas');
      el.style.position = 'absolute';
      el.style.inset = '0';
      el.style.pointerEvents = 'none';
      el.style.zIndex = '1';
      overlayRef.current = el;
    }
    const overlay = overlayRef.current;

    if (overlay.parentElement === parent) return;

    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '1';
    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    parent.appendChild(overlay);
  }, [canvasRef, status]);

  // Resize overlay to match the CSS pixel dimensions of the WebGPU canvas.
  useEffect(() => {
    const overlay = overlayRef.current;
    const canvas = canvasRef.current;
    if (!overlay || !canvas) return;

    const resize = () => {
      overlay.width = canvas.clientWidth;
      overlay.height = canvas.clientHeight;
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef, status]);

  // Drawing function — called from the rAF loop while measure mode is active.
  const draw = useCallback(() => {
    const overlay = overlayRef.current;
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!overlay || !renderer || !canvas) return;

    const currentMode = useViewportStore.getState().measureMode;
    const currentPoints = useViewportStore.getState().measurePoints;
    if (currentMode === 'none') return;

    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    // Clear the overlay first — either redraw markers or show nothing
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (currentPoints.length === 0) return;

    const dpr = canvas.width / canvas.clientWidth;

    const screenPoints: Array<{ x: number; y: number } | null> = [];
    for (const pt of currentPoints) {
      const screen = renderer.projectWorldToScreen(pt.x, pt.y);
      if (screen) {
        screenPoints.push({ x: screen.x / dpr, y: screen.y / dpr });
      } else {
        screenPoints.push(null);
      }
    }

    // Connecting lines
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = LINE_WIDTH;
    ctx.beginPath();
    let started = false;
    for (const sp of screenPoints) {
      if (sp) {
        if (!started) { ctx.moveTo(sp.x, sp.y); started = true; }
        else ctx.lineTo(sp.x, sp.y);
      }
    }
    if (started) ctx.stroke();

    // Per-segment distance labels (distance mode only)
    if (currentMode === 'distance' && currentPoints.length >= 2) {
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      for (let i = 0; i < currentPoints.length - 1; i++) {
        const pa = currentPoints[i]!;
        const pb = currentPoints[i + 1]!;
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const segDist = Math.sqrt(dx * dx + dy * dy);
        const sa = screenPoints[i];
        const sb = screenPoints[i + 1];
        if (!sa || !sb) continue;
        const mx = (sa.x + sb.x) / 2;
        const my = (sa.y + sb.y) / 2;
        const label = segDist.toFixed(2) + ' m';
        const tw = ctx.measureText(label).width;
        // Background pill
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        const pad = 4;
        ctx.beginPath();
        ctx.roundRect(mx - tw / 2 - pad, my - 16 - pad, tw + pad * 2, 18 + pad, 4);
        ctx.fill();
        // Text
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(label, mx, my - 6);
      }
    }

    // Area fill
    if (currentMode === 'area' && screenPoints.filter(Boolean).length >= 3) {
      ctx.fillStyle = 'rgba(255, 107, 53, 0.15)';
      ctx.beginPath();
      let first = true;
      for (const sp of screenPoints) {
        if (sp) {
          if (first) { ctx.moveTo(sp.x, sp.y); first = false; }
          else ctx.lineTo(sp.x, sp.y);
        }
      }
      ctx.closePath();
      ctx.fill();
    }

    // Point markers
    for (let i = 0; i < screenPoints.length; i++) {
      const sp = screenPoints[i];
      if (!sp) continue;

      ctx.fillStyle = 'rgba(255, 107, 53, 0.3)';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, POINT_RADIUS + 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = POINT_COLOR;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, POINT_RADIUS, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), sp.x, sp.y);
    }
  }, [rendererRef, canvasRef]);

  // Run a rAF loop while measure mode is active so markers follow camera pan/zoom.
  useEffect(() => {
    if (measureMode === 'none' || status !== 'ready') return;
    let frameId = 0;
    const loop = () => {
      draw();
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [measureMode, status, draw]);

  // Clear overlay when exiting measure mode
  useEffect(() => {
    if (measureMode === 'none') {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const ctx = overlay.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);
    }
  }, [measureMode]);

  return overlayRef;
}
