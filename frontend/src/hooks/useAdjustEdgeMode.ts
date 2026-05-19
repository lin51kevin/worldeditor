import { useRef, type MutableRefObject, type RefObject } from 'react';
import { ViewportRenderer } from '../viewport/renderer';
import { emitCursorMove } from '../viewport/cursorEvents';
import { useProjectStore } from '../stores/projectStore';
import { useViewportStore } from '../stores/viewportStore';
import { getPlatformService } from '../services';
import type { LaneWidth } from '../services/platform';

interface AdjustEdgeDragState {
  roadId: string;
  side: 'left' | 'right';
  startT: number;
  startHeading: number;
  startWidths: Map<number, number>; // laneId → original width[0].a
  computedWidths: Map<number, number>; // laneId → new width (set by update)
}

/**
 * Handles adjust-edge drag: drag a road edge to scale lane widths proportionally.
 */
export function useAdjustEdgeMode(
  rendererRef: RefObject<ViewportRenderer | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  _isPreviewingRoadRef: MutableRefObject<boolean>,
  pendingCursorRef: MutableRefObject<{ x: number; y: number } | null>,
) {
  const adjustEdgeDragRef = useRef<AdjustEdgeDragState | null>(null);

  /** Compute new widths given original state and deltaT. */
  const computeNewWidths = (state: AdjustEdgeDragState, deltaT: number): Map<number, number> => {
    const result = new Map<number, number>();
    let totalOrigWidth = 0;
    for (const w of state.startWidths.values()) totalOrigWidth += w;
    if (totalOrigWidth <= 0) return result;

    const outwardDelta = state.side === 'left' ? deltaT : -deltaT;
    const newTotal = Math.max(0.2 * state.startWidths.size, totalOrigWidth + outwardDelta);
    const scale = newTotal / totalOrigWidth;
    for (const [laneId, origW] of state.startWidths) {
      result.set(laneId, Math.max(0.2, origW * scale));
    }
    return result;
  };

  /** Start adjust-edge drag. Returns true if started. */
  const startAdjustEdgeDrag = async (
    e: React.MouseEvent,
  ): Promise<boolean> => {
    const viewState = useViewportStore.getState();
    if (viewState.editMode !== 'adjust-edge') return false;

    const projState = useProjectStore.getState();
    const selRoadId = projState.selectedRoadId;
    if (!selRoadId) return false;
    const road = projState.project.roads.find((r) => r.id === selRoadId);
    if (!road) return false;

    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!renderer || !canvas) return false;

    const rect = canvas.getBoundingClientRect();
    const screenX = (e.clientX - rect.left) * devicePixelRatio;
    const screenY = (e.clientY - rect.top) * devicePixelRatio;
    const worldPos = renderer.unprojectToGround(screenX, screenY);
    if (!worldPos) return false;

    const service = await getPlatformService();
    const snap = await service.snapPointOnRoad(road, worldPos.x, worldPos.y);

    // Determine which edge is closest and check proximity
    let section: typeof road.lane_sections[0] | null = null;
    for (let si = road.lane_sections.length - 1; si >= 0; si--) {
      const ls = road.lane_sections[si];
      if (ls && ls.s <= snap.s + 1e-9) { section = ls; break; }
    }
    if (!section) return false;
    const leftTotal = section.left.reduce((sum: number, l: typeof section.left[0]) => {
      const w = l.width[0]; return sum + (w ? w.a : 3.5);
    }, 0);
    const rightTotal = section.right.reduce((sum: number, l: typeof section.right[0]) => {
      const w = l.width[0]; return sum + (w ? w.a : 3.5);
    }, 0);

    // Any click within the road surface and away from the center line triggers edge drag.
    // Side is determined by which side of the reference line the click is on.
    if (Math.abs(snap.t) < 0.5) return false; // too close to center line
    const side: 'left' | 'right' = snap.t > 0 ? 'left' : 'right';

    // Verify click is actually within road surface (not outside the edges)
    if (side === 'left' && snap.t > leftTotal + 2.0) return false;
    if (side === 'right' && Math.abs(snap.t) > rightTotal + 2.0) return false;

    // Collect original widths for this side across all sections
    const startWidths = new Map<number, number>();
    for (const section of road.lane_sections) {
      for (const lane of section[side]) {
        const w = lane.width[0]?.a ?? 3.5;
        if (!startWidths.has(lane.id)) startWidths.set(lane.id, w);
      }
    }

    adjustEdgeDragRef.current = {
      roadId: selRoadId,
      side,
      startT: snap.t,
      startHeading: snap.hdg,
      startWidths,
      computedWidths: new Map(),
    };
    renderer.lockCamera();
    return true;
  };

  /** Update adjust-edge preview. Returns true if handled. */
  const updateAdjustEdgeDrag = async (
    worldPos: { x: number; y: number },
  ): Promise<boolean> => {
    const state = adjustEdgeDragRef.current;
    if (!state) return false;

    const projState = useProjectStore.getState();
    const road = projState.project.roads.find((r) => r.id === state.roadId);
    if (!road) return false;

    const service = await getPlatformService();
    const snap = await service.snapPointOnRoad(road, worldPos.x, worldPos.y);
    const deltaT = snap.t - state.startT;
    const newWidths = computeNewWidths(state, deltaT);
    state.computedWidths = newWidths;

    // Generate preview road with adjusted widths (only the dragged side)
    const previewRoad = {
      ...road,
      lane_sections: road.lane_sections.map((section) => ({
        ...section,
        [state.side]: section[state.side].map((lane) => ({
          ...lane,
          width: [{ ...lane.width[0], a: newWidths.get(lane.id) ?? lane.width[0]?.a ?? 3.5 } as LaneWidth],
        })),
      })),
    };

    const liveRenderer = rendererRef.current;
    if (liveRenderer) {
      try {
        const verts = await service.generateSingleRoadVertices(
          previewRoad, 2.0, [0.3, 0.7, 0.95, 0.7],
        );
        liveRenderer.uploadHighlightVertices(verts);
      } catch { /* ignore preview errors */ }
    }

    emitCursorMove(worldPos.x, worldPos.y);
    pendingCursorRef.current = worldPos;
    return true;
  };

  /** Commit widths to store on mouse up. Returns true if handled. */
  const commitAdjustEdgeDrag = (): boolean => {
    const state = adjustEdgeDragRef.current;
    if (!state) return false;

    adjustEdgeDragRef.current = null;
    const renderer = rendererRef.current;
    if (renderer) {
      renderer.unlockCamera();
      renderer.clearHighlight();
    }

    const projState = useProjectStore.getState();
    const road = projState.project.roads.find((r) => r.id === state.roadId);

    // Check if widths actually changed
    let changed = false;
    for (const [laneId, newW] of state.computedWidths) {
      const origW = state.startWidths.get(laneId) ?? 0;
      if (Math.abs(newW - origW) > 0.001) { changed = true; break; }
    }

    if (!changed || !road) return true;

    // Apply to all sections
    for (let si = 0; si < road.lane_sections.length; si++) {
      const section = road.lane_sections[si];
      if (!section) continue;
      for (const lane of section[state.side]) {
        const newW = state.computedWidths.get(lane.id);
        if (newW !== undefined) {
          projState.updateLaneWidth(state.roadId, si, state.side, lane.id, {
            s_offset: 0, a: newW, b: 0, c: 0, d: 0,
          });
        }
      }
    }

    // Restore cursor
    const canvas = canvasRef.current;
    if (canvas?.style) canvas.style.cursor = '';

    return true;
  };

  return {
    adjustEdgeDragRef,
    computeNewWidths,
    startAdjustEdgeDrag,
    updateAdjustEdgeDrag,
    commitAdjustEdgeDrag,
  };
}
