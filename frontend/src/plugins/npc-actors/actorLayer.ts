/**
 * NPC-actor layer — stateful facade for the npc-actors plugin.
 *
 * Holds the current set of actor boxes and trajectory segments, produces the
 * renderer vertex buffers on demand, and answers ground picking. This is the
 * single object the SDK/viewport integration talks to; it keeps the plugin's
 * state isolated from renderer internals.
 */

import { buildBoxVertices, buildPathVertices } from './actorGeometry';
import { pickActorAt } from './actorPicker';
import { CaseActorBox } from './actorTypes';

/** Default trajectory ribbon half-width, meters. */
const DEFAULT_PATH_HALF_WIDTH = 0.25;

export class CaseActorLayer {
  private boxes: CaseActorBox[] = [];
  private segments: Float32Array = new Float32Array(0);
  private pathHalfWidth = DEFAULT_PATH_HALF_WIDTH;

  /** Replace the current actor boxes. */
  setBoxes(boxes: CaseActorBox[]): void {
    this.boxes = boxes;
  }

  /** Replace the trajectory segment list (flat pairs, 14 floats per segment). */
  setPathSegments(segments: Float32Array): void {
    this.segments = segments;
  }

  /** Set the trajectory ribbon half-width in meters. */
  setPathHalfWidth(halfWidth: number): void {
    if (halfWidth > 0 && isFinite(halfWidth)) this.pathHalfWidth = halfWidth;
  }

  /** Remove all actors and trajectories. */
  clear(): void {
    this.boxes = [];
    this.segments = new Float32Array(0);
  }

  /** Triangle vertices for the current boxes (7 floats/vertex). */
  boxVertices(): Float32Array {
    return buildBoxVertices(this.boxes);
  }

  /** Triangle vertices for the current trajectories (7 floats/vertex). */
  pathVertices(): Float32Array {
    return buildPathVertices(this.segments, this.pathHalfWidth);
  }

  /** Pick the top-most actor whose footprint contains the world point. */
  pickAt(worldX: number, worldY: number): string | null {
    return pickActorAt(this.boxes, worldX, worldY);
  }

  /** Number of boxes currently held (diagnostics/tests). */
  get boxCount(): number {
    return this.boxes.length;
  }
}
