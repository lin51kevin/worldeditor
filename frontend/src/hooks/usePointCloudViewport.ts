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

const MAX_RENDER_POINTS = 2_000_000;

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
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

  useEffect(() => {
    if (status !== 'ready') return;
    const renderer = rendererRef.current;
    if (!renderer) return;

    // Cloud unloaded — clear the render
    if (handle === null) {
      if (prevHandleRef.current !== null) {
        renderer.uploadPointCloudVertices(new Float32Array(0));
        prevHandleRef.current = null;
        prevColorModeRef.current = null;
      }
      return;
    }

    // Skip if nothing changed
    if (handle === prevHandleRef.current && colorMode === prevColorModeRef.current) {
      return;
    }

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

        renderer.uploadPointCloudVertices(vertices);
        prevHandleRef.current = handle;
        prevColorModeRef.current = colorMode;
      } catch (err) {
        console.error('[PointCloudViewport] render buffer failed:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [handle, colorMode, status, rendererRef]);
}
