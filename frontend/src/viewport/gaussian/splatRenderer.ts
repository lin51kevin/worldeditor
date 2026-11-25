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
  type GaussianResourceMode,
} from "./splatPipeline";
import {
  GAUSSIAN_TRANSFORM_TEXELS,
  assertGaussianSplatBuffer,
  gaussianFeatureTexelsForDegree,
  halfToFloat,
} from "./splatLayout";
import { SplatSortController, type SplatSorter } from "./splatSortController";
import { createWorkerSplatSorter } from "./splatSorterBackends";
import { GpuSplatSorter } from "./splatSortCompute";
import { GpuSortTimer } from "./splatSortTiming";
import { nextHeldThinTau, nextThinTau, THIN_TAU_INITIAL } from "./splatBudget";
import type { PreparedSplatChunk } from "./splatPrepare";
import { buildSplatUniform, DEFAULT_SPLAT_DILATION, DEFAULT_OCCLUDER_ALPHA_MIN, DEFAULT_OCCLUDER_SIGMA, DEFAULT_OCCLUDER_DEPTH_BIAS } from "./splatUniform";
import { frustumSidePlanes, type Vec3 } from "./splatSort";
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
 * and memory bounded. Texture-array and global-order capacity may lower it
 * further, but only when the caller explicitly selected `decimated`.
 */
export const PREVIEW_SPLAT_BUDGET = 16_000_000;

/** WebGPU spec default for `maxStorageBufferBindingSize` (128 MiB). */
export const DEFAULT_MAX_STORAGE_BINDING_BYTES = 134_217_728;

/**
 * Minimum interval between GPU depth re-sorts (ms). The sort is a near-full-cloud
 * pass (~tens of ms at 10M+), so re-running it on every display frame under a
 * moving camera would bind the frame rate to the sort cost. Capping it to ~20 Hz
 * and reusing the still-valid order buffer between sorts keeps rendering smooth;
 * the order is at most one interval stale (imperceptible) and a settled camera
 * re-sorts within one interval for a correct resting order.
 */
export const GPU_SORT_MIN_INTERVAL_MS = 50;

/**
 * Throughput of the GPU radix sort, calibrated on real hardware via
 * `frontend/public/gpu-sort-harness.html` (~28 ms at 12,000,000 splats). The cost
 * is linear in the splat count, so this scales the estimate to any cloud size.
 */
const GPU_SORT_SPLATS_PER_MS = 430_000;

/**
 * Re-sort no more often than this multiple of the sort's own estimated cost, so
 * the sort stays at roughly a 1/N GPU duty cycle and leaves the rest of the frame
 * budget to rasterization. Without it a 20M+ cloud re-sorts every 50 ms while each
 * sort itself costs ~50 ms, i.e. the GPU does nothing but sort.
 */
const GPU_SORT_DUTY_FACTOR = 2;

/** Ceiling so even a huge cloud still re-sorts several times per second. */
const GPU_SORT_MAX_INTERVAL_MS = 200;

/**
 * Shortest re-sort interval once the sort's real duration is known: one sort per
 * display frame at 60 Hz. The estimate-based interval above never goes below 50 ms.
 */
export const GPU_SORT_FAST_MIN_INTERVAL_MS = 16;

/** GPU share the measured sort may occupy, so rasterization keeps the rest of the frame. */
const GPU_SORT_TARGET_DUTY = 0.3;

/**
 * NDC margin added around the screen when the GPU sort culls splats outside the
 * frustum. A moving camera re-sorts at most every {@link gpuSortIntervalMs}, so
 * the margin keeps splats that just entered the view drawn until the next sort.
 */
export const GPU_SORT_CULL_GUARD_NDC = 0.25;

/** Camera stillness after which an interactive-budget view is re-sorted at full quality. */
const INTERACTIVE_IDLE_MS = 350;

/** Extra sorts a held (still-camera) view may spend steering the thinning threshold onto the budget. */
const HOLD_CONVERGE_SORTS = 8;

/** Minimum gap between redraw requests while a progressive upload is still writing chunks. */
export const PROGRESSIVE_REFRESH_MS = 250;

/** State of an in-progress chunked upload. */
interface ChunkedUploadSession {
  sourceCount: number;
  shDegree: number;
  stride: number;
  total: number;
  /** Positions for the CPU worker sort; `null` when the GPU sort is mandatory. */
  cpuPositions: Float32Array | null;
  /** Drawn (GPU-sorted) while still uploading. */
  progressive: boolean;
  /** Running local-frame bounds of the splats appended so far. */
  min: [number, number, number];
  max: [number, number, number];
  /** Time of the last redraw request, for {@link PROGRESSIVE_REFRESH_MS}. */
  lastRefreshMs: number;
}

/** Leading floats of the splat uniform that affect culling (everything before the occluder fields). */
const CULL_KEY_FLOATS = 45;

/**
 * Minimum interval between GPU depth re-sorts for a cloud of `count` splats.
 * Constant {@link GPU_SORT_MIN_INTERVAL_MS} for ordinary clouds (≤ ~10M) and
 * proportional to the sort cost beyond that. With `measuredMs` (the sort's real
 * GPU time, from timestamp queries) the interval follows the hardware instead:
 * the sort takes at most {@link GPU_SORT_TARGET_DUTY} of the GPU, so a cheap
 * sort (few visible splats, a fast GPU) runs as often as every frame.
 */
export function gpuSortIntervalMs(count: number, measuredMs?: number | null): number {
  if (measuredMs !== undefined && measuredMs !== null && Number.isFinite(measuredMs) && measuredMs > 0) {
    return Math.min(
      GPU_SORT_MAX_INTERVAL_MS,
      Math.max(GPU_SORT_FAST_MIN_INTERVAL_MS, measuredMs / GPU_SORT_TARGET_DUTY),
    );
  }
  const estimatedSortMs = Math.max(0, count) / GPU_SORT_SPLATS_PER_MS;
  return Math.min(
    GPU_SORT_MAX_INTERVAL_MS,
    Math.max(GPU_SORT_MIN_INTERVAL_MS, estimatedSortMs * GPU_SORT_DUTY_FACTOR),
  );
}

/**
 * Safety ceiling for the explicit packed fallback buffer (2 GiB). Its budget is
 * `min(device.maxStorageBufferBindingSize, this)`, so the renderer uses the
 * the minimum of the device's buffer limits and this guard. The normal full
 * path stores attributes in texture arrays and is not bounded by this value.
 */
export const GPU_SPLAT_MEMORY_BUDGET = 2_147_483_648;

/**
 * Repack a higher-degree version-2 buffer into band-0. The f32
 * position/scale/quaternion prefix and first two opacity/DC half-pairs are the
 * degree-0 record, so repacking preserves the first 12 words per splat.
 *
 * @deprecated Explicit offline preprocessing only. `SplatRenderer` never calls
 * this helper because render-time SH reduction is a fidelity loss.
 */
