/**
 * WebGPU pipelines and resources for Gaussian splat rendering.
 *
 * The high-fidelity path transposes packed layout-v2 input into paged
 * RGBA32F/RGBA16F texture arrays. Only the one global sorted-order array remains
 * a storage buffer, so source attributes are no longer constrained by one
 * `maxStorageBufferBindingSize`. A packed-storage pipeline remains available as
 * an explicit compatibility fallback and is always reported to callers.
 */
import { TRANSFORM_LAYERS, type PreparedSplatChunk } from "./splatPrepare";
import { GAUSSIAN_SPLAT_SHADER } from "./splatShader";
import { GAUSSIAN_SPLAT_PACKED_SHADER } from "./splatPackedShader";
import { SPLAT_UNIFORM_BYTES } from "./splatUniform";
import {
  GAUSSIAN_SPLAT_LAYOUT_VERSION,
  GAUSSIAN_SPLAT_TRANSFORM_WORDS,
  assertGaussianSplatBuffer,
  halfToFloat,
  planGaussianTextureArray,
  splatStrideForDegree,
  type GaussianTextureArrayLayout,
} from "./splatLayout";

export { splatStrideForDegree } from "./splatLayout";

export type GaussianResourceMode =
  | "texture-array"
  | "packed-storage-fallback"
  | "none";

export interface GaussianSplatPipelines {
  pipeline: GPURenderPipeline;
  bindGroupLayout: GPUBindGroupLayout;
  /** Colour-masked pass that writes the opaque core depth of each splat. */
  depthPipeline: GPURenderPipeline;
  packedFallbackPipeline: GPURenderPipeline;
  packedFallbackBindGroupLayout: GPUBindGroupLayout;
}

function createRenderPipeline(
  device: GPUDevice,
  shaderCode: string,
  bindGroupLayout: GPUBindGroupLayout,
  format: GPUTextureFormat,
  sampleCount: number,
): GPURenderPipeline {
  const shader = device.createShaderModule({ code: shaderCode });
  return device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: { module: shader, entryPoint: "vs_main" },
    fragment: {
      module: shader,
      entryPoint: "fs_main",
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
          },
        },
      ],
    },
    depthStencil: {
      format: "depth32float",
      depthWriteEnabled: false,
      depthCompare: "greater",
    },
    multisample: { count: sampleCount },
    primitive: { topology: "triangle-strip", stripIndexFormat: undefined },
  });
}

/**
 * Depth-only companion of {@link createRenderPipeline}: same instanced quads,
 * but colour writes are masked off and the splat core writes depth. Drawn after
 * the scene's colour pass so it seeds occlusion for later (actor) splats without
 * altering the scene's own blended result.
 */
function createDepthOnlyPipeline(
  device: GPUDevice,
  shaderCode: string,
  bindGroupLayout: GPUBindGroupLayout,
  format: GPUTextureFormat,
  sampleCount: number,
): GPURenderPipeline {
  const shader = device.createShaderModule({ code: shaderCode });
  return device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: { module: shader, entryPoint: "vs_depth" },
    fragment: {
      module: shader,
      entryPoint: "fs_depth",
      targets: [{ format, writeMask: 0 }],
    },
    depthStencil: {
      format: "depth32float",
      depthWriteEnabled: true,
      depthCompare: "greater",
    },
    multisample: { count: sampleCount },
    primitive: { topology: "triangle-strip", stripIndexFormat: undefined },
  });
}

/**
 * Create the texture-array primary pipeline and packed compatibility pipeline.
 * Both use one instanced draw and premultiplied back-to-front blending.
 */
export function createGaussianSplatPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  sampleCount: number,
): GaussianSplatPipelines {
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX,
        texture: {
          sampleType: "unfilterable-float",
          viewDimension: "2d-array",
        },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.VERTEX,
        texture: { sampleType: "float", viewDimension: "2d-array" },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage" },
      },
    ],
  });
  const packedFallbackBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage" },
      },
    ],
  });

  return {
    pipeline: createRenderPipeline(
      device,
      GAUSSIAN_SPLAT_SHADER,
      bindGroupLayout,
      format,
      sampleCount,
    ),
    bindGroupLayout,
    depthPipeline: createDepthOnlyPipeline(
      device,
      GAUSSIAN_SPLAT_SHADER,
      bindGroupLayout,
      format,
      sampleCount,
    ),
    packedFallbackPipeline: createRenderPipeline(
      device,
      GAUSSIAN_SPLAT_PACKED_SHADER,
      packedFallbackBindGroupLayout,
      format,
      sampleCount,
    ),
    packedFallbackBindGroupLayout,
  };
}

const COPY_ROW_ALIGNMENT = 256;
const MAX_STAGING_BYTES = 16 * 1024 * 1024;

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

