/**
 * useMinLineWidthSync — keeps the WASM-side minimum line width in sync with
 * the viewport's current zoom.
 *
 * MSAA is disabled for perf (see `rendererResources.ts`), so a single-sample
 * rasterizer can drop thin geometry (lane marks, crosswalk/hatch stripes, area
 * outlines, stop/yield lines — as little as ~0.1-0.45 m wide) once it shrinks
 * below one screen pixel at low zoom, leaving visible gaps in otherwise
 * continuous lines. This hook computes the minimum world-space width needed
 * to keep such geometry at least `MIN_LINE_PIXELS` wide on screen and pushes
 * it into WASM via `set_min_line_width_m`, then forces the affected mesh
 * layers to regenerate.
 */
import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { ViewportRenderer } from '../viewport/renderer';
import { getPlatformService } from '../services';

/** Target on-screen width (px) below which thin line/stripe geometry risks
 *  single-sample rasterizer coverage gaps. */
const MIN_LINE_PIXELS = 1.5;

/** Debounce so a continuous zoom gesture doesn't re-tessellate every frame —
 *  only the last bucket crossing within this window triggers a regen. */
const DEBOUNCE_MS = 200;

interface UseMinLineWidthSyncParams {
  rendererRef: MutableRefObject<ViewportRenderer | null>;
  status: 'loading' | 'ready' | 'unsupported';
  /** Forces the object + line mesh layers to regenerate (see useViewportMeshes). */
  notifyScaleChanged: () => Promise<void>;
}

export function useMinLineWidthSync({ rendererRef, status, notifyScaleChanged }: UseMinLineWidthSyncParams): void {
  const lastBucketRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status !== 'ready') return;
    const renderer = rendererRef.current;
    if (!renderer) return;

    const apply = async (mpp: number) => {
      try {
        const service = await getPlatformService();
        await service.setMinLineWidthM(MIN_LINE_PIXELS * mpp);
        await notifyScaleChanged();
      } catch (err) {
        console.error('[Viewport] Failed to sync minimum line width:', err);
      }
    };

    // Bucketed by log2(mpp) so only a ~1.4x+ zoom change triggers a regen,
    // keeping this cheap during continuous scroll-zoom.
    const bucketOf = (mpp: number) => Math.round(Math.log2(Math.max(mpp, 1e-6)));

    const schedule = (mpp: number) => {
      const bucket = bucketOf(mpp);
      if (bucket === lastBucketRef.current) return;
      lastBucketRef.current = bucket;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void apply(mpp);
      }, DEBOUNCE_MS);
    };

    // Seed immediately (no debounce) so the first mesh generation already
    // uses the right width instead of waiting for a subsequent zoom change.
    const initialMpp = renderer.getMetersPerPixel();
    lastBucketRef.current = bucketOf(initialMpp);
    void apply(initialMpp);

    renderer.setLineWidthScaleCallback(({ mpp }) => schedule(mpp));

    return () => {
      renderer.setLineWidthScaleCallback(null);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [rendererRef, status, notifyScaleChanged]);
}
