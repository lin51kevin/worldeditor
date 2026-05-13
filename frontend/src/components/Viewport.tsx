import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ViewportRenderer, getSplineHandlePoints } from '../viewport/renderer';
import { emitCursorMove } from '../viewport/cursorEvents';
import { onViewportEvent, emitViewportEvent } from '../viewport/viewportEvents';
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
import {
  buildMultiLineGeometries,
  buildMultiArcGeometries,
  buildMultiSpiralGeometries,
  buildRoadFromGeometries,
} from '../utils/geometryBuilder';
import './Viewport.css';

import {
  DRAG_THRESHOLD_SQ, HOVER_HIGHLIGHT_COLOR, HOVER_HIGHLIGHT_Z_LIFT,
  MouseGestureState, MoveRotateDragState,
  mergeFloat32Arrays, liftMeshZ, exceededDragThreshold,
  buildEditableSpline, roadIntersectsAABB, junctionIntersectsAABB,
  nextSplineRoadId, splineToRendererFormat,
} from './viewportUtils';


export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ViewportRenderer | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unsupported'>('loading');
  const [isDragOver, setIsDragOver] = useState(false);
  const project = useEditorStore((s) => s.project);
  const selectedRoadId = useEditorStore((s) => s.selectedRoadId);
  const selectedJunctionId = useEditorStore((s) => s.selectedJunctionId);
  const selectedSceneNode = useEditorStore((s) => s.selectedSceneNode);
  const selectedRoadIds = useEditorStore((s) => s.selectedRoadIds);
  const selectedJunctionIds = useEditorStore((s) => s.selectedJunctionIds);
  const { showGrid, showAxis, dimension, display, editMode } = useEditorViewStore();
  const splineKnots = useEditorViewStore((s) => s.splineKnots);
  const splineTangentOverrides = useEditorViewStore((s) => s.splineTangentOverrides);
  const geometryEditSpline = useEditorViewStore((s) => s.geometryEditSpline);
  const theme = useThemeStore((s) => s.theme);
  const { t } = useTranslation();
  const mouseGestureRef = useRef<MouseGestureState | null>(null);
  /** Guards against concurrent road-preview regenerations during knot drag. */
  const isPreviewingRoadRef = useRef(false);
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null);
  /** Tracks the currently hovered control point to avoid redundant refreshSplineMarkers calls. */
  const hoveredControlPointRef = useRef<{ index: number; type: 'knot' | 'in' | 'out' } | null>(null);
  /** Rubber-band selection state: tracks drag start and whether the overlay is active. */
  const rubberBandRef = useRef<{ startClientX: number; startClientY: number; active: boolean } | null>(null);
  const rubberBandOverlayRef = useRef<HTMLDivElement>(null);
  /** Active move-road / rotate-road drag state. */
  const moveRotateDragRef = useRef<MoveRotateDragState | null>(null);
  /** Tracks the road/junction currently under the cursor for hover highlighting. */
  const hoveredRoadRef = useRef<string | null>(null);
  const hoveredJunctionRef = useRef<string | null>(null);
  /** Snap indicator DOM element — positioned imperatively to avoid React re-renders on every mousemove. */
  const snapIndicatorDomRef = useRef<HTMLDivElement | null>(null);
  /** Touch gesture state: tracks start positions for pan and pinch. */
  const touchStateRef = useRef<{
    touches: Array<{ id: number; x: number; y: number }>;
    lastPinchDist: number | null;
  }>({ touches: [], lastPinchDist: null });

  const finalizeSplineCreation = useCallback(async (overrideKnots?: Array<[number, number, number]>) => {
    const viewState = useEditorViewStore.getState();
    const knots = overrideKnots ?? viewState.splineKnots;
    if (knots.length < 2) {
      console.warn('[Viewport] Need at least 2 spline knots to create a road.');
      return;
    }

    try {
      const service = await getPlatformService();
      const editorState = useEditorStore.getState();
      const roadId = nextSplineRoadId(editorState.project.roads.map((road) => road.id));
      const spline = buildEditableSpline(knots);
      const nextProject = await service.createRoadFromSpline(
        editorState.project,
        roadId,
        spline,
        viewState.splineTemplateId,
      );
      // Use addRoad instead of setProject so the undo stack is preserved and
      // projectLoadVersion is NOT incremented (which would trigger camera auto-fit).
      const newRoad = nextProject.roads.find((r) => r.id === roadId);
      if (newRoad) {
        editorState.addRoad(newRoad);
      }
      editorState.selectRoad(roadId);
      viewState.clearSplineKnots();
    } catch (err) {
      console.error('[Viewport] Failed to create road from spline:', err);
    }
  }, []);

  /** Finalize geometry draw mode: create a road from the accumulated draw points. */
  const finalizeDrawGeometry = useCallback(async (
    mode: 'line' | 'arc' | 'spiral',
    points: Array<[number, number, number]>,
  ) => {
    const editorState = useEditorStore.getState();
    const viewState = useEditorViewStore.getState();

    const minPoints = mode === 'arc' ? 3 : 2;
    if (points.length < minPoints) {
      console.warn(`[Viewport] ${mode} mode needs at least ${minPoints} points.`);
      return;
    }

    const roadId = nextSplineRoadId(editorState.project.roads.map((r) => r.id));

    let geometries;
    if (mode === 'line') {
      geometries = buildMultiLineGeometries(points);
    } else if (mode === 'arc') {
      geometries = buildMultiArcGeometries(points);
    } else {
      geometries = buildMultiSpiralGeometries(points);
    }

    if (geometries.length === 0) {
      console.warn(`[Viewport] ${mode} produced no geometry segments from ${points.length} points.`);
      return;
    }

    const road = buildRoadFromGeometries(roadId, geometries);
    editorState.addRoad(road);
    editorState.selectRoad(roadId);
    viewState.clearSplineKnots();
  }, []);

  /** Enter geometry edit mode for the given road. */
  const enterGeometryEditMode = useCallback(async (roadId: string) => {
    const editorState = useEditorStore.getState();
    const road = editorState.project.roads.find((r) => r.id === roadId);
    if (!road || road.plan_view.length === 0) return;
    try {
      const service = await getPlatformService();
      const spline = await service.roadToSpline(road, 2.0);
      useEditorViewStore.getState().enterGeometryEdit(roadId, spline);
    } catch (err) {
      console.error('[Viewport] Failed to enter geometry edit:', err);
    }
  }, []);

  /** Finalize geometry editing: convert spline back to road geometry and update project. */
  const finalizeGeometryEdit = useCallback(async () => {
    const viewState = useEditorViewStore.getState();
    const { geometryEditRoadId: roadId, geometryEditSpline: spline } = viewState;
    if (!roadId || !spline) return;
    try {
      const service = await getPlatformService();
      const geometries = await service.splineToGeometries(spline);
      // Compute total length from geometries
      const totalLength = geometries.reduce((sum, g) => sum + g.length, 0);
      useEditorStore.getState().updateRoadGeometry(roadId, geometries, totalLength);
      viewState.exitGeometryEdit();
    } catch (err) {
      console.error('[Viewport] Failed to finalize geometry edit:', err);
    }
  }, []);

  useEffect(() => {
    if (editMode !== 'spline' && editMode !== 'line' && editMode !== 'arc' && editMode !== 'spiral') {
      useEditorViewStore.getState().clearSplineKnots();
    }
  }, [editMode]);

  // Keyboard handling for spline creation, geometry editing, and select-mode shortcuts
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const viewState = useEditorViewStore.getState();

      if (event.key === 'Escape') {
        // If in geometry edit mode, finalize and exit
        if (viewState.geometryEditRoadId) {
          void finalizeGeometryEdit();
          return;
        }
        // If in spline creation mode, clear knots
        if (viewState.editMode === 'spline') {
          viewState.clearSplineKnots();
          return;
        }
        // If in geometry draw mode, clear knots (line/arc/spiral all use splineKnots)
        if (viewState.editMode === 'line' || viewState.editMode === 'arc' || viewState.editMode === 'spiral') {
          viewState.clearSplineKnots();
          return;
        }
        // If in a transient edit mode (move/rotate), return to default mode
        if (viewState.editMode === 'move-road' || viewState.editMode === 'rotate-road') {
          viewState.setEditMode('default');
          return;
        }
        // Normal select mode: clear any active selection
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

      // Delete selected element(s) — only in select mode (not spline / geometry edit)
      if (event.key === 'Delete') {
        if (!viewState.geometryEditRoadId && viewState.editMode !== 'spline') {
          useEditorStore.getState().deleteSelected();
        }
        return;
      }

      // E: enter geometry edit mode for selected road (normal select mode only)
      if (event.key === 'e' || event.key === 'E') {
        if (!viewState.geometryEditRoadId && viewState.editMode !== 'spline' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const { selectedRoadId } = useEditorStore.getState();
          if (selectedRoadId) {
            void enterGeometryEditMode(selectedRoadId);
          }
        }
        return;
      }

      if (editMode !== 'spline' && editMode !== 'line' && editMode !== 'arc' && editMode !== 'spiral') return;
      if (event.key === 'Backspace') {
        useEditorViewStore.getState().popSplineKnot();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const mode = viewState.editMode;
        if (mode === 'spline') {
          void finalizeSplineCreation();
        } else if (mode === 'line' || mode === 'arc' || mode === 'spiral') {
          void finalizeDrawGeometry(mode, viewState.splineKnots);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [editMode, finalizeSplineCreation, finalizeDrawGeometry, finalizeGeometryEdit, enterGeometryEditMode]);

  // Sync spline knot preview into the WebGPU renderer each time knots or tangents change
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready') return;

    // Geometry edit mode takes priority: render editable spline knots
    if (geometryEditSpline) {
      const { knots, tangentOverrides } = splineToRendererFormat(geometryEditSpline);
      renderer.setSplinePreviewKnots(knots, tangentOverrides);
      return;
    }

    // All draw modes (spline, line, arc, spiral) use splineKnots for control points
    const isDrawMode = editMode === 'spline' || editMode === 'line' || editMode === 'arc' || editMode === 'spiral';
    const overrides = Object.keys(splineTangentOverrides).length > 0 ? splineTangentOverrides : undefined;
    renderer.setSplinePreviewKnots(isDrawMode ? splineKnots : [], overrides);
  }, [splineKnots, splineTangentOverrides, editMode, status, geometryEditSpline]);

  // Regenerate road mesh when project or display settings change
  const updateMesh = useCallback(async () => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready' || !project) return;

      try {
        const service = await getPlatformService();
        const visibleProject = buildRenderableProject(project, display);

      // Run all needed generators in parallel; use empty fallbacks for disabled layers.
      // Each optional generator is individually guarded with .catch() so a missing or
      // unimplemented WASM export (e.g. when the WASM binary is stale) cannot abort
      // core road/junction rendering.
      const empty = Promise.resolve(new Float32Array(0));
      const centerLineProm = display.showReferenceLine
        ? service.generateCenterLineVertices(visibleProject, 2.0).catch(() => new Float32Array(0))
        : empty;
      const laneLineProm = display.showLaneLines
        ? service.generateLaneLineVertices(visibleProject, 2.0).catch(() => new Float32Array(0))
        : empty;
      const signalProm = display.showSignals
        ? service.generateSignalPaintVertices(visibleProject, 2.0).catch(() => new Float32Array(0))
        : empty;
      const objectProm = display.showObjects
        ? service.generateObjectVertices(visibleProject).catch(() => new Float32Array(0))
        : empty;

      const [roadVerts, junctionVerts, laneLineVerts, centerLineVerts, signalVerts, objectVerts] =
        await Promise.all([
          service.generateRoadVertices(visibleProject, 2.0, display.colorMode).catch((e) => { console.warn('[Viewport] generateRoadVertices failed:', e); return new Float32Array(0); }),
          service.generateJunctionVertices(visibleProject).catch((e) => { console.warn('[Viewport] generateJunctionVertices failed:', e); return new Float32Array(0); }),
          laneLineProm,
          centerLineProm,
          signalProm,
          objectProm,
        ]);

      // Merge road surfaces + junction surfaces + signal paint marks + objects into one upload
      const surfaceVerts = mergeFloat32Arrays(
        mergeFloat32Arrays(mergeFloat32Arrays(roadVerts, junctionVerts), signalVerts),
        objectVerts,
      );
      renderer.uploadRoadVertices(surfaceVerts);

      // Merge lane boundary lines + reference centerlines into lane line upload
      const lineVerts = mergeFloat32Arrays(laneLineVerts, centerLineVerts);
      renderer.uploadLaneLineVertices(lineVerts);
    } catch (err) {
      console.error('[Viewport] Failed to generate road mesh:', err);
    }
  }, [
    project,
    status,
    display.showLaneLines,
    display.showRoadMarks,
    display.showReferenceLine,
    display.showSignals,
    display.showObjects,
    display.colorMode,
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

  useEffect(() => { updateMesh(); }, [updateMesh]);

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
          // Pan to the road containing the signal; this navigates close enough for inspection
          const { project: currentProject } = useEditorStore.getState();
          const road = currentProject.roads.find((r) => r.id === event.roadId);
          const signal = road?.signals?.find((s) => s.id === event.signalId);
          if (road && signal) {
            (async () => {
              try {
                const service = await getPlatformService();
                const verts = await service.generateSingleRoadVertices(road, 2.0, [0.2, 0.5, 1.0, 0.7]);
                if (verts.length > 0) renderer.panToCenter(verts);
              } catch (err) {
                console.error('[Viewport] pan-to-signal failed:', err);
              }
            })();
          }
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

  // Handle mouse move for world coordinates (unproject to ground plane)
  const handleMouseMove = useCallback(async (e: React.MouseEvent) => {
    const gesture = mouseGestureRef.current;
    if (gesture && !gesture.dragged && exceededDragThreshold(gesture.startX, gesture.startY, e.clientX, e.clientY)) {
      gesture.dragged = true;
    }
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    // Rubber-band selection: update overlay position
    const rubberBand = rubberBandRef.current;
    if (rubberBand) {
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
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = (e.clientX - rect.left) * devicePixelRatio;
    const screenY = (e.clientY - rect.top) * devicePixelRatio;
    const worldPos = renderer.unprojectToGround(screenX, screenY);
    if (!worldPos) return;

    // Move/Rotate road drag: compute transform and generate preview vertices
    const moveRotateDrag = moveRotateDragRef.current;
    if (moveRotateDrag) {
      const { mode, roadId, startWorldX, startWorldY, centroidX, centroidY } = moveRotateDrag;
      const { project: currentProject } = useEditorStore.getState();
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
          // Angle from centroid to start vs centroid to current
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

        // Upload async preview as highlight overlay (throttled like knot drag)
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
      return;
    }

    // Spline knot dragging: update knot position
    const viewState = useEditorViewStore.getState();
    const drag = viewState.draggingKnot;
    if (drag) {
      // Geometry edit mode: move knot via WASM
      if (viewState.geometryEditSpline) {
        const spline = viewState.geometryEditSpline;
        if (drag.type === 'knot' && drag.index >= 0 && drag.index < spline.knots.length) {
          // Skip if previous frame's update hasn't completed
          if (isPreviewingRoadRef.current) {
            emitCursorMove(worldPos.x, worldPos.y);
            pendingCursorRef.current = worldPos;
            return;
          }
          try {
            const service = await getPlatformService();
            const updated = await service.moveSplineKnot(
              spline, drag.index, worldPos.x, worldPos.y, spline.knots[drag.index]!.position[2],
            );
            viewState.setGeometryEditSpline(updated);

            // Real-time road mesh preview: regenerate geometry for the edited road only.
            const editRoadId = viewState.geometryEditRoadId;
            const renderer = rendererRef.current;
            if (editRoadId && renderer) {
              isPreviewingRoadRef.current = true;
              void (async () => {
                try {
                  const liveRenderer = rendererRef.current;
                  if (!liveRenderer) return;
                  // Incremental update: convert spline to geometries, then generate only the changed road's vertices
                  const geometries = await service.splineToGeometries(updated);
                  const totalLength = geometries.reduce((s, g) => s + g.length, 0);
                  const currentProject = useEditorStore.getState().project;
                  const previewRoad = { ...currentProject.roads.find((r) => r.id === editRoadId)!, plan_view: geometries, length: totalLength };
                  // Only generate vertices for the single changed road
                  const singleRoadVerts = await service.generateSingleRoadVertices(previewRoad, 2.0, [0.35, 0.35, 0.35, 1.0]);
                  // For lane lines, only include the edited road
                  const singleProject = { ...currentProject, roads: [previewRoad] };
                  const singleLaneLineVerts = await service.generateLaneLineVertices(singleProject, 2.0);
                  liveRenderer.uploadRoadVertices(singleRoadVerts);
                  liveRenderer.uploadLaneLineVertices(singleLaneLineVerts);
                } catch { /* ignore preview errors during drag */ }
                finally { isPreviewingRoadRef.current = false; }
              })();
            }
          } catch {
            // Ignore move errors during drag
          }
        }
        emitCursorMove(worldPos.x, worldPos.y);
        pendingCursorRef.current = worldPos;
        return;
      }

      // Spline creation mode: direct position update
      const knots = viewState.splineKnots;
      if (drag.index >= 0 && drag.index < knots.length) {
        if (drag.type === 'knot') {
          // Move knot directly to cursor
          const updated: Array<[number, number, number]> = knots.map((k, i) =>
            i === drag.index ? [worldPos.x, worldPos.y, k[2]] : k
          );
          viewState.setSplineKnots(updated);
        } else {
          // Tangent handle drag: compute new tangent vector from knot→cursor
          // so the handle visually tracks the cursor and the curve curvature changes.
          const kn = knots[drag.index]!;
          const handleVec: [number, number, number] = [
            worldPos.x - kn[0],
            worldPos.y - kn[1],
            0,
          ];
          // Convert handle display offset to actual tangent vector.
          // Display uses scale = min(4/|t|, 0.3), so tangent = handleVec / 0.3
          // for handles within visual range.
          const DISPLAY_SCALE = 0.3;
          const tangent: [number, number, number] = drag.type === 'out'
            ? [handleVec[0] / DISPLAY_SCALE, handleVec[1] / DISPLAY_SCALE, 0]
            : [-handleVec[0] / DISPLAY_SCALE, -handleVec[1] / DISPLAY_SCALE, 0];
          viewState.setSplineTangentOverride(drag.index, tangent);
        }
      }
      // Update cursor position but skip snapping during drag
      emitCursorMove(worldPos.x, worldPos.y);
      pendingCursorRef.current = worldPos;
      return;
    }

    // Hover cursor: check if mouse is over a draggable knot
    const isGeometryEdit = !!viewState.geometryEditSpline;
    const isSplineCreate = viewState.editMode === 'spline' && viewState.splineKnots.length > 0;
    const isDrawModeActive =
      (viewState.editMode === 'line' || viewState.editMode === 'arc' || viewState.editMode === 'spiral') &&
      viewState.splineKnots.length > 0;
    if (isGeometryEdit || isSplineCreate || isDrawModeActive) {
      const mpp = renderer.getMetersPerPixel();
      const knotHitSq   = (8.0 * mpp) ** 2;  // match knotHalfSize (6*mpp) + small margin
      const handleHitSq = (6.0 * mpp) ** 2;  // match handleHalfSize (4*mpp) + small margin
      let newHover: { index: number; type: 'knot' | 'in' | 'out' } | null = null;

      // Get knot positions and tangent overrides based on mode
      const hoverKnots = isGeometryEdit
        ? splineToRendererFormat(viewState.geometryEditSpline!).knots
        : viewState.splineKnots;
      const hoverOverrides = isGeometryEdit
        ? splineToRendererFormat(viewState.geometryEditSpline!).tangentOverrides
        : viewState.splineTangentOverrides;

      for (let ki = 0; ki < hoverKnots.length; ki++) {
        const k = hoverKnots[ki]!;
        const dx = worldPos.x - k[0];
        const dy = worldPos.y - k[1];
        if (dx * dx + dy * dy < knotHitSq) { newHover = { index: ki, type: 'knot' }; break; }
      }
      if (!newHover) {
        const handles = getSplineHandlePoints(hoverKnots, hoverOverrides);
        for (const h of handles) {
          const dx = worldPos.x - h.x;
          const dy = worldPos.y - h.y;
          if (dx * dx + dy * dy < handleHitSq) { newHover = { index: h.knotIndex, type: h.type }; break; }
        }
      }

      // Update marker visuals only when hover changes (avoids per-frame GPU buffer rebuild)
      const prev = hoveredControlPointRef.current;
      const changed = newHover?.index !== prev?.index || newHover?.type !== prev?.type;
      if (changed) {
        hoveredControlPointRef.current = newHover;
        renderer.refreshSplineMarkers(newHover, undefined);
      }

      // grab when over a control point, crosshair otherwise (still in a draw/edit mode)
      canvas.style.cursor = newHover ? 'grab' : 'crosshair';
    } else {
      if (hoveredControlPointRef.current !== null) {
        hoveredControlPointRef.current = null;
        renderer.refreshSplineMarkers(null, undefined);
      }
      // In draw modes show crosshair even before the first point is placed
      const isAnyDrawMode =
        viewState.editMode === 'line' ||
        viewState.editMode === 'arc' ||
        viewState.editMode === 'spiral' ||
        viewState.editMode === 'spline';
      canvas.style.cursor = isAnyDrawMode ? 'crosshair' : '';
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
          // Show snap indicator at the snapped world position
          const renderer = rendererRef.current;
          const snapEl = snapIndicatorDomRef.current;
          if (renderer && snapEl) {
            const screenPos = renderer.projectWorldToScreen(snapResult.x, snapResult.y);
            if (screenPos) {
              snapEl.style.left = `${screenPos.x}px`;
              snapEl.style.top = `${screenPos.y}px`;
              snapEl.style.display = 'block';
            }
          }
          emitCursorMove(snapResult.x, snapResult.y);
          pendingCursorRef.current = { x: snapResult.x, y: snapResult.y };
          return;
        }
      } catch {
        // Fall through to raw position on snap error
      }
      // Not snapped — hide snap indicator
      const snapEl = snapIndicatorDomRef.current;
      if (snapEl) snapEl.style.display = 'none';
    }

    // Hover detection: opaque yellow highlight for road/junction under cursor in select mode
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

    // Set mode-specific cursor when no drag is active.
    // Note: line/arc/spiral/spline cursors are handled above in the hover block.
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
                // Only show yellow hover highlight if not already selected
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
                } else {
                  if (!rendererInst.pointerDragging) {
                    canvas.style.cursor = '';
                  }
                }
              }
            }
          }
      } catch {
        // Ignore hover detection errors
      }
    }

    emitCursorMove(worldPos.x, worldPos.y);
    pendingCursorRef.current = worldPos;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    mouseGestureRef.current = {
      button: e.button,
      startX: e.clientX,
      startY: e.clientY,
      dragged: false,
    };

    // Hit-test knots on left-button press
    if (e.button !== 0) return;

    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    const viewState = useEditorViewStore.getState();

    // Determine knot positions to hit-test based on mode
    let hitKnots: Array<[number, number, number]> | null = null;
    let hitOverrides: Record<number, [number, number, number]> | undefined;

    if (viewState.geometryEditSpline) {
      // Geometry edit mode: hit-test the editable spline knots
      const fmt = splineToRendererFormat(viewState.geometryEditSpline);
      hitKnots = fmt.knots;
      hitOverrides = fmt.tangentOverrides;
    } else if (
      (viewState.editMode === 'spline' ||
       viewState.editMode === 'line' ||
       viewState.editMode === 'arc' ||
       viewState.editMode === 'spiral') &&
      viewState.splineKnots.length > 0
    ) {
      // All draw modes use splineKnots for control points
      hitKnots = viewState.splineKnots;
      hitOverrides = viewState.editMode === 'spline' ? viewState.splineTangentOverrides : {};
    }

    if (!hitKnots || hitKnots.length === 0) {
      // Move/Rotate road: start drag on the selected road
      if (viewState.editMode === 'move-road' || viewState.editMode === 'rotate-road') {
        const { selectedRoadId: selRoadId, project: currentProject } = useEditorStore.getState();
        if (selRoadId) {
          const road = currentProject.roads.find((r) => r.id === selRoadId);
          if (road && road.plan_view.length > 0) {
            const rect = canvas.getBoundingClientRect();
            const screenX = (e.clientX - rect.left) * devicePixelRatio;
            const screenY = (e.clientY - rect.top) * devicePixelRatio;
            const worldPos = renderer.unprojectToGround(screenX, screenY);
            if (worldPos) {
              const cx = road.plan_view.reduce((sum, g) => sum + g.x, 0) / road.plan_view.length;
              const cy = road.plan_view.reduce((sum, g) => sum + g.y, 0) / road.plan_view.length;
              moveRotateDragRef.current = {
                mode: viewState.editMode,
                roadId: selRoadId,
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
            }
          }
        }
        return;
      }

      // Shift+left-drag starts rubber-band multi-select (plain left-drag still pans)
      if (e.shiftKey && viewState.editMode !== 'spline' && viewState.editMode !== 'line' && viewState.editMode !== 'arc' && viewState.editMode !== 'spiral' && !viewState.geometryEditSpline) {
        rubberBandRef.current = { startClientX: e.clientX, startClientY: e.clientY, active: false };
        renderer.lockCamera();
      }

      // NOTE: draw modes (line/arc/spiral) no longer lock the camera unconditionally.
      // Camera locking only happens when dragging an existing control point (handled
      // by the hit-test above). Click-to-add-point uses gesture.dragged detection.
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = (e.clientX - rect.left) * devicePixelRatio;
    const screenY = (e.clientY - rect.top) * devicePixelRatio;
    const worldPos = renderer.unprojectToGround(screenX, screenY);
    if (!worldPos) return;

    const mpp = renderer.getMetersPerPixel();
    const knotHitSq   = (8.0 * mpp) ** 2;
    const handleHitSq = (6.0 * mpp) ** 2;

    // Check knot positions first
    let bestDistSq = Infinity;
    let bestHit: { index: number; type: 'knot' | 'in' | 'out' } | null = null;

    for (let i = 0; i < hitKnots.length; i++) {
      const [kx, ky] = hitKnots[i]!;
      const dx = worldPos.x - kx;
      const dy = worldPos.y - ky;
      const dSq = dx * dx + dy * dy;
      if (dSq < knotHitSq && dSq < bestDistSq) {
        bestDistSq = dSq;
        bestHit = { index: i, type: 'knot' };
      }
    }

    // Check tangent handle positions — only for spline creation mode (not line/arc/spiral draw modes)
    if (!viewState.geometryEditSpline && viewState.editMode === 'spline') {
      const handles = getSplineHandlePoints(hitKnots, hitOverrides);
      for (const h of handles) {
        const dx = worldPos.x - h.x;
        const dy = worldPos.y - h.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < handleHitSq && dSq < bestDistSq) {
          bestDistSq = dSq;
          bestHit = { index: h.knotIndex, type: h.type };
        }
      }
    }

    if (bestHit) {
      viewState.setDraggingKnot(bestHit);
      renderer.lockCamera();
      canvas.style.cursor = 'grabbing';
      // Show red selection highlight on the clicked control point
      hoveredControlPointRef.current = null;
      renderer.refreshSplineMarkers(null, bestHit);
    }
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

    // Measurement mode: collect points instead of picking
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

    const splineState = useEditorViewStore.getState();

    // In move/rotate mode, clicks do not change road selection
    if (splineState.editMode === 'move-road' || splineState.editMode === 'rotate-road') {
      return;
    }

    // If in geometry edit mode, click outside knots → do nothing (stay in edit)
    if (splineState.geometryEditRoadId) {
      return;
    }

    if (splineState.editMode === 'spline') {
      const nextKnots: Array<[number, number, number]> = [
        ...splineState.splineKnots,
        [worldPos.x, worldPos.y, 0],
      ];
      splineState.setSplineKnots(nextKnots);
      if (e.detail >= 2 && nextKnots.length >= 2) {
        await finalizeSplineCreation(nextKnots);
      }
      return;
    }

    // Geometry draw modes: line, arc, spiral — accumulate points like spline
    if (splineState.editMode === 'line' || splineState.editMode === 'arc' || splineState.editMode === 'spiral') {
      const point: [number, number, number] = [worldPos.x, worldPos.y, 0];
      const nextKnots: Array<[number, number, number]> = [...splineState.splineKnots, point];
      splineState.setSplineKnots(nextKnots);

      // Double-click finalizes (same UX as spline mode)
      const minPoints = splineState.editMode === 'arc' ? 3 : 2;
      if (e.detail >= 2 && nextKnots.length >= minPoints) {
        await finalizeDrawGeometry(splineState.editMode, nextKnots);
      }
      return;
    }

    try {
      const service = await getPlatformService();
      const { project: currentProject, selectedRoadId } = useEditorStore.getState();
      const { display: currentDisplay } = useEditorViewStore.getState();
      const visibleProject = buildRenderableProject(currentProject, currentDisplay);
      const roadId = await service.pickRoadAtPoint(visibleProject, worldPos.x, worldPos.y, 5.0);

      // Shift+click: toggle item in/out of multi-selection without clearing others
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

      // Double-click on already-selected road → enter geometry edit mode
      if (e.detail >= 2 && roadId && roadId === selectedRoadId) {
        void enterGeometryEditMode(roadId);
        return;
      }

      if (roadId) {
        useEditorStore.getState().selectRoad(roadId);
        // Clear hover highlight immediately after selection so the yellow doesn't linger
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
      // Clicking empty space: do NOT clear selection
    } catch (err) {
      console.error('[Viewport] Pick failed:', err);
    }
  }, [finalizeSplineCreation, enterGeometryEditMode]);

  const handleMouseUp = useCallback(async (e: React.MouseEvent) => {
    // Commit rubber-band multi-select
    const rubberBand = rubberBandRef.current;
    if (rubberBand) {
      rubberBandRef.current = null;
      const overlay = rubberBandOverlayRef.current;
      if (overlay) overlay.style.display = 'none';
      const rendererInst = rendererRef.current;
      if (rendererInst) rendererInst.unlockCamera();

      if (rubberBand.active) {
        const canvas = canvasRef.current;
        if (canvas && rendererInst) {
          const canvasRect = canvas.getBoundingClientRect();
          const dpr = devicePixelRatio;
          const sx0 = (rubberBand.startClientX - canvasRect.left) * dpr;
          const sy0 = (rubberBand.startClientY - canvasRect.top) * dpr;
          const sx1 = (e.clientX - canvasRect.left) * dpr;
          const sy1 = (e.clientY - canvasRect.top) * dpr;
          const tl = rendererInst.unprojectToGround(Math.min(sx0, sx1), Math.min(sy0, sy1));
          const br = rendererInst.unprojectToGround(Math.max(sx0, sx1), Math.max(sy0, sy1));
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
      return;
    }

    // Commit move/rotate road drag
    const moveRotateDrag = moveRotateDragRef.current;
    if (moveRotateDrag) {
      moveRotateDragRef.current = null;
      const renderer = rendererRef.current;
      if (renderer) {
        renderer.unlockCamera();
        renderer.clearHighlight();
      }
      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = '';
      const { mode, roadId, currentDx, currentDy, currentAngle, centroidX, centroidY } = moveRotateDrag;
      const store = useEditorStore.getState();
      if (mode === 'move-road' && (currentDx !== 0 || currentDy !== 0)) {
        store.moveRoad(roadId, currentDx, currentDy);
      } else if (mode === 'rotate-road' && currentAngle !== 0) {
        store.rotateRoad(roadId, currentAngle, centroidX, centroidY);
      }
      return;
    }

    const viewState = useEditorViewStore.getState();
    const { draggingKnot } = viewState;

    if (draggingKnot) {
      viewState.setDraggingKnot(null);
      const renderer = rendererRef.current;
      if (renderer) {
        renderer.unlockCamera();
        // Clear red selection highlight when drag ends
        renderer.refreshSplineMarkers(null, null);
      }
      hoveredControlPointRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = '';

      // In geometry edit mode, apply spline changes to road mesh immediately
      const { geometryEditRoadId: roadId, geometryEditSpline: spline } = viewState;
      if (roadId && spline) {
        try {
          const service = await getPlatformService();
          const geometries = await service.splineToGeometries(spline);
          const totalLength = geometries.reduce((sum, g) => sum + g.length, 0);
          useEditorStore.getState().updateRoadGeometry(roadId, geometries, totalLength);
        } catch (err) {
          console.error('[Viewport] Failed to update road geometry:', err);
        }
      }
    }
  }, []);

  const hasTemplateDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes('application/we-template-id');

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (hasTemplateDrag(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (hasTemplateDrag(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear when leaving the viewport div (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const templateId = e.dataTransfer.getData('application/we-template-id');
    if (!templateId) return;

    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    const rect = canvas.getBoundingClientRect();
    const screenX = (e.clientX - rect.left) * devicePixelRatio;
    const screenY = (e.clientY - rect.top) * devicePixelRatio;
    const worldPos = renderer.unprojectToGround(screenX, screenY);
    if (!worldPos) return;

    // Resolve the template item from the contrib store and let it handle creation
    const sections = usePluginContribStore.getState().templateSections;
    const item = sections.flatMap((s) => s.items).find((i) => i.id === templateId);
    if (item) {
      item.onApply({ x: worldPos.x, y: worldPos.y, hdg: 0 });
      // Pan camera to the newly created element so it's visible immediately
      const { selectedRoadId, selectedJunctionId } = useEditorStore.getState();
      if (selectedRoadId) {
        emitViewportEvent({ type: 'pan-to-road', roadId: selectedRoadId });
      } else if (selectedJunctionId) {
        emitViewportEvent({ type: 'pan-to-junction', junctionId: selectedJunctionId });
      }
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

  const handleMouseLeave = useCallback(() => {
    if (hoveredRoadRef.current !== null || hoveredJunctionRef.current !== null) {
      hoveredRoadRef.current = null;
      hoveredJunctionRef.current = null;
      rendererRef.current?.clearHover();
    }
    // Always hide snap indicator on leave
    const snapEl = snapIndicatorDomRef.current;
    if (snapEl) snapEl.style.display = 'none';
  }, []);

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
      {/* Context hints: keyboard shortcut hints when elements are selected */}
      {(selectedRoadId || selectedJunctionId || selectedRoadIds.length > 0) && (
        <div className="viewport-context-hints">
          {selectedRoadIds.length > 0
            ? <><span>已选 {selectedRoadIds.length} 条</span><kbd>Delete</kbd><span>批量删除</span><kbd>Esc</kbd><span>取消</span></>
            : selectedRoadId
            ? <><kbd>Delete</kbd><span>删除</span><kbd>Ctrl+D</kbd><span>复制</span><kbd>E</kbd><span>编辑</span><kbd>Esc</kbd><span>取消</span></>
            : <><kbd>Delete</kbd><span>删除</span><kbd>Esc</kbd><span>取消</span></>
          }
        </div>
      )}
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
