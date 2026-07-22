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
import { GpuSplatSorter } from "./splatSortCompute";
import { buildSplatUniform, DEFAULT_SPLAT_DILATION } from "./splatUniform";
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
 * Safety ceiling for the splat storage buffer (2 GiB). The effective budget is
 * `min(device.maxStorageBufferBindingSize, this)`, so the renderer uses the
 * GPU's *real* binding limit — desktop GPUs commonly report 2 GiB+, which lets
 * a full multi-million-splat cloud (e.g. 12.4M deg-3 ≈ 1.5 GiB in f16) render
 * in its entirety, matching dedicated splat viewers' coverage. The ceiling only
 * guards against pathological uploads on GPUs that advertise absurd limits; it
 * is intentionally high so it is not the binding cap on normal hardware.
 *
 * Note: the CPU counting sort is O(n) and stays responsive at these counts;
 * VRAM (not sort time) is the practical constraint, and it is device-bounded.
 */
export const GPU_SPLAT_MEMORY_BUDGET = 2_147_483_648;

/** GPU compute sort is not wired into the frame pass yet; avoid its scratch allocations. */
const ENABLE_GPU_SPLAT_SORT = false;

/**
 * When the fraction of splats that fit the GPU at the original SH degree drops
 * below this threshold, auto-downgrade to band-0 (degree 0) to trade view-
 * dependent colour for drastically better surface coverage. Degree 3 → 0 is
 * ~3.9× more splats in the same memory.
 */
const AUTO_DOWNGRADE_THRESHOLD = 0.5;

/**
 * Repack a higher-degree packed splat buffer into band-0 (degree 0) layout.
 * Strips higher SH bands, keeping only `pos(3 f32) + cov6 + opacity + dc3`
 * (8 u32 words = 32 B/splat). The packed half-precision block is ordered
 * `[σxx|σxy, σxz|σyy, σyz|σzz, opacity|sh0_r, sh0_g|sh0_b, ...]`, so the
 * first 5 u32 words after position contain exactly what degree-0 needs.
 */
export function repackAsBand0(
  splatData: Uint32Array,
  srcDegree: number,
): Uint32Array {
  if (srcDegree === 0) return splatData;
  const srcStride = splatStrideForDegree(srcDegree);
  const dstStride = splatStrideForDegree(0); // 8 words
  const n = Math.floor(splatData.length / srcStride);
  const out = new Uint32Array(n * dstStride);
  for (let i = 0; i < n; i++) {
    const sb = i * srcStride;
    const db = i * dstStride;
    // position (3 f32 words) + first 5 half-pair words (cov6 + opacity + dc3)
    out[db] = splatData[sb]!;
    out[db + 1] = splatData[sb + 1]!;
    out[db + 2] = splatData[sb + 2]!;
    out[db + 3] = splatData[sb + 3]!;
    out[db + 4] = splatData[sb + 4]!;
    out[db + 5] = splatData[sb + 5]!;
    out[db + 6] = splatData[sb + 6]!;
    out[db + 7] = splatData[sb + 7]!;
  }
  return out;
}

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

/**
 * Strategy for choosing which splats survive when a cloud exceeds the GPU/
 * preview budget. Both strategies keep the *same* number of splats (so memory
 * is identical) — they differ only in *which* splats are kept:
 * - `uniform`: stride-sample evenly — preserves spatial spread and fine detail
 *   across the whole cloud (generally the sharper-looking result).
 * - `importance`: keep the highest `opacity × size` splats — favours large
 *   opaque surfaces, which can look fuller but drops fine low-opacity detail.
 */
export type SplatSampleMode = "importance" | "uniform";

/**
 * Default splat sampling strategy. `importance` (keep highest `opacity × size`)
 * preserves solid surfaces far better than uniform stride sampling — which
 * drops whole regions and leaves anisotropic residual gaussians protruding as
 * spikes (the sparse/hairy look). Only matters when a cloud still exceeds the
 * device budget after {@link GPU_SPLAT_MEMORY_BUDGET}; on GPUs that fit the
 * whole cloud no reduction happens at all.
 */
export const DEFAULT_SPLAT_SAMPLE_MODE: SplatSampleMode = "importance";

/**
 * Splat rendering mode (user-selectable):
 * - `full`: keep every splat the GPU can physically hold. Ignores the quality
 *   fraction and the {@link PREVIEW_SPLAT_BUDGET} soft cap; only the device
 *   storage-buffer limit (and, if needed, auto band-0 downgrade) bounds it.
 *   Matches dedicated splat viewers' full-cloud coverage.
 * - `decimated`: reduce to the quality fraction / preview budget for lighter
 *   VRAM and faster per-frame sorting on very large clouds.
 */
