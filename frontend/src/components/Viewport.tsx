import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ViewportRenderer } from '../viewport/renderer';
import { onViewportEvent } from '../viewport/viewportEvents';
import { useEditorStore } from '../stores/editorStore';
import { useEditorViewStore } from '../stores/editorViewStore';
import { useThemeStore } from '../stores/themeStore';
import { getPlatformService } from '../services';
import { showContextMenu } from '../services/contextMenu';
import './Viewport.css';

const DRAG_THRESHOLD_SQ = 9;

/** Concatenate two Float32Arrays into a single new array. */
function mergeFloat32Arrays(a: Float32Array, b: Float32Array): Float32Array {
  if (b.length === 0) return a;
  if (a.length === 0) return b;
  const merged = new Float32Array(a.length + b.length);
  merged.set(a, 0);
  merged.set(b, a.length);
  return merged;
}

interface MouseGestureState {
  button: number;
  startX: number;
  startY: number;
  dragged: boolean;
}

function exceededDragThreshold(startX: number, startY: number, clientX: number, clientY: number): boolean {
  const dx = clientX - startX;
  const dy = clientY - startY;
  return dx * dx + dy * dy > DRAG_THRESHOLD_SQ;
}

export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ViewportRenderer | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unsupported'>('loading');
  const project = useEditorStore((s) => s.project);
  const selectedRoadId = useEditorStore((s) => s.selectedRoadId);
  const { showGrid, showAxis, dimension } = useEditorViewStore();
  const theme = useThemeStore((s) => s.theme);
  const { t } = useTranslation();
  const mouseGestureRef = useRef<MouseGestureState | null>(null);

  // Regenerate road mesh when project changes
  const updateMesh = useCallback(async () => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready' || !project) return;

    try {
      const service = await getPlatformService();

      // Generate road surfaces and junction surfaces in parallel
      const [roadVerts, junctionVerts, laneLineVerts, centerLineVerts] = await Promise.all([
        service.generateRoadVertices(project, 2.0),
        service.generateJunctionVertices(project),
        service.generateLaneLineVertices(project, 2.0),
        service.generateCenterLineVertices(project, 2.0),
      ]);

      // Merge road surfaces + junction surfaces into one upload
      const surfaceVerts = mergeFloat32Arrays(roadVerts, junctionVerts);
      renderer.uploadRoadVertices(surfaceVerts);

      // Merge lane boundary lines + reference centerlines into lane line upload
      const lineVerts = mergeFloat32Arrays(laneLineVerts, centerLineVerts);
      renderer.uploadLaneLineVertices(lineVerts);
    } catch (err) {
      console.error('[Viewport] Failed to generate road mesh:', err);
    }
  }, [project, status]);

  useEffect(() => { updateMesh(); }, [updateMesh]);

  // Update selection highlight when selectedRoadId changes
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready') return;

    const selectedRoad = selectedRoadId
      ? project.roads.find((r) => r.id === selectedRoadId)
      : null;

    if (!selectedRoad) {
      renderer.clearHighlight();
      return;
    }

    (async () => {
      try {
        const service = await getPlatformService();
        // Highlight color: bright blue with slight transparency
        const highlightVerts = await service.generateSingleRoadVertices(
          selectedRoad, 2.0, [0.2, 0.5, 1.0, 0.7],
        );
        renderer.uploadHighlightVertices(highlightVerts);
      } catch (err) {
        console.error('[Viewport] Failed to generate highlight mesh:', err);
      }
    })();
  }, [selectedRoadId, project, status]);

  // Sync grid/axis/dimension to renderer
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready') return;
    renderer.setShowGrid(showGrid);
    renderer.setShowAxis(showAxis);
  }, [showGrid, showAxis, status]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready') return;
    renderer.setDimension(dimension);
  }, [dimension, status]);

  // Sync theme colors to WebGPU renderer
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready') return;
    try {
      const style = getComputedStyle(document.documentElement);
      const r = parseFloat(style.getPropertyValue('--color-viewport-clear-r')) || 0.10;
      const g = parseFloat(style.getPropertyValue('--color-viewport-clear-g')) || 0.10;
      const b = parseFloat(style.getPropertyValue('--color-viewport-clear-b')) || 0.12;
      renderer.setClearColor(r, g, b);
      const gr = parseFloat(style.getPropertyValue('--color-viewport-grid-r')) || 0.35;
      const gg = parseFloat(style.getPropertyValue('--color-viewport-grid-g')) || 0.35;
      const gb = parseFloat(style.getPropertyValue('--color-viewport-grid-b')) || 0.35;
      renderer.setGridColor(gr, gg, gb);
    } catch {
      // CSS custom properties unavailable in test environment
    }
  }, [theme, status]);

  // Listen for viewport events from other components
  useEffect(() => {
    const unsubscribe = onViewportEvent((event) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      switch (event.type) {
        case 'zoom-to-fit':
          renderer.fitToVertices();
          break;
        case 'set-dimension':
          renderer.setDimension(event.dimension);
          break;
        case 'set-show-grid':
          renderer.setShowGrid(event.show);
          break;
        case 'set-show-axis':
          renderer.setShowAxis(event.show);
          break;
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!ViewportRenderer.isSupported()) {
      setStatus('unsupported');
      return;
    }

    const renderer = new ViewportRenderer();
    rendererRef.current = renderer;

    const initRenderer = async () => {
      // Size canvas to container
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = Math.floor(rect.width * devicePixelRatio);
        canvas.height = Math.floor(rect.height * devicePixelRatio);
      }

      const ok = await renderer.init(canvas);
      if (ok) {
        setStatus('ready');
        renderer.start();
        renderer.setScaleChangeCallback((info) => {
          useEditorStore.getState().setViewportInfo(info);
        });
      } else {
        setStatus('unsupported');
      }
    };

    initRenderer();

    // Handle resize
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const w = Math.floor(width * devicePixelRatio);
        const h = Math.floor(height * devicePixelRatio);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          renderer.resize(w, h);
        }
      }
    });
    observer.observe(canvas.parentElement!);

    return () => {
      observer.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  // Handle mouse move for world coordinates (unproject to ground plane)
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const gesture = mouseGestureRef.current;
    if (gesture && !gesture.dragged && exceededDragThreshold(gesture.startX, gesture.startY, e.clientX, e.clientY)) {
      gesture.dragged = true;
    }
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;
    const rect = canvas.getBoundingClientRect();
    const screenX = (e.clientX - rect.left) * devicePixelRatio;
    const screenY = (e.clientY - rect.top) * devicePixelRatio;
    const worldPos = renderer.unprojectToGround(screenX, screenY);
    if (worldPos) {
      useEditorStore.getState().setCursorWorldPos(worldPos);
    }
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    mouseGestureRef.current = {
      button: e.button,
      startX: e.clientX,
      startY: e.clientY,
      dragged: false,
    };
  }, []);

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    const gesture = mouseGestureRef.current;
    mouseGestureRef.current = null;
    if (!gesture || gesture.button !== 0) return;
    if (gesture.dragged || exceededDragThreshold(gesture.startX, gesture.startY, e.clientX, e.clientY)) {
      return;
    }

    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    const rect = canvas.getBoundingClientRect();
    const screenX = (e.clientX - rect.left) * devicePixelRatio;
    const screenY = (e.clientY - rect.top) * devicePixelRatio;
    const worldPos = renderer.unprojectToGround(screenX, screenY);
    if (!worldPos) return;

    try {
      const service = await getPlatformService();
      const { project: currentProject } = useEditorStore.getState();
      const roadId = await service.pickRoadAtPoint(currentProject, worldPos.x, worldPos.y, 5.0);
      useEditorStore.getState().selectRoad(roadId);
    } catch (err) {
      console.error('[Viewport] Pick failed:', err);
    }
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const gesture = mouseGestureRef.current;
    mouseGestureRef.current = null;
    if (
      gesture &&
      gesture.button === 2 &&
      (gesture.dragged || exceededDragThreshold(gesture.startX, gesture.startY, e.clientX, e.clientY))
    ) {
      return;
    }
    showContextMenu(e.clientX, e.clientY, 'viewport');
  }, []);

  return (
    <div className="viewport">
      <canvas
        ref={canvasRef}
        className="viewport-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      />
      {status !== 'ready' && (
        <div className="viewport-overlay">
          <span className="viewport-label">
            {status === 'loading' ? t('viewport.initializing') : t('viewport.unsupported')}
          </span>
        </div>
      )}
    </div>
  );
}
