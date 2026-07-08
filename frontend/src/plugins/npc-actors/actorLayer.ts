/**
 * NPC-actor layer — stateful facade for the npc-actors plugin.
 *
 * Holds the current set of actor boxes and trajectory segments, produces the
 * renderer vertex buffers on demand, and answers ground picking. This is the
 * single object the SDK/viewport integration talks to; it keeps the plugin's
 * state isolated from renderer internals.
 */

import { buildBoxVertices, buildPathVertices } from './actorGeometry';
import { pickActorAt, pointInBoxFootprint } from './actorPicker';
import { CaseActorBox } from './actorTypes';

/** Default trajectory ribbon half-width, meters. */
const DEFAULT_PATH_HALF_WIDTH = 0.25;

export class CaseActorLayer {
  private boxes: CaseActorBox[] = [];
  private segments: Float32Array = new Float32Array(0);
  private pathHalfWidth = DEFAULT_PATH_HALF_WIDTH;
  // Scene render origin adopted from the loaded point cloud (road mesh). Boxes
  // and paths are authored in absolute coords; the point cloud renders in an
  // origin-relative frame, so we subtract this origin at vertex-build time to
  // align both. Ground picks arrive in the render frame, so the origin is added
  // back before hit-testing the absolute footprints.
  private sceneOrigin: [number, number, number] = [0, 0, 0];

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

  /**
   * Adopt the point cloud's render origin so authored (absolute) actors and
   * paths render in the same origin-relative frame as the road mesh.
   */
  setSceneOrigin(origin: readonly [number, number, number]): void {
    this.sceneOrigin = [origin[0], origin[1], origin[2]];
  }

  /** Current scene render origin (diagnostics). */
  getSceneOrigin(): [number, number, number] {
    return [this.sceneOrigin[0], this.sceneOrigin[1], this.sceneOrigin[2]];
  }

  /** Remove all actors and trajectories. */
  clear(): void {
    this.boxes = [];
    this.segments = new Float32Array(0);
  }

  /** Triangle vertices for the current boxes (7 floats/vertex). */
  boxVertices(): Float32Array {
    return buildBoxVertices(this.boxes, this.sceneOrigin);
  }

  /** Triangle vertices for the current trajectories (7 floats/vertex). */
  pathVertices(): Float32Array {
    return buildPathVertices(this.segments, this.pathHalfWidth, this.sceneOrigin);
  }

  /**
   * Pick the top-most actor whose footprint contains the world point. The point
   * arrives in the origin-relative render frame (from `unprojectToGround`), so
   * the scene origin is added back to compare against the absolute footprints.
   */
  pickAt(worldX: number, worldY: number): string | null {
    return pickActorAt(this.boxes, worldX + this.sceneOrigin[0], worldY + this.sceneOrigin[1]);
  }

  /**
   * Pick the top-most actor under a screen-space ray, height-aware.
   *
   * Ground picking (`pickAt`) intersects the click ray with the Z=0 plane, so in
   * the 3D perspective view an elevated box is hit where its ground shadow falls
   * — several meters off from where the box visually appears, making it hard to
   * click. Here, for each box (reverse insertion order), the ray is intersected
   * with the horizontal plane at that box's own centre height, so the hit test
   * runs where the box actually is on screen.
   *
   * `unprojectAtZ(worldZ)` returns the render-frame XY where the click ray meets
   * the plane z = worldZ (or null when the ray misses it). Picks arrive in the
   * origin-relative render frame, so the scene origin is added back before
   * comparing against the absolute footprints.
   */
  pickAtScreen(unprojectAtZ: (worldZ: number) => { x: number; y: number } | null): string | null {
    for (let i = this.boxes.length - 1; i >= 0; i--) {
      const box = this.boxes[i]!;
      const renderZ = box.position[2] - this.sceneOrigin[2];
      const hit = unprojectAtZ(renderZ);
      if (!hit) continue;
      if (pointInBoxFootprint(box, hit.x + this.sceneOrigin[0], hit.y + this.sceneOrigin[1])) {
        return box.id;
      }
    }
    return null;
  }

  /** Number of boxes currently held (diagnostics/tests). */
  get boxCount(): number {
    return this.boxes.length;
  }
}
