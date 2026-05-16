/**
 * Pure functions for tangent handle hit-testing and drag computation.
 *
 * These are extracted from ViewportRenderer so they can be tested without WebGPU.
 * The renderer calls these during mouse events to implement Phase 1.8
 * (click/drag tangent vectors).
 */

import type { TangentCoupling } from '../stores/viewportStore';

export type ControlPointRef = { index: number; type: 'knot' | 'in' | 'out' };

export interface ControlPointWorldPos {
  ref: ControlPointRef;
  /** World-space X. */
  wx: number;
  /** World-space Y. */
  wy: number;
}

/** Axis constraint applied during tangent handle dragging. */
export type DragConstraint = 'none' | 'horizontal' | 'vertical';

/**
 * Minimum display distance (meters) from knot to handle.
 * Prevents handles from collapsing to an invisible size.
 */
const HANDLE_DISPLAY_MIN = 0.5;

/**
 * Maximum display distance (meters) from knot to handle.
 * Prevents handles from extending too far at low zoom.
 */
const HANDLE_DISPLAY_MAX = 60.0;

/**
 * Compute the Catmull-Rom tangent at knot `i`, with optional overrides.
 */
export function computeTangentAt(
  i: number,
  knots: ReadonlyArray<readonly [number, number, number]>,
  tangentOverrides: Readonly<Record<number, readonly [number, number, number]>>,
): [number, number, number] {
  const override = tangentOverrides[i];
  if (override) return [override[0], override[1], override[2]];
  const n = knots.length;
  if (n <= 1) return [0, 0, 0];
  if (i === 0) {
    return [knots[1]![0] - knots[0]![0], knots[1]![1] - knots[0]![1], knots[1]![2] - knots[0]![2]];
  }
  if (i === n - 1) {
    return [
      knots[n - 1]![0] - knots[n - 2]![0],
      knots[n - 1]![1] - knots[n - 2]![1],
      knots[n - 1]![2] - knots[n - 2]![2],
    ];
  }
  return [
    0.5 * (knots[i + 1]![0] - knots[i - 1]![0]),
    0.5 * (knots[i + 1]![1] - knots[i - 1]![1]),
    0.5 * (knots[i + 1]![2] - knots[i - 1]![2]),
  ];
}

/**
 * Compute the display scale factor for a tangent vector.
 *
 * The handle is placed at `knot + tangent * scale` in world space.
 * Uses a camera-adaptive scale so handles stay a reasonable screen size:
 *   displayDist = clamp(|tangent| * baseFactor, MIN, MAX)
 *   scale = displayDist / |tangent|
 *
 * @param tLen Length of the tangent vector.
 * @param mpp Meters per pixel (camera zoom level).
 */
export function computeHandleScale(tLen: number, mpp: number = 1): number {
  if (tLen < 1e-6) return 0;
  // Target display distance scales with viewport — ~80 screen pixels
  const targetDist = Math.max(80 * mpp, HANDLE_DISPLAY_MIN);
  const clamped = Math.min(targetDist, HANDLE_DISPLAY_MAX);
  return clamped / tLen;
}

/**
 * Compute world-space positions of all control points (knots + tangent handles).
 * Returns positions for knots and, when there are ≥2 knots, 'in'+'out' handles.
 *
 * @param tangentInOverrides Independent in-tangent overrides (broken tangent mode).
 *   When a knot has an entry here, its 'in' handle uses this direction instead
 *   of mirroring the 'out' tangent.
 * @param mpp Meters per pixel for camera-adaptive handle placement.
 */
export function computeControlPointPositions(
  knots: ReadonlyArray<readonly [number, number, number]>,
  tangentOverrides: Readonly<Record<number, readonly [number, number, number]>>,
  tangentInOverrides?: Readonly<Record<number, readonly [number, number, number]>>,
  mpp: number = 1,
): ControlPointWorldPos[] {
  const result: ControlPointWorldPos[] = [];

  for (let i = 0; i < knots.length; i++) {
    const [kx, ky] = knots[i]!;
    result.push({ ref: { index: i, type: 'knot' }, wx: kx, wy: ky });

    if (knots.length >= 2) {
      const [tvx, tvy] = computeTangentAt(i, knots, tangentOverrides);
      const tLen = Math.hypot(tvx, tvy);
      if (tLen >= 1e-6) {
        const scale = computeHandleScale(tLen, mpp);
        // 'out' handle: knot + tangent * scale
        result.push({ ref: { index: i, type: 'out' }, wx: kx + tvx * scale, wy: ky + tvy * scale });

        // 'in' handle: use independent in-tangent if available (broken mode)
        const inOverride = tangentInOverrides?.[i];
        if (inOverride) {
          const [ix, iy] = inOverride;
          const iLen = Math.hypot(ix, iy);
          if (iLen >= 1e-6) {
            const iScale = computeHandleScale(iLen, mpp);
            // In-tangent points backward: knot - inTangent * scale
            result.push({ ref: { index: i, type: 'in' }, wx: kx - ix * iScale, wy: ky - iy * iScale });
          } else {
            result.push({ ref: { index: i, type: 'in' }, wx: kx - tvx * scale, wy: ky - tvy * scale });
          }
        } else {
          // Mirror mode: in = -out
          result.push({ ref: { index: i, type: 'in' }, wx: kx - tvx * scale, wy: ky - tvy * scale });
        }
      }
    }
  }

  return result;
}