/** GPU-side state for one globally sorted splat cloud. */
export class GaussianSplatResources {
  private transformTexture: GPUTexture | null = null;
  private featureTexture: GPUTexture | null = null;
  private packedSplatBuffer: GPUBuffer | null = null;
  private orderBuffer: GPUBuffer | null = null;
  private positionsBuffer: GPUBuffer | null = null;
  /** One f32 per splat: its largest activated scale axis (frustum-culling bound). */
  private radiiBuffer: GPUBuffer | null = null;
  private readonly uniformBuffer: GPUBuffer;
  private bindGroup: GPUBindGroup | null = null;
  private _count = 0;
  private _visibleCount = 0;
  /** GPU-written `[4, visibleCount, 0, 0]` draw arguments; `null` = CPU count. */
  private indirectBuffer: GPUBuffer | null = null;
  private _shDegree = 0;
  private _resourceMode: GaussianResourceMode = "none";
  private _textureLayout: GaussianTextureArrayLayout | null = null;
  // Depth-only occluder pass state: a fixed, opacity-filtered index buffer built
  // once per upload/threshold-change instead of every frame. The pass is order-
  // independent (it only writes depth), so it need not track the per-frame sort.
  /** Raw f16 opacity bits, one per uploaded splat; source for {@link rebuildOccluderIndex}. */
  private opacityHalfBits: Uint16Array | null = null;
  private occluderIndexBuffer: GPUBuffer | null = null;
  private occluderBindGroup: GPUBindGroup | null = null;
  private _occluderCount = 0;
  /** In-progress chunked upload, or `null`. */
  private chunked: { count: number; stride: number; written: number } | null =
    null;

