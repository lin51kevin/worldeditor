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
  // Keep template selected for multi-placement (C# behaviour).
  // User cancels via right-click or ESC.
  try {
    const service = await getPlatformService();
    const visibleProject = getVisibleProject();
    if (visibleProject) {
      const { selectedRoadId } = useProjectStore.getState();
      let roadId: string | null = null;

      // Step 1: Pick the nearest road via spatial index (ground truth).
      const pickedId = await service.pickRoadAtPointCached(worldPos.x, worldPos.y, 10.0);

      if (pickedId) {
        const pickedRoad = visibleProject.roads.find((r) => r.id === pickedId);

        if (pickedRoad?.junction_id) {
          // Picked a junction connector — try to find the closest incoming
          // main road instead, since users usually intend to place on the
          // approach road rather than inside the junction.
          const junction = visibleProject.junctions.find((j) => j.id === pickedRoad.junction_id);
          if (junction) {
            const incomingIds = new Set(junction.connections.map((c) => c.incoming_road));
            let bestIncId: string | null = null;
            let bestAbsT = Infinity;
            const snapResults: Array<{ id: string; t: number; s: number; len: number }> = [];
            for (const incId of incomingIds) {
              const incRoad = visibleProject.roads.find((r) => r.id === incId);
              if (!incRoad) continue;
              try {
                const snap = await service.snapPointOnRoad(incRoad, worldPos.x, worldPos.y);
                snapResults.push({ id: incId, t: snap.t, s: snap.s, len: incRoad.length });
                // Reject if snap.s is clamped to road boundary — this means
                // the click is beyond the road's extent (projected to the endpoint).
                // A 2m tolerance accounts for segment projection rounding.
                const margin = 2.0;
                if (snap.s <= margin || snap.s >= incRoad.length - margin) {
                  continue; // click is outside this road's range
                }
                const absT = Math.abs(snap.t);
                if (absT < 10.0 && absT < bestAbsT) {
                  bestAbsT = absT;
                  bestIncId = incId;
                }
              } catch { /* skip */ }
            }
            console.debug('[PlaceObject] connector picked — junction=%s, chosen=%s',
              pickedRoad.junction_id, bestIncId ?? pickedId);
            roadId = bestIncId ?? pickedId;
          } else {
            roadId = pickedId;
          }
        } else {
          // Picked a normal (non-connector) road — use it directly.
          roadId = pickedId;
        }
      }

      // Step 2: If spatial index found nothing but a road is selected, use it
      // as a fallback (generous threshold for cases where the spatial index
      // has no nearby candidate but the user clearly intends the selected road).
      if (!roadId && selectedRoadId) {
        const selectedRoad = visibleProject.roads.find((r) => r.id === selectedRoadId);
        if (selectedRoad && !selectedRoad.junction_id) {
          try {
            const snap = await service.snapPointOnRoad(selectedRoad, worldPos.x, worldPos.y);
            if (Math.abs(snap.t) < 15.0) {
              roadId = selectedRoadId;
            }
          } catch { /* snap failed */ }
        }
      }

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
      } else {
        // No road found within pickup threshold — placement silently skipped.
      }
    }
  } catch (err) {
    console.error('[Viewport] Failed to place road object:', err);
  }
  return true;
}

// ── Polygon-draw mode for area-type road objects ────────────────────────────

/**
 * Handle left-click in line/polygon draw mode (C# style object creation).
 *
 * When the pending template has `drawMode === 'line'` or `'polygon'`, each
 * click adds a vertex. The first click also picks the target road. Returns
 * true when the click was consumed by multi-click drawing.
 */