/**
 * Pick the nearest control point within `thresholdMeters` of world position (wx, wy).
 * Knots take priority over handles.
 * Returns null if none found within threshold.
 */
export function pickControlPoint(
  wx: number,
  wy: number,
  positions: ControlPointWorldPos[],
  thresholdMeters: number,
): ControlPointRef | null {
  // Two passes: prefer knots over handles
  let bestRef: ControlPointRef | null = null;
  let bestDist = Infinity;

  for (const cp of positions) {
    if (cp.ref.type !== 'knot') continue;
    const d = Math.hypot(cp.wx - wx, cp.wy - wy);
    if (d < thresholdMeters && d < bestDist) {
      bestDist = d;
      bestRef = cp.ref;
    }
  }
  if (bestRef) return bestRef;

  for (const cp of positions) {
    if (cp.ref.type === 'knot') continue;
    const d = Math.hypot(cp.wx - wx, cp.wy - wy);
    if (d < thresholdMeters && d < bestDist) {
      bestDist = d;
      bestRef = cp.ref;
    }
  }
  return bestRef;
}

/**
 * Apply an axis constraint to a displacement vector.
 * When `constraint` is 'horizontal', dy is zeroed; 'vertical' zeros dx.
 */
export function applyConstraint(dx: number, dy: number, constraint: DragConstraint): [number, number] {
  if (constraint === 'none') return [dx, dy];
  if (constraint === 'horizontal') return [dx, 0];
  return [0, dy];
}

/**
 * Determine axis constraint from Shift key: pick the dominant axis.
 */
export function inferConstraint(dx: number, dy: number, shiftKey: boolean): DragConstraint {
  if (!shiftKey) return 'none';
  return Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
}

/**
 * Compute new tangent override(s) for knot `ref.index` after dragging
 * the handle to world position (newWx, newWy).
 *
 * Returns `{ out, in? }`:
 * - `out`: updated out-tangent override (always set on drag)
 * - `in`: updated in-tangent override (only set in 'broken' coupling mode when dragging 'in')
 *
 * The tangent magnitude equals the distance from the knot to the handle
 * position, giving direct control over curve tension.
 */
export function applyHandleDrag(
  ref: ControlPointRef,
  newWx: number,
  newWy: number,
  knots: ReadonlyArray<readonly [number, number, number]>,
  tangentOverrides: Readonly<Record<number, readonly [number, number, number]>>,
  tangentInOverrides: Readonly<Record<number, readonly [number, number, number]>>,
  coupling: TangentCoupling = 'mirror',
  constraint: DragConstraint = 'none',
): { out: Record<number, [number, number, number]>; in_: Record<number, [number, number, number]> } {
  const knot = knots[ref.index];
  if (!knot || ref.type === 'knot') {
    return {
      out: { ...tangentOverrides } as Record<number, [number, number, number]>,
      in_: { ...tangentInOverrides } as Record<number, [number, number, number]>,
    };
  }

  const kx = knot[0], ky = knot[1];
  let dx = newWx - kx;
  let dy = newWy - ky;
  [dx, dy] = applyConstraint(dx, dy, constraint);

  const outOverrides = { ...tangentOverrides } as Record<number, [number, number, number]>;
  const inOverrides = { ...tangentInOverrides } as Record<number, [number, number, number]>;

  if (ref.type === 'out') {
    // Out-tangent: direction = delta from knot, magnitude = distance
    outOverrides[ref.index] = [dx, dy, 0];
    if (coupling === 'mirror') {
      // Mirror: clear any independent in-tangent for this knot
      delete inOverrides[ref.index];
    }
  } else {
    // In-tangent: handle position = knot - inTangent * scale
    // So inTangent direction is -(delta), but we store the actual
    // outgoing direction vector: tangent = -delta  (flipped)
    if (coupling === 'broken') {
      // Broken mode: only update the in-tangent independently
      inOverrides[ref.index] = [-dx, -dy, 0];
    } else {
      // Mirror mode: in drag updates the out tangent (mirrored)
      outOverrides[ref.index] = [-dx, -dy, 0];
      delete inOverrides[ref.index];
    }
  }

  return { out: outOverrides, in_: inOverrides };
}
