import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ViewportRenderer, getSplineHandlePoints } from '../viewport/renderer';
import { emitCursorMove } from '../viewport/cursorEvents';
import { onViewportEvent } from '../viewport/viewportEvents';
import { useEditorStore } from '../stores/editorStore';
import { useEditorViewStore } from '../stores/editorViewStore';
import { useThemeStore } from '../stores/themeStore';
import { getPlatformService } from '../services';
import type { EditableSpline, SplineKnot } from '../services/platform';
import { showContextMenu } from '../services/contextMenu';
import { createRoadFromTemplate } from './TemplatePanel';
import {
  buildHighlightProject,
  buildRenderableProject,
  isSceneSelectionVisible,
  tintVertices,
} from '../utils/sceneGraph';
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

function makeSplineKnot(position: [number, number, number], s: number): SplineKnot {
  return {
    position,
    tangent_in: [0, 0, 0],
    tangent_out: [0, 0, 0],
    s,
    knot_type: 'Key',
    tangent_mode: 'Auto',
  };
}

function buildEditableSpline(points: Array<[number, number, number]>): EditableSpline {
  const knots: SplineKnot[] = [];
  let station = 0;
  for (let i = 0; i < points.length; i += 1) {
    if (i > 0) {
      const prev = points[i - 1]!;
      const curr = points[i]!;
      const dx = curr[0] - prev[0];
      const dy = curr[1] - prev[1];
      const dz = curr[2] - prev[2];
      station += Math.hypot(dx, dy, dz);
    }
    knots.push(makeSplineKnot(points[i]!, station));
  }
  if (knots.length > 0) {
    const firstKnot = knots[0]!;
    knots[0] = { ...firstKnot, knot_type: 'Anchor' };
  }
  if (knots.length > 1) {
    const last = knots.length - 1;
    const lastKnot = knots[last]!;
    knots[last] = { ...lastKnot, knot_type: 'Anchor' };
  }
  return { knots };
}

function nextSplineRoadId(existingRoadIds: string[]): string {
  let index = existingRoadIds.length + 1;
  let id = `road_spline_${index}`;
  const idSet = new Set(existingRoadIds);
  while (idSet.has(id)) {
    index += 1;
    id = `road_spline_${index}`;
  }
  return id;
}

/** Extract renderer-compatible knot positions and tangent overrides from an EditableSpline. */
function splineToRendererFormat(spline: EditableSpline): {
  knots: Array<[number, number, number]>;
  tangentOverrides: Record<number, [number, number, number]>;
} {
  const knots = spline.knots.map((k) => k.position);
  const tangentOverrides: Record<number, [number, number, number]> = {};
  for (let i = 0; i < spline.knots.length; i++) {
    const k = spline.knots[i]!;
    // Always use the tangent_out from the EditableSpline (computed by backend)
    tangentOverrides[i] = k.tangent_out;
  }
  return { knots, tangentOverrides };
}

