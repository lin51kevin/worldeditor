/**
 * Main-thread bridge to the point-cloud Web Worker.
 * Wraps postMessage/onmessage in Promises with request IDs.
 * Float32Array results are received via Transferable (zero-copy).
 */

import type { PointCloudColorMode, PointCloudPolyline, PointCloudSummary } from '../services/platform';

interface PendingRequest {
  resolve: (value: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  reject: (reason: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, PendingRequest>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./pointcloudWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result?: any; error?: string }>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const { id, result, error } = e.data;
      const req = pending.get(id);
      if (!req) return;
      pending.delete(id);
      if (error !== undefined) {
        req.reject(new Error(error));
      } else {
        req.resolve(result);
      }
    };
    worker.onerror = (ev) => {
      // Reject all pending requests on unrecoverable worker error
      for (const [, req] of pending) {
        req.reject(new Error(`Worker error: ${ev.message}`));
      }
      pending.clear();
    };
  }
  return worker;
}

function call(type: string, params: Record<string, unknown>, transfer: Transferable[] = []): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, type, ...params }, transfer);
  });
}

export interface WorkerLoadResult {
  handle: number;
  summary: PointCloudSummary;
}

/** Load a point cloud in the worker (bytes are transferred, zero-copy). */
export function workerLoadPointCloud(
  bytes: Uint8Array,
  format: string,
): Promise<WorkerLoadResult> {
  const transfer: Transferable[] = [bytes.buffer];
  return call('load', { bytes, format }, transfer);
}

/** Free a loaded point cloud handle. */
export function workerFreePointCloud(handle: number): Promise<void> {
  return call('free', { handle });
}

/** Get render buffer from the worker (returned buffer is transferred). */
export function workerRenderBuffer(
  handle: number,
  colorMode: PointCloudColorMode,
  maxPoints: number,
): Promise<Float32Array> {
  return call('renderBuffer', { handle, colorMode, maxPoints });
}

/** Get render buffer in 7-float format (x,y,z,r,g,b,a) ready for GPU upload.
 *  The 6→7 conversion happens in the worker to avoid blocking the main thread. */
export function workerRenderBuffer7(
  handle: number,
  colorMode: PointCloudColorMode,
  maxPoints: number,
): Promise<Float32Array> {
  return call('renderBuffer7', { handle, colorMode, maxPoints });
}

/** Extract ground from the loaded cloud. */
export function workerExtractGround(handle: number, config: Record<string, unknown> = {}): Promise<unknown> {
  return call('extractGround', { handle, config });
}

/** Extract marking polylines. */
export function workerExtractMarkings(handle: number, config: Record<string, unknown> = {}): Promise<PointCloudPolyline[]> {
  return call('extractMarkings', { handle, config });
}

/** Vectorize polylines into roads (runs in worker where the cloud handle lives). */
export function workerVectorize(
  handle: number,
  polylines: PointCloudPolyline[],
  config: Record<string, unknown> = {},
  useGround = false,
): Promise<unknown> {
  return call('vectorize', { handle, polylines, config, useGround });
}

/** Terminate the worker (cleanup). */
export function terminatePointCloudWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
    for (const [, req] of pending) {
      req.reject(new Error('Worker terminated'));
    }
    pending.clear();
  }
}
