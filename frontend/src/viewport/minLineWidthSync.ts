/**
 * Zoom → minimum world-space line width, shared by the desktop viewport
 * (`useMinLineWidthSync`) and the rnk-next SDK adapter.
 *
 * MSAA is disabled (see `rendererResources.ts`), so thin geometry widened in
 * world space (crosswalk/hatch stripes, area outlines, stop lines) must stay at
 * least `MIN_LINE_PIXELS` wide on screen or the single-sample rasterizer drops
 * it. Regenerating that geometry is expensive, so mpp is bucketed and the
 * regeneration debounced.
 */

/** Target on-screen width (px) below which thin geometry risks coverage gaps. */
export const MIN_LINE_PIXELS = 1.5;

export const MIN_LINE_WIDTH_DEBOUNCE_MS = 200;

/** Half-octave bucket of a meters-per-pixel value (≈1.41x zoom per bucket). */
export function lineWidthBucket(mpp: number): number {
  return Math.round(2 * Math.log2(Math.max(mpp, 1e-6)));
}

/**
 * Width for a bucket, sized against the bucket's coarsest (largest) mpp so
 * every zoom level inside it renders at ≥ `MIN_LINE_PIXELS` (≤ ~2.1 px).
 */
export function minLineWidthForBucket(bucket: number): number {
  return MIN_LINE_PIXELS * 2 ** ((bucket + 0.5) / 2);
}

export interface MinLineWidthSync {
  /** Apply immediately (no debounce), e.g. before the first mesh generation. */
  seed(mpp: number): void;
  /** Report a new scale; applies after the debounce if the bucket changed. */
  update(mpp: number): void;
  dispose(): void;
}

export function createMinLineWidthSync(
  apply: (widthM: number) => void,
  debounceMs: number = MIN_LINE_WIDTH_DEBOUNCE_MS,
): MinLineWidthSync {
  let bucket: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return {
    seed(mpp) {
      cancel();
      bucket = lineWidthBucket(mpp);
      apply(minLineWidthForBucket(bucket));
    },
    update(mpp) {
      const next = lineWidthBucket(mpp);
      if (next === bucket) return;
      bucket = next;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        apply(minLineWidthForBucket(next));
      }, debounceMs);
    },
    dispose: cancel,
  };
}
