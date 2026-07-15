/**
 * Web Worker for point cloud WASM operations.
 * Runs heavy point-cloud processing off the main thread to prevent UI freezes.
 *
 * Protocol: main thread sends `{ id, type, ...params }` messages.
 * Worker replies with `{ id, result }` or `{ id, error }`.
 * Float32Array results are transferred (zero-copy).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  splatStrideForDegree,
  shiftSplatOrigin,
  shiftPointCloudOrigin,
} from '../viewport/gaussian/splatSampling';

let wasm: any = null;

async function ensureWasm(): Promise<any> {
  if (wasm) return wasm;
  // Dynamic import of the WASM package (relative to worker location)
  const mod = await import('../../wasm/pkg/we_wasm');
  await (mod.default as unknown as () => Promise<void>)();
  wasm = mod;
  return wasm;
}

interface WorkerRequest {
  id: number;
  type: string;
  [key: string]: any;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, type, ...params } = e.data;
  try {
    const w = await ensureWasm();
    let result: any;
    const transfer: Transferable[] = [];

    switch (type) {
      case 'load': {
        const handle = w.load_point_cloud(params.bytes, params.format);
        const summary = w.point_cloud_summary(handle);
        result = { handle, summary };
        break;
      }
      case 'free': {
        w.free_point_cloud(params.handle);
        result = null;
        break;
      }
      case 'loadGaussian': {
        // Parse a 3D Gaussian Splatting PLY, then shift it into the road's
        // absolute frame IN THE WORKER (the ~hundreds-of-MB per-splat copy that
        // used to freeze the main thread). Quality/sample reduction stays in the
        // GPU renderer so the live quality slider keeps working on the full
        // buffer. `maxSplats` bounds the parsed count on huge clouds.
        const handle = w.load_gaussian_splats(params.bytes, params.maxSplats);
        const meta = w.gaussian_splat_meta(handle);
        const raw: Uint32Array = w.gaussian_splat_buffer_sh(handle);
        const stride = splatStrideForDegree(meta.shDegree);
        const shifted = shiftSplatOrigin(raw, stride, meta.origin);
        // `shiftSplatOrigin` returns `raw` unchanged when the origin is zero;
        // `raw` is a fresh copy out of WASM, so transferring it is safe.
        result = { handle, meta, buffer: shifted };
        transfer.push(shifted.buffer);
        break;
      }
      case 'freeGaussian': {
        w.free_gaussian_splats(params.handle);
        result = null;
        break;
      }
      case 'renderBuffer': {
        const buf: Float32Array = w.point_cloud_render_buffer(
          params.handle, params.colorMode, params.maxPoints,
        );
        result = buf;
        transfer.push(buf.buffer);
        break;
      }
      case 'renderBuffer7': {
        // Returns 7-float format (x,y,z,r,g,b,a) ready for GPU upload.
        // Conversion done here in the worker to avoid blocking the main thread.
        const raw: Float32Array = w.point_cloud_render_buffer(
          params.handle, params.colorMode, params.maxPoints,
        );
        const pointCount = Math.floor(raw.length / 6);
        const out = new Float32Array(pointCount * 7);
        for (let i = 0; i < pointCount; i++) {
          const s = i * 6;
          const d = i * 7;
          out[d] = raw[s]!;
          out[d + 1] = raw[s + 1]!;
          out[d + 2] = raw[s + 2]!;
          out[d + 3] = raw[s + 3]!;
          out[d + 4] = raw[s + 4]!;
          out[d + 5] = raw[s + 5]!;
          out[d + 6] = 1.0;
        }
        // Shift into the road's absolute frame here too, so the main thread never
        // loops over the (up to millions of) points.
        if (params.origin) {
          shiftPointCloudOrigin(out, params.origin as [number, number, number]);
        }
        result = out;
        transfer.push(out.buffer);
        break;
      }
      case 'extractGround': {
        result = w.point_cloud_extract_ground(params.handle, JSON.stringify(params.config ?? {}));
        break;
      }
      case 'extractMarkings': {
        result = w.point_cloud_extract_markings(params.handle, JSON.stringify(params.config ?? {}));
        break;
      }
      case 'vectorize': {
        result = w.point_cloud_vectorize(
          params.handle,
          JSON.stringify(params.polylines),
          JSON.stringify(params.config ?? {}),
          params.useGround ?? false,
        );
        break;
      }
      default:
        throw new Error(`Unknown worker message type: ${type}`);
    }

    (self as unknown as Worker).postMessage({ id, result }, transfer);
  } catch (err: any) {
    (self as unknown as Worker).postMessage({ id, error: err?.message ?? String(err) });
  }
};
