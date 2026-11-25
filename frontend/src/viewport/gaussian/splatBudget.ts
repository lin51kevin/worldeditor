/**
 * Interactive splat budget: while the camera moves, the GPU sort thins small
 * on-screen splats so the visible count stays near a budget; a settled camera
 * re-sorts at full quality. This is the feedback controller for the thinning
 * threshold `tau` (pixels) — see `splat_thinned` in `splatCulling.ts`.
 */

/** Threshold used when thinning starts and the real splat-size distribution is still unknown. */
export const THIN_TAU_INITIAL = 2;
/** Above this size every splat is kept anyway, so a higher threshold gains nothing. */
export const THIN_TAU_MAX = 48;
/** Below this the threshold is dropped to zero (thinning off). */
const THIN_TAU_MIN = 0.5;
/** Count within this multiple of the budget needs no change. */
const OVER_BUDGET_TOLERANCE = 1.05;
/** Count under this fraction of the budget relaxes the threshold. */
const UNDER_BUDGET_FRACTION = 0.7;
/** Largest overshoot ratio one step reacts to. */
const MAX_STEP_RATIO = 4;
/** Damping of the multiplicative step, since kept count is not linear in tau. */
const STEP_EXPONENT = 0.8;
/** Shrink factor per step when under budget. */
const RELAX_FACTOR = 0.75;

/**
 * Next thinning threshold given the visible count measured under the current
 * one. `budget <= 0` disables thinning.
 */
export function nextThinTau(tau: number, visible: number, budget: number): number {
  if (budget <= 0) return 0;
  const ratio = visible / budget;
  if (ratio > OVER_BUDGET_TOLERANCE) {
    const base = tau > 0 ? tau : THIN_TAU_INITIAL;
    return Math.min(THIN_TAU_MAX, base * Math.min(ratio, MAX_STEP_RATIO) ** STEP_EXPONENT);
  }
  if (ratio < UNDER_BUDGET_FRACTION && tau > 0) {
    const relaxed = tau * RELAX_FACTOR;
    return relaxed < THIN_TAU_MIN ? 0 : relaxed;
  }
  return tau;
}
