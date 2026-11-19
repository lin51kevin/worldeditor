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
import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { ViewportRenderer } from '../viewport/renderer';
import { getPlatformService } from '../services';
import { createMinLineWidthSync } from '../viewport/minLineWidthSync';

interface UseMinLineWidthSyncParams {
  rendererRef: MutableRefObject<ViewportRenderer | null>;
  status: 'loading' | 'ready' | 'unsupported';
  /** Forces the object + line mesh layers to regenerate (see useViewportMeshes). */
  notifyScaleChanged: () => Promise<void>;
}

export function useMinLineWidthSync({ rendererRef, status, notifyScaleChanged }: UseMinLineWidthSyncParams): void {
  useEffect(() => {
    if (status !== 'ready') return;
    const renderer = rendererRef.current;
    if (!renderer) return;

    const apply = async (widthM: number) => {
      try {
        const service = await getPlatformService();
        await service.setMinLineWidthM(widthM);
        await notifyScaleChanged();
      } catch (err) {
        console.error('[Viewport] Failed to sync minimum line width:', err);
      }
    };

    const sync = createMinLineWidthSync((widthM) => void apply(widthM));
    // Seed immediately (no debounce) so the first mesh generation already
    // uses the right width instead of waiting for a subsequent zoom change.
    sync.seed(renderer.getLineMetersPerPixel());
    renderer.setLineWidthScaleCallback(({ mpp }) => sync.update(mpp));

    return () => {
      renderer.setLineWidthScaleCallback(null);
      sync.dispose();
    };
  }, [rendererRef, status, notifyScaleChanged]);
}