export function repackAsBand0(
  splatData: Uint32Array,
  srcDegree: number,
  layoutVersion: number,
): Uint32Array {
  assertGaussianSplatBuffer(splatData, srcDegree, layoutVersion);
  if (srcDegree === 0) return splatData;
  const srcStride = splatStrideForDegree(srcDegree);
  const dstStride = splatStrideForDegree(0); // 12 words
  const n = Math.floor(splatData.length / srcStride);
  const out = new Uint32Array(n * dstStride);
  for (let i = 0; i < n; i++) {
    const sb = i * srcStride;
    const db = i * dstStride;
    out.set(splatData.subarray(sb, sb + dstStride), db);
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

export { halfToFloat } from "./splatLayout";

/**
 * Per-splat rendering importance ≈ `opacity × splat size`, used to keep the most
 * visually significant splats when a cloud must be decimated to fit the GPU.
 * Size is `sqrt(trace(Σ)) = length(scale)`, which is rotation-invariant.
 * Activated scale is f32 at words 3..5; opacity is the low half of word 10.
 */
export function computeSplatImportance(
  splatData: Uint32Array,
  stride: number,
): Float32Array {
  const n = stride >= splatStrideForDegree(0)
    ? Math.floor(splatData.length / stride)
    : 0;
  const out = new Float32Array(n);
  const f32 = new Float32Array(
    splatData.buffer,
    splatData.byteOffset,
    splatData.length,
  );
  for (let i = 0; i < n; i++) {
    const b = i * stride;
    const sx = f32[b + 3]!;
    const sy = f32[b + 4]!;
    const sz = f32[b + 5]!;
    const opacity = halfToFloat(splatData[b + 10]! & 0xffff);
    const trace = sx * sx + sy * sy + sz * sz;
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
 * - `full`: preserve every source splat and its requested SH degree. If neither
 *   texture arrays nor the explicit packed fallback can hold it, reject the
 *   upload with structured status instead of silently reducing fidelity.
 * - `decimated`: reduce to the quality fraction / preview budget for lighter
 *   VRAM and faster per-frame sorting on very large clouds.
 */
export type SplatRenderMode = "full" | "decimated";

/** Default rendering mode: show the whole cloud (device-limited). */
export const DEFAULT_SPLAT_RENDER_MODE: SplatRenderMode = "full";

/** Why the renderer used an explicit fallback or could not upload a cloud. */
export type SplatFallbackReason =
  | "source-data-decimated"
  | "texture-arrays-unavailable"
  | "texture-array-capacity-exceeded"
  | "order-buffer-capacity-exceeded"
  | "texture-array-capacity-decimation"
  | "order-buffer-capacity-decimation"
  | "packed-storage-capacity-exceeded"
  | "gpu-sort-unavailable"
  | "texture-upload-failed";

/** Structured result for every Gaussian upload attempt. */
export interface SplatUploadStatus {
  outcome: "empty" | "uploaded" | "fallback" | "failed";
  sourceCount: number;
  uploadedCount: number;
  requestedShDegree: number;
  effectiveShDegree: number;
  renderMode: SplatRenderMode;
  resourceMode: GaussianResourceMode;
  fallbackReason: SplatFallbackReason | null;
}

const DEFAULT_MAX_BUFFER_BYTES = 268_435_456;
const MAX_U32_SPLAT_COUNT = 0xffff_ffff;

/**
 * Largest cloud that may still depend on the CPU worker sort. Above it a chunked
 * upload keeps no CPU copy of the positions (12 B/splat, doubled by the worker
 * transfer), so the GPU compute sort is mandatory.
 */
export const CPU_SORT_MAX_SPLATS = 16_000_000;

/** Local-frame bounds of a finished chunked upload. */
export interface SplatUploadBounds {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

function textureArrayCapacity(device: GPUDevice, shDegree: number): number {
  if (
    typeof device.createTexture !== "function" ||
    typeof device.queue.writeTexture !== "function"
  ) {
    return 0;
  }
  const dimension = Math.floor(device.limits?.maxTextureDimension2D ?? 0);
  const layers = Math.floor(device.limits?.maxTextureArrayLayers ?? 0);
  if (dimension <= 0 || layers <= 0) return 0;
  const featureLayers = gaussianFeatureTexelsForDegree(shDegree);
  const pages = Math.min(
    Math.floor(layers / GAUSSIAN_TRANSFORM_TEXELS),
    Math.floor(layers / featureLayers),
  );
  return Math.min(MAX_U32_SPLAT_COUNT, dimension * dimension * pages);
}

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
  /** 2D low-pass filter size (px²); larger = fuller/blurrier splats. */
  private dilation = DEFAULT_SPLAT_DILATION;
  /** Diagnostic encoding for inputs whose decoded SH is known to be linear. */
  private encodeLinearToSrgb = false;
  /**
   * Cap screen-space splat anisotropy while a decimated preview is active. Full
   * mode leaves this off so its (dense) render is bit-for-bit unchanged; when a
   * cloud is reduced to a budget the surviving large splats would otherwise
   * project into bright needles once their small neighbours are gone.
   */
  private clampAnisotropy = false;
  /**
   * When true, a colour-masked depth pass runs after this cloud's colour draw
   * so later translucent geometry (the dynamic actor splats) is occluded by the
   * scene's opaque surfaces instead of always compositing on top.
   */
  private occluderDepth = false;
  private occluderAlphaMin = DEFAULT_OCCLUDER_ALPHA_MIN;
  private occluderSigma = DEFAULT_OCCLUDER_SIGMA;
  private occluderDepthBias = DEFAULT_OCCLUDER_DEPTH_BIAS;
  /** SOG training model of the loaded cloud: 0 = standard 3DGS, 1 = `antialiased`. */
  private splatModel = 0;
  /** A fixed-capacity LOD store is loaded: empty slots (radius 0) are skipped by the sort. */
  private resident = false;
  /** Time of the last redraw request caused by a resident-store write. */
  private lastResidentRefreshMs = Number.NEGATIVE_INFINITY;
  private residentRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** Optional GPU compute sorter; lazily built the first time GPU sort runs. */
  private gpuSorter: GpuSplatSorter | null = null;
  /** Measures the GPU sort's real duration where the device has timestamp queries. */
  private sortTimer: GpuSortTimer | null = null;
  /** When true and the texture-array path is active, sort on the GPU each frame. */
  private useGpuSort = false;
  /** Latest camera pose, captured by {@link onCamera} for the GPU sort pass. */
  private lastCamPos: Vec3 = [0, 0, 0];
  private lastViewDir: Vec3 = [0, 0, 1];
  /** Camera uniform of the latest frame; the key pass culls against its projection. */
  private lastCullKey: Float32Array = new Float32Array(0);
  private lastSortedCullKey: Float32Array = new Float32Array(0);
  private frustumCull = true;
  /** Visible-splat budget while the camera moves (0 = unlimited / thinning off). */
  private interactiveBudget = 0;
  /** Current thinning threshold in pixels, steered by {@link nextThinTau}. */
  private thinTau = 0;
  /** Set when the camera has settled, so the next sort runs at full quality. */
  private forceFullSort = false;
  private refineTimer: ReturnType<typeof setTimeout> | null = null;
  /** The host animates content (playback): stay on the budgeted order even with a still camera. */
  private interactiveHold = false;
  private holdConvergeLeft = 0;
  /** In-progress chunked upload, or `null`. */
  private chunkedUpload: ChunkedUploadSession | null = null;
  /** Set when a huge cloud made the GPU sort mandatory; ignores `setGpuSort(false)`. */
  private gpuSortForced = false;
  /** Chunked uploads above this size require the GPU sort (see {@link CPU_SORT_MAX_SPLATS}). */
  cpuSortMaxSplats = CPU_SORT_MAX_SPLATS;
  /**
   * GPU-sort skip cache. The counting sort orders splats back-to-front for the
   * current camera; that order only changes when the cloud changes (upload/
   * invalidate) or the camera moves. For a large static scene (e.g. a 10M-splat
   * reconstruction) re-running the sort every frame while the camera holds still
   * is pure waste and dominates preview-playback frame time. We record the pose
   * we last sorted for and a dirty flag, then skip the sort when nothing changed
   * (the persistent order buffer stays valid). A moving-actor cloud re-uploads
   * every frame (which calls invalidateSort), so it always re-sorts.
   */
  private gpuSortDirty = true;
  private lastSortedCamPos: Vec3 = [NaN, NaN, NaN];
  private lastSortedViewDir: Vec3 = [NaN, NaN, NaN];
  /** Timestamp (ms) of the last GPU sort, for the re-sort rate cap. */
  private lastGpuSortMs = Number.NEGATIVE_INFINITY;
  /** One-time diagnostic latch so the GPU-sort status is logged once per state. */
  private gpuSortLogged = false;
  /** Cloud AABB (world) for O(1) per-frame projected depth-range estimation. */
  private boundsMin: Vec3 = [0, 0, 0];
  private boundsMax: Vec3 = [0, 0, 0];
  /** Max bytes bindable by the explicit packed compatibility path. */
  private readonly maxStorageBytes: number;
  /** Max splats addressable by the one global order storage buffer. */
  private readonly maxOrderCount: number;
  private _uploadStatus: SplatUploadStatus = {
    outcome: "empty",
    sourceCount: 0,
    uploadedCount: 0,
    requestedShDegree: 0,
    effectiveShDegree: 0,
    renderMode: DEFAULT_SPLAT_RENDER_MODE,
    resourceMode: "none",
    fallbackReason: null,
  };

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
    packedFallbackBindGroupLayout: GPUBindGroupLayout = bindGroupLayout,
    private readonly packedFallbackPipeline: GPURenderPipeline = pipeline,
    /** Colour-masked depth pass; absent on bundles built without it. */
    private readonly depthPipeline: GPURenderPipeline | null = null,
  ) {
    const maxBufferBytes =
      this.device.limits?.maxBufferSize ?? DEFAULT_MAX_BUFFER_BYTES;
    this.maxStorageBytes = Math.min(
      this.device.limits?.maxStorageBufferBindingSize ?? DEFAULT_MAX_STORAGE_BINDING_BYTES,
      maxBufferBytes,
      GPU_SPLAT_MEMORY_BUDGET,
    );
    this.maxOrderCount = Math.min(
      MAX_U32_SPLAT_COUNT,
      Math.floor(this.maxStorageBytes / Uint32Array.BYTES_PER_ELEMENT),
    );
    this.resources = new GaussianSplatResources(
      this.device,
      bindGroupLayout,
      packedFallbackBindGroupLayout,
    );
    this.sort = new SplatSortController(sorter, (idx, visibleCount) => {
      this.resources.updateOrder(idx, visibleCount);
      this.onOrderChanged?.();
    });
  }

  /** Whether there are splats to draw. */
  get hasContent(): boolean {
    return this.resources.hasContent;
  }

  /** Smoothed GPU time of the depth sort in ms; `null` without timestamp queries or before the first sort. */
  get sortMs(): number | null {
    return this.sortTimer?.ms ?? null;
  }

  /** Number of splats currently loaded. */
  get count(): number {
    return this.resources.count;
  }

  /** Result of the most recent upload attempt. */
  get uploadStatus(): Readonly<SplatUploadStatus> {
    return this._uploadStatus;
  }

  /**
   * Upload a packed SH splat buffer and prime the sorter. Full mode is atomic:
   * it preserves both source count and SH degree or returns `failed`. Decimated
   * mode alone may apply quality/sampling and hardware capacity bounds.
   */
  upload(
    splatData: Uint32Array,
    shDegree: number,
    layoutVersion: number,
    sampleMode: SplatSampleMode = DEFAULT_SPLAT_SAMPLE_MODE,
    quality = 1,
    renderMode: SplatRenderMode = DEFAULT_SPLAT_RENDER_MODE,
    sourceCount?: number,
  ): SplatUploadStatus {
    this.abortUpload();
    this.gpuSortForced = false;
    this.splatModel = 0;
    const stride = assertGaussianSplatBuffer(
      splatData,
      shDegree,
      layoutVersion,
    );
    const inputCount = Math.floor(splatData.length / stride);
    const reportedSourceCount = Math.max(
      inputCount,
      Number.isFinite(sourceCount) ? Math.floor(sourceCount!) : inputCount,
    );
    const emptyStatus: SplatUploadStatus = {
      outcome: "empty",
      sourceCount: reportedSourceCount,
      uploadedCount: 0,
      requestedShDegree: shDegree,
      effectiveShDegree: shDegree,
      renderMode,
      resourceMode: "none",
      fallbackReason: null,
    };
    if (inputCount === 0) {
      this.clear();
      this._uploadStatus = emptyStatus;
      return this._uploadStatus;
    }

    const bytesPerSplat = stride * Uint32Array.BYTES_PER_ELEMENT;
    const packedCapacity = Math.floor(this.maxStorageBytes / bytesPerSplat);
    const textureCapacity = textureArrayCapacity(this.device, shDegree);
    const textureAvailable = textureCapacity > 0;
    const full = renderMode === "full";
    // Only decimated previews need needle suppression; full mode stays exact.
    this.clampAnisotropy = !full;
    let resourceMode: Exclude<GaussianResourceMode, "none">;
    let fallbackReason: SplatFallbackReason | null = null;
    let maxSplats = inputCount;

    if (full) {
      if (reportedSourceCount > inputCount) {
        return this.failUpload(
          reportedSourceCount,
          shDegree,
          renderMode,
          "source-data-decimated",
        );
      }
      if (inputCount > this.maxOrderCount) {
        return this.failUpload(
          reportedSourceCount,
          shDegree,
          renderMode,
          "order-buffer-capacity-exceeded",
        );
      }
      if (textureAvailable && inputCount <= textureCapacity) {
        resourceMode = "texture-array";
      } else if (inputCount <= packedCapacity) {
        resourceMode = "packed-storage-fallback";
        fallbackReason = textureAvailable
          ? "texture-array-capacity-exceeded"
          : "texture-arrays-unavailable";
      } else {
        return this.failUpload(
          reportedSourceCount,
          shDegree,
          renderMode,
          textureAvailable
            ? "texture-array-capacity-exceeded"
            : "packed-storage-capacity-exceeded",
        );
      }
    } else {
      const q = Math.min(1, Math.max(0, quality));
      const byQuality =
        q >= 1 ? inputCount : Math.max(1, Math.floor(inputCount * q));
      const requested = Math.min(byQuality, PREVIEW_SPLAT_BUDGET);
      if (textureAvailable) {
        resourceMode = "texture-array";
        maxSplats = Math.min(requested, textureCapacity, this.maxOrderCount);
        if (maxSplats < requested) {
          fallbackReason =
            this.maxOrderCount <= textureCapacity
              ? "order-buffer-capacity-decimation"
              : "texture-array-capacity-decimation";
        }
      } else {
        resourceMode = "packed-storage-fallback";
        fallbackReason = "texture-arrays-unavailable";
        maxSplats = Math.min(requested, packedCapacity, this.maxOrderCount);
      }
      if (maxSplats <= 0) {
        return this.failUpload(
          reportedSourceCount,
          shDegree,
          renderMode,
          this.maxOrderCount <= 0
            ? "order-buffer-capacity-exceeded"
            : "packed-storage-capacity-exceeded",
        );
      }
    }

    const data =
      maxSplats < inputCount
        ? sampleSplatBuffer(splatData, stride, maxSplats, sampleMode)
        : splatData;
    const kept = Math.floor(data.length / stride);
    try {
      this.resources.upload(data, shDegree, layoutVersion, resourceMode);
    } catch (error) {
      if (
        resourceMode === "texture-array" &&
        kept <= packedCapacity &&
        kept <= this.maxOrderCount
      ) {
        console.warn("[Splat] Texture upload failed; using explicit packed fallback", error);
        resourceMode = "packed-storage-fallback";
        fallbackReason = "texture-upload-failed";
        try {
          this.resources.upload(data, shDegree, layoutVersion, resourceMode);
        } catch (fallbackError) {
          console.error("[Splat] Packed fallback upload failed", fallbackError);
          return this.failUpload(
            reportedSourceCount,
            shDegree,
            renderMode,
            "texture-upload-failed",
          );
        }
      } else {
        console.error("[Splat] Texture upload failed", error);
        return this.failUpload(
          reportedSourceCount,
          shDegree,
          renderMode,
          "texture-upload-failed",
        );
      }
    }

    const positions = extractSplatPositions(data, stride);
    // Build the GPU positions buffer and cloud bounds BEFORE handing the array
    // to the worker sorter: `setSplats` transfers (zero-copies) `positions.buffer`
    // to the worker, which neuters the main-thread view (length -> 0). Doing this
    // first keeps the GPU-sort positions buffer populated instead of empty.
    this.resources.setPositions(positions);
    this.resources.setOccluderSource(data, stride, this.occluderAlphaMin);
    this.updateBounds(positions);
    this.gpuSorter?.resize(this.resources.count);
    this.resetThinning();
    this.sort.setSplats(positions);
    this._uploadStatus = {
      outcome:
        fallbackReason !== null || resourceMode === "packed-storage-fallback"
          ? "fallback"
          : "uploaded",
      sourceCount: reportedSourceCount,
      uploadedCount: kept,
      requestedShDegree: shDegree,
      effectiveShDegree: shDegree,
      renderMode,
      resourceMode,
      fallbackReason,
    };
    console.info(
      `[Splat] Upload ${this._uploadStatus.outcome}: ` +
        `${reportedSourceCount.toLocaleString()} → ${kept.toLocaleString()}, ` +
        `SH ${shDegree}, resource=${resourceMode}`,
    );
    return this._uploadStatus;
  }

  /**
   * Begin a chunked, full-fidelity upload of `totalCount` splats in layout v2.
   * Chunks go straight to the GPU, so the cloud never has to exist as one CPU
   * buffer. Returns the pending status (`outcome: "empty"`), or a `failed`
   * status when the device cannot hold the cloud, in which case nothing is
   * allocated and no chunk should be appended. Always full mode: it never
   * reduces the splat count or SH degree.
   */
  beginUpload(
    totalCount: number,
    shDegree: number,
    layoutVersion: number,
    sourceCount: number = totalCount,
    splatModel?: string,
    progressive = false,
  ): SplatUploadStatus {
    this.abortUpload();
    this.splatModel = splatModel === "antialiased" ? 1 : 0;
    const renderMode: SplatRenderMode = "full";
    this.clampAnisotropy = false;
    const fail = (reason: SplatFallbackReason) =>
      this.failUpload(sourceCount, shDegree, renderMode, reason);

    const textureCapacity = textureArrayCapacity(this.device, shDegree);
    if (textureCapacity <= 0) return fail("texture-arrays-unavailable");
    if (totalCount > textureCapacity) return fail("texture-array-capacity-exceeded");
    if (totalCount > this.maxOrderCount) return fail("order-buffer-capacity-exceeded");
    const needGpuSort = totalCount > this.cpuSortMaxSplats;
    if (needGpuSort && typeof this.device.createComputePipeline !== "function") {
      return fail("gpu-sort-unavailable");
    }
    // Drawing a partial cloud needs the GPU sort (the CPU sort only knows the whole cloud).
    const drawWhileUploading =
      progressive &&
      (this.useGpuSort || needGpuSort) &&
      typeof this.device.createComputePipeline === "function";
    try {
      this.resources.beginChunkedUpload(totalCount, shDegree, layoutVersion, drawWhileUploading);
    } catch (error) {
      console.error("[Splat] Chunked upload could not start", error);
      return fail("texture-upload-failed");
    }
    this.sort.setSplats(new Float32Array(0));
    this.chunkedUpload = {
      sourceCount,
      shDegree,
      stride: splatStrideForDegree(shDegree),
      total: totalCount,
      cpuPositions: needGpuSort ? null : new Float32Array(totalCount * 3),
      progressive: drawWhileUploading,
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
      lastRefreshMs: Number.NEGATIVE_INFINITY,
    };
    this.gpuSortForced = needGpuSort;
    this._uploadStatus = {
      outcome: "empty",
      sourceCount,
      uploadedCount: 0,
      requestedShDegree: shDegree,
      effectiveShDegree: shDegree,
      renderMode,
      resourceMode: "none",
      fallbackReason: null,
    };
    return this._uploadStatus;
  }

  /** Whether a chunked upload is in progress. */
  get uploading(): boolean {
    return this.chunkedUpload !== null;
  }

  /** Whether the in-progress chunked upload is drawn before it finishes. */
  get progressiveUpload(): boolean {
    return this.chunkedUpload?.progressive ?? false;
  }

  /**
   * Append the next chunk (whole layout-v2 records) of the upload started by
   * {@link beginUpload}. Returns `false` after a failure, which also aborts the
   * upload and leaves a `failed` status.
   */
  appendUpload(chunk: Uint32Array, prepared?: PreparedSplatChunk): boolean {
    const session = this.chunkedUpload;
    if (!session) throw new Error("No chunked Gaussian upload in progress");
    const first = this.resources.chunkedWritten;
    try {
      this.resources.appendChunkedUpload(chunk, prepared);
    } catch (error) {
      console.error("[Splat] Chunked upload failed", error);
      this.failUpload(session.sourceCount, session.shDegree, "full", "texture-upload-failed");
      return false;
    }
    session.cpuPositions?.set(extractSplatPositions(chunk, session.stride), first * 3);
    if (session.progressive) this.refreshProgressive(session, chunk, prepared);
    return true;
  }

  /**
   * Grow the partial cloud's bounds and, at most every {@link PROGRESSIVE_REFRESH_MS},
   * ask for a re-sort + redraw so the splats uploaded so far appear without
   * starving the upload of GPU time.
   */
  private refreshProgressive(
    session: ChunkedUploadSession,
    chunk: Uint32Array,
    prepared?: PreparedSplatChunk,
  ): void {
    const positions = prepared?.positions ?? extractSplatPositions(chunk, session.stride);
    for (let i = 0; i + 2 < positions.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        const v = positions[i + a]!;
        if (!Number.isFinite(v)) continue;
        if (v < session.min[a]!) session.min[a] = v;
        if (v > session.max[a]!) session.max[a] = v;
      }
    }
    this.boundsMin = [session.min[0], session.min[1], session.min[2]];
    this.boundsMax = [session.max[0], session.max[1], session.max[2]];
    const now = performance.now();
    if (now - session.lastRefreshMs < PROGRESSIVE_REFRESH_MS) return;
    session.lastRefreshMs = now;
    this.gpuSortDirty = true;
    this.onOrderChanged?.();
  }

  /**
   * Finish the chunked upload; `bounds` is the cloud's AABB in the same local
   * frame as the positions. Returns the final upload status.
   */
  endUpload(bounds: SplatUploadBounds): SplatUploadStatus {
    const session = this.chunkedUpload;
    if (!session) throw new Error("No chunked Gaussian upload in progress");
    try {
      this.resources.endChunkedUpload();
    } catch (error) {
      console.error("[Splat] Chunked upload could not finish", error);
      return this.failUpload(session.sourceCount, session.shDegree, "full", "texture-upload-failed");
    }
    this.chunkedUpload = null;
    // A cloud that needs the GPU sort draws its occluder from the sort's visible
    // list, so the whole-cloud index would only cost memory.
    if (!this.gpuSortForced) this.resources.rebuildOccluderIndex(this.occluderAlphaMin);
    this.boundsMin = [bounds.min[0], bounds.min[1], bounds.min[2]];
    this.boundsMax = [bounds.max[0], bounds.max[1], bounds.max[2]];
    this.gpuSorter?.resize(this.resources.count);
    this.resetThinning();
    this.sort.setSplats(session.cpuPositions ?? new Float32Array(0));
    if (this.gpuSortForced) this.setGpuSort(true);
    this._uploadStatus = {
      outcome: "uploaded",
      sourceCount: session.sourceCount,
      uploadedCount: session.total,
      requestedShDegree: session.shDegree,
      effectiveShDegree: session.shDegree,
      renderMode: "full",
      resourceMode: "texture-array",
      fallbackReason: null,
    };
    console.info(
      `[Splat] Chunked upload: ${session.total.toLocaleString()} splats, SH ${session.shDegree}, ` +
        `GPU sort ${this.gpuSortForced ? "required" : "optional"}`,
    );
    return this._uploadStatus;
  }

  /** Cancel an in-progress chunked upload or resident store and free what it allocated. */
  abortUpload(): void {
    if (this.resident) {
      this.resident = false;
      this.gpuSortForced = false;
      this.resources.clear();
    }
    if (!this.chunkedUpload) return;
    this.chunkedUpload = null;
    this.gpuSortForced = false;
    this.resources.abortChunkedUpload();
  }

  /**
   * Allocate a fixed-capacity store of `capacity` splat slots for LOD streaming
   * and make the scene drawable: empty slots hold no splat and are skipped by the
   * GPU sort, which the store requires (and forces on). `bounds` is the whole
   * scene's AABB in the local frame, for the sort's depth-range estimate.
   */
  beginResidentStore(
    capacity: number,
    shDegree: number,
    layoutVersion: number,
    bounds: SplatUploadBounds,
    splatModel?: string,
  ): SplatUploadStatus {
    this.abortUpload();
    this.splatModel = splatModel === "antialiased" ? 1 : 0;
    this.clampAnisotropy = false;
    const fail = (reason: SplatFallbackReason) =>
      this.failUpload(capacity, shDegree, "full", reason);
    const textureCapacity = textureArrayCapacity(this.device, shDegree);
    if (textureCapacity <= 0) return fail("texture-arrays-unavailable");
    if (capacity > textureCapacity) return fail("texture-array-capacity-exceeded");
    if (capacity > this.maxOrderCount) return fail("order-buffer-capacity-exceeded");
    if (typeof this.device.createComputePipeline !== "function") return fail("gpu-sort-unavailable");
    try {
      this.resources.beginResidentStore(capacity, shDegree, layoutVersion);
    } catch (error) {
      console.error("[Splat] Resident store could not be allocated", error);
      return fail("texture-upload-failed");
    }
    this.sort.setSplats(new Float32Array(0));
    this.resident = true;
    this.gpuSortForced = true;
    this.boundsMin = [bounds.min[0], bounds.min[1], bounds.min[2]];
    this.boundsMax = [bounds.max[0], bounds.max[1], bounds.max[2]];
    this.gpuSorter?.resize(capacity);
    this.resetThinning();
    this.setGpuSort(true);
    this._uploadStatus = {
      outcome: "uploaded",
      sourceCount: 0,
      uploadedCount: 0,
      requestedShDegree: shDegree,
      effectiveShDegree: shDegree,
      renderMode: "full",
      resourceMode: "texture-array",
      fallbackReason: null,
    };
    console.info(
      `[Splat] Resident store: ${capacity.toLocaleString()} slots, SH ${shDegree}, ` +
        `${(capacity * 1e-6).toFixed(1)}M splats of GPU capacity`,
    );
    return this._uploadStatus;
  }

  /** Splat slots of the resident store, or 0 when none is loaded. */
  get residentCapacity(): number {
    return this.resident ? this.resources.capacity : 0;
  }

  /** Largest resident store this device can hold for `shDegree` (0 = unsupported). */
  residentCapacityLimit(shDegree: number): number {
    if (typeof this.device.createComputePipeline !== "function") return 0;
    return Math.min(textureArrayCapacity(this.device, shDegree), this.maxOrderCount);
  }

  /** Write prepared splats into slots `[first, first + prepared.count)` of the resident store. */
  writeResident(prepared: PreparedSplatChunk, first: number): void {
    this.resources.writeResident(prepared, first);
    this.markResidentChanged();
  }

  /** Empty slots `[first, first + count)` of the resident store. */
  releaseResident(first: number, count: number): void {
    this.resources.releaseResident(first, count);
    this.markResidentChanged();
  }

  /** Report how many splats the resident store holds, for {@link uploadStatus}. */
  setResidentCount(count: number, sourceCount = count): void {
    this._uploadStatus = { ...this._uploadStatus, sourceCount, uploadedCount: count };
  }

  /** Re-sort and redraw after a slot write, at most every {@link PROGRESSIVE_REFRESH_MS}. */
  private markResidentChanged(): void {
    this.gpuSortDirty = true;
    const wait = PROGRESSIVE_REFRESH_MS - (performance.now() - this.lastResidentRefreshMs);
    if (wait <= 0) {
      this.lastResidentRefreshMs = performance.now();
      this.onOrderChanged?.();
      return;
    }
    // A throttled write still needs one trailing redraw, or the last change of a burst stays unseen.
    if (this.residentRefreshTimer) return;
    this.residentRefreshTimer = setTimeout(() => {
      this.residentRefreshTimer = null;
      this.lastResidentRefreshMs = performance.now();
      this.onOrderChanged?.();
    }, wait);
  }

  private failUpload(
    sourceCount: number,
    shDegree: number,
    renderMode: SplatRenderMode,
    fallbackReason: SplatFallbackReason,
  ): SplatUploadStatus {
    this.chunkedUpload = null;
    this.gpuSortForced = false;
    this.resources.clear();
    this.sort.setSplats(new Float32Array(0));
    this._uploadStatus = {
      outcome: "failed",
      sourceCount,
      uploadedCount: 0,
      requestedShDegree: shDegree,
      effectiveShDegree: shDegree,
      renderMode,
      resourceMode: "none",
      fallbackReason,
    };
    return this._uploadStatus;
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

  /**
   * Enable/disable the depth-only occluder pass for this cloud.
   *
   * @param options.alphaMin - Minimum splat opacity that may occlude (higher =
   *   fewer leaks through translucent foliage, more see-through gaps).
   * @param options.sigma - Occluder core radius in quad units (2 = the full
   *   footprint, 1 ≈ 1σ). Larger closes gaps but eats into nearby actors.
   * @param options.depthBias - Relative reverse-Z push away from the eye.
   */
  setOccluderDepth(
    enabled: boolean,
    options?: { alphaMin?: number; sigma?: number; depthBias?: number },
  ): void {
    this.occluderDepth = enabled;
    if (options?.alphaMin !== undefined) {
      const alphaMin = Math.max(0, options.alphaMin);
      if (alphaMin !== this.occluderAlphaMin) {
        this.occluderAlphaMin = alphaMin;
        // Threshold changed: rebuild the fixed occluder index against the
        // already-cached opacities (no-op until a cloud has been uploaded).
        if (!this.gpuSortForced) this.resources.rebuildOccluderIndex(alphaMin);
      }
    }
    if (options?.sigma !== undefined) {
      this.occluderSigma = Math.max(0.01, options.sigma);
    }
    if (options?.depthBias !== undefined) {
      this.occluderDepthBias = Math.max(0, options.depthBias);
    }
    this.onOrderChanged?.();
  }

  /** Per-frame update: refresh the camera uniform and re-sort if needed. */
  onCamera(
    camera: CameraState,
    dimensionMode: "2d" | "3d",
    numPixelsPerMeter: number,
    width: number,
    height: number,
    viewProj?: Float32Array,
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
      this.clampAnisotropy,
      this.occluderAlphaMin,
      this.occluderSigma,
      this.occluderDepthBias,
      this.splatModel,
    );
    this.resources.updateUniform(uniform);
    this.lastCullKey = uniform.slice(0, CULL_KEY_FLOATS);
    const viewDir = computeViewDir(camera.position, camera.target);
    this.lastCamPos = [camera.position[0], camera.position[1], camera.position[2]];
    this.lastViewDir = viewDir;
    // GPU sort path: the order is produced every frame in sortGpu(); skip the
    // async worker sort and keep the whole cloud drawable (behind-eye splats are
    // culled in the vertex shader). Otherwise drive the CPU worker sort.
    if (this.isGpuSortEligible()) {
      // Suppress CPU sort deliveries so an in-flight worker result cannot
      // overwrite the GPU-sorted order buffer and cause a one-frame flicker.
      this.sort.suppress();
      this.resources.markAllVisible();
      return;
    }
    // GPU sort is not eligible for this cloud or device — ensure CPU sort can
    // deliver its results (it may have been suppressed by a prior setGpuSort(true)
    // or an earlier eligible frame).
    this.sort.unsuppress();
    // Frustum-cull off-screen splats in 3D (the perspective frustum tapers, so
    // culling is worthwhile). In 2D the orthographic view fills the viewport
    // and lateral culling buys little, so it is skipped.
    const frustum =
      dimensionMode === "3d" && viewProj ? frustumSidePlanes(viewProj) : undefined;
    this.sort.onCamera(camera.position, viewDir, frustum);
  }

  /** Whether the GPU compute sort should run for the current cloud/device. */
  private isGpuSortEligible(): boolean {
    return (
      this.useGpuSort &&
      this.resources.count > 0 &&
      this.resources.resourceMode === "texture-array" &&
      typeof this.device.createComputePipeline === "function"
    );
  }

  /**
   * Enable/disable culling of splats outside the view frustum in the GPU sort
   * (default on). Culling is lossless for a settled camera; turn it off to rule
   * it out when diagnosing edge artifacts under fast camera motion.
   */
  /**
   * After a budgeted sort: read back how many splats survived (once the frame has
   * been submitted) to steer the threshold, and arrange a full-quality re-sort for
   * when the camera stops.
   */
  private trackInteractiveBudget(budget: number, thinned: boolean): void {
    setTimeout(() => {
      void this.readVisibleCount()
        .then((visible) => {
          if (visible === null) return;
          const next = this.interactiveHold
            ? nextHeldThinTau(this.thinTau, visible, budget)
            : nextThinTau(this.thinTau, visible, budget);
          const changed = next !== this.thinTau;
          this.thinTau = next;
          // A held view has a still camera, so nothing else would re-sort with the corrected threshold.
          if (changed && this.interactiveHold && this.holdConvergeLeft > 0) {
            this.holdConvergeLeft--;
            this.gpuSortDirty = true;
            this.onOrderChanged?.();
          }
        })
        .catch(() => undefined);
    }, 0);
    if (!thinned || this.interactiveHold) return;
    if (this.refineTimer) clearTimeout(this.refineTimer);
    this.refineTimer = setTimeout(() => {
      this.refineTimer = null;
      this.forceFullSort = true;
      this.gpuSortDirty = true;
      this.onOrderChanged?.();
    }, INTERACTIVE_IDLE_MS);
  }

  /**
   * Cap the splats drawn while the camera moves at about `maxSplats` by thinning
   * small on-screen splats in the GPU sort; a settled camera re-sorts at full
   * quality. `0` (default) keeps every splat at all times.
   */
  setInteractiveBudget(maxSplats: number): void {
    const budget = Math.max(0, Math.floor(maxSplats));
    if (budget === this.interactiveBudget) return;
    this.interactiveBudget = budget;
    this.resetThinning();
    this.gpuSortDirty = true;
    this.onOrderChanged?.();
  }

  /**
   * While `hold` is set the budgeted (thinned) order stays in force even when the
   * camera is still, so a huge cloud is not redrawn at full quality every frame of
   * an animation (trajectory playback moves actors, not the camera). Releasing it
   * re-sorts at full quality. No effect on a cloud that fits the budget.
   */
  setInteractiveHold(hold: boolean): void {
    if (hold === this.interactiveHold) return;
    this.interactiveHold = hold;
    if (this.refineTimer) clearTimeout(this.refineTimer);
    this.refineTimer = null;
    if (!(this.interactiveBudget > 0 && this.resources.count > this.interactiveBudget)) return;
    this.forceFullSort = !hold;
    this.holdConvergeLeft = hold ? HOLD_CONVERGE_SORTS : 0;
    this.gpuSortDirty = true;
    this.onOrderChanged?.();
  }

  /** Start a cloud at the initial threshold when it exceeds the budget, else unthinned. */
  private resetThinning(): void {
    this.holdConvergeLeft = this.interactiveHold ? HOLD_CONVERGE_SORTS : 0;
    this.thinTau =
      this.interactiveBudget > 0 && this.resources.count > this.interactiveBudget
        ? THIN_TAU_INITIAL
        : 0;
  }

  setFrustumCull(enabled: boolean): void {
    if (this.frustumCull === enabled) return;
    this.frustumCull = enabled;
    this.gpuSortDirty = true;
    this.onOrderChanged?.();
  }

  /** Enable/disable the per-frame GPU compute sort. Wakes a redraw. */
  setGpuSort(enabled: boolean): void {
    // A cloud too large for the CPU sort cannot go back to it.
    if (!enabled && this.gpuSortForced) return;
    if (this.useGpuSort === enabled) return;
    this.useGpuSort = enabled;
    this.gpuSortLogged = false;
    this.gpuSortDirty = true;
    console.info(`[Splat] GPU depth sort ${enabled ? "requested" : "disabled"}`);
    if (enabled) {
      // Pre-suppress CPU sort results so that any worker sort already in-flight
      // at the moment we switch does not overwrite the GPU-sorted order buffer.
      // onCamera() will re-check eligibility each frame and keep this in sync.
      this.sort.suppress();
      this.resources.markAllVisible();
    } else {
      // Back to the CPU path: force a fresh worker sort on the next frame.
      this.resources.setIndirectDraw(null);
      this.sort.unsuppress();
      this.sort.invalidate();
    }
    this.onOrderChanged?.();
  }

  /** Recompute the cloud AABB used for the GPU sort's depth-range estimate. */
  private updateBounds(positions: Float32Array): void {
    const n = Math.floor(positions.length / 3);
    let x0 = Infinity, y0 = Infinity, z0 = Infinity;
    let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = positions[i * 3]!;
      const y = positions[i * 3 + 1]!;
      const z = positions[i * 3 + 2]!;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    if (!(x1 >= x0)) {
      x0 = y0 = z0 = x1 = y1 = z1 = 0;
    }
    this.boundsMin = [x0, y0, z0];
    this.boundsMax = [x1, y1, z1];
  }

  /** View-space depth [min,max] of the cloud AABB for the latest camera (O(1)). */
  private projectedDepthRange(): [number, number] {
    const v = this.lastViewDir;
    const camDepth =
      this.lastCamPos[0] * v[0] + this.lastCamPos[1] * v[1] + this.lastCamPos[2] * v[2];
    let minP = 0;
    let maxP = 0;
    for (let a = 0; a < 3; a++) {
      const lo = this.boundsMin[a]! * v[a]!;
      const hi = this.boundsMax[a]! * v[a]!;
      minP += Math.min(lo, hi);
      maxP += Math.max(lo, hi);
    }
    return [minP - camDepth, maxP - camDepth];
  }

  /**
   * Run the GPU compute sort into `encoder` (before the render pass) when it is
   * enabled and the texture-array path is active. Returns `true` when the GPU
   * sort ran; `false` leaves the CPU worker sort in charge. On any failure it
   * reverts to the CPU path so the cloud never gets stuck on a stale order.
   */
  sortGpu(encoder: GPUCommandEncoder): boolean {
    if (!this.useGpuSort || this.resources.count === 0) return false;
    // Granular, one-time diagnostics so a silent CPU fallback is visible.
    if (this.resources.resourceMode !== "texture-array") {
      this.logGpuSortOnce(
        `inactive — resource mode is "${this.resources.resourceMode}" (needs texture-array)`,
      );
      return false;
    }
    if (typeof this.device.createComputePipeline !== "function") {
      this.logGpuSortOnce("inactive — this device/browser has no WebGPU compute");
      return false;
    }
    const positionsBuffer = this.resources.gpuPositionsBuffer;
    const orderBuffer = this.resources.gpuOrderBuffer;
    if (!positionsBuffer || !orderBuffer) {
      this.logGpuSortOnce("inactive — positions/order buffer missing");
      return false;
    }
    // Skip the sort when neither the cloud nor the camera pose changed since the
    // last sort — the order buffer still holds a valid back-to-front ordering,
    // so drawing with it is correct. This is the dominant win for a large static
    // scene during preview playback (a static camera → zero per-frame sort cost).
    if (!this.gpuSortDirty && this.sameCameraAsLastSort()) {
      this.logGpuSortOnce(`ACTIVE (${this.resources.count.toLocaleString()} splats)`);
      return true;
    }
    // Rate-cap the expensive re-sort: under continuous motion re-sort at most
    // every gpuSortIntervalMs() and reuse the still-valid order buffer in
    // between, so the frame rate is not bound to the sort cost.
    const now = performance.now();
    if (
      !this.gpuSortDirty &&
      now - this.lastGpuSortMs < gpuSortIntervalMs(this.resources.count, this.sortTimer?.ms)
    ) {
      // Keep the render loop ticking so a trailing sort still runs once the
      // interval elapses after the camera settles (else the resting order stays
      // one interval stale).
      this.onOrderChanged?.();
      return true;
    }
    // Encoding faults (e.g. an over-limit dispatch) are reported asynchronously and
    // invalidate the entire command encoder, so the frame would render nothing at
    // all. Scope them so the next frame falls back to the CPU sort instead of
    // white-screening forever.
    const scoped = typeof this.device.pushErrorScope === "function";
    if (scoped) this.device.pushErrorScope("validation");
    try {
      if (!this.gpuSorter) {
        this.gpuSorter = new GpuSplatSorter(this.device);
        this.sortTimer = new GpuSortTimer(this.device);
      }
      // Sized for the whole cloud even while an upload is still filling it.
      this.gpuSorter.resize(this.resources.capacity);
      const [minD, maxD] = this.projectedDepthRange();
      const radiiBuffer = this.resources.gpuRadiiBuffer;
      const fullQuality = this.forceFullSort && !this.interactiveHold;
      const budget = this.interactiveBudget;
      const thinning = budget > 0 && !fullQuality && this.resources.count > budget;
      const thinTau = thinning ? this.thinTau : 0;
      const stamps = this.sortTimer?.begin() ?? null;
      this.gpuSorter.sort(
        encoder,
        positionsBuffer,
        orderBuffer,
        this.lastCamPos,
        this.lastViewDir,
        minD,
        maxD,
        radiiBuffer && (this.frustumCull || this.resident)
          ? {
              uniformBuffer: this.resources.gpuUniformBuffer,
              radiiBuffer,
              guardNdc: GPU_SORT_CULL_GUARD_NDC,
              thinTau: this.frustumCull ? thinTau : 0,
              enabled: this.frustumCull,
              deadSplats: this.resident,
            }
          : undefined,
        this.resources.count,
        stamps,
      );
      this.sortTimer?.end(encoder, stamps !== null);
      this.forceFullSort = false;
      if (thinning && radiiBuffer && this.frustumCull) this.trackInteractiveBudget(budget, thinTau > 0);
      // Remember the pose we just sorted for so identical subsequent frames skip.
      this.lastSortedCamPos = [this.lastCamPos[0], this.lastCamPos[1], this.lastCamPos[2]];
      this.lastSortedViewDir = [this.lastViewDir[0], this.lastViewDir[1], this.lastViewDir[2]];
      this.lastSortedCullKey = this.lastCullKey;
      // The sort parked behind-eye splats at the tail of the order and counted the
      // survivors into its indirect draw arguments — draw only that prefix.
      this.resources.setIndirectDraw(this.gpuSorter.drawArgsBuffer);
      this.gpuSortDirty = false;
      this.lastGpuSortMs = now;
      this.logGpuSortOnce(`ACTIVE (${this.resources.count.toLocaleString()} splats)`);
    } catch (error) {
      if (scoped) void this.device.popErrorScope().catch(() => undefined);
      this.revertToCpuSort(error);
      return false;
    }
    if (scoped) {
      void this.device
        .popErrorScope()
        .then((err) => {
          if (err) this.revertToCpuSort(err.message);
        })
        .catch(() => undefined);
    }
    return true;
  }

  /**
   * Diagnostic: how many splats the most recent GPU sort kept (the indirect draw's
   * instance count), or `null` when no GPU sort has produced one. Stalls on a GPU readback.
   */
  async readVisibleCount(): Promise<number | null> {
    const args = this.gpuSorter?.drawArgsBuffer;
    if (!args) return null;
    const staging = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(args, 0, staging, 0, 16);
    this.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(1 /* GPUMapMode.READ */);
    const count = new Uint32Array(staging.getMappedRange().slice(0))[1] ?? 0;
    staging.unmap();
    staging.destroy();
    return count;
  }

  /** Permanently fall back to the CPU worker sort after a GPU sort failure. */
  private revertToCpuSort(error: unknown): void {
    if (!this.useGpuSort) return;
    console.error("[Splat] GPU sort failed; reverting to CPU sort", error);
    this.useGpuSort = false;
    this.resources.setIndirectDraw(null);
    this.gpuSorter?.dispose();
    this.gpuSorter = null;
    this.sort.unsuppress();
    this.sort.invalidate();
    this.onOrderChanged?.();
  }

  /**
   * True when the current camera pose matches the pose the GPU sort last ran for,
   * so the cached order buffer is still correct. A tiny epsilon absorbs float
   * noise; any real camera motion (pan/orbit/fly/chase) fails it and re-sorts.
   */
  private sameCameraAsLastSort(): boolean {
    const p = this.lastCamPos;
    const q = this.lastSortedCamPos;
    const d = this.lastViewDir;
    const e = this.lastSortedViewDir;
    const EPS_POS = 1e-3; // world meters
    const EPS_DIR = 1e-5;
    const a = this.lastCullKey;
    const b = this.lastSortedCullKey;
    // The frustum cull bakes projection, viewport and dilation into the order, so
    // any change to them (not just camera motion) invalidates it.
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) return false;
    return (
      Math.abs(p[0] - q[0]) < EPS_POS &&
      Math.abs(p[1] - q[1]) < EPS_POS &&
      Math.abs(p[2] - q[2]) < EPS_POS &&
      Math.abs(d[0] - e[0]) < EPS_DIR &&
      Math.abs(d[1] - e[1]) < EPS_DIR &&
      Math.abs(d[2] - e[2]) < EPS_DIR
    );
  }

  /** Log a GPU-sort status line at most once per enable/upload. */
  private logGpuSortOnce(message: string): void {
    if (this.gpuSortLogged) return;
    this.gpuSortLogged = true;
    console.info(`[Splat] GPU depth sort ${message}`);
  }

  /** Draw the splats into the active render pass (after opaque geometry). */
  draw(pass: GPURenderPassEncoder): void {
    this.resources.draw(pass, this.pipeline, this.packedFallbackPipeline);
  }

  /**
   * Write this cloud's opaque-core depth (no colour). Call right after
   * {@link draw} so splats drawn later in the same pass are depth-tested
   * against this scene.
   */
  drawDepthOnly(pass: GPURenderPassEncoder): void {
    if (!this.occluderDepth || !this.depthPipeline) return;
    this.resources.drawDepthOnly(pass, this.depthPipeline);
  }

  /** Remove the current cloud. */
  clear(): void {
    this.abortUpload();
    this.gpuSortForced = false;
    this.resources.clear();
    this.sort.setSplats(new Float32Array(0));
    this._uploadStatus = {
      outcome: "empty",
      sourceCount: 0,
      uploadedCount: 0,
      requestedShDegree: 0,
      effectiveShDegree: 0,
      renderMode: DEFAULT_SPLAT_RENDER_MODE,
      resourceMode: "none",
      fallbackReason: null,
    };
  }

  /** Force a re-sort next frame (e.g. after a projection change). */
  invalidateSort(): void {
    this.gpuSortDirty = true;
    this.sort.invalidate();
  }

  /** Release all GPU + worker resources. */
  dispose(): void {
    if (this.refineTimer) clearTimeout(this.refineTimer);
    this.refineTimer = null;
    if (this.residentRefreshTimer) clearTimeout(this.residentRefreshTimer);
    this.residentRefreshTimer = null;
    this.resources.dispose();
    this.sort.dispose();
    this.gpuSorter?.dispose();
    this.gpuSorter = null;
    this.sortTimer?.dispose();
    this.sortTimer = null;
    this.gpuSorter = null;
  }
}

/**
 * Convenience constructor: create the pipeline and a worker-backed
 * `SplatRenderer` in one call.
 */
export function createSplatRenderer(
  device: GPUDevice,
  format: GPUTextureFormat,
  sampleCount: number,
  onOrderChanged?: () => void,
): SplatRenderer {
  const {
    pipeline,
    bindGroupLayout,
    depthPipeline,
    packedFallbackPipeline,
    packedFallbackBindGroupLayout,
  } = createGaussianSplatPipeline(
    device,
    format,
    sampleCount,
  );
  return new SplatRenderer(
    device,
    bindGroupLayout,
    pipeline,
    createWorkerSplatSorter('scene'),
    onOrderChanged,
    packedFallbackBindGroupLayout,
    packedFallbackPipeline,
    depthPipeline,
  );
}
