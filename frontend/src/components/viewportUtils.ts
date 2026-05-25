/**
 * Viewport utility functions — extracted from Viewport.tsx.
 *
 * Contains pure constants, types, and stateless helper functions used by the
 * Viewport component and related viewport modules.
 */

import { computeControlPointPositions } from '../viewport/tangentHandleController';
import type { EditableSpline, Junction, Project, Road, SplineKnot } from '../services/platform';
import { genId } from '../plugins/editing/templates/engine';

// ── Constants ──────────────────────────────────────────────────────────────

export const DRAG_THRESHOLD_SQ = 9;
export const HOVER_HIGHLIGHT_COLOR: [number, number, number, number] = [0.2, 0.8, 1.0, 1.0];
export const SELECT_HIGHLIGHT_COLOR: [number, number, number, number] = [1.0, 0.76, 0.0, 1.0];
export const MULTI_SELECT_HIGHLIGHT_COLOR: [number, number, number, number] = [1.0, 0.55, 0.0, 1.0];
export const PREDECESSOR_HIGHLIGHT_COLOR: [number, number, number, number] = [0.2, 0.6, 1.0, 0.75];
export const SUCCESSOR_HIGHLIGHT_COLOR: [number, number, number, number] = [0.2, 1.0, 0.4, 0.75];
export const GRID_COLOR: [number, number, number, number] = [0.35, 0.35, 0.35, 0.5];
export const AXIS_COLOR_X: [number, number, number, number] = [0.9, 0.3, 0.3, 1.0];
export const AXIS_COLOR_Y: [number, number, number, number] = [0.3, 0.9, 0.3, 1.0];
export const HOVER_HIGHLIGHT_Z_LIFT = 0.03;
export const LINK_HIGHLIGHT_Z_LIFT = 0.02;

// ── Types ─────────────────────────────────────────────────────────────────

export interface MouseGestureState {
  button: number;
  startX: number;
  startY: number;
  dragged: boolean;
}

export interface MoveRotateDragState {
  mode: 'move-road' | 'rotate-road';
  roadId: string;
  startWorldX: number;
  startWorldY: number;
  /** Road geometry centroid — rotation pivot for rotate-road mode. */
  centroidX: number;
  centroidY: number;
  /** Accumulated delta / angle written on each mousemove and committed on mouseup. */
  currentDx: number;
  currentDy: number;
  currentAngle: number;
}

export interface SplineControlPoint {
  index: number;
  type: 'knot' | 'in' | 'out';
}

// ── Utility functions ──────────────────────────────────────────────────────

export function mergeFloat32Arrays(a: Float32Array, b: Float32Array): Float32Array {
  if (b.length === 0) return a;
  if (a.length === 0) return b;
  const merged = new Float32Array(a.length + b.length);
  merged.set(a, 0);
  merged.set(b, a.length);
  return merged;
}

/** Raise mesh vertices along Z to avoid coplanar depth fighting with road surfaces. */
export function liftMeshZ(vertices: Float32Array, zLift: number): Float32Array {
  if (vertices.length === 0) return vertices;
  const lifted = new Float32Array(vertices);
  for (let index = 2; index < lifted.length; index += 7) {
    lifted[index] = (lifted[index] ?? 0) + zLift;
  }
  return lifted;
}

export function exceededDragThreshold(startX: number, startY: number, clientX: number, clientY: number): boolean {
  const dx = clientX - startX;
  const dy = clientY - startY;
  return dx * dx + dy * dy > DRAG_THRESHOLD_SQ;
}

export function makeSplineKnot(position: [number, number, number], s: number): SplineKnot {
  return {
    position,
    tangent_in: [0, 0, 0],
    tangent_out: [0, 0, 0],
    s,
    knot_type: 'Key',
    tangent_mode: 'Auto',
  };
}

export function buildEditableSpline(points: Array<[number, number, number]>): EditableSpline {
  const knots: SplineKnot[] = [];
  let station = 0;
  for (let i = 0; i < points.length; i += 1) {
    if (i > 0) {
      const prev = points[i - 1]!;
      const curr = points[i]!;
      const dx = curr[0] - prev[0];
      const dy = curr[1] - prev[1];
      const dz = curr[2] - prev[2];
      station += Math.hypot(dx, dy, dz);
    }
    knots.push(makeSplineKnot(points[i]!, station));
  }
  if (knots.length > 0) {
    const firstKnot = knots[0]!;
    knots[0] = { ...firstKnot, knot_type: 'Anchor' };
  }
  if (knots.length > 1) {
    const last = knots.length - 1;
    const lastKnot = knots[last]!;
    knots[last] = { ...lastKnot, knot_type: 'Anchor' };
  }
  return { knots };
}

