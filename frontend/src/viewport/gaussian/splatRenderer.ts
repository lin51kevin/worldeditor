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
  assertGaussianSplatBuffer,
} from "./splatLayout";
import { SplatSortController, type SplatSorter } from "./splatSortController";
import { createWorkerSplatSorter } from "./splatSorterBackends";
import { buildSplatUniform, DEFAULT_SPLAT_DILATION } from "./splatUniform";
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
  const featureLayers = Math.ceil(
    (1 + (shDegree + 1) * (shDegree + 1) * 3) / 4,
  );
  const pages = Math.min(Math.floor(layers / 3), Math.floor(layers / featureLayers));
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

  private failUpload(
    sourceCount: number,
    shDegree: number,
    renderMode: SplatRenderMode,
    fallbackReason: SplatFallbackReason,
  ): SplatUploadStatus {
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
    );
    this.resources.updateUniform(uniform);
    const viewDir = computeViewDir(camera.position, camera.target);
    // Frustum-cull off-screen splats in 3D (the perspective frustum tapers, so
    // culling is worthwhile). In 2D the orthographic view fills the viewport
    // and lateral culling buys little, so it is skipped.
    const frustum =
      dimensionMode === "3d" && viewProj ? frustumSidePlanes(viewProj) : undefined;
    this.sort.onCamera(camera.position, viewDir, frustum);
  }

  /**
   * @deprecated GPU sorting is disabled. Its old shader depended on packed
   * splat storage and must be redesigned for texture-array transforms before it
   * can return. Worker sorting owns the one global order buffer.
   */
  sortGpu(_encoder: GPUCommandEncoder): boolean {
    return false;
  }

  /** Draw the splats into the active render pass (after opaque geometry). */
  draw(pass: GPURenderPassEncoder): void {
    this.resources.draw(pass, this.pipeline, this.packedFallbackPipeline);
  }

  /** Remove the current cloud. */
  clear(): void {
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
  const {
    pipeline,
    bindGroupLayout,
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
    createWorkerSplatSorter(),
    onOrderChanged,
    packedFallbackBindGroupLayout,
    packedFallbackPipeline,
  );
}