export type SplatRenderMode = "full" | "decimated";

/** Default rendering mode: show the whole cloud (device-limited). */
export const DEFAULT_SPLAT_RENDER_MODE: SplatRenderMode = "full";

/**
 * Reduce a packed splat buffer to at most `maxSplats` using `mode`. Returns the
 * input unchanged when it already fits (both strategies short-circuit).
 */
export function sampleSplatBuffer(
  splatData: Uint32Array,
  stride: number,
  maxSplats: number,
  mode: SplatSampleMode,
): Uint32Array {
  return mode === "uniform"
    ? decimateSplatBuffer(splatData, stride, maxSplats)
    : importanceDecimateSplatBuffer(splatData, stride, maxSplats);
}


/** Orchestrates upload, per-frame uniform/sort updates, and drawing of splats. */
export class SplatRenderer {
  private readonly resources: GaussianSplatResources;
  private readonly sort: SplatSortController;
  private gpuSort: GpuSplatSorter | null = null;
  /** 2D low-pass filter size (px²); larger = fuller/blurrier splats. */
  private dilation = DEFAULT_SPLAT_DILATION;
  /** Diagnostic encoding for inputs whose decoded SH is known to be linear. */
  private encodeLinearToSrgb = false;
  /** Max bytes bindable as a single read-only-storage buffer on this device. */
  private readonly maxStorageBytes: number;
  /** CPU-side positions for GPU sort depth range computation. */
  private positions: Float32Array = new Float32Array(0);
  /** Last camera pose used for GPU sort (avoids redundant sorts). */
  private lastSortCamPos: Vec3 = [0, 0, 0];
  private lastSortViewDir: Vec3 = [0, 0, 1];
  private gpuSortDirty = true;