/** Check if any geometry point (start or estimated end) of a road falls within the AABB. */
export function roadIntersectsAABB(road: Road, minX: number, minY: number, maxX: number, maxY: number): boolean {
  for (const seg of road.plan_view) {
    if (seg.x >= minX && seg.x <= maxX && seg.y >= minY && seg.y <= maxY) return true;
    const endX = seg.x + Math.cos(seg.hdg) * seg.length;
    const endY = seg.y + Math.sin(seg.hdg) * seg.length;
    if (endX >= minX && endX <= maxX && endY >= minY && endY <= maxY) return true;
  }
  return false;
}

/** Check if any connecting road of a junction has geometry within the AABB. */
export function junctionIntersectsAABB(
  junc: Junction,
  project: Project,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  for (const conn of junc.connections) {
    const r1 = project.roads.find((r) => r.id === conn.connecting_road);
    if (r1 && roadIntersectsAABB(r1, minX, minY, maxX, maxY)) return true;
    const r2 = project.roads.find((r) => r.id === conn.incoming_road);
    if (r2 && roadIntersectsAABB(r2, minX, minY, maxX, maxY)) return true;
  }
  return false;
}

export function nextSplineRoadId(existingRoadIds: string[]): string {
  return genId(existingRoadIds);
}

/** Extract renderer-compatible knot positions and tangent overrides from an EditableSpline.
 *
 * Only knots with `tangent_mode === 'Manual'` contribute to `tangentOverrides`.
 * Auto knots are omitted so the frontend Catmull-Rom formula computes their
 * tangents from positions — matching what the Rust side produces.
 */
export function splineToRendererFormat(spline: EditableSpline): {
  knots: Array<[number, number, number]>;
  tangentOverrides: Record<number, [number, number, number]>;
} {
  const knots = spline.knots.map((k) => k.position);
  const tangentOverrides: Record<number, [number, number, number]> = {};
  for (let i = 0; i < spline.knots.length; i++) {
    const k = spline.knots[i]!;
    if (k.tangent_mode === 'Manual') {
      tangentOverrides[i] = k.tangent_out;
    }
  }
  return { knots, tangentOverrides };
}

export function tangentFromHandlePosition(
  knot: [number, number, number],
  worldPos: { x: number; y: number },
  type: 'in' | 'out',
): [number, number, number] {
  const dx = worldPos.x - knot[0];
  const dy = worldPos.y - knot[1];
  const length = Math.hypot(dx, dy);
  if (length <= 1e-6) {
    return [0, 0, 0];
  }
  return type === 'out'
    ? [dx / length, dy / length, 0]
    : [-dx / length, -dy / length, 0];
}

export function findSplineControlPointHit(
  worldPos: { x: number; y: number },
  knots: Array<[number, number, number]>,
  metersPerPixel: number,
  tangentOverrides?: Record<number, [number, number, number]>,
  allowHandles = true,
): SplineControlPoint | null {
  const knotHitSq = (8.0 * metersPerPixel) ** 2;
  const handleHitSq = (6.0 * metersPerPixel) ** 2;
  let bestDistSq = Infinity;
  let bestHit: SplineControlPoint | null = null;

  for (let index = 0; index < knots.length; index += 1) {
    const knot = knots[index]!;
    const dx = worldPos.x - knot[0];
    const dy = worldPos.y - knot[1];
    const distSq = dx * dx + dy * dy;
    if (distSq < knotHitSq && distSq < bestDistSq) {
      bestDistSq = distSq;
      bestHit = { index, type: 'knot' };
    }
  }

  if (!allowHandles) {
    return bestHit;
  }

  // Use camera-adaptive handle positions matching what's actually rendered.
  const positions = computeControlPointPositions(knots, tangentOverrides ?? {}, undefined, metersPerPixel);
  for (const pos of positions) {
    if (pos.ref.type === 'knot') continue;
    const dx = worldPos.x - pos.wx;
    const dy = worldPos.y - pos.wy;
    const distSq = dx * dx + dy * dy;
    if (distSq < handleHitSq && distSq < bestDistSq) {
      bestDistSq = distSq;
      bestHit = { index: pos.ref.index, type: pos.ref.type };
    }
  }

  return bestHit;
}
