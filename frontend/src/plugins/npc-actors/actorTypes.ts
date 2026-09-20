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
  /**
   * Role, so rendering/picking can weight handles above bodies.
   *
   * Non-box shapes, all used by editor manipulators:
   * - `'cone'`  — solid cone with its apex at local +X (translate-arm arrowhead).
   * - `'conez'` — the same cone with its axis along world +Z, since the local-X
   *   cone cannot point up (Z translate-arm arrowhead).
   * - `'sphere'`— solid low-poly UV sphere (rotation-pivot marker, gizmo hub).
   * - `'bar'`   — solid box in its literal colour: no edge bars and no fill
   *   dimming, unlike `'element'`/`'trigger'` (translate-arm shafts).
   */
  kind: 'element' | 'waypoint' | 'trigger' | 'cone' | 'conez' | 'sphere' | 'bar';
  /**
   * World-space center [x, y, z] in meters. For `'cone'`/`'conez'`, the base
   * center.
   */
  position: [number, number, number];
  /** Heading around the world Z axis, in radians. */
  heading: number;
  /**
   * Extents [length(x), width(y), height(z)] in meters. For `'cone'`/`'conez'`,
   * [axis length, base diameter, unused]. For `'sphere'`, [diameter, _, _].
   */
  size: [number, number, number];
  /** Fill color. */
  color: Rgba;
  /** Whether to render the selected/highlighted style. */
  selected?: boolean;
  /**
   * Draw on top of the whole scene with the depth test disabled.
   *
   * Editor manipulators (transform gizmos) must stay grabbable wherever they
   * are placed, so they may not be buried by the OpenDRIVE road surface, a
   * point cloud or the reconstructed Gaussian-splat scene.
   */
  overlay?: boolean;
}

/**
 * Look of the bounding-box actors, so an embedding host can match its own
 * design language instead of the editor's.
 *
 * Every field is optional; unset fields keep {@link DEFAULT_ACTOR_BOX_STYLE}.
 */
export interface ActorBoxStyle {
  /** Fill colour of a selected actor (its alpha comes from the box's colour). */
  selectedFill: Rgba;
  /** Fill opacity multiplier for a selected boxed actor. */
  selectedFillAlpha: number;
  /** Fill opacity multiplier for an unselected boxed actor. */
  fillAlpha: number;
  /** Colour of the 12 wireframe edge bars. */
  edgeColor: Rgba;
  /** Edge bar colour when the actor is selected. */
  selectedEdgeColor: Rgba;
  /** Half-thickness of an edge bar, meters. */
  edgeHalf: number;
  /** Edge bar thickness multiplier when the actor is selected. */
  selectedEdgeGain: number;
  /** Shape of a `'waypoint'` handle: a crisp cube or a round dot. */
  waypointShape: 'cube' | 'sphere';
}

/** Number of floats per vertex in the renderer's basic pipeline (pos3 + rgba). */
export const ACTOR_VERTEX_STRIDE = 7;

/** Editor-default actor look: wine-red selection, white wireframe, cube handles. */
export const DEFAULT_ACTOR_BOX_STYLE: ActorBoxStyle = {
  selectedFill: [0.62, 0.12, 0.2, 1],
  selectedFillAlpha: 0.75,
  fillAlpha: 0.5,
  edgeColor: [1, 1, 1, 1],
  selectedEdgeColor: [1, 1, 1, 1],
  edgeHalf: 0.02,
  selectedEdgeGain: 1,
  waypointShape: 'cube',
};
