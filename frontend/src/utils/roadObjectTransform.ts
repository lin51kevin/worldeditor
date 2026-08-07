import type { RoadObjectItem } from '../services/platform';

/**
 * Transform helpers for placed road objects (markings, props, signs).
 *
 * A road object's footprint can be described two ways, and they react to
 * position/heading edits very differently:
 *
 * - `cornerLocal` (or no corners): the outline is relative to `position`/`hdg`,
 *   so editing those fields moves and rotates the object for free.
 * - `cornerRoad`: every corner is an absolute `(s, t)` road-frame station, so
 *   the renderer ignores `position`/`hdg` entirely. Corners have to be
 *   transformed explicitly or the object appears frozen in place.
 *
 * Every edit path (viewport drag, move/rotate mode, property panel) goes
 * through these helpers so both representations behave identically.
 */

/** True when the object's outline is stored as absolute road-frame `(s, t)` corners. */
export function hasRoadFrameCorners(obj: RoadObjectItem): boolean {
  return obj.corner_type === 'Road' && obj.corners.length > 0;
}

/**
 * True when the outline is fixed by an explicit corner list, which makes
 * `length`/`width` purely informational for that object.
 */
export function hasCornerFootprint(obj: RoadObjectItem): boolean {
  return obj.corners.length >= 2;
}

/** Move an object to road-frame station `s` and lateral offset `t`. */
export function moveRoadObjectTo(obj: RoadObjectItem, s: number, t: number): RoadObjectItem {
  const ds = s - obj.position.x;
  const dt = t - obj.position.y;
  if (ds === 0 && dt === 0) {
    return obj;
  }
  return {
    ...obj,
    position: { ...obj.position, x: s, y: t },
    corners: hasRoadFrameCorners(obj)
      ? obj.corners.map((corner) => ({ ...corner, x: corner.x + ds, y: corner.y + dt }))
      : obj.corners,
  };
}

/** Set an object's heading (radians, relative to the road direction). */
export function rotateRoadObjectTo(obj: RoadObjectItem, hdg: number): RoadObjectItem {
  const delta = hdg - obj.hdg;
  if (delta === 0) {
    return obj;
  }
  const rotated = { ...obj, hdg };
  if (!hasRoadFrameCorners(obj)) {
    return rotated;
  }
  const cos = Math.cos(delta);
  const sin = Math.sin(delta);
  const { x: cx, y: cy } = obj.position;
  return {
    ...rotated,
    corners: obj.corners.map((corner) => {
      const dx = corner.x - cx;
      const dy = corner.y - cy;
      return { ...corner, x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
    }),
  };
}

/** Apply a move and a rotation in one step, keeping corner data consistent. */
export function transformRoadObject(
  obj: RoadObjectItem,
  s: number,
  t: number,
  hdg: number,
): RoadObjectItem {
  return rotateRoadObjectTo(moveRoadObjectTo(obj, s, t), hdg);
}

/** Replace an object inside a road's `objects` list, leaving the rest untouched. */
export function replaceRoadObject<T extends { objects?: RoadObjectItem[] }>(
  road: T,
  objectId: string,
  transform: (obj: RoadObjectItem) => RoadObjectItem,
): T {
  const objects = road.objects;
  if (!objects?.some((obj) => obj.id === objectId)) {
    return road;
  }
  return {
    ...road,
    objects: objects.map((obj) => (obj.id === objectId ? transform(obj) : obj)),
  };
}
