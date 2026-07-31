/**
 * Pure geometric constraints applied while drawing roads.
 *
 * These helpers are UI-framework agnostic so they can be unit-tested in
 * isolation and reused by any draw-mode hook (spline, arc, spiral).
 */

/** Default angular increment (degrees) used when angle-snapping is active. */
export const DEFAULT_ANGLE_SNAP_STEP_DEG = 15;

/**
 * Snap `cur` so the segment `prev → cur` aligns to the nearest multiple of
 * `stepDeg` degrees, preserving the segment length.
 *
 * Returns `cur` unchanged when it coincides with `prev`.
 */
export function snapAngleFromPrev(
  prev: readonly [number, number],
  cur: readonly [number, number],
  stepDeg: number = DEFAULT_ANGLE_SNAP_STEP_DEG,
): [number, number] {
  const dx = cur[0] - prev[0];
  const dy = cur[1] - prev[1];
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-9) return [cur[0], cur[1]];

  const stepRad = (stepDeg * Math.PI) / 180;
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / stepRad) * stepRad;
  return [prev[0] + Math.cos(snapped) * dist, prev[1] + Math.sin(snapped) * dist];
}
