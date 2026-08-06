/**
 * usePointCloudViewport — subscribes to the point cloud store and feeds
 * render-ready vertex data to the viewport renderer as point-list geometry.
 *
 * On web, the worker returns 7-float format directly (conversion off main thread).
 * On Tauri, raw 6-float bytes are received and converted here (small cost since
 * binary IPC is fast).
 */
import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { ViewportRenderer } from '../viewport/renderer';
import { usePointCloudStore } from '../plugins/gis-viz/pointcloud/pointcloudState';
import type { SplatBackground } from '../plugins/gis-viz/pointcloud/pointcloudState';
import { useThemeStore } from '../stores/themeStore';
import { getPlatformService } from '../services';
import { workerRenderBuffer7 } from '../workers/pointcloudBridge';
import {
  assertGaussianSplatBuffer,
} from '../viewport/gaussian/splatLayout';

const MAX_RENDER_POINTS = 2_000_000;

/** RGB (0..1) backdrop for each non-theme splat background preset. */
const SPLAT_BG_COLORS: Record<Exclude<SplatBackground, 'theme'>, [number, number, number]> = {
  gray: [0.5, 0.5, 0.53],
  white: [1, 1, 1],
  sky: [0.62, 0.68, 0.75],
};

/** Resolve the editor's theme viewport background from CSS custom properties. */
function themeClearColor(): [number, number, number] {
  try {
    const style = getComputedStyle(document.documentElement);
    const r = parseFloat(style.getPropertyValue('--color-viewport-clear-r')) || 0.10;
    const g = parseFloat(style.getPropertyValue('--color-viewport-clear-g')) || 0.10;
    const b = parseFloat(style.getPropertyValue('--color-viewport-clear-b')) || 0.12;
    return [r, g, b];
  } catch {
    return [0.10, 0.10, 0.12];
  }
}

/**
 * Shift an origin-relative point-cloud render buffer back into absolute world
 * coordinates so it aligns with OpenDRIVE road geometry (which is rendered in
 * raw planView coordinates, unshifted).
 *
 * The parser subtracts the cloud's first vertex (`summary.origin`) from every
 * point to preserve f32 precision near large global coordinates, so the render
 * buffer is origin-relative. Adding `origin` back places the cloud in the same
 * frame as the road. Mutates `vertices` in place (7-float stride: x,y,z,r,g,b,a).
 */
export function applyOrigin(vertices: Float32Array, origin: readonly [number, number, number] | undefined): void {
  if (!origin || (origin[0] === 0 && origin[1] === 0 && origin[2] === 0)) return;
  const [ox, oy, oz] = origin;
  for (let i = 0; i + 2 < vertices.length; i += 7) {
    vertices[i] = vertices[i]! + ox;
    vertices[i + 1] = vertices[i + 1]! + oy;
    vertices[i + 2] = vertices[i + 2]! + oz;
  }
}

/**
 * Shift an origin-relative packed 3DGS splat buffer into absolute world
 * coordinates so it aligns with OpenDRIVE road geometry, mirroring
 * {@link applyOrigin} for point-list clouds.
 *
 * The versioned buffer keeps position in the first 3 `u32` words as f32 bit
 * patterns. The declared layout is validated before any stride-based access.
 * Returns a shifted copy (the store buffer stays origin-relative and immutable)
 * or the input unchanged when `origin` is zero/undefined.
 */
export function applySplatOrigin(
  splatData: Uint32Array,
  shDegree: number,
  layoutVersion: number,
  origin: readonly [number, number, number] | undefined,
): Uint32Array {
  const stride = assertGaussianSplatBuffer(splatData, shDegree, layoutVersion);
  if (!origin || (origin[0] === 0 && origin[1] === 0 && origin[2] === 0)) return splatData;
  const [ox, oy, oz] = origin;
  const out = new Uint32Array(splatData);
  const f32 = new Float32Array(out.buffer, out.byteOffset, out.length);
  for (let i = 0; i + 2 < f32.length; i += stride) {
    f32[i] = f32[i]! + ox;
    f32[i + 1] = f32[i + 1]! + oy;
    f32[i + 2] = f32[i + 2]! + oz;
  }
  return out;
}

