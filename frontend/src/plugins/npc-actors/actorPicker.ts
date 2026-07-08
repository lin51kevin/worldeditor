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