export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ViewportRenderer | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unsupported'>('loading');
  const [isDragOver, setIsDragOver] = useState(false);
  const project = useEditorStore((s) => s.project);
  const selectedJunctionId = useEditorStore((s) => s.selectedJunctionId);
  const selectedSceneNode = useEditorStore((s) => s.selectedSceneNode);
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
      editorState.setProject(nextProject);
      editorState.markDirty();
      editorState.selectRoad(roadId);
      viewState.clearSplineKnots();
    } catch (err) {
      console.error('[Viewport] Failed to create road from spline:', err);
    }
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
    if (editMode !== 'spline') {
      useEditorViewStore.getState().clearSplineKnots();
    }
  }, [editMode]);

  // Keyboard handling for spline creation and geometry editing
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const viewState = useEditorViewStore.getState();
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
      }
      if (editMode !== 'spline') return;
      if (event.key === 'Backspace') {
        useEditorViewStore.getState().popSplineKnot();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        void finalizeSplineCreation();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [editMode, finalizeSplineCreation, finalizeGeometryEdit]);

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

    const overrides = Object.keys(splineTangentOverrides).length > 0 ? splineTangentOverrides : undefined;
    renderer.setSplinePreviewKnots(editMode === 'spline' ? splineKnots : [], overrides);
  }, [splineKnots, splineTangentOverrides, editMode, status, geometryEditSpline]);

  // Regenerate road mesh when project or display settings change
  const updateMesh = useCallback(async () => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready' || !project) return;

      try {
        const service = await getPlatformService();
        const visibleProject = buildRenderableProject(project, display);

      // Run all needed generators in parallel; use empty fallbacks for disabled layers
      const centerLineProm = display.showReferenceLine
        ? service.generateCenterLineVertices(visibleProject, 2.0)
        : Promise.resolve(new Float32Array(0));
      const signalProm = display.showSignals
        ? service.generateSignalPaintVertices(visibleProject, 2.0)
        : Promise.resolve(new Float32Array(0));

      const [roadVerts, junctionVerts, laneLineVerts, centerLineVerts, signalVerts] =
        await Promise.all([
          service.generateRoadVertices(visibleProject, 2.0),
          service.generateJunctionVertices(visibleProject),
          service.generateLaneLineVertices(visibleProject, 2.0),
          centerLineProm,
          signalProm,
        ]);

      // Merge road surfaces + junction surfaces + signal paint marks into one upload
      const surfaceVerts = mergeFloat32Arrays(
        mergeFloat32Arrays(roadVerts, junctionVerts),
        signalVerts,
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
    display.showReferenceLine,
    display.showSignals,
    display.hiddenRoadIds,
    display.hiddenJunctionIds,
    display.hiddenLaneSectionKeys,
    display.hiddenLaneKeys,
  ]);

  useEffect(() => { updateMesh(); }, [updateMesh]);

  // Update selection highlight when scene selection changes
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready') return;

    (async () => {
      try {
        const service = await getPlatformService();
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
        console.error('[Viewport] Failed to generate highlight mesh:', err);
      }
    })();
  }, [display, project, selectedJunctionId, selectedSceneNode, status]);

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

  // Handle mouse move for world coordinates (unproject to ground plane)
  const handleMouseMove = useCallback(async (e: React.MouseEvent) => {
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
    if (!worldPos) return;

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
    if (isGeometryEdit || isSplineCreate) {
      const camDist = renderer.getCameraDistance();
      const hitThreshold = Math.max(1.5, camDist * 0.02);
      const hitThresholdSq = hitThreshold * hitThreshold;
      let hovering = false;

      // Get knot positions and tangent overrides based on mode
      const hoverKnots = isGeometryEdit
        ? splineToRendererFormat(viewState.geometryEditSpline!).knots
        : viewState.splineKnots;
      const hoverOverrides = isGeometryEdit
        ? splineToRendererFormat(viewState.geometryEditSpline!).tangentOverrides
        : viewState.splineTangentOverrides;

      for (const k of hoverKnots) {
        const dx = worldPos.x - k[0];
        const dy = worldPos.y - k[1];
        if (dx * dx + dy * dy < hitThresholdSq) { hovering = true; break; }
      }
      if (!hovering) {
        const handles = getSplineHandlePoints(hoverKnots, hoverOverrides);
        for (const h of handles) {
          const dx = worldPos.x - h.x;
          const dy = worldPos.y - h.y;
          if (dx * dx + dy * dy < hitThresholdSq) { hovering = true; break; }
        }
      }
      canvas.style.cursor = hovering ? 'grab' : '';
    } else {
      canvas.style.cursor = '';
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
          emitCursorMove(snapResult.x, snapResult.y);
          pendingCursorRef.current = { x: snapResult.x, y: snapResult.y };
          return;
        }
      } catch {
        // Fall through to raw position on snap error
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
    } else if (viewState.editMode === 'spline' && viewState.splineKnots.length > 0) {
      // Spline creation mode
      hitKnots = viewState.splineKnots;
      hitOverrides = viewState.splineTangentOverrides;
    }

    if (!hitKnots || hitKnots.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const screenX = (e.clientX - rect.left) * devicePixelRatio;
    const screenY = (e.clientY - rect.top) * devicePixelRatio;
    const worldPos = renderer.unprojectToGround(screenX, screenY);
    if (!worldPos) return;

    const camDist = renderer.getCameraDistance();
    const hitThreshold = Math.max(1.5, camDist * 0.02);
    const hitThresholdSq = hitThreshold * hitThreshold;

    // Check knot positions (yellow squares) first
    let bestDistSq = Infinity;
    let bestHit: { index: number; type: 'knot' | 'in' | 'out' } | null = null;

    for (let i = 0; i < hitKnots.length; i++) {
      const [kx, ky] = hitKnots[i]!;
      const dx = worldPos.x - kx;
      const dy = worldPos.y - ky;
      const dSq = dx * dx + dy * dy;
      if (dSq < hitThresholdSq && dSq < bestDistSq) {
        bestDistSq = dSq;
        bestHit = { index: i, type: 'knot' };
      }
    }

    // Check tangent handle positions (white squares) — only for spline creation mode
    if (!viewState.geometryEditSpline) {
      const handles = getSplineHandlePoints(hitKnots, hitOverrides);
      for (const h of handles) {
        const dx = worldPos.x - h.x;
        const dy = worldPos.y - h.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < hitThresholdSq && dSq < bestDistSq) {
          bestDistSq = dSq;
          bestHit = { index: h.knotIndex, type: h.type };
        }
      }
    }

    if (bestHit) {
      viewState.setDraggingKnot(bestHit);
      renderer.lockCamera();
      canvas.style.cursor = 'grabbing';
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

    try {
      const service = await getPlatformService();
      const { project: currentProject, selectedRoadId } = useEditorStore.getState();
      const { display: currentDisplay } = useEditorViewStore.getState();
      const visibleProject = buildRenderableProject(currentProject, currentDisplay);
      const roadId = await service.pickRoadAtPoint(visibleProject, worldPos.x, worldPos.y, 5.0);

      // Double-click on already-selected road → enter geometry edit mode
      if (e.detail >= 2 && roadId && roadId === selectedRoadId) {
        void enterGeometryEditMode(roadId);
        return;
      }

      if (roadId) {
        useEditorStore.getState().selectRoad(roadId);
        return;
      }
      const junctionId = await service.pickJunctionAtPoint(visibleProject, worldPos.x, worldPos.y, 8.0);
      useEditorStore.getState().selectJunction(junctionId);
    } catch (err) {
      console.error('[Viewport] Pick failed:', err);
    }
  }, [finalizeSplineCreation, enterGeometryEditMode]);

  const handleMouseUp = useCallback(async () => {
    const viewState = useEditorViewStore.getState();
    const { draggingKnot } = viewState;
    if (draggingKnot) {
      viewState.setDraggingKnot(null);
      const renderer = rendererRef.current;
      if (renderer) {
        renderer.unlockCamera();
      }
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

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/we-template-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
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

    const road = createRoadFromTemplate(templateId, worldPos.x, worldPos.y, 0);
    if (road) {
      useEditorStore.getState().addRoad(road);
      useEditorStore.getState().markDirty();
      useEditorStore.getState().selectRoad(road.id);
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
    <div
      className={`viewport${isDragOver ? ' viewport-drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <canvas
        ref={canvasRef}
        className="viewport-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
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