interface UsePointCloudViewportOptions {
  rendererRef: MutableRefObject<ViewportRenderer | null>;
  status: 'loading' | 'ready' | 'unsupported';
}

export function usePointCloudViewport({ rendererRef, status }: UsePointCloudViewportOptions): void {
  const prevHandleRef = useRef<number | null>(null);
  const prevColorModeRef = useRef<string | null>(null);
  const prevSampleModeRef = useRef<string | null>(null);
  const prevRenderModeRef = useRef<string | null>(null);
  const prevQualityRef = useRef<number | null>(null);
  // Splat buffer identity is the true cloud identity: native splats hardcode
  // handle 0 (and the WASM worker can reuse handles), so a handle-number match
  // does NOT mean the same cloud. Tracking the buffer reference prevents a
  // reloaded cloud from being skipped and leaving the previous cloud on screen.
  const prevSplatBufferRef = useRef<Uint32Array | null>(null);

  const handle = usePointCloudStore((s) => s.handle);
  const colorMode = usePointCloudStore((s) => s.colorMode);
  const isSplat = usePointCloudStore((s) => s.isSplat);
  const splatBuffer = usePointCloudStore((s) => s.splatBuffer);
  const splatOriginShifted = usePointCloudStore((s) => s.splatOriginShifted);
  const splatShDegree = usePointCloudStore((s) => s.splatShDegree);
  const splatLayoutVersion = usePointCloudStore((s) => s.splatLayoutVersion);
  const splatDilation = usePointCloudStore((s) => s.splatDilation);
  const splatEncodeLinearToSrgb = usePointCloudStore((s) => s.splatEncodeLinearToSrgb);
  const splatSampleMode = usePointCloudStore((s) => s.splatSampleMode);
  const splatRenderMode = usePointCloudStore((s) => s.splatRenderMode);
  const splatQuality = usePointCloudStore((s) => s.splatQuality);
  const splatRefreshFps = usePointCloudStore((s) => s.splatRefreshFps);
  const splatGpuSort = usePointCloudStore((s) => s.splatGpuSort);
  const splatBackground = usePointCloudStore((s) => s.splatBackground);
  const theme = useThemeStore((s) => s.theme);

  // Apply the live dilation (splat fullness) slider to the renderer.
  useEffect(() => {
    if (status !== 'ready' || !isSplat) return;
    rendererRef.current?.setSplatDilation(splatDilation);
  }, [splatDilation, isSplat, status, rendererRef]);

  // Apply the diagnostic linear-input encoding toggle to the renderer.
  useEffect(() => {
    if (status !== 'ready' || !isSplat) return;
    rendererRef.current?.setSplatLinearToSrgbEncoding(splatEncodeLinearToSrgb);
  }, [splatEncodeLinearToSrgb, isSplat, status, rendererRef]);

  // Apply the splat refresh-rate (re-sort) cap to the renderer.
  useEffect(() => {
    if (status !== 'ready' || !isSplat) return;
    rendererRef.current?.setSplatRefreshFps(splatRefreshFps);
  }, [splatRefreshFps, isSplat, status, rendererRef]);

  // Toggle the per-frame GPU compute depth sort (zero-latency ordering).
  useEffect(() => {
    if (status !== 'ready' || !isSplat) return;
    rendererRef.current?.setSplatGpuSort(splatGpuSort);
  }, [splatGpuSort, isSplat, status, rendererRef]);

  // Drive the viewport background from the splat preset while a splat cloud is
  // shown so sparse sky regions blend into the backdrop instead of reading as
  // black; restore the theme background once the splat is cleared. `theme` is a
  // dependency so a theme switch re-applies the correct colour either way.
  useEffect(() => {
    if (status !== 'ready') return;
    const renderer = rendererRef.current;
    if (!renderer) return;
    const [r, g, b] =
      isSplat && splatBackground !== 'theme'
        ? SPLAT_BG_COLORS[splatBackground]
        : themeClearColor();
    renderer.setClearColor(r, g, b);
  }, [splatBackground, isSplat, theme, status, rendererRef]);

  useEffect(() => {
    if (status !== 'ready') return;
    const renderer = rendererRef.current;
    if (!renderer) return;

    // Cloud unloaded — clear both point-list and splat renders.
    if (handle === null) {
      if (prevHandleRef.current !== null) {
        renderer.uploadPointCloudVertices(new Float32Array(0));
        // Fully tear down the splat renderer (not just clear) so the next load
        // recreates a pristine instance + sort worker, matching first-load state.
        renderer.disposeGaussianSplats();
        usePointCloudStore.getState().setSplatUploadStatus(null);
        prevHandleRef.current = null;
        prevColorModeRef.current = null;
        prevSampleModeRef.current = null;
        prevRenderModeRef.current = null;
        prevQualityRef.current = null;
        prevSplatBufferRef.current = null;
      }
      return;
    }

    // 3D Gaussian Splatting cloud — render as true splats (colorMode N/A).
    if (isSplat) {
      // Re-upload on a new cloud or when the sampling strategy / quality budget
      // changes (both decide which & how many splats survive the reduction).
      // Compare the buffer reference (not just the handle) so a reloaded cloud
      // that reuses the same handle number still counts as new.
      const isNewCloud =
        handle !== prevHandleRef.current ||
        splatBuffer !== prevSplatBufferRef.current;
      const changed =
        isNewCloud ||
        splatSampleMode !== prevSampleModeRef.current ||
        splatRenderMode !== prevRenderModeRef.current ||
        splatQuality !== prevQualityRef.current;
      if (!changed) return;

      // Drop any stale point geometry, then upload the packed splat buffer. The
      // quality/sample reduction happens inside uploadGaussianSplats (on the full
      // buffer) so the live quality slider keeps working. The origin shift was
      // already done off the main thread (web worker) or is applied here (native).
      renderer.uploadPointCloudVertices(new Float32Array(0));
      // On a genuinely new cloud, tear down any existing splat renderer first so
      // the upload below recreates a fresh instance + sort worker. This makes a
      // reload behave exactly like the first load (no retained/stale GPU or
      // worker state), fixing the reloaded-cloud render corruption and stutter.
      if (isNewCloud) {
        renderer.disposeGaussianSplats();
      }
      if (splatBuffer) {
        const origin = usePointCloudStore.getState().summary?.origin;
        const shifted = splatOriginShifted
          ? splatBuffer
          : applySplatOrigin(splatBuffer, splatShDegree, splatLayoutVersion, origin);
        const uploadStatus = renderer.uploadGaussianSplats(
          shifted,
          splatShDegree,
          splatLayoutVersion,
          splatSampleMode,
          splatQuality,
          splatRenderMode,
          usePointCloudStore.getState().summary?.count,
        );
        usePointCloudStore.getState().setSplatUploadStatus(uploadStatus);

        // Start 3DGS in perspective for useful initial framing. The splat shader
        // also has an orthographic Jacobian for later dimension-mode switches.
        if (isNewCloud) {
          const summary = usePointCloudStore.getState().summary;
          renderer.setDimension('3d');
          if (summary) {
            const [ox, oy] = summary.origin ?? [0, 0, 0];
            const minX = summary.min[0] + ox;
            const minY = summary.min[1] + oy;
            const maxX = summary.max[0] + ox;
            const maxY = summary.max[1] + oy;
            // Inflate the framed footprint by the cloud's vertical (Z) extent so
            // the camera backs off far enough to start OUTSIDE the cloud. Framing
            // by the XY box alone can place the camera inside a tall/deep capture,
            // where splats on the near plane explode into screen-spanning streaks.
            const zmin = summary.min[2];
            const zmax = summary.max[2];
            const dz =
              typeof zmin === 'number' && typeof zmax === 'number'
                ? Math.abs(zmax - zmin)
                : 0;
            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;
            const half = Math.max((maxX - minX) / 2, (maxY - minY) / 2, dz / 2);
            renderer.frameScene3D(cx - half, cy - half, cx + half, cy + half);
          }
        }
      }
      prevHandleRef.current = handle;
      prevSampleModeRef.current = splatSampleMode;
      prevRenderModeRef.current = splatRenderMode;
      prevQualityRef.current = splatQuality;
      prevSplatBufferRef.current = splatBuffer;
      prevColorModeRef.current = null;
      return;
    }

    // Skip if nothing changed
    if (handle === prevHandleRef.current && colorMode === prevColorModeRef.current) {
      return;
    }

    // Leaving a splat cloud (or a fresh point cloud) — ensure no splats linger.
    renderer.clearGaussianSplats();
    usePointCloudStore.getState().setSplatUploadStatus(null);

    const handleChanged = handle !== prevHandleRef.current;
    if (handleChanged) {
      // New cloud → drop the previous cloud's cached per-color-mode buffers.
      renderer.uploadPointCloudVertices(new Float32Array(0));
    } else if (renderer.hasPointCloudColorMode(colorMode)) {
      // Same cloud and this colour mode is already on the GPU → re-bind the
      // cached buffer instead of re-fetching + re-uploading (fixes the switch jank).
      renderer.showPointCloudColorMode(colorMode);
      prevColorModeRef.current = colorMode;
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const origin = usePointCloudStore.getState().summary?.origin;
        // Read the render buffer from the SAME backend that produced the handle.
        // A plain cloud loaded via the file-input path uses the WASM worker even
        // inside the Tauri webview, so branching on `isTauri()` here would query
        // the wrong (native) registry and fail with "invalid point cloud handle".
        const nativeBackend = usePointCloudStore.getState().nativeBackend;
        let vertices: Float32Array;
        if (nativeBackend) {
          // Native IPC returns 6-float format, convert here (fast after binary transfer)
          const service = await getPlatformService();
          const raw = await service.pointCloudRenderBuffer(handle, colorMode, MAX_RENDER_POINTS);
          if (cancelled) return;
          const pointCount = Math.floor(raw.length / 6);
          vertices = new Float32Array(pointCount * 7);
          for (let i = 0; i < pointCount; i++) {
            const s = i * 6, d = i * 7;
            vertices[d] = raw[s]!;
            vertices[d + 1] = raw[s + 1]!;
            vertices[d + 2] = raw[s + 2]!;
            vertices[d + 3] = raw[s + 3]!;
            vertices[d + 4] = raw[s + 4]!;
            vertices[d + 5] = raw[s + 5]!;
            vertices[d + 6] = 1.0;
          }
          // The IPC buffer is origin-relative; shift here (small, post binary IPC).
          applyOrigin(vertices, origin);
        } else {
          // Web: the worker returns 7-float format already origin-shifted, so the
          // main thread never loops over the (up to millions of) points.
          vertices = await workerRenderBuffer7(handle, colorMode, MAX_RENDER_POINTS, origin);
          if (cancelled) return;
        }

        renderer.uploadPointCloudVerticesForMode(colorMode, vertices);
        prevHandleRef.current = handle;
        prevColorModeRef.current = colorMode;
      } catch (err) {
        console.error('[PointCloudViewport] render buffer failed:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [handle, colorMode, isSplat, splatBuffer, splatOriginShifted, splatShDegree, splatLayoutVersion, splatSampleMode, splatRenderMode, splatQuality, status, rendererRef]);
}
