/**
 * Viewport event dispatch — extracts complex mouse event routing logic
 * from Viewport.tsx into testable, stateless handler functions.
 *
 * Each function takes a context object with necessary refs/callbacks and
 * returns a boolean indicating whether the event was consumed.
 */

import type { ViewportRenderer } from '../viewport/renderer';
import { useViewportStore } from '../stores/viewportStore';
import { useProjectStore } from '../stores/projectStore';
import { usePluginContribStore } from '../stores/pluginContribStore';
import { getPlatformService } from '../services';
import { emitCursorMove } from '../viewport/cursorEvents';
import {
  querySnap,
  queryClickPick,
  pickLane,
  pickRoad,
  pickRoadWide,
  snapToRoad,
} from '../services/snapService';

export interface ViewportEventContext {
  canvas: HTMLCanvasElement;
  renderer: ViewportRenderer;
  pendingCursorRef: React.MutableRefObject<{ x: number; y: number } | null>;
  snapIndicatorDomRef: React.MutableRefObject<HTMLDivElement | null>;
}

/** Show/hide the snap indicator DOM element based on a snap result. */
export function updateSnapIndicator(
  ctx: ViewportEventContext,
  snapped: boolean,
  worldX?: number,
  worldY?: number,
): void {
  const snapEl = ctx.snapIndicatorDomRef.current;
  if (!snapEl) return;

  if (snapped && worldX != null && worldY != null) {
    const screenPos = ctx.renderer.projectWorldToScreen(worldX, worldY);
    if (screenPos) {
      snapEl.style.left = `${screenPos.x}px`;
      snapEl.style.top = `${screenPos.y}px`;
      snapEl.style.display = 'block';
    }
  } else {
    snapEl.style.display = 'none';
  }
}

/** Handle general snapping during mousemove. Returns true if snapped. */
export async function handleMoveSnap(
  ctx: ViewportEventContext,
  worldX: number,
  worldY: number,
): Promise<boolean> {
  const { snapEnabled } = useViewportStore.getState();
  if (!snapEnabled) return false;

  const { selectedRoadId } = useProjectStore.getState();
  const result = await querySnap(worldX, worldY, selectedRoadId ?? undefined);

  if (result) {
    updateSnapIndicator(ctx, true, result.x, result.y);
    emitCursorMove(result.x, result.y);
    ctx.pendingCursorRef.current = { x: result.x, y: result.y };
    return true;
  }

  updateSnapIndicator(ctx, false);
  return false;
}

