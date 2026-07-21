import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useViewportStore } from '../stores/viewportStore';
import { useProjectStore } from '../stores/projectStore';
import { usePluginContribStore } from '../stores/pluginContribStore';
import { evalRoadAtS } from '../utils/roadEdit';
import type { ViewportRenderer } from '../viewport/renderer';

type ViewportStatus = 'loading' | 'ready' | 'unsupported';

const POINT_RADIUS = 5;
const POINT_COLOR = '#00BFFF';
const LINE_COLOR = '#00BFFF';
const LINE_COLOR_LINE_MODE = '#FF9800';
const LINE_WIDTH = 2;
const FILL_COLOR = 'rgba(0, 191, 255, 0.12)';

/**
 * Renders a line/polygon draw overlay on a Canvas 2D layer while the user is
 * drawing a road object (stop line, crosswalk, parking space, etc.).
 *
 * - **line** mode: open polyline (no closing edge, no fill)
 * - **polygon** mode: closed polygon (closing edge + translucent fill)
 */
export function useObjectDrawOverlay({
  rendererRef,
  canvasRef,
  status,
}: {
  rendererRef: RefObject<ViewportRenderer | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  status: ViewportStatus;
}) {
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const worldCoordsRef = useRef<Array<{ x: number; y: number }>>([]);

  const objectDrawVertices = useViewportStore((s) => s.objectDrawVertices);
  const objectDrawRoadId = useViewportStore((s) => s.objectDrawRoadId);
  const objectDrawTemplateId = useViewportStore((s) => s.objectDrawTemplateId);

  // Create and attach overlay canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent || status !== 'ready') return;

    if (!overlayRef.current) {
      const el = document.createElement('canvas');
      el.style.position = 'absolute';
      el.style.inset = '0';
      el.style.pointerEvents = 'none';
      el.style.zIndex = '2';
      overlayRef.current = el;
    }
    const overlay = overlayRef.current;

    if (overlay.parentElement === parent) return;

    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    parent.appendChild(overlay);
  }, [canvasRef, status]);

  // Resize overlay to match canvas
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

  // Convert road-frame vertices (s, t) to world coordinates when they change
  useEffect(() => {
    if (!objectDrawRoadId || objectDrawVertices.length === 0) {
      worldCoordsRef.current = [];
      return;
    }

    const project = useProjectStore.getState().project;
    const road = project.roads.find((r) => r.id === objectDrawRoadId);
    if (!road) {
      worldCoordsRef.current = [];
      return;
    }

    const coords: Array<{ x: number; y: number }> = [];
    for (const v of objectDrawVertices) {
      const s = v[0];
      const t = v[1];
      const pose = evalRoadAtS(road, s);
      // Offset perpendicular to heading by t
      const nx = -Math.sin(pose.hdg);
      const ny = Math.cos(pose.hdg);
      coords.push({ x: pose.x + nx * t, y: pose.y + ny * t });
    }
    worldCoordsRef.current = coords;
  }, [objectDrawVertices, objectDrawRoadId]);

  // Drawing function
  const draw = useCallback(() => {
    const overlay = overlayRef.current;
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!overlay || !renderer || !canvas) return;

    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const worldCoords = worldCoordsRef.current;
    if (worldCoords.length === 0) return;

    // Determine draw mode from the active template
    const tid = useViewportStore.getState().objectDrawTemplateId;
    const allItems = usePluginContribStore.getState().templateSections.flatMap((s) => s.items);
    const tplItem = tid ? allItems.find((i) => i.id === tid) : undefined;
    const isLineMode = tplItem?.drawMode === 'line';

    const dpr = canvas.width / canvas.clientWidth;

    const screenPoints: Array<{ x: number; y: number } | null> = [];
    for (const pt of worldCoords) {
      const screen = renderer.projectWorldToScreen(pt.x, pt.y);
      if (screen) {
        screenPoints.push({ x: screen.x / dpr, y: screen.y / dpr });
      } else {
        screenPoints.push(null);
      }
    }

    // Fill polygon area (polygon mode only, ≥3 points)
    if (!isLineMode && screenPoints.filter(Boolean).length >= 3) {
      ctx.fillStyle = FILL_COLOR;
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

    // Connecting lines
    const lineColor = isLineMode ? LINE_COLOR_LINE_MODE : LINE_COLOR;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = LINE_WIDTH;
    ctx.setLineDash(isLineMode ? [] : [6, 4]);
    ctx.beginPath();
    let started = false;
    for (const sp of screenPoints) {
      if (sp) {
        if (!started) { ctx.moveTo(sp.x, sp.y); started = true; }
        else ctx.lineTo(sp.x, sp.y);
      }
    }
    // Close the polygon visually (polygon mode only, ≥3 points)
    if (!isLineMode && screenPoints.length >= 3) {
      const firstValid = screenPoints.find(Boolean);
      if (firstValid) ctx.lineTo(firstValid.x, firstValid.y);
    }
    if (started) ctx.stroke();
    ctx.setLineDash([]);

    // Vertex markers
    for (let i = 0; i < screenPoints.length; i++) {
      const sp = screenPoints[i];
      if (!sp) continue;

      ctx.fillStyle = 'rgba(0, 191, 255, 0.3)';
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

  // rAF loop while polygon drawing is active
  useEffect(() => {
    if (!objectDrawTemplateId || status !== 'ready') return;
    let frameId = 0;
    const loop = () => {
      draw();
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [objectDrawTemplateId, status, draw]);

  // Clear overlay when exiting polygon draw
  useEffect(() => {
    if (!objectDrawTemplateId) {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const ctx = overlay.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);
    }
  }, [objectDrawTemplateId]);

  return overlayRef;
}
