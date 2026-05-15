import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ViewportRenderer } from '../viewport/renderer';
import { emitCursorMove } from '../viewport/cursorEvents';
import { onViewportEvent } from '../viewport/viewportEvents';
import { useEditorStore } from '../stores/editorStore';
import { useEditorViewStore } from '../stores/editorViewStore';
import { useThemeStore } from '../stores/themeStore';
import { getPlatformService } from '../services';
import { showContextMenu } from '../services/contextMenu';
import { usePluginContribStore } from '../stores/pluginContribStore';
import {
  buildHighlightProject,
  buildRenderableProject,
  isSceneSelectionVisible,
  tintVertices,
} from '../utils/sceneGraph';
import { useViewportDrop } from '../hooks/useViewportDrop';
import { useRubberBandSelect } from '../hooks/useRubberBandSelect';
import { useMoveRotateMode } from '../hooks/useMoveRotateMode';
import { useSplineDrawMode } from '../hooks/useSplineDrawMode';
import { useSplineDrawPreview } from '../hooks/useSplineDrawPreview';
import { useGeometryEditMode } from '../hooks/useGeometryEditMode';
import './Viewport.css';

import {
  HOVER_HIGHLIGHT_COLOR, HOVER_HIGHLIGHT_Z_LIFT,
  MouseGestureState,
  mergeFloat32Arrays, liftMeshZ, exceededDragThreshold,
  type SplineControlPoint,
} from './viewportUtils';