  constructor(
    private readonly device: GPUDevice,
    private readonly bindGroupLayout: GPUBindGroupLayout,
    private readonly packedFallbackBindGroupLayout: GPUBindGroupLayout =
      bindGroupLayout,
  ) {
    this.uniformBuffer = device.createBuffer({
      size: SPLAT_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  /** Number of splats currently uploaded. */
  get count(): number {
    return this._count;
  }

  /** Number of sorted splats currently known to be in front of the camera. */
  get visibleCount(): number {
    return this._visibleCount;
  }

  /** SH degree of the current cloud. */
  get shDegree(): number {
    return this._shDegree;
  }

  /** Active source-resource representation. */
  get resourceMode(): GaussianResourceMode {
    return this._resourceMode;
  }

  /** Texture geometry used by the active high-fidelity upload. */
  get textureLayout(): GaussianTextureArrayLayout | null {
    return this._textureLayout;
  }

  /** Whether there is anything to draw. */
  get hasContent(): boolean {
    return this._count > 0 && this.bindGroup !== null;
  }

  /**
   * Mark every splat drawable. Used by the GPU compute sort, which orders the
   * whole cloud each frame (behind-eye splats are culled in the vertex shader),
   * so the CPU front-prefix `visibleCount` no longer applies. When an indirect
   * draw buffer is attached via {@link setIndirectDraw} the instance count comes
   * from the GPU instead and this value is only the inert fallback.
   */
  markAllVisible(): void {
    this._visibleCount = this._count;
  }

  /**
   * Attach the GPU sort's `drawIndirect` argument buffer, whose `instanceCount`
   * is the number of splats the sort found in front of the eye. Pass `null` to
   * go back to a CPU-supplied instance count.
   */
  setIndirectDraw(buffer: GPUBuffer | null): void {
    this.indirectBuffer = buffer;
  }

  /** The one global sorted index buffer. */
  get gpuOrderBuffer(): GPUBuffer | null {
    return this.orderBuffer;
  }

  /**
   * Dedicated `array<vec3<f32>>`-equivalent (3 f32 words/splat) of splat centres
   * for the GPU compute sort's depth pass. Populated by {@link setPositions}
   * after a texture-array upload; `null` on the packed fallback path or before
   * positions are provided.
   */
  get gpuPositionsBuffer(): GPUBuffer | null {
    return this.positionsBuffer;
  }

  /**
   * Per-splat largest activated scale axis (one f32 per splat), the radius bound
   * the GPU sort's key pass needs to cull splats outside the view frustum.
   */
  get gpuRadiiBuffer(): GPUBuffer | null {
    return this.radiiBuffer;
  }

  /** The splat camera uniform the vertex stage reads; the key pass culls against the same values. */
  get gpuUniformBuffer(): GPUBuffer {
    return this.uniformBuffer;
  }

  /**
   * Cache each splat's opacity from the just-uploaded source buffer and build
   * the initial depth-only occluder index for it. Call once right after
   * {@link upload} succeeds, passing the SAME `splatData`/`stride`. Cheap to
   * keep around: 2 bytes/splat, vs. re-scanning the full source buffer (tens of
   * bytes/splat) on every {@link rebuildOccluderIndex} call.
   */
  setOccluderSource(splatData: Uint32Array, stride: number, alphaMin: number): void {
    const bits = new Uint16Array(this._count);
    for (let i = 0; i < this._count; i++) {
      bits[i] = splatData[i * stride + GAUSSIAN_SPLAT_TRANSFORM_WORDS]! & 0xffff;
    }
    this.opacityHalfBits = bits;
    this.rebuildOccluderIndex(alphaMin);
  }

  /**
   * Rebuild the depth-only occluder pass's compacted "opaque enough to occlude"
   * index buffer for a new alpha threshold. The pass only writes depth and never
   * reads colour order, so — unlike the colour draw — its instance list can be
   * computed once per upload/threshold-change instead of every frame, and need
   * not track the per-frame (GPU- or CPU-)sorted order at all.
   */
  rebuildOccluderIndex(alphaMin: number): void {
    this.occluderIndexBuffer?.destroy();
    this.occluderIndexBuffer = null;
    this.occluderBindGroup = null;
    this._occluderCount = 0;
    const bits = this.opacityHalfBits;
    if (!bits || this._resourceMode !== "texture-array") return;
    if (!this.transformTexture || !this.featureTexture) return;
    const kept = new Uint32Array(bits.length);
    let n = 0;
    for (let i = 0; i < bits.length; i++) {
      if (halfToFloat(bits[i]!) >= alphaMin) kept[n++] = i;
    }
    if (n === 0) return;
    const indices = kept.subarray(0, n);
    this.occluderIndexBuffer = this.device.createBuffer({
      label: "Gaussian occluder index (opacity-compacted)",
      size: indices.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(
      this.occluderIndexBuffer,
      0,
      indices as GPUAllowSharedBufferSource,
    );
    this.occluderBindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        {
          binding: 1,
          resource: this.transformTexture.createView({ dimension: "2d-array" }),
        },
        {
          binding: 2,
          resource: this.featureTexture.createView({ dimension: "2d-array" }),
        },
        { binding: 3, resource: { buffer: this.occluderIndexBuffer } },
      ],
    });
    this._occluderCount = n;
  }

  /**
   * Upload packed layout-v2 input into the selected resource representation.
   * Texture capacity and order-buffer limits must be checked by `SplatRenderer`
   * before calling this method.
   */
  upload(
    splatData: Uint32Array,
    shDegree: number,
    layoutVersion: number,
    resourceMode?: Exclude<GaussianResourceMode, "none">,
  ): void {
    const stride = assertGaussianSplatBuffer(
      splatData,
      shDegree,
      layoutVersion,
    );
    this.releaseCloudResources();
    const count = splatData.length / stride;
    this._count = count;
    this._visibleCount = count;
    this._shDegree = shDegree;
    const selectedMode =
      resourceMode ??
      (typeof this.device.createTexture === "function" &&
      typeof this.device.queue.writeTexture === "function" &&
      this.device.limits
        ? "texture-array"
        : "packed-storage-fallback");
    this._resourceMode = count === 0 ? "none" : selectedMode;
    if (count === 0) return;

    try {
      this.createOrderBuffer(count);
      if (selectedMode === "texture-array") {
        this.uploadTextureArrays(splatData, stride, shDegree);
        this.uploadRadii(splatData, stride, count);
      } else {
        this.uploadPackedFallback(splatData);
      }
    } catch (error) {
      this.releaseCloudResources();
      this._count = 0;
      this._visibleCount = 0;
      this._resourceMode = "none";
      throw error;
    }
  }

  /**
   * Begin a chunked texture-array upload of `count` splats in layout v2. The
   * cloud is not drawable until {@link endChunkedUpload}. Chunks are written
   * straight into the GPU textures, so no full-size CPU copy is ever needed.
   * Throws when the device cannot hold the cloud; nothing stays allocated then.
   */
  beginChunkedUpload(
    count: number,
    shDegree: number,
    layoutVersion: number,
  ): void {
    if (layoutVersion !== GAUSSIAN_SPLAT_LAYOUT_VERSION) {
      throw new Error(`Unsupported Gaussian layout version ${layoutVersion}`);
    }
    if (!Number.isSafeInteger(count) || count <= 0) {
      throw new RangeError("Chunked upload needs a positive splat count");
    }
    const stride = splatStrideForDegree(shDegree);
    this.releaseCloudResources();
    this._count = 0;
    this._visibleCount = 0;
    this._shDegree = shDegree;
    this._resourceMode = "none";
    this.chunked = null;
    try {
      this.createTextureArrays(count, shDegree);
      this.orderBuffer = this.device.createBuffer({
        size: count * Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.positionsBuffer = this.device.createBuffer({
        size: count * 3 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.radiiBuffer = this.device.createBuffer({
        size: count * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.opacityHalfBits = new Uint16Array(count);
    } catch (error) {
      this.releaseCloudResources();
      throw error;
    }
    this.chunked = { count, stride, written: 0 };
  }

  /** Splats written so far by the in-progress chunked upload. */
  get chunkedWritten(): number {
    return this.chunked?.written ?? 0;
  }

  /**
   * Write the next `chunk` (whole layout-v2 records) of a chunked upload.
   * `prepared`, when given, is the same chunk already repacked by
   * {@link prepareSplatChunk} (typically in a worker), which skips the CPU repack.
   */
  appendChunkedUpload(chunk: Uint32Array, prepared?: PreparedSplatChunk): void {
    const session = this.chunked;
    if (!session) throw new Error("No chunked Gaussian upload in progress");
    const { stride, count, written } = session;
    if (chunk.length % stride !== 0) {
      throw new RangeError("Chunk is not a whole number of splat records");
    }
    const n = chunk.length / stride;
    if (written + n > count) {
      throw new RangeError("Chunk exceeds the declared splat count");
    }
    if (prepared && (prepared.count !== n || prepared.shDegree !== this._shDegree)) {
      throw new RangeError("Prepared chunk does not match the appended splats");
    }
    try {
      this.writeSplatRange(chunk, n, written, stride, prepared);
      this.writeSideBuffers(chunk, n, written, stride, prepared);
    } catch (error) {
      this.abortChunkedUpload();
      throw error;
    }
    session.written += n;
  }

  /** Finish a chunked upload; the cloud becomes drawable. */
  endChunkedUpload(): void {
    const session = this.chunked;
    if (!session) throw new Error("No chunked Gaussian upload in progress");
    if (session.written !== session.count) {
      this.abortChunkedUpload();
      throw new Error(
        `Chunked upload ended after ${session.written} of ${session.count} splats`,
      );
    }
    this._count = session.count;
    this._visibleCount = session.count;
    this._resourceMode = "texture-array";
    this.createTextureBindGroup();
    this.chunked = null;
  }

  /** Discard an in-progress chunked upload and free what it allocated. */
  abortChunkedUpload(): void {
    this.chunked = null;
    this.releaseCloudResources();
    this._count = 0;
    this._visibleCount = 0;
    this._resourceMode = "none";
  }

  /** Identity order, centres, radii and opacity bits for splats `[first, first+n)`. */
  private writeSideBuffers(
    chunk: Uint32Array,
    n: number,
    first: number,
    stride: number,
    prepared?: PreparedSplatChunk,
  ): void {
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = first + i;
    let positions: Float32Array;
    let radii: Float32Array;
    if (prepared) {
      positions = prepared.positions;
      radii = prepared.radii;
      this.opacityHalfBits!.set(prepared.opacity, first);
    } else {
      const f32 = new Float32Array(chunk.buffer, chunk.byteOffset, chunk.length);
      positions = new Float32Array(n * 3);
      radii = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const base = i * stride;
        positions[i * 3] = f32[base]!;
        positions[i * 3 + 1] = f32[base + 1]!;
        positions[i * 3 + 2] = f32[base + 2]!;
        radii[i] = Math.max(f32[base + 3]!, f32[base + 4]!, f32[base + 5]!);
        this.opacityHalfBits![first + i] =
          chunk[base + GAUSSIAN_SPLAT_TRANSFORM_WORDS]! & 0xffff;
      }
    }
    this.device.queue.writeBuffer(
      this.orderBuffer!,
      first * Uint32Array.BYTES_PER_ELEMENT,
      order as GPUAllowSharedBufferSource,
    );
    this.device.queue.writeBuffer(
      this.positionsBuffer!,
      first * 3 * Float32Array.BYTES_PER_ELEMENT,
      positions as GPUAllowSharedBufferSource,
    );
    this.device.queue.writeBuffer(
      this.radiiBuffer!,
      first * Float32Array.BYTES_PER_ELEMENT,
      radii as GPUAllowSharedBufferSource,
    );
  }

  /**
   * Write splats `[first, first + n)` of `chunk` into the texture arrays as
   * rectangles of raster-consecutive splats: a partial first/last row, or a run
   * of whole rows, so an arbitrary chunk size never overwrites its neighbours.
   */
  private writeSplatRange(
    chunk: Uint32Array,
    n: number,
    first: number,
    stride: number,
    prepared?: PreparedSplatChunk,
  ): void {
    const layout = this._textureLayout!;
    const maxRows = Math.max(
      1,
      Math.floor(
        MAX_STAGING_BYTES / alignTo(layout.width * 16, COPY_ROW_ALIGNMENT),
      ),
    );
    let done = 0;
    while (done < n) {
      const global = first + done;
      const page = Math.floor(global / layout.splatsPerPage);
      const local = global - page * layout.splatsPerPage;
      const y = Math.floor(local / layout.width);
      const x = local - y * layout.width;
      const left = n - done;
      let width: number;
      let rows: number;
      if (x !== 0 || left < layout.width) {
        width = Math.min(layout.width - x, left);
        rows = 1;
      } else {
        width = layout.width;
        const pageRowsLeft = Math.floor(
          (layout.splatsPerPage - local) / layout.width,
        );
        rows = Math.min(Math.floor(left / layout.width), maxRows, pageRowsLeft);
      }
      if (prepared) {
        this.writePreparedRect(prepared, done, layout, page, x, y, width, rows);
      } else {
        this.writeRect(chunk, done, stride, layout, page, x, y, width, rows);
      }
      done += width * rows;
    }
  }

  /**
   * Repack one rectangle of splats into every transform and feature layer in a
   * single pass over the chunk (one pass per layer re-reads the whole chunk from
   * memory several times over), then write each layer as its own texture copy.
   */
  private writeRect(
    chunk: Uint32Array,
    firstInChunk: number,
    stride: number,
    layout: GaussianTextureArrayLayout,
    page: number,
    x0: number,
    y: number,
    width: number,
    rows: number,
  ): void {
    const transformRow = alignTo(width * 16, COPY_ROW_ALIGNMENT);
    const featureRow = alignTo(width * 8, COPY_ROW_ALIGNMENT);
    const transformLayerWords = (transformRow * rows) / 4;
    const featureLayerHalves = (featureRow * rows) / 2;
    const featureLayers = layout.featureTexelsPerSplat;
    const transform = new Float32Array(transformLayerWords * TRANSFORM_LAYERS);
    const features = new Uint16Array(featureLayerHalves * featureLayers);
    const featureElements = 1 + (this._shDegree + 1) ** 2 * 3;
    const source = new Float32Array(chunk.buffer, chunk.byteOffset, chunk.length);
    // Half-float features are little-endian pairs inside each 32-bit word.
    const halves = new Uint16Array(chunk.buffer, chunk.byteOffset, chunk.length * 2);

    for (let row = 0; row < rows; row++) {
      const transformRowWord = (row * transformRow) / 4;
      const featureRowHalf = (row * featureRow) / 2;
      for (let x = 0; x < width; x++) {
        const base = (firstInChunk + row * width + x) * stride;
        const t = transformRowWord + x * 4;
        transform[t] = source[base]!;
        transform[t + 1] = source[base + 1]!;
        transform[t + 2] = source[base + 2]!;
        transform[t + 3] = source[base + 3]!;
        transform[transformLayerWords + t] = source[base + 4]!;
        transform[transformLayerWords + t + 1] = source[base + 5]!;
        transform[transformLayerWords + t + 2] = source[base + 6]!;
        transform[transformLayerWords + t + 3] = source[base + 7]!;
        transform[2 * transformLayerWords + t] = source[base + 8]!;
        transform[2 * transformLayerWords + t + 1] = source[base + 9]!;

        const f = featureRowHalf + x * 4;
        const half = (base + GAUSSIAN_SPLAT_TRANSFORM_WORDS) * 2;
        for (let e = 0; e < featureElements; e++) {
          features[(e >> 2) * featureLayerHalves + f + (e & 3)] = halves[half + e]!;
        }
      }
    }

    const transformBytes = transformLayerWords * 4;
    for (let layer = 0; layer < TRANSFORM_LAYERS; layer++) {
      this.device.queue.writeTexture(
        { texture: this.transformTexture!, origin: { x: x0, y, z: page * TRANSFORM_LAYERS + layer } },
        new Uint8Array(transform.buffer, layer * transformBytes, transformBytes),
        { bytesPerRow: transformRow, rowsPerImage: rows },
        { width, height: rows, depthOrArrayLayers: 1 },
      );
    }
    const featureBytes = featureLayerHalves * 2;
    for (let layer = 0; layer < featureLayers; layer++) {
      this.device.queue.writeTexture(
        { texture: this.featureTexture!, origin: { x: x0, y, z: page * featureLayers + layer } },
        new Uint8Array(features.buffer, layer * featureBytes, featureBytes),
        { bytesPerRow: featureRow, rowsPerImage: rows },
        { width, height: rows, depthOrArrayLayers: 1 },
      );
    }
  }

  /**
   * Write a rectangle straight from the prepared planes: consecutive splats are
   * contiguous in every layer, so rows go to the GPU without a CPU repack unless
   * their byte length is not a multiple of the 256-byte row alignment.
   */
  private writePreparedRect(
    prepared: PreparedSplatChunk,
    firstInChunk: number,
    layout: GaussianTextureArrayLayout,
    page: number,
    x0: number,
    y: number,
    width: number,
    rows: number,
  ): void {
    const { count } = prepared;
    for (let layer = 0; layer < TRANSFORM_LAYERS; layer++) {
      this.writePlaneRect(
        this.transformTexture!,
        prepared.transform,
        (layer * count + firstInChunk) * 4,
        { x: x0, y, z: page * TRANSFORM_LAYERS + layer },
        width,
        rows,
      );
    }
    for (let layer = 0; layer < layout.featureTexelsPerSplat; layer++) {
      this.writePlaneRect(
        this.featureTexture!,
        prepared.features,
        (layer * count + firstInChunk) * 4,
        { x: x0, y, z: page * layout.featureTexelsPerSplat + layer },
        width,
        rows,
      );
    }
  }

  private writePlaneRect(
    texture: GPUTexture,
    plane: Float32Array | Uint16Array,
    firstElement: number,
    origin: { x: number; y: number; z: number },
    width: number,
    rows: number,
  ): void {
    const rowBytes = width * 4 * plane.BYTES_PER_ELEMENT;
    const bytes = new Uint8Array(
      plane.buffer,
      plane.byteOffset + firstElement * plane.BYTES_PER_ELEMENT,
      rowBytes * rows,
    );
    let data = bytes;
    let bytesPerRow = rowBytes;
    if (rows > 1 && rowBytes % COPY_ROW_ALIGNMENT !== 0) {
      bytesPerRow = alignTo(rowBytes, COPY_ROW_ALIGNMENT);
      data = new Uint8Array(bytesPerRow * rows);
      for (let row = 0; row < rows; row++) {
        data.set(bytes.subarray(row * rowBytes, (row + 1) * rowBytes), row * bytesPerRow);
      }
    }
    this.device.queue.writeTexture(
      { texture, origin },
      data as GPUAllowSharedBufferSource,
      { bytesPerRow, rowsPerImage: rows },
      { width, height: rows, depthOrArrayLayers: 1 },
    );
  }

  /** Largest activated scale axis per splat, for the sort's frustum culling. */
  private uploadRadii(splatData: Uint32Array, stride: number, count: number): void {
    const f32 = new Float32Array(
      splatData.buffer,
      splatData.byteOffset,
      splatData.length,
    );
    const radii = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const base = i * stride;
      radii[i] = Math.max(f32[base + 3]!, f32[base + 4]!, f32[base + 5]!);
    }
    this.radiiBuffer = this.device.createBuffer({
      size: radii.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(
      this.radiiBuffer,
      0,
      radii as GPUAllowSharedBufferSource,
    );
  }

  private createOrderBuffer(count: number): void {
    const order = new Uint32Array(count);
    for (let i = 0; i < count; i++) order[i] = i;
    this.orderBuffer = this.device.createBuffer({
      size: order.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.orderBuffer, 0, order);
  }

  /**
   * Upload splat centres (3 f32 words/splat) into a GPU storage buffer for the
   * compute-sort depth pass. Reuses the `positions` array the renderer already
   * extracts for the CPU worker sort, so there is no second extraction. Safe to
   * call after {@link upload}; the buffer lives until the next upload/clear.
   * A length mismatch with the uploaded count is ignored (leaves no buffer) so
   * the caller falls back to the CPU sort rather than sorting stale positions.
   */
  setPositions(positions: Float32Array): void {
    this.positionsBuffer?.destroy();
    this.positionsBuffer = null;
    if (this._count === 0 || positions.length !== this._count * 3) return;
    if (typeof this.device.createBuffer !== "function") return;
    this.positionsBuffer = this.device.createBuffer({
      size: positions.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(
      this.positionsBuffer,
      0,
      positions as GPUAllowSharedBufferSource,
    );
  }

  private uploadPackedFallback(splatData: Uint32Array): void {
    this.packedSplatBuffer = this.device.createBuffer({
      size: splatData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(
      this.packedSplatBuffer,
      0,
      splatData as GPUAllowSharedBufferSource,
    );
    this.bindGroup = this.device.createBindGroup({
      layout: this.packedFallbackBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.packedSplatBuffer } },
        { binding: 2, resource: { buffer: this.orderBuffer! } },
      ],
    });
  }

  private uploadTextureArrays(
    splatData: Uint32Array,
    stride: number,
    shDegree: number,
  ): void {
    const layout = this.createTextureArrays(this._count, shDegree);
    this.writeTransformTexture(splatData, stride, layout);
    this.writeFeatureTexture(splatData, stride, layout);
    this.createTextureBindGroup();
  }

  /** Allocate the paged transform/feature texture arrays for `count` splats. */
  private createTextureArrays(
    count: number,
    shDegree: number,
  ): GaussianTextureArrayLayout {
    const limits = this.device.limits;
    const layout = planGaussianTextureArray(
      count,
      shDegree,
      limits.maxTextureDimension2D,
      limits.maxTextureArrayLayers,
    );
    if (!layout || typeof this.device.queue.writeTexture !== "function") {
      throw new Error("Gaussian texture-array capacity is unavailable");
    }
    this._textureLayout = layout;
    this.transformTexture = this.device.createTexture({
      label: "Gaussian transforms (RGBA32F array)",
      size: {
        width: layout.width,
        height: layout.height,
        depthOrArrayLayers: layout.transformLayers,
      },
      format: "rgba32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.featureTexture = this.device.createTexture({
      label: "Gaussian opacity/SH (RGBA16F array)",
      size: {
        width: layout.width,
        height: layout.height,
        depthOrArrayLayers: layout.featureLayers,
      },
      format: "rgba16float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    return layout;
  }

  private createTextureBindGroup(): void {
    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        {
          binding: 1,
          resource: this.transformTexture!.createView({
            dimension: "2d-array",
          }),
        },
        {
          binding: 2,
          resource: this.featureTexture!.createView({
            dimension: "2d-array",
          }),
        },
        { binding: 3, resource: { buffer: this.orderBuffer! } },
      ],
    });
  }

  private writeTransformTexture(
    splatData: Uint32Array,
    stride: number,
    layout: GaussianTextureArrayLayout,
  ): void {
    const source = new Float32Array(
      splatData.buffer,
      splatData.byteOffset,
      splatData.length,
    );
    const bytesPerRow = alignTo(layout.width * 16, COPY_ROW_ALIGNMENT);
    const rowsPerChunk = Math.max(
      1,
      Math.floor(MAX_STAGING_BYTES / bytesPerRow),
    );

    for (let page = 0; page < layout.pageCount; page++) {
      const pageStart = page * layout.splatsPerPage;
      const pageCount = Math.min(
        layout.splatsPerPage,
        this._count - pageStart,
      );
      const pageRows = Math.ceil(pageCount / layout.width);
      for (let chunk = 0; chunk < 3; chunk++) {
        for (let y = 0; y < pageRows; y += rowsPerChunk) {
          const rows = Math.min(rowsPerChunk, pageRows - y);
          const staging = new ArrayBuffer(bytesPerRow * rows);
          const output = new Float32Array(staging);
          for (let row = 0; row < rows; row++) {
            const localY = y + row;
            for (let x = 0; x < layout.width; x++) {
              const local = localY * layout.width + x;
              if (local >= pageCount) break;
              const splat = pageStart + local;
              const src = splat * stride + chunk * 4;
              const dst = (row * bytesPerRow + x * 16) / 4;
              for (let lane = 0; lane < 4; lane++) {
                const attribute = chunk * 4 + lane;
                output[dst + lane] =
                  attribute < GAUSSIAN_SPLAT_TRANSFORM_WORDS
                    ? source[src + lane]!
                    : 0;
              }
            }
          }
          this.device.queue.writeTexture(
            {
              texture: this.transformTexture!,
              origin: { x: 0, y, z: page * 3 + chunk },
            },
            new Uint8Array(staging),
            { bytesPerRow, rowsPerImage: rows },
            { width: layout.width, height: rows, depthOrArrayLayers: 1 },
          );
        }
      }
    }
  }

  private writeFeatureTexture(
    splatData: Uint32Array,
    stride: number,
    layout: GaussianTextureArrayLayout,
  ): void {
    const bytesPerRow = alignTo(layout.width * 8, COPY_ROW_ALIGNMENT);
    const rowsPerChunk = Math.max(
      1,
      Math.floor(MAX_STAGING_BYTES / bytesPerRow),
    );
    const featureElements = 1 + ((this._shDegree + 1) ** 2) * 3;

    for (let page = 0; page < layout.pageCount; page++) {
      const pageStart = page * layout.splatsPerPage;
      const pageCount = Math.min(
        layout.splatsPerPage,
        this._count - pageStart,
      );
      const pageRows = Math.ceil(pageCount / layout.width);
      for (let chunk = 0; chunk < layout.featureTexelsPerSplat; chunk++) {
        for (let y = 0; y < pageRows; y += rowsPerChunk) {
          const rows = Math.min(rowsPerChunk, pageRows - y);
          const staging = new ArrayBuffer(bytesPerRow * rows);
          const output = new Uint16Array(staging);
          for (let row = 0; row < rows; row++) {
            const localY = y + row;
            for (let x = 0; x < layout.width; x++) {
              const local = localY * layout.width + x;
              if (local >= pageCount) break;
              const splat = pageStart + local;
              const base = splat * stride;
              const dst = (row * bytesPerRow + x * 8) / 2;
              for (let lane = 0; lane < 4; lane++) {
                const element = chunk * 4 + lane;
                if (element >= featureElements) break;
                const word =
                  splatData[
                    base +
                      GAUSSIAN_SPLAT_TRANSFORM_WORDS +
                      (element >> 1)
                  ]!;
                output[dst + lane] =
                  (word >>> ((element & 1) * 16)) & 0xffff;
              }
            }
          }
          this.device.queue.writeTexture(
            {
              texture: this.featureTexture!,
              origin: {
                x: 0,
                y,
                z:
                  page * layout.featureTexelsPerSplat +
                  chunk,
              },
            },
            new Uint8Array(staging),
            { bytesPerRow, rowsPerImage: rows },
            { width: layout.width, height: rows, depthOrArrayLayers: 1 },
          );
        }
      }
    }
  }

  /** Replace the global sorted order with a fresh back-to-front order. */
  updateOrder(indices: Uint32Array, visibleCount = this._count): void {
    if (!this.orderBuffer || indices.length !== this._count) return;
    // A CPU-supplied order supersedes any GPU sort result, including its count.
    this.indirectBuffer = null;
    this._visibleCount = Math.max(
      0,
      Math.min(this._count, Math.floor(visibleCount)),
    );
    this.device.queue.writeBuffer(
      this.orderBuffer,
      0,
      indices as GPUAllowSharedBufferSource,
    );
  }

  /** Write the per-frame camera uniform. */
  updateUniform(uniform: Float32Array): void {
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      uniform as GPUAllowSharedBufferSource,
    );
  }

  /** Record one instanced quad draw for the globally sorted cloud. */
  draw(
    pass: GPURenderPassEncoder,
    texturePipeline: GPURenderPipeline,
    packedFallbackPipeline: GPURenderPipeline = texturePipeline,
  ): void {
    if (!this.hasContent || !this.bindGroup) return;
    pass.setPipeline(
      this._resourceMode === "texture-array"
        ? texturePipeline
        : packedFallbackPipeline,
    );
    pass.setBindGroup(0, this.bindGroup);
    if (this.indirectBuffer) {
      pass.drawIndirect(this.indirectBuffer, 0);
      return;
    }
    pass.draw(4, this._visibleCount);
  }

  /**
   * Record the depth-only occluder draw. Uses the fixed, opacity-compacted
   * index built by {@link rebuildOccluderIndex} rather than the per-frame
   * sorted order — the pass is order-independent, so this shrinks its instance
   * count to just the splats that actually write depth instead of the whole
   * cloud. Only the texture-array path has a `vs_depth` stage; the packed
   * compatibility shader has none, so that mode silently skips occlusion rather
   * than mis-rendering (as before).
   */
  drawDepthOnly(pass: GPURenderPassEncoder, depthPipeline: GPURenderPipeline): void {
    // The GPU sort already culled the cloud to what the camera can see, and the
    // depth stage drops translucent splats itself, so reuse that list: drawing
    // the fixed whole-cloud index costs every splat of a huge scene each frame.
    if (
      this.indirectBuffer &&
      this.bindGroup &&
      this._resourceMode === "texture-array"
    ) {
      pass.setPipeline(depthPipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.drawIndirect(this.indirectBuffer, 0);
      return;
    }
    if (!this.occluderBindGroup || this._occluderCount === 0) return;
    pass.setPipeline(depthPipeline);
    pass.setBindGroup(0, this.occluderBindGroup);
    pass.draw(4, this._occluderCount);
  }

  /** Clear the current cloud while retaining the reusable uniform buffer. */
  clear(): void {
    this.releaseCloudResources();
    this._count = 0;
    this._visibleCount = 0;
    this._shDegree = 0;
    this._resourceMode = "none";
  }

  /** Free textures, buffers, and the uniform buffer. */
  dispose(): void {
    this.clear();
    this.uniformBuffer.destroy();
  }

  private releaseCloudResources(): void {
    this.chunked = null;
    this.transformTexture?.destroy();
    this.featureTexture?.destroy();
    this.packedSplatBuffer?.destroy();
    this.orderBuffer?.destroy();
    this.positionsBuffer?.destroy();
    this.radiiBuffer?.destroy();
    this.occluderIndexBuffer?.destroy();
    this.transformTexture = null;
    this.featureTexture = null;
    this.packedSplatBuffer = null;
    this.orderBuffer = null;
    this.positionsBuffer = null;
    this.radiiBuffer = null;
    this.bindGroup = null;
    this._textureLayout = null;
    this.opacityHalfBits = null;
    this.occluderIndexBuffer = null;
    this.occluderBindGroup = null;
    this._occluderCount = 0;
    // Owned by the GPU sorter, which is resized/disposed alongside the cloud —
    // never draw indirect from arguments computed for a different cloud.
    this.indirectBuffer = null;
  }
}
