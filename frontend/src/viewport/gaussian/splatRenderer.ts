/**
 * High-level facade tying the Gaussian splat GPU resources to the depth sorter.
 *
 * The renderer owns one `SplatRenderer`, calls {@link upload} when an NPC splat
 * cloud loads, {@link onCamera} once per frame (which refreshes the uniform and
 * schedules a re-sort when the camera moved), and {@link draw} inside the main
 * render pass after opaque geometry.
 */
import {
  GaussianSplatResources,
  splatStrideForDegree,
  createGaussianSplatPipeline,
} from "./splatPipeline";
import { SplatSortController, type SplatSorter } from "./splatSortController";
import { createWorkerSplatSorter } from "./splatSorterBackends";
import { buildSplatUniform } from "./splatUniform";
import type { Vec3 } from "./splatSort";
import type { CameraState } from "../cameraController";

/**
 * Extract the `[x,y,z,...]` positions from a packed splat buffer. Positions are
 * stored as the first 3 `u32` words (f32 bit patterns) of each record, so a
 * `Float32Array` view over the same bytes reads them directly. `stride` is the
 * per-splat `u32`-word count (varies with SH degree).
 */
export function extractSplatPositions(
  splatData: Uint32Array,
  stride: number,
): Float32Array {
  const n = Math.floor(splatData.length / stride);
  const pos = new Float32Array(n * 3);
  const f32 = new Float32Array(splatData.buffer, splatData.byteOffset, splatData.length);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = f32[i * stride]!;
    pos[i * 3 + 1] = f32[i * stride + 1]!;
    pos[i * 3 + 2] = f32[i * stride + 2]!;
  }
  return pos;
}

/** Normalized view direction `target - position`; falls back to +Z if degenerate. */
export function computeViewDir(position: Vec3, target: Vec3): Vec3 {
  const dx = target[0] - position[0];
  const dy = target[1] - position[1];
  const dz = target[2] - position[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) return [0, 0, 1];
  return [dx / len, dy / len, dz / len];
}

/**
 * Upper bound on splats kept for an editor preview, independent of GPU limits.
 * Very large 3DGS clouds are decimated to this budget to keep sorting, upload
 * and memory bounded; the GPU storage-buffer limit may lower it further. Raised
 * to 16M now that half-precision packing (~2× density) lets far more splats fit
 * — the per-device storage limit is usually the real cap.
 */
export const PREVIEW_SPLAT_BUDGET = 16_000_000;

/** WebGPU spec default for `maxStorageBufferBindingSize` (128 MiB). */
export const DEFAULT_MAX_STORAGE_BINDING_BYTES = 134_217_728;

/**
 * Decimate a packed splat buffer to at most `maxSplats` via uniform stride
 * sampling (keeps the cloud's spatial spread). Returns the input unchanged when
 * it already fits. `stride` is the per-splat float count.
 */
export function decimateSplatBuffer(
  splatData: Uint32Array,
  stride: number,
  maxSplats: number,
): Uint32Array {
  const count = Math.floor(splatData.length / stride);
  if (count <= maxSplats || maxSplats <= 0) return splatData;
  const step = Math.ceil(count / maxSplats);
  const kept = Math.ceil(count / step);
  const out = new Uint32Array(kept * stride);
  let d = 0;
  for (let i = 0; i < count; i += step) {
    out.set(splatData.subarray(i * stride, i * stride + stride), d * stride);
    d++;
  }
  // `kept` is an upper bound; trim if the final step landed short.
  return d * stride === out.length ? out : out.subarray(0, d * stride);
}

/** IEEE-754 binary16 (half) bit pattern → `f32`. */
export function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * frac * 2 ** -24; // signed zero / subnormal
  if (exp === 0x1f) return frac ? NaN : sign * Infinity;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

/**
 * Per-splat rendering importance ≈ `opacity × splat size`, used to keep the most
 * visually significant splats when a cloud must be decimated to fit the GPU.
 * Size is the covariance trace `σxx + σyy + σzz` (sum of squared axis extents);
 * opacity and covariance are decoded from the packed half-precision record
 * (position occupies words `0..2`; the half block starts at word `3`, holding
 * `σxx|σxy, σxz|σyy, σyz|σzz, opacity|sh…`).
 */