export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ViewportRenderer | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unsupported'>('loading');
  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useViewportDrop(rendererRef, canvasRef);
  const project = useEditorStore((s) => s.project);
  const selectedJunctionId = useEditorStore((s) => s.selectedJunctionId);
  const selectedSceneNode = useEditorStore((s) => s.selectedSceneNode);
  const selectedRoadIds = useEditorStore((s) => s.selectedRoadIds);
  const selectedJunctionIds = useEditorStore((s) => s.selectedJunctionIds);
  const { showGrid, showAxis, dimension, display } = useEditorViewStore();
  const theme = useThemeStore((s) => s.theme);
  const { t } = useTranslation();
  const mouseGestureRef = useRef<MouseGestureState | null>(null);
  const isPreviewingRoadRef = useRef(false);
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null);
  const hoveredControlPointRef = useRef<SplineControlPoint | null>(null);
  const { rubberBandRef, rubberBandOverlayRef, startRubberBand, updateRubberBand, commitRubberBand } = useRubberBandSelect(rendererRef, canvasRef);
  const { startMoveRotateDrag, updateMoveRotateDrag, commitMoveRotateDrag } = useMoveRotateMode(rendererRef, canvasRef, isPreviewingRoadRef, pendingCursorRef);
  const hoveredRoadRef = useRef<string | null>(null);
  const hoveredJunctionRef = useRef<string | null>(null);
  const snapIndicatorDomRef = useRef<HTMLDivElement | null>(null);
  const touchStateRef = useRef<{
    touches: Array<{ id: number; x: number; y: number }>;
    lastPinchDist: number | null;
  }>({ touches: [], lastPinchDist: null });

  const {
    clearSplineDrawHover,
    handleSplineDrawMouseMove,
    handleSplineDrawMouseDown,
    handleSplineDrawClick,
    handleSplineDrawMouseUp,
    handleSplineDrawRightClick,
  } = useSplineDrawMode({
    canvasRef,
    rendererRef,
    pendingCursorRef,
    hoveredControlPointRef,
    status,
  });
  const {
    clearGeometryEditHover,
    handleGeometryEditMouseMove,
    handleGeometryEditMouseDown,
    handleGeometryEditMouseUp,
    handleRoadDoubleClick,
  } = useGeometryEditMode({
    canvasRef,
    rendererRef,
    isPreviewingRoadRef,
    pendingCursorRef,
    hoveredControlPointRef,
    status,
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const viewState = useEditorViewStore.getState();
      const isDrawMode =
        viewState.editMode === 'spline' ||
        viewState.editMode === 'line' ||
        viewState.editMode === 'arc' ||
        viewState.editMode === 'spiral';

      if (event.key === 'Escape') {
        // Pending click-to-place mode takes priority — cancel it first
        if (viewState.pendingTemplateId) {
          viewState.clearPendingTemplate();
          return;
        }
        if (viewState.geometryEditRoadId || isDrawMode) {
          return;
        }
        if (viewState.editMode === 'move-road' || viewState.editMode === 'rotate-road') {
          viewState.setEditMode('default');
          return;
        }
        const editorState = useEditorStore.getState();
        if (
          editorState.selectedRoadId ||
          editorState.selectedJunctionId ||
          editorState.selectedRoadIds.length > 0 ||
          editorState.selectedJunctionIds.length > 0
        ) {
          editorState.selectRoad(null);
        }
        return;
      }

      if (event.key === 'Delete' && !viewState.geometryEditRoadId && !isDrawMode && !viewState.pendingTemplateId) {
        useEditorStore.getState().deleteSelected();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ── Surface mesh (roads + junctions + signals + objects) ──
  // Only regenerates when geometry-affecting deps change; toggling
  // lane-line or reference-line visibility does NOT trigger this.
  const surfaceDepsRef = useRef<{
    roadRefs: Map<string, unknown>;
    junctionRefs: Map<string, unknown>;
  }>({ roadRefs: new Map(), junctionRefs: new Map() });
  const cachedSurfaceRef = useRef<Float32Array>(new Float32Array(0));

  const updateSurfaceMesh = useCallback(async () => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready' || !project) return;

    try {
      const service = await getPlatformService();
      const visibleProject = buildRenderableProject(project, display);

      // Detect whether any road/junction actually changed via reference equality.
      const prev = surfaceDepsRef.current;
      const newRoadRefs = new Map(visibleProject.roads.map((r) => [r.id, r]));
      const newJunctionRefs = new Map(visibleProject.junctions.map((j) => [j.id, j]));

      const roadsChanged =
        newRoadRefs.size !== prev.roadRefs.size ||
        [...newRoadRefs].some(([id, ref]) => prev.roadRefs.get(id) !== ref);
      const junctionsChanged =
        newJunctionRefs.size !== prev.junctionRefs.size ||
        [...newJunctionRefs].some(([id, ref]) => prev.junctionRefs.get(id) !== ref);

      surfaceDepsRef.current = { roadRefs: newRoadRefs, junctionRefs: newJunctionRefs };

      if (!roadsChanged && !junctionsChanged && cachedSurfaceRef.current.length > 0) {
        // Nothing geometry-related changed — skip WASM calls entirely.
        return;
      }

      const empty = Promise.resolve(new Float32Array(0));
      const signalProm = display.showSignals
        ? service.generateSignalPaintVertices(visibleProject, 2.0).catch(() => new Float32Array(0))
        : empty;
      const objectProm = display.showObjects
        ? service.generateObjectVertices(visibleProject).catch(() => new Float32Array(0))
        : empty;

      const [roadVerts, junctionVerts, signalVerts, objectVerts] = await Promise.all([
        service.generateRoadVertices(visibleProject, 2.0, display.colorMode).catch((e) => { console.warn('[Viewport] generateRoadVertices failed:', e); return new Float32Array(0); }),
        service.generateJunctionVertices(visibleProject).catch((e) => { console.warn('[Viewport] generateJunctionVertices failed:', e); return new Float32Array(0); }),
        signalProm,
        objectProm,
      ]);

      const surfaceVerts = mergeFloat32Arrays(
        mergeFloat32Arrays(mergeFloat32Arrays(roadVerts, junctionVerts), signalVerts),
        objectVerts,
      );
      cachedSurfaceRef.current = surfaceVerts;
      renderer.uploadRoadVertices(surfaceVerts);
    } catch (err) {
      console.error('[Viewport] Failed to generate surface mesh:', err);
    }
  }, [
    project,
    status,
    display.showSignals,
    display.showObjects,
    display.colorMode,
    display.hiddenRoadIds,
    display.hiddenJunctionIds,
    display.hiddenLaneSectionKeys,
    display.hiddenLaneKeys,
    display.hiddenSignalKeys,
    display.hiddenObjectKeys,
  ]);

  // ── Line mesh (lane lines + center/reference lines) ──
  // Only regenerates when line-related deps change; road surface color
  // mode changes do NOT trigger this.
  const updateLineMesh = useCallback(async () => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready' || !project) return;

    try {
      const service = await getPlatformService();
      const visibleProject = buildRenderableProject(project, display);

      const empty = Promise.resolve(new Float32Array(0));
      const centerLineProm = display.showReferenceLine
        ? service.generateCenterLineVertices(visibleProject, 2.0).catch(() => new Float32Array(0))
        : empty;
      const laneLineProm = display.showLaneLines
        ? service.generateLaneLineVertices(visibleProject, 2.0).catch(() => new Float32Array(0))
        : empty;

      const [laneLineVerts, centerLineVerts] = await Promise.all([laneLineProm, centerLineProm]);
      const lineVerts = mergeFloat32Arrays(laneLineVerts, centerLineVerts);
      renderer.uploadLaneLineVertices(lineVerts);
    } catch (err) {
      console.error('[Viewport] Failed to generate line mesh:', err);
    }
  }, [
    project,
    status,
    display.showLaneLines,
    display.showRoadMarks,
    display.showReferenceLine,
    display.hiddenRoadIds,
    display.hiddenJunctionIds,
    display.hiddenLaneSectionKeys,
    display.hiddenLaneKeys,
  ]);

  const projectLoadVersion = useEditorStore((s) => s.projectLoadVersion);

  // Reset auto-fit cache only when a genuinely new file is loaded (not on every mutation)
  useEffect(() => {
    const renderer = rendererRef.current;
    if (status !== 'ready') return;
    renderer?.clearVertexCache();
  }, [projectLoadVersion, status]);

  useEffect(() => { updateSurfaceMesh(); }, [updateSurfaceMesh]);
  useEffect(() => { updateLineMesh(); }, [updateLineMesh]);

  // Real-time road mesh preview while adding knots in draw mode
  useSplineDrawPreview({
    rendererRef,
    status,
    onPreviewEnd: useCallback(() => {
      void updateSurfaceMesh();
      void updateLineMesh();
    }, [updateSurfaceMesh, updateLineMesh]),
  });

  // Update selection highlight when scene selection changes
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready') return;

    let cancelled = false;

    (async () => {
      try {
        const service = await getPlatformService();
        if (cancelled) return;

        // Multi-select highlight (rubber-band box selection)
        if (selectedRoadIds.length > 0 || selectedJunctionIds.length > 0) {
          const parts: Float32Array[] = [];
          if (selectedRoadIds.length > 0) {
            const multiProject = { ...project, roads: project.roads.filter((r) => selectedRoadIds.includes(r.id)) };
            const verts = await service.generateRoadVertices(multiProject, 2.0);
            parts.push(tintVertices(verts, [0.95, 0.18, 0.18, 0.82]));
          }
          for (const jId of selectedJunctionIds) {
            const jVerts = await service.generateSingleJunctionVertices(project, jId, [0.7, 0.4, 1.0, 0.65]);
            parts.push(jVerts);
          }
          const combined = parts.reduce((acc, p) => mergeFloat32Arrays(acc, p), new Float32Array());
          renderer.uploadHighlightVertices(combined);
          return;
        }

        if (!isSceneSelectionVisible(selectedSceneNode, display)) {
          renderer.clearHighlight();
          return;
        }

        if (selectedSceneNode && selectedSceneNode.type !== 'junction') {
          // For signal/object selections: render a small highlight marker at the element's position
          if (selectedSceneNode.type === 'signal') {
            const verts = await service.generateSingleSignalVertices(
              project, selectedSceneNode.roadId, selectedSceneNode.signalId,
              [0.2, 0.9, 0.9, 1.0],
            );
            if (verts.length > 0) renderer.uploadHighlightVertices(verts);
            else renderer.clearHighlight();
            return;
          }
          if (selectedSceneNode.type === 'object') {
            const verts = await service.generateSingleObjectVertices(
              project, selectedSceneNode.roadId, selectedSceneNode.objectId,
              [0.2, 0.9, 0.9, 1.0],
            );
            if (verts.length > 0) renderer.uploadHighlightVertices(verts);
            else renderer.clearHighlight();
            return;
          }
          const highlightProject = buildHighlightProject(project, selectedSceneNode);
          if (!highlightProject) {
            renderer.clearHighlight();
            return;
          }
          const highlightVerts = await service.generateRoadVertices(highlightProject, 2.0);
          renderer.uploadHighlightVertices(
            tintVertices(
              highlightVerts,
              selectedSceneNode.type === 'road'
                ? [0.95, 0.18, 0.18, 0.82]
                : [0.92, 0.3, 0.3, 0.72],
            ),
          );
          return;
        }

        if (selectedJunctionId) {
          const highlightVerts = await service.generateSingleJunctionVertices(
            project, selectedJunctionId, [0.7, 0.4, 1.0, 0.65],
          );
          renderer.uploadHighlightVertices(highlightVerts);
          return;
        }
        renderer.clearHighlight();
      } catch (err) {
        if (!cancelled) console.error('[Viewport] Failed to generate highlight mesh:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [display, project, selectedJunctionId, selectedJunctionIds, selectedRoadIds, selectedSceneNode, status]);

  // Throttle Zustand cursor updates to once per animation frame
  useEffect(() => {
    let frameId = 0;
    const flush = () => {
      if (pendingCursorRef.current) {
        useEditorStore.getState().setCursorWorldPos(pendingCursorRef.current);
        pendingCursorRef.current = null;
      }
      frameId = requestAnimationFrame(flush);
    };
    frameId = requestAnimationFrame(flush);
    return () => cancelAnimationFrame(frameId);
  }, []);

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
        case 'zoom-to-selected':
          (async () => {
            try {
              const service = await getPlatformService();
              const { project: currentProject } = useEditorStore.getState();
              const road = currentProject.roads.find((r) => r.id === event.roadId);
              if (!road) return;
              const verts = await service.generateSingleRoadVertices(road, 2.0, [0.2, 0.5, 1.0, 0.7]);
              renderer.fitToVertices(verts);
            } catch (err) {
              console.error('[Viewport] zoom-to-selected failed:', err);
            }
          })();
          break;
        case 'zoom-to-junction':
          (async () => {
            try {
              const service = await getPlatformService();
              const { project: currentProject } = useEditorStore.getState();
              const verts = await service.generateSingleJunctionVertices(
                currentProject,
                event.junctionId,
                [0.7, 0.4, 1.0, 0.65],
              );
              renderer.fitToVertices(verts);
            } catch (err) {
              console.error('[Viewport] zoom-to-junction failed:', err);
            }
          })();
          break;
        case 'pan-to-road':
          (async () => {
            try {
              const service = await getPlatformService();
              const { project: currentProject } = useEditorStore.getState();
              const road = currentProject.roads.find((r) => r.id === event.roadId);
              if (!road) return;
              const verts = await service.generateSingleRoadVertices(road, 2.0, [0.2, 0.5, 1.0, 0.7]);
              if (verts.length > 0) renderer.panToCenter(verts);
            } catch (err) {
              console.error('[Viewport] pan-to-road failed:', err);
            }
          })();
          break;
        case 'pan-to-junction':
          (async () => {
            try {
              const service = await getPlatformService();
              const { project: currentProject } = useEditorStore.getState();
              const verts = await service.generateSingleJunctionVertices(
                currentProject,
                event.junctionId,
                [0.7, 0.4, 1.0, 0.65],
              );
              if (verts.length > 0) renderer.panToCenter(verts);
            } catch (err) {
              console.error('[Viewport] pan-to-junction failed:', err);
            }
          })();
          break;
        case 'pan-to-signal': {
          // Pan to the actual world position of the signal
          const { project: currentProject } = useEditorStore.getState();
          (async () => {
            try {
              const service = await getPlatformService();
              const pos = await service.getSignalWorldPos(currentProject, event.roadId, event.signalId);
              if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
                // Build a tiny synthetic quad centred on the signal position
                const sz = 1.0;
                const synth = new Float32Array([
                  pos.x - sz, pos.y - sz, 0, 1, 1, 1, 1,
                  pos.x + sz, pos.y - sz, 0, 1, 1, 1, 1,
                  pos.x,      pos.y + sz, 0, 1, 1, 1, 1,
                ]);
                renderer.panToCenter(synth);
              }
            } catch (err) {
              console.error('[Viewport] pan-to-signal failed:', err);
            }
          })();
          break;
        }
        case 'pan-to-object': {
          // Pan to the actual world position of the object
          const { project: currentProject } = useEditorStore.getState();
          (async () => {
            try {
              const service = await getPlatformService();
              const pos = await service.getObjectWorldPos(currentProject, event.roadId, event.objectId);
              if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
                const sz = 1.0;
                const synth = new Float32Array([
                  pos.x - sz, pos.y - sz, 0, 1, 1, 1, 1,
                  pos.x + sz, pos.y - sz, 0, 1, 1, 1, 1,
                  pos.x,      pos.y + sz, 0, 1, 1, 1, 1,
                ]);
                renderer.panToCenter(synth);
              }
            } catch (err) {
              console.error('[Viewport] pan-to-object failed:', err);
            }
          })();
          break;
        }
        case 'set-dimension':
          renderer.setDimension(event.dimension);
          break;
        case 'set-show-grid':
          renderer.setShowGrid(event.show);
          break;
        case 'set-show-axis':
          renderer.setShowAxis(event.show);
          break;
        case 'capture-screenshot': {
          // Capture the WebGPU canvas as PNG and trigger a browser download
          const canvas = canvasRef.current;
          if (!canvas) break;
          try {
            const dataUrl = canvas.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = event.filename ?? `worldeditor-${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          } catch (err) {
            console.error('[Viewport] Screenshot capture failed:', err);
          }
          break;
        }
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
      // Debounce resize via rAF to avoid redundant depth-texture recreations
      requestAnimationFrame(() => {
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
    });
    observer.observe(canvas.parentElement!);

    return () => {
      observer.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  // Wire plugin viewport overlays to the renderer
  const viewportOverlays = usePluginContribStore((s) => s.viewportOverlays);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setOverlayRenderers(
      viewportOverlays.map((o) => o.render),
      canvasRef.current ?? undefined,
    );
  }, [viewportOverlays]);

  const handleMouseMove = useCallback(async (e: React.MouseEvent) => {
    const gesture = mouseGestureRef.current;
    if (gesture && !gesture.dragged && exceededDragThreshold(gesture.startX, gesture.startY, e.clientX, e.clientY)) {
      gesture.dragged = true;
    }
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    if (rubberBandRef.current) {
      updateRubberBand(e, canvas);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = (e.clientX - rect.left) * devicePixelRatio;
    const screenY = (e.clientY - rect.top) * devicePixelRatio;
    const worldPos = renderer.unprojectToGround(screenX, screenY);
    if (!worldPos) return;

    if (updateMoveRotateDrag(worldPos)) return;

    const viewState = useEditorViewStore.getState();
    if (await handleGeometryEditMouseMove(worldPos, canvas, renderer)) return;
    if (handleSplineDrawMouseMove(worldPos, canvas, renderer, e)) return;

    // Show snap indicator for draw-mode endpoint snapping
    {
      const drawSnap = useEditorViewStore.getState().drawSnapResult;
      const snapEl = snapIndicatorDomRef.current;
      const inDrawMode = viewState.editMode === 'spline' || viewState.editMode === 'line' || viewState.editMode === 'arc' || viewState.editMode === 'spiral';
      if (drawSnap?.snapped && snapEl) {
        const screenPos = renderer.projectWorldToScreen(drawSnap.x, drawSnap.y);
        if (screenPos) {
          snapEl.style.left = `${screenPos.x}px`;
          snapEl.style.top = `${screenPos.y}px`;
          snapEl.style.display = 'block';
        }
      } else if (snapEl && inDrawMode) {
        snapEl.style.display = 'none';
      }
    }

    // In click-to-place mode show crosshair and skip normal hover picking
    if (viewState.pendingTemplateId) {
      canvas.style.cursor = 'crosshair';
      return;
    }

    if (viewState.snapEnabled) {
      try {
        const service = await getPlatformService();
        const { project: currentProject, selectedRoadId: excludeId } = useEditorStore.getState();
        const snapResult = await service.snapPoint(
          currentProject,
          worldPos.x,
          worldPos.y,
          {
            grid_enabled: viewState.snapMode === 'Grid',
            grid_size: viewState.gridSnapSize,
            endpoint_enabled: viewState.snapMode === 'Endpoint',
            endpoint_threshold: viewState.snapThreshold,
            midpoint_enabled: viewState.snapMode === 'Midpoint',
            perpendicular_enabled: viewState.snapMode === 'Perpendicular',
          },
          excludeId ?? undefined,
        );
        if (snapResult.snapped) {
          const snapEl = snapIndicatorDomRef.current;
          const screenPos = renderer.projectWorldToScreen(snapResult.x, snapResult.y);
          if (snapEl && screenPos) {
            snapEl.style.left = `${screenPos.x}px`;
            snapEl.style.top = `${screenPos.y}px`;
            snapEl.style.display = 'block';
          }
          emitCursorMove(snapResult.x, snapResult.y);
          pendingCursorRef.current = { x: snapResult.x, y: snapResult.y };
          return;
        }
      } catch {
        // Fall through to raw position on snap error.
      }
      const snapEl = snapIndicatorDomRef.current;
      if (snapEl) snapEl.style.display = 'none';
    }

    const isInSelectMode =
      viewState.editMode !== 'spline' &&
      viewState.editMode !== 'move-road' &&
      viewState.editMode !== 'rotate-road' &&
      viewState.editMode !== 'line' &&
      viewState.editMode !== 'arc' &&
      viewState.editMode !== 'spiral' &&
      !viewState.geometryEditSpline &&
      !viewState.draggingKnot &&
      !rubberBandRef.current;

    if (viewState.editMode === 'move-road') {
      canvas.style.cursor = 'move';
    } else if (viewState.editMode === 'rotate-road') {
      canvas.style.cursor = 'crosshair';
    }

    if (isInSelectMode) {
      try {
        const service = await getPlatformService();
        const { project: currentProject } = useEditorStore.getState();
        const { display: currentDisplay } = useEditorViewStore.getState();
        const visibleProject = buildRenderableProject(currentProject, currentDisplay);
        const rendererInst = rendererRef.current;
        const newHoveredRoad = await service.pickRoadAtPoint(visibleProject, worldPos.x, worldPos.y, 5.0);
        if (newHoveredRoad !== hoveredRoadRef.current || hoveredJunctionRef.current !== null) {
          hoveredRoadRef.current = newHoveredRoad;
          hoveredJunctionRef.current = null;
          if (rendererInst) {
            if (newHoveredRoad) {
              const { selectedRoadId } = useEditorStore.getState();
              if (newHoveredRoad !== selectedRoadId) {
                const road = currentProject.roads.find((r) => r.id === newHoveredRoad);
                if (road) {
                  const singleRoadProject = { ...currentProject, roads: [road], junctions: [] };
                  const hoverVerts = tintVertices(
                    await service.generateRoadVertices(singleRoadProject, 2.0),
                    HOVER_HIGHLIGHT_COLOR,
                  );
                  rendererInst.uploadHoverVertices(liftMeshZ(hoverVerts, HOVER_HIGHLIGHT_Z_LIFT));
                }
              } else {
                rendererInst.clearHover();
              }
              if (!rendererInst.pointerDragging) {
                canvas.style.cursor = 'pointer';
              }
            } else {
              rendererInst.clearHover();
              const newHoveredJunction = await service.pickJunctionAtPoint(visibleProject, worldPos.x, worldPos.y, 8.0);
              hoveredJunctionRef.current = newHoveredJunction;
              if (newHoveredJunction) {
                const hoverVerts = await service.generateSingleJunctionVertices(
                  currentProject,
                  newHoveredJunction,
                  HOVER_HIGHLIGHT_COLOR,
                );
                rendererInst.uploadHoverVertices(liftMeshZ(hoverVerts, HOVER_HIGHLIGHT_Z_LIFT));
                if (!rendererInst.pointerDragging) {
                  canvas.style.cursor = 'pointer';
                }
              } else if (!rendererInst.pointerDragging) {
                canvas.style.cursor = '';
              }
            }
          }
        }
      } catch {
        // Ignore hover detection errors.
      }
    }

    emitCursorMove(worldPos.x, worldPos.y);
    pendingCursorRef.current = worldPos;
  }, [handleGeometryEditMouseMove, handleSplineDrawMouseMove]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    mouseGestureRef.current = {
      button: e.button,
      startX: e.clientX,
      startY: e.clientY,
      dragged: false,
    };

    if (e.button !== 0) return;

    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    const viewState = useEditorViewStore.getState();
    if (handleGeometryEditMouseDown(e, canvas, renderer) || handleSplineDrawMouseDown(e, canvas, renderer)) {
      return;
    }
    if (startMoveRotateDrag(e, renderer, canvas)) return;
    if (
      e.shiftKey &&
      viewState.editMode !== 'spline' &&
      viewState.editMode !== 'line' &&
      viewState.editMode !== 'arc' &&
      viewState.editMode !== 'spiral' &&
      !viewState.geometryEditSpline
    ) {
      startRubberBand(e, renderer);
    }
  }, [handleGeometryEditMouseDown, handleSplineDrawMouseDown, startMoveRotateDrag, startRubberBand]);

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

    const { measureMode, measurePoints, addMeasurePoint, setMeasurementResult } = useEditorViewStore.getState();
    if (measureMode !== 'none') {
      const point = { x: worldPos.x, y: worldPos.y, z: 0 };
      addMeasurePoint(point);
      const pts = [...measurePoints, point];
      try {
        const service = await getPlatformService();
        if (measureMode === 'distance' && pts.length >= 2) {
          const p0 = pts[0]!;
          const p1 = pts[1]!;
          const result = await service.measureDistance(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
          setMeasurementResult({ type: 'distance', value: result });
        } else if (measureMode === 'angle' && pts.length >= 3) {
          const p0 = pts[0]!;
          const p1 = pts[1]!;
          const p2 = pts[2]!;
          const result = await service.measureAngle(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y);
          setMeasurementResult({ type: 'angle', value: result });
        } else if (measureMode === 'area' && pts.length >= 3) {
          const coords: Array<[number, number]> = pts.map((p) => [p.x, p.y]);
          const result = await service.measureArea(coords);
          setMeasurementResult({ type: 'area', value: result });
        }
      } catch (err) {
        console.error('[Viewport] Measurement failed:', err);
      }
      return;
    }

    const viewState = useEditorViewStore.getState();
    if (viewState.editMode === 'move-road' || viewState.editMode === 'rotate-road') {
      return;
    }

    // Click-to-place mode: instantiate the pending template at the clicked world position
    if (viewState.pendingTemplateId) {
      const templateId = viewState.pendingTemplateId;
      viewState.clearPendingTemplate();
      const allItems = usePluginContribStore.getState().templateSections.flatMap((s) => s.items);
      const item = allItems.find((i) => i.id === templateId);
      if (item) {
        item.onApply({ x: worldPos.x, y: worldPos.y, hdg: 0 });
      }
      return;
    }

    if (await handleSplineDrawClick(e, worldPos)) {
      return;
    }
    if (viewState.geometryEditRoadId) {
      return;
    }

    try {
      const service = await getPlatformService();
      const { project: currentProject } = useEditorStore.getState();
      const { display: currentDisplay } = useEditorViewStore.getState();
      const visibleProject = buildRenderableProject(currentProject, currentDisplay);

      // Signals and objects sit ON roads, so they must be checked first with a
      // tight threshold (2 m) before road picking (5 m) would always win.
      // Skip during shift-click which is reserved for multi-road/junction selection.
      if (!e.shiftKey) {
        const signalHit = await service.pickSignalAtPoint(visibleProject, worldPos.x, worldPos.y, 2.0);
        if (signalHit !== null) {
          useEditorStore.getState().selectSignal(signalHit.roadId, signalHit.signalId);
          const rendererInst = rendererRef.current;
          if (rendererInst) rendererInst.clearHover();
          hoveredRoadRef.current = null;
          hoveredJunctionRef.current = null;
          return;
        }
        const objectHit = await service.pickObjectAtPoint(visibleProject, worldPos.x, worldPos.y, 2.0);
        if (objectHit !== null) {
          useEditorStore.getState().selectObject(objectHit.roadId, objectHit.objectId);
          const rendererInst = rendererRef.current;
          if (rendererInst) rendererInst.clearHover();
          hoveredRoadRef.current = null;
          hoveredJunctionRef.current = null;
          return;
        }
      }

      const roadId = await service.pickRoadAtPoint(visibleProject, worldPos.x, worldPos.y, 5.0);

      if (e.shiftKey) {
        if (roadId) {
          const { selectedRoadIds, selectedJunctionIds } = useEditorStore.getState();
          const newRoadIds = selectedRoadIds.includes(roadId)
            ? selectedRoadIds.filter((id) => id !== roadId)
            : [...selectedRoadIds, roadId];
          useEditorStore.getState().selectMultiple(newRoadIds, selectedJunctionIds);
        } else {
          const junctionId = await service.pickJunctionAtPoint(visibleProject, worldPos.x, worldPos.y, 8.0);
          if (junctionId) {
            const { selectedRoadIds, selectedJunctionIds } = useEditorStore.getState();
            const newJunctionIds = selectedJunctionIds.includes(junctionId)
              ? selectedJunctionIds.filter((id) => id !== junctionId)
              : [...selectedJunctionIds, junctionId];
            useEditorStore.getState().selectMultiple(selectedRoadIds, newJunctionIds);
          }
        }
        return;
      }

      if (handleRoadDoubleClick(roadId, e.detail)) {
        return;
      }

      if (roadId) {
        useEditorStore.getState().selectRoad(roadId);
        const rendererInst = rendererRef.current;
        if (rendererInst) rendererInst.clearHover();
        hoveredRoadRef.current = null;
        hoveredJunctionRef.current = null;
        return;
      }
      const junctionId = await service.pickJunctionAtPoint(visibleProject, worldPos.x, worldPos.y, 8.0);
      if (junctionId !== null) {
        useEditorStore.getState().selectJunction(junctionId);
        const rendererInst = rendererRef.current;
        if (rendererInst) rendererInst.clearHover();
        hoveredRoadRef.current = null;
        hoveredJunctionRef.current = null;
      }
    } catch (err) {
      console.error('[Viewport] Pick failed:', err);
    }
  }, [handleRoadDoubleClick, handleSplineDrawClick]);

  const handleMouseUp = useCallback(async (e: React.MouseEvent) => {
    if (commitRubberBand(e)) return;
    if (commitMoveRotateDrag()) return;
    if (await handleGeometryEditMouseUp()) return;
    handleSplineDrawMouseUp();
  }, [commitMoveRotateDrag, commitRubberBand, handleGeometryEditMouseUp, handleSplineDrawMouseUp]);

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
    // Cancel pending template placement on right-click
    const viewState = useEditorViewStore.getState();
    if (viewState.pendingTemplateId) {
      viewState.clearPendingTemplate();
      return;
    }
    // Right-click in draw mode finalizes (or cancels) the road being drawn
    if (handleSplineDrawRightClick()) return;
    showContextMenu(e.clientX, e.clientY, 'viewport');
  }, [handleSplineDrawRightClick]);

  const handleMouseLeave = useCallback(() => {
    if (hoveredRoadRef.current !== null || hoveredJunctionRef.current !== null) {
      hoveredRoadRef.current = null;
      hoveredJunctionRef.current = null;
      rendererRef.current?.clearHover();
    }
    clearGeometryEditHover();
    clearSplineDrawHover();
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = '';
    const snapEl = snapIndicatorDomRef.current;
    if (snapEl) snapEl.style.display = 'none';
  }, [clearGeometryEditHover, clearSplineDrawHover]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touches = Array.from(e.touches).map((t) => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
    touchStateRef.current.touches = touches;
    if (touches.length === 2) {
      const dx = touches[1]!.x - touches[0]!.x;
      const dy = touches[1]!.y - touches[0]!.y;
      touchStateRef.current.lastPinchDist = Math.sqrt(dx * dx + dy * dy);
    } else {
      touchStateRef.current.lastPinchDist = null;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!renderer || !canvas) return;

    const prev = touchStateRef.current.touches;
    const curr = Array.from(e.touches).map((t) => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
    touchStateRef.current.touches = curr;

    if (curr.length === 1 && prev.length === 1) {
      // Single-finger pan
      const p = prev[0]!;
      const c = curr[0]!;
      renderer.applyPan(canvas, [p.x, p.y], [c.x, c.y]);
    } else if (curr.length === 2 && prev.length >= 2) {
      // Two-finger pinch-to-zoom
      const dx = curr[1]!.x - curr[0]!.x;
      const dy = curr[1]!.y - curr[0]!.y;
      const newDist = Math.sqrt(dx * dx + dy * dy);
      const oldDist = touchStateRef.current.lastPinchDist;
      if (oldDist && oldDist > 0) {
        renderer.applyZoomFactor(oldDist / newDist);
      }
      touchStateRef.current.lastPinchDist = newDist;
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const curr = Array.from(e.touches).map((t) => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
    touchStateRef.current.touches = curr;
    if (curr.length < 2) touchStateRef.current.lastPinchDist = null;
  }, []);

  return (
    <div
      className={`viewport${isDragOver ? ' viewport-drag-over' : ''}`}
      onMouseUp={handleMouseUp}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <canvas
        ref={canvasRef}
        className="viewport-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
      {/* Rubber-band selection overlay */}
      <div ref={rubberBandOverlayRef} className="selection-rect" />
      {/* Snap indicator: shown when cursor snaps to a nearby point */}
      <div ref={snapIndicatorDomRef} className="snap-indicator" style={{ display: 'none' }} />
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