/** Handle measurement click. Returns true if in measurement mode. */
export async function handleMeasurementClick(
  worldX: number,
  worldY: number,
): Promise<boolean> {
  const { measureMode, measurePoints, addMeasurePoint, setMeasurementResult } =
    useViewportStore.getState();
  if (measureMode === 'none') return false;

  const point = { x: worldX, y: worldY, z: 0 };
  addMeasurePoint(point);
  const pts = [...measurePoints, point];

  try {
    const service = await getPlatformService();
    if (measureMode === 'distance' && pts.length >= 2) {
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
  return true;
}

/** Handle mode-aware road sub-selection clicks. */
export async function handleLaneSelectionClick(
  worldX: number,
  worldY: number,
  visibleProject: { roads: Array<{ id: string; lane_sections: Array<{ s: number; left: Array<{ width: Array<{ a: number }> }>; right: Array<{ width: Array<{ a: number }> }> }> }> } | null,
): Promise<boolean> {
  const viewState = useViewportStore.getState();
  const activeSelectionMode = viewState.editMode === 'road-markings' ? 'lane' : viewState.selectionMode;
  if (activeSelectionMode === 'road') {
    return false;
  }
  if (!visibleProject) return true;

  try {
    const service = await getPlatformService();
    if (activeSelectionMode === 'laneSection') {
      const roadId = await service.pickRoadAtPointCached(worldX, worldY, 5.0);
      if (roadId) {
        const road = visibleProject.roads.find((candidate) => candidate.id === roadId);
        if (road) {
          const snap = await service.snapPointOnRoad(road as never, worldX, worldY);
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
      const laneResult = await pickLane(worldX, worldY);
      if (laneResult) {
        const { roadId, sectionIndex, laneId } = laneResult;
        useProjectStore.getState().setSelectedLane(roadId, sectionIndex, laneId);
      } else {
        const roadId = await pickRoad(worldX, worldY);
        if (roadId) {
          useProjectStore.getState().selectRoad(roadId);
        }
      }
    }
  } catch (err) {
    console.error('[Viewport] Lane pick failed:', err);
  }
  return true;
}

/** Handle template placement click. Returns true if in template mode. */
export async function handleTemplatePlacementClick(
  worldX: number,
  worldY: number,
  visibleProject: { roads: Array<{ id: string }> } | null,
): Promise<boolean> {
  const viewState = useViewportStore.getState();

  if (viewState.pendingTemplateId) {
    const templateId = viewState.pendingTemplateId;
    viewState.clearPendingTemplate();
    const allItems = usePluginContribStore.getState().templateSections.flatMap((s) => s.items);
    const item = allItems.find((i) => i.id === templateId);
    if (item) {
      item.onApply({ x: worldX, y: worldY, hdg: 0 });
    }
    return true;
  }

  if (viewState.pendingObjectTemplateId) {
    const templateId = viewState.pendingObjectTemplateId;
    viewState.clearPendingObjectTemplate();
    try {
      const roadId = await pickRoadWide(worldX, worldY);
      if (roadId && visibleProject) {
        const allItems = usePluginContribStore.getState().templateSections.flatMap((s) => s.items);
        const item = allItems.find((i) => i.id === templateId);
        if (item) {
          const road = visibleProject.roads.find((r) => r.id === roadId);
          let s = worldX;
          let t = worldY;
          let hdg = 0;
          if (road) {
            const snap = await snapToRoad(road as never, worldX, worldY);
            if (snap) { s = snap.s; t = snap.t; hdg = snap.hdg; }
          }
          item.onApply({ roadId, x: s, y: t, hdg });
        }
      }
    } catch (err) {
      console.error('[Viewport] Failed to place road object:', err);
    }
    return true;
  }

  return false;
}

/** Handle default selection click (signal → object → road → junction). */
export async function handleDefaultSelectionClick(
  worldX: number,
  worldY: number,
  shiftKey: boolean,
  rendererRef: React.MutableRefObject<ViewportRenderer | null>,
  hoverRefs: {
    hoveredRoadRef: React.MutableRefObject<string | null>;
    hoveredJunctionRef: React.MutableRefObject<string | null>;
    hoveredSignalRef: React.MutableRefObject<{ roadId: string; signalId: string } | null>;
    hoveredObjectRef: React.MutableRefObject<{ roadId: string; objectId: string } | null>;
    lastHoverMeshIdRef: React.MutableRefObject<string | null>;
  },
): Promise<void> {
  const result = await queryClickPick(worldX, worldY);
  const clearHover = () => {
    rendererRef.current?.clearHover();
    hoverRefs.hoveredRoadRef.current = null;
    hoverRefs.hoveredJunctionRef.current = null;
    hoverRefs.hoveredSignalRef.current = null;
    hoverRefs.hoveredObjectRef.current = null;
    hoverRefs.lastHoverMeshIdRef.current = null;
  };

  if (!shiftKey) {
    if (result.type === 'signal' && result.roadId && result.signalId) {
      useProjectStore.getState().selectSignal(result.roadId, result.signalId);
      clearHover();
      return;
    }
    if (result.type === 'object' && result.roadId && result.objectId) {
      useProjectStore.getState().selectObject(result.roadId, result.objectId);
      clearHover();
      return;
    }
  }

  if (result.type === 'road' && result.roadId) {
    if (shiftKey) {
      const { selectedRoadIds, selectedJunctionIds } = useProjectStore.getState();
      const newRoadIds = selectedRoadIds.includes(result.roadId)
        ? selectedRoadIds.filter((id) => id !== result.roadId)
        : [...selectedRoadIds, result.roadId];
      useProjectStore.getState().selectMultiple(newRoadIds, selectedJunctionIds);
    } else {
      useProjectStore.getState().selectRoad(result.roadId);
      clearHover();
    }
    return;
  }

  if (result.type === 'junction' && result.junctionId) {
    if (shiftKey) {
      const { selectedRoadIds, selectedJunctionIds } = useProjectStore.getState();
      const newJunctionIds = selectedJunctionIds.includes(result.junctionId)
        ? selectedJunctionIds.filter((id) => id !== result.junctionId)
        : [...selectedJunctionIds, result.junctionId];
      useProjectStore.getState().selectMultiple(selectedRoadIds, newJunctionIds);
    } else {
      useProjectStore.getState().selectJunction(result.junctionId);
      clearHover();
    }
  }
}