export function computeSplatImportance(
  splatData: Uint32Array,
  stride: number,
): Float32Array {
  const n = stride >= 7 ? Math.floor(splatData.length / stride) : 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const b = i * stride;
    const sxx = halfToFloat(splatData[b + 3]! & 0xffff);
    const syy = halfToFloat((splatData[b + 4]! >>> 16) & 0xffff);
    const szz = halfToFloat((splatData[b + 5]! >>> 16) & 0xffff);
    const opacity = halfToFloat(splatData[b + 6]! & 0xffff);
    const trace = sxx + syy + szz;
    out[i] = opacity * Math.sqrt(trace > 0 ? trace : 0);
  }
  return out;
}

/** Histogram buckets used to pick an importance threshold without a full sort. */
const IMPORTANCE_BUCKETS = 1024;

/**
 * Reduce a packed splat buffer to at most `maxSplats` by keeping the highest-
 * importance splats (`opacity × size`). This preserves surface coverage far
 * better than uniform stride sampling — which drops whole regions and leaves
 * anisotropic residual gaussians protruding as spikes — so the decimated cloud
 * stays visually faithful. Returns the input unchanged when it already fits.
 *
 * Selection uses a histogram threshold over the importance range: `O(n)` time
 * and `O(buckets)` memory, avoiding an `O(n log n)` sort of the multi-million-
 * entry importance array. Falls back to uniform stride when every splat has the
 * same importance (degenerate range).
 */
export function importanceDecimateSplatBuffer(
  splatData: Uint32Array,
  stride: number,
  maxSplats: number,
): Uint32Array {
  const count = Math.floor(splatData.length / stride);
  if (count <= maxSplats || maxSplats <= 0) return splatData;

  const importance = computeSplatImportance(splatData, stride);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < count; i++) {
    const v = importance[i]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(hi > lo)) {
    // All splats equally important — no basis for selection.
    return decimateSplatBuffer(splatData, stride, maxSplats);
  }

  const scale = IMPORTANCE_BUCKETS / (hi - lo);
  const bucketOf = (v: number): number => {
    const b = Math.floor((v - lo) * scale);
    return b >= IMPORTANCE_BUCKETS ? IMPORTANCE_BUCKETS - 1 : b < 0 ? 0 : b;
  };

  const hist = new Uint32Array(IMPORTANCE_BUCKETS);
  for (let i = 0; i < count; i++) hist[bucketOf(importance[i]!)]!++;

  // Walk buckets high→low until the budget is reached; `t` is the boundary
  // bucket that must be partially sampled to land near `maxSplats`.
  let acc = 0;
  let t = 0;
  for (let b = IMPORTANCE_BUCKETS - 1; b >= 0; b--) {
    acc += hist[b]!;
    if (acc >= maxSplats) {
      t = b;
      break;
    }
  }
  const aboveT = acc - hist[t]!; // kept in full from buckets strictly above `t`
  const remaining = maxSplats - aboveT; // to draw from the boundary bucket `t`
  const stepT = Math.max(1, Math.ceil(hist[t]! / Math.max(1, remaining)));

  const out = new Uint32Array(maxSplats * stride);
  let d = 0;
  let seenT = 0;
  for (let i = 0; i < count && d < maxSplats; i++) {
    const b = bucketOf(importance[i]!);
    let keep = false;
    if (b > t) {
      keep = true;
    } else if (b === t) {
      if (seenT % stepT === 0) keep = true;
      seenT++;
    }
    if (keep) {
      out.set(splatData.subarray(i * stride, i * stride + stride), d * stride);
      d++;
    }
  }
  return d * stride === out.length ? out : out.subarray(0, d * stride);
}


/** Orchestrates upload, per-frame uniform/sort updates, and drawing of splats. */
export class SplatRenderer {
  private readonly resources: GaussianSplatResources;
  private readonly sort: SplatSortController;
  /** 2D low-pass filter size (px²); larger = fuller/blurrier splats. */
  private dilation = 0.15;
  /** Max bytes bindable as a single read-only-storage buffer on this device. */
  private readonly maxStorageBytes: number;

