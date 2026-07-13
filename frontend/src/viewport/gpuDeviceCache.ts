/**
 * Eagerly pre-warms the WebGPU adapter + device so that the first
 * ViewportRenderer.init() call avoids ~180ms of cold-start latency.
 *
 * Import this module early (e.g. from App.tsx) to kick off the warm-up.
 * The renderer calls `takePrewarmedGPU()` to consume the cached result.
 */

export interface PrewarmedGPU {
  adapter: GPUAdapter;
  device: GPUDevice;
}

/** Synchronous slot — populated once the async prewarm resolves. */
let cachedGPU: PrewarmedGPU | null = null;
/** Tracks whether prewarm is still in-flight. */
let prewarmPending: Promise<void> | null = null;

/**
 * Build the device `requiredLimits` we depend on, raised to the adapter's
 * maximum. Beyond `maxBufferSize`, large 3D Gaussian Splatting clouds bind a
 * single big read-only-storage buffer, so `maxStorageBufferBindingSize` must
 * also be raised — otherwise it stays at the 128 MiB default and binding the
 * splat buffer triggers a device-lost crash.
 */
export function buildRequiredLimits(adapter: GPUAdapter): Record<string, number> {
  return {
    maxBufferSize: adapter.limits.maxBufferSize,
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
  };
}

function startPrewarm(): void {
  if (!('gpu' in navigator)) return;

  prewarmPending = (async () => {
    try {
      const t0 = performance.now();
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return;
      const device = await adapter.requestDevice({
        requiredLimits: buildRequiredLimits(adapter),
      });
      cachedGPU = { adapter, device };
      console.info(
        `[GPU:prewarm] adapter+device ready in ${(performance.now() - t0).toFixed(1)}ms`,
      );
    } catch {
      // Ignore — renderer will fall back to fresh request
    } finally {
      prewarmPending = null;
    }
  })();
}

/** Start pre-warming immediately on import. */
startPrewarm();

/**
 * Try to take the pre-warmed GPU synchronously.
 * If the prewarm is still in-flight, optionally wait for it via the returned promise.
 */
export function takePrewarmedGPUSync(): PrewarmedGPU | null {
  if (!cachedGPU) return null;
  const gpu = cachedGPU;
  cachedGPU = null;
  return gpu;
}

/**
 * Wait for the prewarm to finish (if still running), then take the result.
 */
export async function takePrewarmedGPU(): Promise<PrewarmedGPU | null> {
  if (cachedGPU) {
    const gpu = cachedGPU;
    cachedGPU = null;
    return gpu;
  }
  if (prewarmPending) {
    await prewarmPending;
    if (cachedGPU) {
      const gpu = cachedGPU;
      cachedGPU = null;
      return gpu;
    }
  }
  return null;
}

/**
 * Return a GPU device back to the cache (e.g. when React StrictMode
 * disposes the first mount before the renderer can use it).
 */
export function returnPrewarmedGPU(gpu: PrewarmedGPU): void {
  cachedGPU = gpu;
}