  constructor(
    private readonly device: GPUDevice,
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
    this.maxStorageBytes = Math.min(
      this.device.limits?.maxStorageBufferBindingSize ?? DEFAULT_MAX_STORAGE_BINDING_BYTES,
      GPU_SPLAT_MEMORY_BUDGET,
    );
    this.resources = new GaussianSplatResources(this.device, bindGroupLayout);
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
   *
   * When the GPU can hold less than {@link AUTO_DOWNGRADE_THRESHOLD} of the
   * splats at the original SH degree, the buffer is repacked to band-0 (degree
   * 0) automatically: the ~3.9× memory saving (degree-3 → 0) lets far more
   * splats survive, which matters much more for visual quality than view-
   * dependent SH highlights.
   */
  upload(
    splatData: Uint32Array,
    shDegree: number,
    sampleMode: SplatSampleMode = DEFAULT_SPLAT_SAMPLE_MODE,
    quality = 1,
    renderMode: SplatRenderMode = DEFAULT_SPLAT_RENDER_MODE,
  ): void {
    let stride = splatStrideForDegree(shDegree);
    let bytesPerSplat = stride * Uint32Array.BYTES_PER_ELEMENT;
    let count = Math.floor(splatData.length / stride);
    let maxByLimit = Math.floor(this.maxStorageBytes / bytesPerSplat);
    let effectiveDegree = shDegree;

    // Auto-downgrade: if less than half the splats fit at the full degree,
    // repack to band-0 for ~3.9× more coverage (degree 3) or ~1.6× (degree 1).
    if (shDegree > 0 && maxByLimit < count * AUTO_DOWNGRADE_THRESHOLD) {
      const band0Data = repackAsBand0(splatData, shDegree);
      const band0Stride = splatStrideForDegree(0);
      const band0Bps = band0Stride * Uint32Array.BYTES_PER_ELEMENT;
      const band0Max = Math.floor(this.maxStorageBytes / band0Bps);
       
      console.info(
        `[Splat] Auto-downgrade SH deg ${shDegree}→0: ` +
          `${maxByLimit.toLocaleString()} → ${band0Max.toLocaleString()} max splats ` +
          `(${(band0Max / maxByLimit).toFixed(1)}× gain, ` +
          `GPU limit ${(this.maxStorageBytes / 1048576).toFixed(0)} MiB)`,
      );
      splatData = band0Data;
      shDegree = 0;
      stride = band0Stride;
      bytesPerSplat = band0Bps;
      count = Math.floor(splatData.length / stride);
      maxByLimit = band0Max;
      effectiveDegree = 0;
    }

    // In `full` mode keep every splat the device can hold (quality fraction and
    // the preview soft-cap are bypassed); in `decimated` mode honour both so a
    // huge cloud stays light. The hardware storage limit (`maxByLimit`) always
    // applies — binding an oversized buffer would crash the device.
    const full = renderMode === "full";
    const q = full ? 1 : Math.min(1, Math.max(0, quality));
    const byQuality = q >= 1 ? count : Math.max(1, Math.floor(count * q));
    const softBudget = full ? maxByLimit : PREVIEW_SPLAT_BUDGET;
    const maxSplats = Math.min(byQuality, softBudget, maxByLimit);
    // Reduce to fit using the caller-selected strategy (importance vs uniform).
    const data = sampleSplatBuffer(splatData, stride, maxSplats, sampleMode);
    const kept = Math.floor(data.length / stride);
     
    console.info(
      `[Splat] Upload: ${count.toLocaleString()} → ${kept.toLocaleString()} splats ` +
        `(deg ${effectiveDegree}, ${(kept * bytesPerSplat / 1048576).toFixed(1)} MiB, ` +
        `${((kept / count) * 100).toFixed(1)}% kept, mode=${sampleMode})`,
    );
    this.resources.upload(data, shDegree);
    const positions = extractSplatPositions(data, stride);
    if (ENABLE_GPU_SPLAT_SORT) {
      this.positions = positions;
      this.gpuSort ??= new GpuSplatSorter(this.device);
      this.gpuSort.resize(kept, stride);
      this.gpuSortDirty = true;
      this.sort.setSplats(positions.slice()); // clone because GPU sort retains positions
    } else {
      this.positions = new Float32Array(0);
      this.gpuSortDirty = false;
      this.sort.setSplats(positions);
    }
  }

  /** Set the 2D low-pass dilation (splat fullness). Wakes a redraw. */
  setDilation(dilation: number): void {
    this.dilation = Math.max(0, dilation);
    this.onOrderChanged?.();
  }

  /** Toggle diagnostic linear→sRGB encoding. Wakes a redraw. */
  setLinearToSrgbEncoding(enabled: boolean): void {
    this.encodeLinearToSrgb = enabled;
    this.onOrderChanged?.();
  }

  /** Cap the depth re-sort (refresh) rate; `fps <= 0` = realtime (no cap). */
  setRefreshFps(fps: number): void {
    this.sort.setRefreshFps(fps);
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
      this.encodeLinearToSrgb,
    );
    this.resources.updateUniform(uniform);
    const viewDir = computeViewDir(camera.position, camera.target);
    // Track camera for GPU sort (currently disabled pending further debugging).
    this.lastSortCamPos = camera.position;
    this.lastSortViewDir = viewDir;
    this.gpuSortDirty = true;
    // CPU sort — proven stable, runs thresholded in a worker.
    this.sort.onCamera(camera.position, viewDir);
  }

  /**
   * Encode the GPU depth sort into the command encoder. Call this BEFORE
   * beginning the render pass so the sorted order is ready for drawing.
   * Returns true if a sort was dispatched.
   */
  sortGpu(encoder: GPUCommandEncoder): boolean {
    if (!ENABLE_GPU_SPLAT_SORT) return false;
    if (!this.resources.hasContent || !this.gpuSortDirty) return false;
    const splatBuf = this.resources.gpuSplatBuffer;
    const orderBuf = this.resources.gpuOrderBuffer;
    if (!splatBuf || !orderBuf) return false;
    this.gpuSort ??= new GpuSplatSorter(this.device);
    this.gpuSort.sort(
      encoder,
      splatBuf,
      orderBuf,
      this.lastSortCamPos,
      this.lastSortViewDir,
      this.positions,
    );
    this.gpuSortDirty = false;
    return true;
  }

  /** Draw the splats into the active render pass (after opaque geometry). */
  draw(pass: GPURenderPassEncoder): void {
    this.resources.draw(pass, this.pipeline);
  }

  /** Remove the current cloud. */
  clear(): void {
    this.resources.clear();
    this.positions = new Float32Array(0);
    this.gpuSortDirty = false;
    this.gpuSort?.resize(0, 0);
    this.sort.setSplats(new Float32Array(0));
  }

  /** Force a re-sort next frame (e.g. after a projection change). */
  invalidateSort(): void {
    this.sort.invalidate();
  }

  /** Release all GPU + worker resources. */
  dispose(): void {
    this.resources.dispose();
    this.positions = new Float32Array(0);
    this.gpuSort?.dispose();
    this.gpuSort = null;
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
