/**
 * WebGPU pipelines and resources for Gaussian splat rendering.
 *
 * The high-fidelity path transposes packed layout-v2 input into paged
 * RGBA32UI/RGBA16F texture arrays (compact: ~48 B/splat at SH1). Only the one global sorted-order array remains
 * a storage buffer, so source attributes are no longer constrained by one
 * `maxStorageBufferBindingSize`. A packed-storage pipeline remains available as
 * an explicit compatibility fallback and is always reported to callers.
 */
import {
  PREPARED_SLICE_SPLATS,
  TRANSFORM_LAYERS,
  prepareSplatChunk,
  type PreparedSplatChunk,
} from "./splatPrepare";
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
          sampleType: "uint",
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
  private transformView: GPUTextureView | null = null;
  private featureTexture: GPUTexture | null = null;
  private packedSplatBuffer: GPUBuffer | null = null;
  private orderBuffer: GPUBuffer | null = null;
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
  private chunked: {
    count: number;
    stride: number;
    written: number;
    /** Drawable (GPU-sorted) while still uploading. */
    progressive: boolean;
    /** Fixed-capacity LOD store: slots are written and released in any order. */
    resident: boolean;
  } | null = null;

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

  /** Splats the allocated textures can hold: the declared total while a chunked upload runs. */
  get capacity(): number {
    return this.chunked?.count ?? this._count;
  }

  /** Whether the in-progress chunked upload is already drawable. */
  get progressive(): boolean {
    return this.chunked?.progressive ?? false;
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
   * The RGBA32UI transform texture array (texel xyz = splat centre bits), which
   * the GPU compute sort's key pass reads instead of a separate centre buffer.
   * `null` on the packed fallback path or before an upload.
   */
  get gpuTransformView(): GPUTextureView | null {
    if (!this.transformTexture) return null;
    this.transformView ??= this.transformTexture.createView({ dimension: "2d-array" });
    return this.transformView;
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
   * Begin a chunked texture-array upload of `count` splats in layout v2. Unless
   * `progressive`, the cloud is not drawable until {@link endChunkedUpload}; a
   * progressive upload draws the splats written so far (the GPU sort orders just
   * that prefix). Chunks are written straight into the GPU textures, so no
   * full-size CPU copy is ever needed.
   * Throws when the device cannot hold the cloud; nothing stays allocated then.
   */
  beginChunkedUpload(
    count: number,
    shDegree: number,
    layoutVersion: number,
    progressive = false,
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
      this.radiiBuffer = this.device.createBuffer({
        size: count * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.opacityHalfBits = new Uint16Array(count);
      if (progressive) {
        this.createTextureBindGroup();
        this._resourceMode = "texture-array";
      }
    } catch (error) {
      this.releaseCloudResources();
      throw error;
    }
    this.chunked = { count, stride, written: 0, progressive, resident: false };
  }

  /**
   * Allocate a fixed-capacity store of `capacity` splat slots for LOD streaming.
   * Slots start empty (radius zero, which the GPU sort skips); fill them with
   * {@link writeResident} and empty them with {@link releaseResident}. The store
   * is drawn through the GPU sort only, like a progressive upload.
   */
  beginResidentStore(capacity: number, shDegree: number, layoutVersion: number): void {
    this.beginChunkedUpload(capacity, shDegree, layoutVersion, true);
    this.chunked!.resident = true;
    this._count = capacity;
    this._visibleCount = capacity;
  }

  /** Whether a resident store is allocated. */
  get residentStore(): boolean {
    return this.chunked?.resident ?? false;
  }

  /** Write prepared splats into slots `[first, first + prepared.count)` of the resident store. */
  writeResident(prepared: PreparedSplatChunk, first: number): void {
    const session = this.chunked;
    if (!session?.resident) throw new Error("No resident Gaussian store allocated");
    if (prepared.shDegree !== this._shDegree) {
      throw new RangeError("Prepared chunk does not match the store's SH degree");
    }
    if (first < 0 || first + prepared.count > session.count) {
      throw new RangeError("Slots exceed the resident store capacity");
    }
    this.writePrepared(prepared, first);
  }

  /** Empty slots `[first, first + count)`: a zero radius makes the GPU sort skip them. */
  releaseResident(first: number, count: number): void {
    const session = this.chunked;
    if (!session?.resident) throw new Error("No resident Gaussian store allocated");
    if (first < 0 || count < 0 || first + count > session.count) {
      throw new RangeError("Slots exceed the resident store capacity");
    }
    if (count === 0) return;
    this.device.queue.writeBuffer(
      this.radiiBuffer!,
      first * Float32Array.BYTES_PER_ELEMENT,
      new Float32Array(count) as GPUAllowSharedBufferSource,
    );
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
    if (session.resident) {
      throw new Error("A resident store takes slot writes, not sequential chunks");
    }
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
      if (prepared) {
        this.writePrepared(prepared, written);
      } else {
        for (let first = 0; first < n; first += PREPARED_SLICE_SPLATS) {
          const end = Math.min(n, first + PREPARED_SLICE_SPLATS);
          const slice = prepareSplatChunk(
            chunk.subarray(first * stride, end * stride),
            this._shDegree,
          );
          this.writePrepared(slice, written + first);
        }
      }
    } catch (error) {
      this.abortChunkedUpload();
      throw error;
    }
    session.written += n;
    if (session.progressive) {
      this._count = session.written;
      this._visibleCount = session.written;
    }
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
    if (!session.progressive) this.createTextureBindGroup();
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

  /** Textures plus identity order, centres, radii and opacity for splats `[first, first+n)`. */
  private writePrepared(prepared: PreparedSplatChunk, first: number): void {
    this.writeSplatRange(prepared, first);
    this.writeSideBuffers(prepared, first);
  }

  /** Identity order, radii and opacity bits for splats `[first, first+n)`. */
  private writeSideBuffers(prepared: PreparedSplatChunk, first: number): void {
    const n = prepared.count;
    this.opacityHalfBits!.set(prepared.opacity, first);
    // A resident store is ordered by the GPU sort alone, so skip the identity order.
    if (!this.chunked?.resident) {
      const order = new Uint32Array(n);
      for (let i = 0; i < n; i++) order[i] = first + i;
      this.device.queue.writeBuffer(
        this.orderBuffer!,
        first * Uint32Array.BYTES_PER_ELEMENT,
        order as GPUAllowSharedBufferSource,
      );
    }
    this.device.queue.writeBuffer(
      this.radiiBuffer!,
      first * Float32Array.BYTES_PER_ELEMENT,
      prepared.radii as GPUAllowSharedBufferSource,
    );
  }

  /**
   * Write the prepared splats at global index `first` into the texture arrays as
   * rectangles of raster-consecutive splats: a partial first/last row, or a run
   * of whole rows, so an arbitrary chunk size never overwrites its neighbours.
   */
  private writeSplatRange(prepared: PreparedSplatChunk, first: number): void {
    const n = prepared.count;
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
      this.writePreparedRect(prepared, done, layout, page, x, y, width, rows);
      done += width * rows;
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
    plane: Uint32Array | Uint16Array,
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
    this.createTextureArrays(this._count, shDegree);
    for (let first = 0; first < this._count; first += PREPARED_SLICE_SPLATS) {
      const end = Math.min(this._count, first + PREPARED_SLICE_SPLATS);
      this.writeSplatRange(
        prepareSplatChunk(splatData.subarray(first * stride, end * stride), shDegree),
        first,
      );
    }
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
      label: "Gaussian transforms (RGBA32UI array)",
      size: {
        width: layout.width,
        height: layout.height,
        depthOrArrayLayers: layout.transformLayers,
      },
      format: "rgba32uint",
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
    // A progressive upload has no meaningful order until the GPU sort has run once.
    if (this.chunked?.progressive && !this.indirectBuffer) return;
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
    this.radiiBuffer?.destroy();
    this.occluderIndexBuffer?.destroy();
    this.transformTexture = null;
    this.transformView = null;
    this.featureTexture = null;
    this.packedSplatBuffer = null;
    this.orderBuffer = null;
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
