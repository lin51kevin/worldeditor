/**
 * WebGPU pipelines and resources for Gaussian splat rendering.
 *
 * The high-fidelity path transposes packed layout-v2 input into paged
 * RGBA32F/RGBA16F texture arrays. Only the one global sorted-order array remains
 * a storage buffer, so source attributes are no longer constrained by one
 * `maxStorageBufferBindingSize`. A packed-storage pipeline remains available as
 * an explicit compatibility fallback and is always reported to callers.
 */
import { GAUSSIAN_SPLAT_SHADER } from "./splatShader";
import { GAUSSIAN_SPLAT_PACKED_SHADER } from "./splatPackedShader";
import { SPLAT_UNIFORM_BYTES } from "./splatUniform";
import {
  GAUSSIAN_SPLAT_TRANSFORM_WORDS,
  assertGaussianSplatBuffer,
  planGaussianTextureArray,
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
  private readonly uniformBuffer: GPUBuffer;
  private bindGroup: GPUBindGroup | null = null;
  private _count = 0;
  private _visibleCount = 0;
  /** GPU-written `[4, visibleCount, 0, 0]` draw arguments; `null` = CPU count. */
  private indirectBuffer: GPUBuffer | null = null;
  private _shDegree = 0;
  private _resourceMode: GaussianResourceMode = "none";
  private _textureLayout: GaussianTextureArrayLayout | null = null;

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
    const limits = this.device.limits;
    const layout = planGaussianTextureArray(
      this._count,
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

    this.writeTransformTexture(splatData, stride, layout);
    this.writeFeatureTexture(splatData, stride, layout);
    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        {
          binding: 1,
          resource: this.transformTexture.createView({
            dimension: "2d-array",
          }),
        },
        {
          binding: 2,
          resource: this.featureTexture.createView({
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
   * Record the depth-only occluder draw. Only the texture-array path has a
   * `vs_depth` stage; the packed compatibility shader has none, so that mode
   * silently skips occlusion rather than mis-rendering.
   */
  drawDepthOnly(pass: GPURenderPassEncoder, depthPipeline: GPURenderPipeline): void {
    if (!this.hasContent || !this.bindGroup) return;
    if (this._resourceMode !== "texture-array") return;
    pass.setPipeline(depthPipeline);
    pass.setBindGroup(0, this.bindGroup);
    if (this.indirectBuffer) {
      pass.drawIndirect(this.indirectBuffer, 0);
      return;
    }
    pass.draw(4, this._visibleCount);
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
    this.transformTexture?.destroy();
    this.featureTexture?.destroy();
    this.packedSplatBuffer?.destroy();
    this.orderBuffer?.destroy();
    this.positionsBuffer?.destroy();
    this.transformTexture = null;
    this.featureTexture = null;
    this.packedSplatBuffer = null;
    this.orderBuffer = null;
    this.positionsBuffer = null;
    this.bindGroup = null;
    this._textureLayout = null;
    // Owned by the GPU sorter, which is resized/disposed alongside the cloud —
    // never draw indirect from arguments computed for a different cloud.
    this.indirectBuffer = null;
  }
}
