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
import { getPlatformService } from '../services';
import { workerRenderBuffer7 } from '../workers/pointcloudBridge';
import { splatStrideForDegree } from '../viewport/gaussian/splatPipeline';

const MAX_RENDER_POINTS = 2_000_000;

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
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
 * Positions occupy the first three floats of each
 * `splatStrideForDegree(shDegree)`-float record. Returns a shifted copy (the
 * store buffer stays origin-relative and immutable) or the input unchanged when
 * `origin` is zero/undefined.
 */
export function applySplatOrigin(
  splatData: Float32Array,
  shDegree: number,
  origin: readonly [number, number, number] | undefined,
): Float32Array {
  if (!origin || (origin[0] === 0 && origin[1] === 0 && origin[2] === 0)) return splatData;
  const stride = splatStrideForDegree(shDegree);
  if (stride < 3) return splatData;
  const [ox, oy, oz] = origin;
  const out = new Float32Array(splatData);
  for (let i = 0; i + 2 < out.length; i += stride) {
    out[i] = out[i]! + ox;
    out[i + 1] = out[i + 1]! + oy;
    out[i + 2] = out[i + 2]! + oz;
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

  const handle = usePointCloudStore((s) => s.handle);
  const colorMode = usePointCloudStore((s) => s.colorMode);
  const isSplat = usePointCloudStore((s) => s.isSplat);
  const splatBuffer = usePointCloudStore((s) => s.splatBuffer);
  const splatShDegree = usePointCloudStore((s) => s.splatShDegree);
  const splatDilation = usePointCloudStore((s) => s.splatDilation);

  // Apply the live dilation (splat fullness) slider to the renderer.
  useEffect(() => {
    if (status !== 'ready' || !isSplat) return;
    rendererRef.current?.setSplatDilation(splatDilation);
  }, [splatDilation, isSplat, status, rendererRef]);

  useEffect(() => {
    if (status !== 'ready') return;
    const renderer = rendererRef.current;
    if (!renderer) return;

    // Cloud unloaded — clear both point-list and splat renders.
    if (handle === null) {
      if (prevHandleRef.current !== null) {
        renderer.uploadPointCloudVertices(new Float32Array(0));
        renderer.clearGaussianSplats();
        prevHandleRef.current = null;
        prevColorModeRef.current = null;
      }
      return;
    }

    // 3D Gaussian Splatting cloud — render as true splats (colorMode N/A).
    if (isSplat) {
      if (handle !== prevHandleRef.current) {
        // Drop any stale point geometry, then upload the packed splat buffer,
        // shifted into the road's absolute frame so it overlaps the OpenDRIVE
        // geometry instead of rendering around the origin.
        renderer.uploadPointCloudVertices(new Float32Array(0));
        if (splatBuffer) {
          const shifted = applySplatOrigin(
            splatBuffer,
            splatShDegree,
            usePointCloudStore.getState().summary?.origin,
          );
          renderer.uploadGaussianSplats(shifted, splatShDegree);
        }
        prevHandleRef.current = handle;
        prevColorModeRef.current = null;
      }
      return;
    }

    // Skip if nothing changed
    if (handle === prevHandleRef.current && colorMode === prevColorModeRef.current) {
      return;
    }

    // Leaving a splat cloud (or a fresh point cloud) — ensure no splats linger.
    renderer.clearGaussianSplats();

    let cancelled = false;

    (async () => {
      try {
        let vertices: Float32Array;
        if (isTauri()) {
          // Tauri: binary IPC returns 6-float format, convert here (fast after binary transfer)
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
        } else {
          // Web: worker returns 7-float format directly (zero main-thread conversion)
          vertices = await workerRenderBuffer7(handle, colorMode, MAX_RENDER_POINTS);
          if (cancelled) return;
        }

        // The render buffer is origin-relative; shift it back into absolute
        // world coordinates so the cloud overlaps the OpenDRIVE road geometry.
        applyOrigin(vertices, usePointCloudStore.getState().summary?.origin);

        renderer.uploadPointCloudVertices(vertices);
        prevHandleRef.current = handle;
        prevColorModeRef.current = colorMode;
      } catch (err) {
        console.error('[PointCloudViewport] render buffer failed:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [handle, colorMode, isSplat, splatBuffer, splatShDegree, status, rendererRef]);
}
