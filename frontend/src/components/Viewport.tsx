import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ViewportRenderer } from '../viewport/renderer';
import { emitCursorMove } from '../viewport/cursorEvents';
import { useProjectStore } from '../stores/projectStore';
import { isDrawMode, useViewportStore } from '../stores/viewportStore';
import { getPlatformService } from '../services';
import { buildSnapConfig } from '../services/snapService';
import { showContextMenu } from '../services/contextMenu';
import { usePluginContribStore } from '../stores/pluginContribStore';
import { useViewportDrop } from '../hooks/useViewportDrop';
import { ViewportLoadingOverlay } from './ViewportLoadingOverlay';
import { useRubberBandSelect } from '../hooks/useRubberBandSelect';
import { useMoveRotateMode } from '../hooks/useMoveRotateMode';
import { useAdjustEdgeMode } from '../hooks/useAdjustEdgeMode';
import { useSplitMode } from '../hooks/useSplitMode';
import { useArcDrawMode } from '../hooks/useArcDrawMode';
import { useSpiralDrawMode } from '../hooks/useSpiralDrawMode';
import { useSplineDrawMode } from '../hooks/useSplineDrawMode';
import { useSplineDrawPreview } from '../hooks/useSplineDrawPreview';
import { useGeometryEditMode } from '../hooks/useGeometryEditMode';
import { useLaneLineEdit } from '../hooks/useLaneLineEdit';
import { useViewportKeyboard } from '../hooks/useViewportKeyboard';
import { useViewportMeshes } from '../hooks/useViewportMeshes';
import { useSelectionHighlight } from '../hooks/useSelectionHighlight';
import { useRoadLinkHighlight } from '../hooks/useRoadLinkHighlight';
import { useMeasureOverlay } from '../hooks/useMeasureOverlay';
import { useViewportTouch } from '../hooks/useViewportTouch';
import { useViewportHoverPick } from '../hooks/useViewportHoverPick';
import { useSignalPlacement } from '../hooks/useSignalPlacement';
import { useViewportEvents } from '../hooks/useViewportEvents';
import { useViewportInit } from '../hooks/useViewportInit';
import { useViewportSync } from '../hooks/useViewportSync';
import { usePointCloudViewport } from '../hooks/usePointCloudViewport';
import './Viewport.css';

import {
  MouseGestureState,
  exceededDragThreshold,
  type SplineControlPoint,
} from './viewportUtils';


