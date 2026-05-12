/**
 * Pure functions for tangent handle hit-testing and drag computation.
 *
 * These are extracted from ViewportRenderer so they can be tested without WebGPU.
 * The renderer calls these during mouse events to implement Phase 1.8
 * (click/drag tangent vectors).
 */

export type ControlPointRef = { index: number; type: 'knot' | 'in' | 'out' };

export interface ControlPointWorldPos {
  ref: ControlPointRef;
  /** World-space X. */
  wx: number;
  /** World-space Y. */
  wy: number;
}

/** Scale factor used to position handles relative to knots (matches renderer). */
const HANDLE_SCALE_MAX = 0.3;
const HANDLE_CLAMP_DIST = 4.0; // handle never placed more than 4m from knot when tangent is small

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
 * Compute the display scale factor for a tangent vector of length `tLen`.
 * Mirrors the renderer: scale = min(HANDLE_CLAMP_DIST / tLen, HANDLE_SCALE_MAX).
 */
export function computeHandleScale(tLen: number): number {
  if (tLen < 1e-6) return HANDLE_SCALE_MAX;
  return Math.min(HANDLE_CLAMP_DIST / tLen, HANDLE_SCALE_MAX);
}

/**
 * Compute world-space positions of all control points (knots + tangent handles).
 * Returns positions for knots and, when there are ≥2 knots, 'in'+'out' handles.
 */
export function computeControlPointPositions(
  knots: ReadonlyArray<readonly [number, number, number]>,
  tangentOverrides: Readonly<Record<number, readonly [number, number, number]>>,
): ControlPointWorldPos[] {
  const result: ControlPointWorldPos[] = [];

  for (let i = 0; i < knots.length; i++) {
    const [kx, ky] = knots[i]!;
    result.push({ ref: { index: i, type: 'knot' }, wx: kx, wy: ky });

    if (knots.length >= 2) {
      const [tvx, tvy] = computeTangentAt(i, knots, tangentOverrides);
      const tLen = Math.hypot(tvx, tvy);
      if (tLen >= 1e-6) {
        const scale = computeHandleScale(tLen);
        result.push({ ref: { index: i, type: 'out' }, wx: kx + tvx * scale, wy: ky + tvy * scale });
        result.push({ ref: { index: i, type: 'in'  }, wx: kx - tvx * scale, wy: ky - tvy * scale });
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
 * Compute a new tangent override for knot `ref.index` after dragging
 * the handle to world position (newWx, newWy).
 *
 * The sign is flipped for 'in' handles (they are the mirror of 'out').
 * Returns the updated tangentOverrides map (immutable — does not mutate input).
 */
export function applyHandleDrag(
  ref: ControlPointRef,
  newWx: number,
  newWy: number,
  knots: ReadonlyArray<readonly [number, number, number]>,
  tangentOverrides: Readonly<Record<number, readonly [number, number, number]>>,
): Record<number, [number, number, number]> {
  const knot = knots[ref.index];
  if (!knot || ref.type === 'knot') return { ...tangentOverrides } as Record<number, [number, number, number]>;

  const kx = knot[0], ky = knot[1];
  // Delta from knot to new handle position
  const dx = newWx - kx;
  const dy = newWy - ky;

  // Back-solve: handle = knot ± tangent * scale.
  // We treat scale=0.3 (the max) for an intuitive 1:1 drag feel.
  // This means dragging the handle 0.3m from the knot sets |tangent|=1m.
  const sign = ref.type === 'out' ? 1.0 : -1.0;
  const newTx = (dx * sign) / HANDLE_SCALE_MAX;
  const newTy = (dy * sign) / HANDLE_SCALE_MAX;

  return {
    ...tangentOverrides,
    [ref.index]: [newTx, newTy, 0],
  } as Record<number, [number, number, number]>;
}