export async function handleObjectDrawClick(
  worldPos: { x: number; y: number },
  getVisibleProject: () => Project | null,
): Promise<boolean> {
  const viewState = useViewportStore.getState();
  const templateId = viewState.pendingObjectTemplateId;
  if (!templateId) return false;

  // Check if the template uses a multi-click draw mode
  const allItems = usePluginContribStore.getState().templateSections.flatMap((s) => s.items);
  const item = allItems.find((i) => i.id === templateId);
  if (!item || (item.drawMode !== 'polygon' && item.drawMode !== 'line')) return false;

  // If we're already in polygon draw for a DIFFERENT template, cancel the old one
  if (viewState.objectDrawTemplateId && viewState.objectDrawTemplateId !== templateId) {
    viewState.clearObjectDraw();
  }

  const visibleProject = getVisibleProject();
  if (!visibleProject) return true;

  try {
    const service = await getPlatformService();
    let roadId = viewState.objectDrawRoadId;

    // First click: pick the target road
    if (!roadId) {
      const pickedId = await service.pickRoadAtPointCached(worldPos.x, worldPos.y, 10.0);
      if (!pickedId) return true; // no road nearby — ignore click

      const pickedRoad = visibleProject.roads.find((r) => r.id === pickedId);
      // If junction connector, find incoming main road (same logic as handlePlaceObjectClick)
      if (pickedRoad?.junction_id) {
        const junction = visibleProject.junctions.find((j) => j.id === pickedRoad.junction_id);
        if (junction) {
          const incomingIds = new Set(junction.connections.map((c) => c.incoming_road));
          let bestIncId: string | null = null;
          let bestAbsT = Infinity;
          for (const incId of incomingIds) {
            const incRoad = visibleProject.roads.find((r) => r.id === incId);
            if (!incRoad) continue;
            try {
              const snap = await service.snapPointOnRoad(incRoad, worldPos.x, worldPos.y);
              const margin = 2.0;
              if (snap.s <= margin || snap.s >= incRoad.length - margin) continue;
              const absT = Math.abs(snap.t);
              if (absT < 10.0 && absT < bestAbsT) {
                bestAbsT = absT;
                bestIncId = incId;
              }
            } catch { /* skip */ }
          }
          roadId = bestIncId ?? pickedId;
        } else {
          roadId = pickedId;
        }
      } else {
        roadId = pickedId;
      }

      viewState.setObjectDrawRoadId(roadId);
      viewState.setObjectDrawTemplateId(templateId);
    }

    // Snap clicked world position to road-local (s, t)
    const road = visibleProject.roads.find((r) => r.id === roadId);
    if (road) {
      const snap = await service.snapPointOnRoad(road, worldPos.x, worldPos.y);
      viewState.appendObjectDrawVertex([snap.s, snap.t, 0]);

      // Line mode auto-finalizes after 2 points (start + end)
      if (item.drawMode === 'line' && useViewportStore.getState().objectDrawVertices.length >= 2) {
        finalizeObjectDraw();
      }
    }
  } catch (err) {
    console.error('[Viewport] Object draw click failed:', err);
  }
  return true;
}

/**
 * Finalize line/polygon drawing: create the road object with accumulated corners.
 *
 * - **line** mode: requires ≥2 vertices (open polyline)
 * - **polygon** mode: requires ≥3 vertices (closed outline)
 *
 * Called on right-click. Returns true if drawing was finalized (or cancelled).
 */
export function finalizeObjectDraw(): boolean {
  const viewState = useViewportStore.getState();
  const { objectDrawVertices, objectDrawRoadId, objectDrawTemplateId } = viewState;

  if (!objectDrawTemplateId) return false;

  // Look up the template to determine the draw mode
  const allItems = usePluginContribStore.getState().templateSections.flatMap((s) => s.items);
  const item = allItems.find((i) => i.id === objectDrawTemplateId);
  const drawMode = item?.drawMode ?? 'polygon';
  const minVertices = drawMode === 'line' ? 2 : 3;

  if (objectDrawVertices.length >= minVertices && objectDrawRoadId && item) {
    // Compute centroid in road-frame for the object position
    let sumS = 0;
    let sumT = 0;
    for (const v of objectDrawVertices) {
      sumS += v[0];
      sumT += v[1];
    }
    const centroidS = sumS / objectDrawVertices.length;
    const centroidT = sumT / objectDrawVertices.length;

    const corners = objectDrawVertices.map((v) => ({
      x: v[0],
      y: v[1],
      z: v[2],
    }));

    item.onApply({
      roadId: objectDrawRoadId,
      x: centroidS,
      y: centroidT,
      hdg: 0,
      corners,
    });
  }

  // Clear draw state but keep template pending for next drawing
  viewState.clearObjectDraw();
  return true;
}

/**
 * Cancel line/polygon drawing without creating an object.
 * Returns true if there was a drawing in progress.
 */
export function cancelObjectDraw(): boolean {
  const viewState = useViewportStore.getState();
  if (viewState.objectDrawTemplateId) {
    viewState.clearObjectDraw();
    return true;
  }
  return false;
}
