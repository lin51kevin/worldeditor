import { useCallback, type RefObject } from 'react';
import { emitCursorMove } from '../viewport/cursorEvents';
import { useProjectStore } from '../stores/projectStore';
import { isDrawMode, useViewportStore } from '../stores/viewportStore';
import { getPlatformService } from '../services';
import { buildSnapConfig } from '../services/snapService';
import { showContextMenu } from '../services/contextMenu';
import { ViewportRenderer } from '../viewport/renderer';
import { exceededDragThreshold, type MouseGestureState } from '../components/viewportUtils';
import {
  handleMeasureClick,
  handleEditJunctionClick,
  handlePlaceTemplateClick,
  handlePlaceObjectClick,
  handleObjectDrawClick,
  finalizeObjectDraw,
} from '../components/viewportClickActions';
import type { useRubberBandSelect } from './useRubberBandSelect';
import type { useMoveRotateMode } from './useMoveRotateMode';
import type { useAdjustEdgeMode } from './useAdjustEdgeMode';
import type { useSignalPlacement } from './useSignalPlacement';
import type { useLaneLineEdit } from './useLaneLineEdit';
import type { useSplitMode } from './useSplitMode';
import type { useArcDrawMode } from './useArcDrawMode';
import type { useSpiralDrawMode } from './useSpiralDrawMode';
import type { useSplineDrawMode } from './useSplineDrawMode';
import type { useGeometryEditMode } from './useGeometryEditMode';
import type { useViewportHoverPick } from './useViewportHoverPick';
import type { useViewportMeshes } from './useViewportMeshes';

/**
 * Dependencies for {@link useViewportPointerHandlers}.
 *
 * Each mode bundle is the full return value of its corresponding hook, so the
 * handler bodies can destructure and use the same identifiers verbatim while
 * keeping precise types via `ReturnType<...>`.
 */
export interface ViewportPointerHandlerDeps {
  refs: {
    mouseGestureRef: RefObject<MouseGestureState | null>;
    canvasRef: RefObject<HTMLCanvasElement | null>;
    rendererRef: RefObject<ViewportRenderer | null>;
    snapIndicatorDomRef: RefObject<HTMLDivElement | null>;
    pendingCursorRef: RefObject<{ x: number; y: number } | null>;
  };
  rubberBand: ReturnType<typeof useRubberBandSelect>;
  moveRotate: ReturnType<typeof useMoveRotateMode>;
  adjustEdge: ReturnType<typeof useAdjustEdgeMode>;
  signalPlacement: ReturnType<typeof useSignalPlacement>;
  laneLine: ReturnType<typeof useLaneLineEdit>;
  split: ReturnType<typeof useSplitMode>;
  arcDraw: ReturnType<typeof useArcDrawMode>;
  spiralDraw: ReturnType<typeof useSpiralDrawMode>;
  splineDraw: ReturnType<typeof useSplineDrawMode>;
  geometryEdit: ReturnType<typeof useGeometryEditMode>;
  hoverPick: ReturnType<typeof useViewportHoverPick>;
  getVisibleProject: ReturnType<typeof useViewportMeshes>['getVisibleProject'];
}

/**
 * Centralises the viewport canvas pointer event handlers (mouse move / down /
 * click / up / context-menu / leave). Extracted from `Viewport.tsx` to keep the
 * component focused on wiring; behaviour is unchanged.
 */
export function useViewportPointerHandlers(deps: ViewportPointerHandlerDeps) {
  const { mouseGestureRef, canvasRef, rendererRef, snapIndicatorDomRef, pendingCursorRef } =
    deps.refs;
  const { rubberBandRef, startRubberBand, updateRubberBand, commitRubberBand } = deps.rubberBand;
  const { startMoveRotateDrag, updateMoveRotateDrag, commitMoveRotateDrag } = deps.moveRotate;
  const { startAdjustEdgeDrag, updateAdjustEdgeDrag, commitAdjustEdgeDrag } = deps.adjustEdge;
  const {
    clearPlacementPreview,
    updatePlacementPreview,
    commitPlacement,
    startSignalDrag,
    updateSignalDrag,
    commitSignalDrag,
  } = deps.signalPlacement;
  const {
    handleLaneLineMouseDown,
    handleLaneLineMouseMove,
    handleLaneLineMouseUp,
    handleLaneLineDoubleClick,
    clearLaneLineHover,
  } = deps.laneLine;
  const { clearSplitPreview, handleSplitModeMouseMove, handleSplitModeClick } = deps.split;
  const {
    clearArcDrawHover,
    handleArcDrawMouseMove,
    handleArcDrawMouseDown,
    handleArcDrawClick,
    handleArcDrawMouseUp,
    handleArcDrawRightClick,
  } = deps.arcDraw;
  const {
    clearSpiralDrawHover,
    handleSpiralDrawMouseMove,
    handleSpiralDrawMouseDown,
    handleSpiralDrawClick,
    handleSpiralDrawMouseUp,
    handleSpiralDrawRightClick,
  } = deps.spiralDraw;
  const {
    clearSplineDrawHover,
    handleSplineDrawMouseMove,
    handleSplineDrawMouseDown,
    handleSplineDrawClick,
    handleSplineDrawMouseUp,
    handleSplineDrawRightClick,
  } = deps.splineDraw;
  const {
    clearGeometryEditHover,
    handleGeometryEditMouseMove,
    handleGeometryEditMouseDown,
    handleGeometryEditMouseUp,
    handleRoadDoubleClick,
  } = deps.geometryEdit;
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
  } = deps.hoverPick;
  const { getVisibleProject } = deps;

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
      !!viewState0.objectDrawTemplateId ||
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

    if (await handleMeasureClick(worldPos)) {
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
    if (await handleEditJunctionClick(worldPos)) {
      return;
    }

    // Click-to-place mode: instantiate the pending template at the clicked world position.
    // Handled before selection mode so templates work in any selection mode.
    if (handlePlaceTemplateClick(worldPos)) {
      return;
    }

    // Polygon-draw mode for area-type road objects (crosswalk, parking, etc.)
    // Must be checked BEFORE single-click placement so polygon templates
    // accumulate vertices instead of placing immediately.
    if (await handleObjectDrawClick(worldPos, getVisibleProject)) {
      return;
    }

    // Click-to-place road object / sign: pick nearest road, then place at road-local s/t.
    // Handled before selection mode so object placement works in any selection mode.
    if (await handlePlaceObjectClick(worldPos, getVisibleProject)) {
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
    // Polygon-draw mode: right-click finalizes the polygon (≥3 vertices)
    // or cancels if insufficient vertices. Must be checked BEFORE the
    // generic pendingObjectTemplate cancel so it can close the polygon.
    if (viewState.objectDrawTemplateId) {
      finalizeObjectDraw();
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

  return {
    handleMouseMove,
    handleMouseDown,
    handleClick,
    handleMouseUp,
    handleContextMenu,
    handleMouseLeave,
  };
}