  constructor(
    device: GPUDevice,
    bindGroupLayout: GPUBindGroupLayout,
    private readonly pipeline: GPURenderPipeline,
    sorter: SplatSorter,
    /**
     * Called after a fresh depth-sorted order is uploaded. The renderer wires
     * this to `markSceneDirty` so the (asynchronously produced) sorted order is
     * actually drawn — critical under render-on-demand, where a static camera
     * would otherwise keep showing the initial identity order.
     */
    private readonly onOrderChanged?: () => void,
  ) {
    this.maxStorageBytes =
      device.limits?.maxStorageBufferBindingSize ?? DEFAULT_MAX_STORAGE_BINDING_BYTES;
    this.resources = new GaussianSplatResources(device, bindGroupLayout);
    this.sort = new SplatSortController(sorter, (idx) => {
      this.resources.updateOrder(idx);
      this.onOrderChanged?.();
    });
  }

  /** Whether there are splats to draw. */
  get hasContent(): boolean {
    return this.resources.hasContent;
  }

  /** Number of splats currently loaded. */
  get count(): number {
    return this.resources.count;
  }

  /**
   * Upload a packed SH splat buffer (stride varies with degree) and prime the
   * sorter. Clouds larger than the preview budget or the GPU storage-buffer
   * binding limit are decimated to fit — binding an oversized storage buffer
   * would otherwise crash the device.
   */
  upload(splatData: Uint32Array, shDegree: number): void {
    const stride = splatStrideForDegree(shDegree);
    const bytesPerSplat = stride * Uint32Array.BYTES_PER_ELEMENT;
    const maxByLimit = Math.floor(this.maxStorageBytes / bytesPerSplat);
    const maxSplats = Math.min(PREVIEW_SPLAT_BUDGET, maxByLimit);
    // Importance sampling (opacity × size) preserves surface coverage far
    // better than uniform stride when the cloud exceeds the GPU budget.
    const data = importanceDecimateSplatBuffer(splatData, stride, maxSplats);
    this.resources.upload(data, shDegree);
    // Hand the sorter ownership of the freshly-extracted positions (transferred
    // to the worker) so the main thread does not retain a second copy.
    this.sort.setSplats(extractSplatPositions(data, stride));
  }

  /** Set the 2D low-pass dilation (splat fullness). Wakes a redraw. */
  setDilation(dilation: number): void {
    this.dilation = Math.max(0, dilation);
    this.onOrderChanged?.();
  }

  /** Per-frame update: refresh the camera uniform and re-sort if needed. */
  onCamera(
    camera: CameraState,
    dimensionMode: "2d" | "3d",
    numPixelsPerMeter: number,
    width: number,
    height: number,
  ): void {
    if (!this.resources.hasContent) return;
    const uniform = buildSplatUniform(
      camera,
      dimensionMode,
      numPixelsPerMeter,
      width,
      height,
      this.resources.shDegree,
      this.dilation,
    );
    this.resources.updateUniform(uniform);
    const viewDir = computeViewDir(camera.position, camera.target);
    this.sort.onCamera(camera.position, viewDir);
  }

  /** Draw the splats into the active render pass (after opaque geometry). */
  draw(pass: GPURenderPassEncoder): void {
    this.resources.draw(pass, this.pipeline);
  }

  /** Remove the current cloud. */
  clear(): void {
    this.resources.clear();
    this.sort.setSplats(new Float32Array(0));
  }

  /** Force a re-sort next frame (e.g. after a projection change). */
  invalidateSort(): void {
    this.sort.invalidate();
  }

  /** Release all GPU + worker resources. */
  dispose(): void {
    this.resources.dispose();
    this.sort.dispose();
  }
}

/**
 * Convenience constructor: create the pipeline and a worker-backed
 * `SplatRenderer` in one call.
 */
export function createSplatRenderer(
  device: GPUDevice,
  format: GPUTextureFormat,
  sampleCount = 4,
  onOrderChanged?: () => void,
): SplatRenderer {
  const { pipeline, bindGroupLayout } = createGaussianSplatPipeline(
    device,
    format,
    sampleCount,
  );
  return new SplatRenderer(
    device,
    bindGroupLayout,
    pipeline,
    createWorkerSplatSorter(),
    onOrderChanged,
  );
}
