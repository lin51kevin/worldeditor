/**
 * Viewport click action handlers — extracted from Viewport.tsx.
 *
 * Each function handles one self-contained click mode (measurement, junction
 * editing, click-to-place template / object). They read the relevant store
 * state themselves and return `true` when they handled the click, so the
 * caller can early-return.
 */
import { useViewportStore } from '../stores/viewportStore';
import { useProjectStore } from '../stores/projectStore';
import { usePluginContribStore } from '../stores/pluginContribStore';
import { getPlatformService } from '../services';
import type { Project } from '../services/platform';

/** Handle a click in measurement mode. Returns true if measurement is active. */
export async function handleMeasureClick(worldPos: { x: number; y: number }): Promise<boolean> {
  const { measureMode, measurePoints, addMeasurePoint, setMeasurementResult } = useViewportStore.getState();
  if (measureMode === 'none') return false;
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
  return true;
}

/**
 * editJunction mode: click a road to toggle it as incoming road of the
 * selected junction. Returns true if editJunction mode is active.
 */
export async function handleEditJunctionClick(worldPos: { x: number; y: number }): Promise<boolean> {
  if (useViewportStore.getState().editMode !== 'editJunction') return false;
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
  return true;
}

/**
 * Click-to-place mode: instantiate the pending template at the clicked world
 * position. Returns true if a template was pending.
 */
export function handlePlaceTemplateClick(worldPos: { x: number; y: number }): boolean {
  const viewState = useViewportStore.getState();
  if (!viewState.pendingTemplateId) return false;
  const templateId = viewState.pendingTemplateId;
  viewState.clearPendingTemplate();
  const allItems = usePluginContribStore.getState().templateSections.flatMap((s) => s.items);
  const item = allItems.find((i) => i.id === templateId);
  if (item) {
    item.onApply({ x: worldPos.x, y: worldPos.y, hdg: 0 });
  }
  return true;
}

/**
 * Click-to-place road object / sign: pick nearest road, then place at
 * road-local s/t. Returns true if an object template was pending.
 */
export async function handlePlaceObjectClick(
  worldPos: { x: number; y: number },
  getVisibleProject: () => Project | null,
): Promise<boolean> {
  const viewState = useViewportStore.getState();
  if (!viewState.pendingObjectTemplateId) return false;
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
  return true;
}
