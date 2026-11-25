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

/** Smallest threshold (px) a held view uses; thinning splats below this is invisible. */
export const HELD_TAU_MIN = 0.02;
/** Largest single-step change of a held view's threshold. */
const HELD_MAX_STEP = 8;

/**
 * Threshold update for a held view (animation under a still camera), which can
 * only correct itself by re-sorting and so must converge in a few steps. The kept
 * count falls roughly with `tau²`, so the step is `sqrt(visible / budget)` — and
 * the threshold never reaches zero, because below about half a pixel a sub-pixel
 * scene jumps from a few percent kept to the whole cloud.
 */
export function nextHeldThinTau(tau: number, visible: number, budget: number): number {
  if (budget <= 0) return 0;
  const ratio = visible / budget;
  if (ratio <= OVER_BUDGET_TOLERANCE && ratio >= UNDER_BUDGET_FRACTION) return tau;
  const base = tau > 0 ? tau : THIN_TAU_INITIAL;
  const step = Math.min(HELD_MAX_STEP, Math.max(1 / HELD_MAX_STEP, Math.sqrt(ratio)));
  return Math.min(THIN_TAU_MAX, Math.max(HELD_TAU_MIN, base * step));
}