export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ViewportRenderer | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unsupported'>('loading');
  const { isDragOver, isFileDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useViewportDrop(rendererRef, canvasRef);
  const { t } = useTranslation();
  const mouseGestureRef = useRef<MouseGestureState | null>(null);
  const isPreviewingRoadRef = useRef(false);
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null);
  const hoveredControlPointRef = useRef<SplineControlPoint | null>(null);
  const { rubberBandRef, rubberBandOverlayRef, startRubberBand, updateRubberBand, commitRubberBand } = useRubberBandSelect(rendererRef, canvasRef);
  const { startMoveRotateDrag, updateMoveRotateDrag, commitMoveRotateDrag } = useMoveRotateMode(rendererRef, canvasRef, isPreviewingRoadRef, pendingCursorRef);
  const { startAdjustEdgeDrag, updateAdjustEdgeDrag, commitAdjustEdgeDrag } = useAdjustEdgeMode(rendererRef, canvasRef, isPreviewingRoadRef, pendingCursorRef);
  useMeasureOverlay({ rendererRef, canvasRef, status });
  const snapIndicatorDomRef = useRef<HTMLDivElement | null>(null);
  const splitIndicatorDomRef = useRef<HTMLDivElement | null>(null);

  // ── Extracted hooks ──
  useViewportInit(canvasRef, rendererRef, setStatus);
  useViewportSync(rendererRef, status);
  useViewportEvents(rendererRef, canvasRef);
  usePointCloudViewport({ rendererRef, status });

  // ── Mesh lifecycle (surface + lines + visible project + WASM cache) ──
  const { getVisibleProject, updateSurfaceMesh, updateLineMesh, getCachedLineVertices } = useViewportMeshes({
    rendererRef,
    status,
  });

  const {
    clearArcDrawHover,
    handleArcDrawMouseMove,
    handleArcDrawMouseDown,
    handleArcDrawClick,
    handleArcDrawMouseUp,
    handleArcDrawRightClick,
  } = useArcDrawMode({
    canvasRef,
    rendererRef,
    pendingCursorRef,
    status,
  });
  const {
    clearSpiralDrawHover,
    handleSpiralDrawMouseMove,
    handleSpiralDrawMouseDown,
    handleSpiralDrawClick,
    handleSpiralDrawMouseUp,
    handleSpiralDrawRightClick,
  } = useSpiralDrawMode({
    canvasRef,
    rendererRef,
    pendingCursorRef,
    status,
    onPreviewEnd: useCallback(() => {
      void updateLineMesh();
    }, [updateLineMesh]),
  });
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

  const {
    handleLaneLineMouseDown,
    handleLaneLineMouseMove,
    handleLaneLineMouseUp,
    handleLaneLineDoubleClick,
    clearLaneLineHover,
  } = useLaneLineEdit({
    canvasRef,
    rendererRef,
    status,
  });

  const {
    clearSplitPreview,
    handleSplitModeMouseMove,
    handleSplitModeClick,
  } = useSplitMode({
    canvasRef,
    rendererRef,
    pendingCursorRef,
    splitIndicatorDomRef,
  });

  useViewportKeyboard();

  const {
    executeHoverPick,
    clearHoverPick,
    hoveredRoadRef,
    hoveredJunctionRef,
    hoveredSignalRef,
    hoveredObjectRef,
    lastHoverMeshIdRef,
    pickInFlightRef,
    pendingPickRafRef,
    pendingPickPosRef,
  } = useViewportHoverPick({
    rendererRef,
    canvasRef,
    getVisibleProject,
  });
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useViewportTouch({
    rendererRef,
    canvasRef,
  });
  const {
    clearPlacementPreview,
    updatePlacementPreview,
    commitPlacement,
    startSignalDrag,
    updateSignalDrag,
    commitSignalDrag,
  } = useSignalPlacement({
    rendererRef,
    canvasRef,
    pendingCursorRef,
  });

  // Real-time road mesh preview while adding knots in draw mode
  useSplineDrawPreview({
    rendererRef,
    status,
    onPreviewEnd: useCallback(() => {
      void updateSurfaceMesh();
      void updateLineMesh();
    }, [updateSurfaceMesh, updateLineMesh]),
    getCachedLineVertices,
  });

  // ── Selection highlight ──
  useSelectionHighlight({ rendererRef, status });

  // ── Road link (predecessor/successor) highlight ──
  useRoadLinkHighlight({ rendererRef, status });

  // Throttle Zustand cursor updates to once per animation frame
  useEffect(() => {
    let frameId = 0;
    const flush = () => {
      if (pendingCursorRef.current) {
        useProjectStore.getState().setCursorWorldPos(pendingCursorRef.current);
        pendingCursorRef.current = null;
      }
      frameId = requestAnimationFrame(flush);
    };
    frameId = requestAnimationFrame(flush);
    return () => cancelAnimationFrame(frameId);
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
    if (await updateSignalDrag(worldPos)) return;
    if (await updateAdjustEdgeDrag(worldPos)) return;
    if (handleLaneLineMouseMove(worldPos, canvas, e)) return;
    if (handleSplitModeMouseMove(worldPos)) {
      const snapEl = snapIndicatorDomRef.current;
      if (snapEl) snapEl.style.display = 'none';
      return;
    }

    const viewState = useViewportStore.getState();
    if (await handleGeometryEditMouseMove(worldPos, canvas, renderer)) return;
    if (handleArcDrawMouseMove(worldPos, canvas)) return;
    if (handleSpiralDrawMouseMove(worldPos, canvas)) return;
    if (handleSplineDrawMouseMove(worldPos, canvas, renderer, e)) return;

    // Show snap indicator for draw-mode endpoint snapping
    {
      const drawSnap = useViewportStore.getState().drawSnapResult;
      const snapEl = snapIndicatorDomRef.current;
      const inDrawMode = isDrawMode(viewState.editMode);
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

    if (await updatePlacementPreview(worldPos)) {
      canvas.style.cursor = 'crosshair';
      return;
    }

    // In click-to-place mode show crosshair and skip normal hover picking
    if (viewState.pendingTemplateId || viewState.pendingObjectTemplateId) {
      canvas.style.cursor = 'crosshair';
      return;
    }

    if (viewState.snapEnabled) {
      try {
        const service = await getPlatformService();
        const { selectedRoadId: excludeId } = useProjectStore.getState();
        const snapResult = await service.snapPointCached(
          worldPos.x,
          worldPos.y,
          buildSnapConfig(),
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
      !isDrawMode(viewState.editMode) &&
      viewState.editMode !== 'move-road' &&
      viewState.editMode !== 'rotate-road' &&
      viewState.editMode !== 'adjust-edge' &&
      viewState.editMode !== 'editLaneLine' &&
      !viewState.geometryEditSpline &&
      !viewState.draggingKnot &&
      !rubberBandRef.current;

    if (viewState.editMode === 'move-road') {
      canvas.style.cursor = 'move';
    } else if (viewState.editMode === 'rotate-road') {
      canvas.style.cursor = 'crosshair';
    }

    if (isInSelectMode && !pickInFlightRef.current) {
      // rAF throttle: only schedule one pick per animation frame
      pendingPickPosRef.current = { x: worldPos.x, y: worldPos.y };
      if (!pendingPickRafRef.current) {
        pendingPickRafRef.current = requestAnimationFrame(() => {
          pendingPickRafRef.current = 0;
          void executeHoverPick();
        });
      }
    }

    // adjust-edge hover: detect proximity to road edges and show resize cursor
    if (viewState.editMode === 'adjust-edge' && !pickInFlightRef.current) {
      pickInFlightRef.current = true;
      try {
        const service = await getPlatformService();
        const visibleProject = getVisibleProject();
        const selRoadId = useProjectStore.getState().selectedRoadId;
        if (visibleProject && selRoadId) {
          const road = visibleProject.roads.find(r => r.id === selRoadId);
          if (road) {
            const snap = await service.snapPointOnRoad(road, worldPos.x, worldPos.y);
            // Compute total lane width on each side at the snap point
            let section: typeof road.lane_sections[0] | null = null;
            for (let si = road.lane_sections.length - 1; si >= 0; si--) {
              const ls = road.lane_sections[si];
              if (ls && ls.s <= snap.s + 1e-9) { section = ls; break; }
            }
            if (section) {
              const leftTotal = section.left.reduce((sum: number, l: typeof section.left[0]) => {
                const w = l.width[0]; return sum + (w ? w.a : 3.5);
              }, 0);
              const rightTotal = section.right.reduce((sum: number, l: typeof section.right[0]) => {
                const w = l.width[0]; return sum + (w ? w.a : 3.5);
              }, 0);
              const onRoadSurface = (snap.t >= -(rightTotal + 2.0)) && (snap.t <= leftTotal + 2.0);
              const awayFromCenter = Math.abs(snap.t) > 0.5;
              if (onRoadSurface && awayFromCenter) {
                // Rotate cursor to be perpendicular to road heading
                const headingDeg = (snap.hdg * 180 / Math.PI) % 180;
                canvas.style.cursor = `url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M4 12h16" stroke="%23333" stroke-width="2" stroke-linecap="round"/><path d="M18 8l4 4-4 4" stroke="%23333" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>') ${-headingDeg} ew-resize`;
              } else {
                canvas.style.cursor = '';
              }
            }
          }
        }
      } catch {
        // Ignore hover detection errors.
      } finally {
        pickInFlightRef.current = false;
      }
    }

    emitCursorMove(worldPos.x, worldPos.y);
    pendingCursorRef.current = worldPos;
  }, [getVisibleProject, handleArcDrawMouseMove, handleGeometryEditMouseMove, handleLaneLineMouseMove, handleSpiralDrawMouseMove, handleSplitModeMouseMove, handleSplineDrawMouseMove, updatePlacementPreview, updateSignalDrag]);

  const handleMouseDown = useCallback(async (e: React.MouseEvent) => {
    mouseGestureRef.current = {
      button: e.button,
      startX: e.clientX,
      startY: e.clientY,
      dragged: false,
    };

    if (e.button !== 0) return;

    try {
      const canvas = canvasRef.current;
      const renderer = rendererRef.current;
      if (!canvas || !renderer) return;

      const viewState = useViewportStore.getState();
      if (
        handleGeometryEditMouseDown(e, canvas, renderer) ||
        handleArcDrawMouseDown() ||
        handleSpiralDrawMouseDown() ||
        handleSplineDrawMouseDown(e, canvas, renderer)
      ) {
        return;
      }
      if (await startSignalDrag(e, renderer, canvas)) return;
      if (handleLaneLineMouseDown(e, canvas, renderer)) return;
      if (startMoveRotateDrag(e, renderer, canvas)) return;
      if (await startAdjustEdgeDrag(e)) return;
      if (
        e.shiftKey &&
        !isDrawMode(viewState.editMode) &&
        !viewState.geometryEditSpline
      ) {
        startRubberBand(e, renderer);
      }
    } catch (err) {
      console.error('[Viewport] handleMouseDown error:', err);
    }
  }, [handleArcDrawMouseDown, handleGeometryEditMouseDown, handleLaneLineMouseDown, handleSpiralDrawMouseDown, handleSplineDrawMouseDown, startMoveRotateDrag, startAdjustEdgeDrag, startRubberBand, startSignalDrag]);

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    const gesture = mouseGestureRef.current;
    mouseGestureRef.current = null;
    if (!gesture || gesture.button !== 0) return;
    // In click-to-place modes (draw, template, measure), skip the drag threshold
    // so that slight hand tremor doesn't swallow the click event.
    const viewState0 = useViewportStore.getState();
    const isClickToPlace =
      isDrawMode(viewState0.editMode) ||
      viewState0.editMode === 'split' ||
      viewState0.editMode === 'editJunction' ||
      viewState0.editMode === 'placeSignal' ||
      viewState0.editMode === 'placeObject' ||
      !!viewState0.pendingTemplateId ||
      !!viewState0.pendingObjectTemplateId ||
      viewState0.measureMode !== 'none';
    if (!isClickToPlace && (gesture.dragged || exceededDragThreshold(gesture.startX, gesture.startY, e.clientX, e.clientY))) {
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

    const { measureMode, measurePoints, addMeasurePoint, setMeasurementResult } = useViewportStore.getState();
    if (measureMode !== 'none') {
      const point = { x: worldPos.x, y: worldPos.y, z: 0 };
      addMeasurePoint(point);
      const pts = [...measurePoints, point];
      try {
        const service = await getPlatformService();
        if (measureMode === 'distance' && pts.length >= 2) {
          // Continuous distance: measure every segment and sum them
          let totalStraight = 0;
          let totalHorizontal = 0;
          let totalVertical = 0;
          for (let i = 0; i < pts.length - 1; i++) {
            const pa = pts[i]!;
            const pb = pts[i + 1]!;
            const seg = await service.measureDistance(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
            totalStraight += seg.straight;
            totalHorizontal += seg.horizontal;
            totalVertical += seg.vertical;
          }
          setMeasurementResult({
            type: 'distance',
            value: { straight: totalStraight, horizontal: totalHorizontal, vertical: totalVertical },
          });
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

    const viewState = useViewportStore.getState();
    if (await handleSplitModeClick(worldPos)) {
      return;
    }
    if (viewState.editMode === 'move-road' || viewState.editMode === 'rotate-road' || viewState.editMode === 'adjust-edge' || viewState.editMode === 'editLaneLine') {
      return;
    }

    // editJunction mode: click a road to toggle it as incoming road of the selected junction
    if (viewState.editMode === 'editJunction') {
      const { selectedJunctionId } = useProjectStore.getState();
      if (selectedJunctionId) {
        try {
          const service = await getPlatformService();
          const roadId = await service.pickRoadAtPointCached(worldPos.x, worldPos.y, 8.0);
          if (roadId) {
            const store = useProjectStore.getState();
            const road = store.project.roads.find((r) => r.id === roadId);
            if (road) {
              const { attachRoadToJunction, detachRoadFromJunction, isRoadLinkedToJunction, chooseRoadConnectionContactPoint } = await import('../utils/junctionEditing');
              if (isRoadLinkedToJunction(road, selectedJunctionId)) {
                store.executePluginCommand('Detach Road from Junction', (p) => detachRoadFromJunction(p, selectedJunctionId, roadId));
              } else {
                const contactPoint = chooseRoadConnectionContactPoint(store.project, selectedJunctionId, road);
                store.executePluginCommand('Attach Road to Junction', (p) => attachRoadToJunction(p, selectedJunctionId, roadId, contactPoint));
              }
            }
          }
        } catch (err) {
          console.error('[Viewport] editJunction click failed:', err);
        }
      }
      return;
    }

    // Click-to-place mode: instantiate the pending template at the clicked world position.
    // Handled before selection mode so templates work in any selection mode.
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

    // Click-to-place road object / sign: pick nearest road, then place at road-local s/t.
    // Handled before selection mode so object placement works in any selection mode.
    if (viewState.pendingObjectTemplateId) {
      const templateId = viewState.pendingObjectTemplateId;
      viewState.clearPendingObjectTemplate();
      try {
        const service = await getPlatformService();
        const visibleProject = getVisibleProject();
        if (visibleProject) {
          const roadId = await service.pickRoadAtPointCached(worldPos.x, worldPos.y, 10.0);
          if (roadId) {
            const allItems = usePluginContribStore.getState().templateSections.flatMap((s) => s.items);
            const item = allItems.find((i) => i.id === templateId);
            if (item) {
              const road = visibleProject.roads.find((r) => r.id === roadId);
              let s = worldPos.x;
              let t = worldPos.y;
              let hdg = 0;
              if (road) {
                try {
                  const snap = await service.snapPointOnRoad(road, worldPos.x, worldPos.y);
                  s = snap.s;
                  t = snap.t;
                  hdg = snap.hdg;
                } catch {
                  // snap failed — fall back to world coords approximation
                }
              }
              item.onApply({ roadId, x: s, y: t, hdg });
            }
          }
        }
      } catch (err) {
        console.error('[Viewport] Failed to place road object:', err);
      }
      return;
    }

    if (await commitPlacement(worldPos)) {
      return;
    }

    // Draw mode clicks are handled before selection mode so drawing works
    // regardless of whether selection mode is road, lane, or laneSection.
    if (await handleArcDrawClick(e, worldPos)) {
      return;
    }
    if (handleSpiralDrawClick(e, worldPos)) {
      return;
    }
    if (await handleSplineDrawClick(e, worldPos)) {
      return;
    }
    if (viewState.geometryEditRoadId) {
      return;
    }

    // Mode-aware road sub-selection (road-markings reuses lane picking to choose a target lane)
    const activeSelectionMode = viewState.editMode === 'road-markings' ? 'lane' : viewState.selectionMode;
    if (activeSelectionMode !== 'road') {
      try {
        const service = await getPlatformService();
        const visibleProject = getVisibleProject();
        if (visibleProject) {
          if (activeSelectionMode === 'laneSection') {
            const roadId = await service.pickRoadAtPointCached(worldPos.x, worldPos.y, 5.0);
            if (roadId) {
              const road = visibleProject.roads.find((candidate) => candidate.id === roadId);
              if (road) {
                const snap = await service.snapPointOnRoad(road, worldPos.x, worldPos.y);
                let sectionIndex: number | null = null;
                for (let i = road.lane_sections.length - 1; i >= 0; i--) {
                  const section = road.lane_sections[i];
                  if (section && section.s <= snap.s + 1e-9) {
                    sectionIndex = i;
                    break;
                  }
                }
                useProjectStore.getState().setSelectedLaneSection(roadId, sectionIndex);
              }
            }
          } else {
            const laneResult = await service.pickLaneAtPointCached(worldPos.x, worldPos.y, 5.0);
            if (laneResult) {
              const { roadId, sectionIndex, laneId } = laneResult;
              useProjectStore.getState().setSelectedLane(roadId, sectionIndex, laneId);
              if (await handleLaneLineDoubleClick(laneResult, worldPos, e.detail)) {
                return;
              }
            } else {
              const roadId = await service.pickRoadAtPointCached(worldPos.x, worldPos.y, 5.0);
              if (roadId) {
                useProjectStore.getState().selectRoad(roadId);
              }
            }
          }
        }
      } catch (err) {
        console.error('[Viewport] Lane pick failed:', err);
      }
      return;
    }

    try {
      const service = await getPlatformService();
      const visibleProject = getVisibleProject();
      if (!visibleProject) return;

      // Signals and objects sit ON roads, so they must be checked first with a
      // moderate threshold (4 m) before road picking (5 m) would always win.
      // Skip during shift-click which is reserved for multi-road/junction selection.
      if (!e.shiftKey) {
        const signalHit = await service.pickSignalAtPointCached(worldPos.x, worldPos.y, 4.0);
        if (signalHit !== null) {
          useProjectStore.getState().selectSignal(signalHit.roadId, signalHit.signalId);
          const rendererInst = rendererRef.current;
          if (rendererInst) rendererInst.clearHover();
          hoveredRoadRef.current = null;
          hoveredJunctionRef.current = null;
          lastHoverMeshIdRef.current = null;
          return;
        }
        const objectHit = await service.pickObjectAtPointCached(worldPos.x, worldPos.y, 4.0);
        if (objectHit !== null) {
          useProjectStore.getState().selectObject(objectHit.roadId, objectHit.objectId);
          const rendererInst = rendererRef.current;
          if (rendererInst) rendererInst.clearHover();
          hoveredRoadRef.current = null;
          hoveredJunctionRef.current = null;
          hoveredSignalRef.current = null;
          hoveredObjectRef.current = null;
          lastHoverMeshIdRef.current = null;
          return;
        }
      }

      const roadId = await service.pickRoadAtPointCached(worldPos.x, worldPos.y, 5.0);

      if (e.shiftKey) {
        if (roadId) {
          const { selectedRoadIds, selectedJunctionIds } = useProjectStore.getState();
          const newRoadIds = selectedRoadIds.includes(roadId)
            ? selectedRoadIds.filter((id) => id !== roadId)
            : [...selectedRoadIds, roadId];
          useProjectStore.getState().selectMultiple(newRoadIds, selectedJunctionIds);
        } else {
          const junctionId = await service.pickJunctionAtPointCached(worldPos.x, worldPos.y, 8.0);
          if (junctionId) {
            const { selectedRoadIds, selectedJunctionIds } = useProjectStore.getState();
            const newJunctionIds = selectedJunctionIds.includes(junctionId)
              ? selectedJunctionIds.filter((id) => id !== junctionId)
              : [...selectedJunctionIds, junctionId];
            useProjectStore.getState().selectMultiple(selectedRoadIds, newJunctionIds);
          }
        }
        return;
      }

      if (handleRoadDoubleClick(roadId, e.detail)) {
        return;
      }

      if (roadId) {
        useProjectStore.getState().selectRoad(roadId);
        const rendererInst = rendererRef.current;
        if (rendererInst) rendererInst.clearHover();
        hoveredRoadRef.current = null;
        hoveredJunctionRef.current = null;
        lastHoverMeshIdRef.current = null;
        return;
      }
      const junctionId = await service.pickJunctionAtPointCached(worldPos.x, worldPos.y, 8.0);
      if (junctionId !== null) {
        useProjectStore.getState().selectJunction(junctionId);
        const rendererInst = rendererRef.current;
        if (rendererInst) rendererInst.clearHover();
        hoveredRoadRef.current = null;
        hoveredJunctionRef.current = null;
        lastHoverMeshIdRef.current = null;
      }
    } catch (err) {
      console.error('[Viewport] Pick failed:', err);
    }
  }, [commitPlacement, getVisibleProject, handleArcDrawClick, handleLaneLineDoubleClick, handleRoadDoubleClick, handleSplitModeClick, handleSpiralDrawClick, handleSplineDrawClick]);

  const handleMouseUp = useCallback(async (e: React.MouseEvent) => {
    if (commitRubberBand(e)) return;
    if (commitSignalDrag()) return;
    if (commitMoveRotateDrag()) return;
    if (commitAdjustEdgeDrag()) return;
    if (handleLaneLineMouseUp()) return;
    if (await handleGeometryEditMouseUp()) return;
    if (handleArcDrawMouseUp()) return;
    if (handleSpiralDrawMouseUp()) return;
    handleSplineDrawMouseUp();
  }, [commitMoveRotateDrag, commitAdjustEdgeDrag, commitRubberBand, handleArcDrawMouseUp, handleGeometryEditMouseUp, handleLaneLineMouseUp, handleSpiralDrawMouseUp, handleSplineDrawMouseUp, commitSignalDrag]);

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
    const viewState = useViewportStore.getState();
    if (viewState.pendingTemplateId) {
      viewState.clearPendingTemplate();
      return;
    }
    if (viewState.pendingObjectTemplateId) {
      viewState.clearPendingObjectTemplate();
      return;
    }
    if (viewState.editMode === 'placeSignal' || viewState.editMode === 'placeObject') {
      viewState.setEditMode('default');
      clearPlacementPreview();
      return;
    }
    // Right-click in draw mode finalizes (or cancels) the road being drawn
    if (handleArcDrawRightClick()) return;
    if (handleSpiralDrawRightClick()) return;
    if (handleSplineDrawRightClick()) return;
    // Clear measurement points on right-click when in measure mode
    if (viewState.measureMode !== 'none') {
      viewState.clearMeasurePoints();
      return;
    }
    const rect = canvasRef.current?.getBoundingClientRect();
    const renderer = rendererRef.current;
    if (rect && renderer) {
      const contextWorldPos = renderer.unprojectToGround(
        (e.clientX - rect.left) * devicePixelRatio,
        (e.clientY - rect.top) * devicePixelRatio,
      );
      useViewportStore.getState().setContextMenuWorldPos(contextWorldPos);
    }
    const { selectedRoadId, selectedJunctionId } = useProjectStore.getState();
    if (selectedRoadId) {
      showContextMenu(e.clientX, e.clientY, 'road');
      return;
    }
    if (selectedJunctionId) {
      showContextMenu(e.clientX, e.clientY, 'junction');
      return;
    }
    showContextMenu(e.clientX, e.clientY, 'viewport');
  }, [clearPlacementPreview, handleArcDrawRightClick, handleSpiralDrawRightClick, handleSplineDrawRightClick]);

  const handleMouseLeave = useCallback(() => {
    clearHoverPick();
    clearGeometryEditHover();
    clearLaneLineHover();
    clearArcDrawHover();
    clearSpiralDrawHover();
    clearSplineDrawHover();
    clearSplitPreview();
    clearPlacementPreview();
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = '';
    const snapEl = snapIndicatorDomRef.current;
    if (snapEl) snapEl.style.display = 'none';
  }, [canvasRef, clearArcDrawHover, clearGeometryEditHover, clearHoverPick, clearLaneLineHover, clearPlacementPreview, clearSpiralDrawHover, clearSplineDrawHover, clearSplitPreview]);

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
      <div ref={splitIndicatorDomRef} className="split-indicator" style={{ display: 'none' }} />
      {status !== 'ready' && (
        <div className="viewport-overlay">
          <span className="viewport-label">
            {status === 'loading' ? t('viewport.initializing') : t('viewport.unsupported')}
          </span>
        </div>
      )}
      {/* File loading progress overlay */}
      <ViewportLoadingOverlay />
      {/* File drop zone hint */}
      {isFileDragOver && (
        <div className="viewport-file-drop-zone">
          <div className="viewport-file-drop-hint">
            <span className="viewport-file-drop-icon">📂</span>
            <span>{t('viewport.dropToOpen')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
