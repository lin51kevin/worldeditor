/**
 * NPC-actor plugin — shared types.
 *
 * This plugin renders dynamic scenario actors (opponent vehicles, ego, waypoint
 * handles, trigger volumes) as simple oriented bounding boxes plus their
 * trajectory polylines, and resolves picking against those boxes. It is fully
 * self-contained: pure geometry + math, no WebGPU or renderer dependencies, so
 * it can be unit-tested and reused independently of the viewport.
 */

/** RGBA color, each channel in [0, 1]. */
export type Rgba = [number, number, number, number];

/** An oriented bounding-box actor. */
export interface CaseActorBox {
  /** Stable identifier (host-defined; e.g. "el:<id>" or "wp:<id>:<index>"). */
  id: string;
  /** Role, so rendering/picking can weight handles above bodies. */
  kind: 'element' | 'waypoint' | 'trigger';
  /** World-space center [x, y, z] in meters. */
  position: [number, number, number];
  /** Heading around the world Z axis, in radians. */
  heading: number;
  /** Extents [length(x), width(y), height(z)] in meters. */
  size: [number, number, number];
  /** Fill color. */
  color: Rgba;
  /** Whether to render the selected/highlighted style. */
  selected?: boolean;
}

/** Number of floats per vertex in the renderer's basic pipeline (pos3 + rgba). */
export const ACTOR_VERTEX_STRIDE = 7;
