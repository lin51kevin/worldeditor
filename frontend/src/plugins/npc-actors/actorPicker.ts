/**
 * NPC-actor picking.
 *
 * Resolves the top-most actor box whose ground footprint (an oriented rectangle
 * in the XY plane) contains a world-space point. Boxes are tested in reverse
 * insertion order so that later, smaller handles (e.g. waypoint cubes the host
 * appends after the body box) win over the larger body underneath them.
 */

import { CaseActorBox } from './actorTypes';

/**
 * True when (worldX, worldY) lies inside the box's oriented ground footprint
 * (an oriented rectangle in the XY plane, ignoring height).
 */
export function pointInBoxFootprint(box: CaseActorBox, worldX: number, worldY: number): boolean {
  const hl = box.size[0] / 2;
  const hw = box.size[1] / 2;
  const cos = Math.cos(box.heading);
  const sin = Math.sin(box.heading);
  const dx = worldX - box.position[0];
  const dy = worldY - box.position[1];
  // Rotate the point into the box's local frame (inverse heading).
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  return Math.abs(lx) <= hl && Math.abs(ly) <= hw;
}

/**
 * Return the id of the top-most box whose oriented footprint contains
 * (worldX, worldY), or null if none.
 */
export function pickActorAt(boxes: readonly CaseActorBox[], worldX: number, worldY: number): string | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const box = boxes[i]!;
    if (pointInBoxFootprint(box, worldX, worldY)) {
      return box.id;
    }
  }
  return null;
}

/**
 * Screen-space actor pick: project each box center to screen and return the id
 * of the box whose projection is nearest the click, within `thresholdPx`.
 *
 * Unlike {@link pickActorAt} (a ground-plane footprint test), this is robust to
 * camera tilt and to actors sitting above the ground plane — a grazing camera
 * would otherwise offset a ground-projected click far from the visible box — and
 * the pixel radius gives a forgiving target for small, moving vehicles. The
 * `project` callback receives the whole box so it can project the box center at
 * its true height (a ground-only projection drifts from the visible box as the
 * camera zooms). Later boxes (handles) win ties. `project` returns null for
 * points behind the camera.
 */
export function pickActorAtScreen(
  boxes: readonly CaseActorBox[],
  project: (box: CaseActorBox) => { x: number; y: number } | null,
  screenX: number,
  screenY: number,
  thresholdPx = 40,
): string | null {
  let bestId: string | null = null;
  let bestDistSq = thresholdPx * thresholdPx;
  for (let i = boxes.length - 1; i >= 0; i--) {
    const box = boxes[i]!;
    const p = project(box);
    if (!p) continue;
    const dx = p.x - screenX;
    const dy = p.y - screenY;
    const distSq = dx * dx + dy * dy;
    if (distSq <= bestDistSq) {
      bestDistSq = distSq;
      bestId = box.id;
    }
  }
  return bestId;
}
