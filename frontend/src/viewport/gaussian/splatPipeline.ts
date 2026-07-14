/**
 * WebGPU pipeline + GPU resources for Gaussian splat rendering.
 *
 * A {@link GaussianSplatResources} owns the storage buffer of packed splats,
 * the sorted-index storage buffer, the camera uniform, and the bind group. The
 * renderer uploads splats once, updates the index buffer each time the depth
 * sorter produces a new order, and refreshes the uniform per frame.
 */
import { GAUSSIAN_SPLAT_SHADER } from "./splatShader";
import { SPLAT_UNIFORM_BYTES } from "./splatUniform";

/**
 * `u32` words per splat in the half-precision packed instance buffer:
 * `pos(3 f32 words) + ceil((6 cov + 1 opacity + (deg+1)²·3 SH) / 2)` half-pairs.
 * Positions are stored as f32 bit patterns; the rest are `f16` pairs decoded via
 * `unpack2x16float`. Mirrors `GaussianCloud::sh_buffer_stride_f16` in Rust.
 */
export function splatStrideForDegree(shDegree: number): number {
  const coeffs = (shDegree + 1) * (shDegree + 1);
  const halfCount = 7 + coeffs * 3;
  return 3 + Math.ceil(halfCount / 2);
}

/**
 * Create the Gaussian splat render pipeline.
 *
 * Blend: premultiplied "over" (`src=one, dst=one-minus-src-alpha`).
 * Depth: reverse-Z `greater`, no depth write (splats blend by sort order but
 * are still occluded by opaque geometry drawn earlier).
 */
export function createGaussianSplatPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  sampleCount = 4,
): { pipeline: GPURenderPipeline; bindGroupLayout: GPUBindGroupLayout } {
  const shader = device.createShaderModule({ code: GAUSSIAN_SPLAT_SHADER });

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
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage" },
      },
    ],
  });

  const pipeline = device.createRenderPipeline({
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

  return { pipeline, bindGroupLayout };
}

/** GPU-side state for one splat cloud. */
export class GaussianSplatResources {
  private splatBuffer: GPUBuffer | null = null;
  private orderBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer;
  private bindGroup: GPUBindGroup | null = null;
  private _count = 0;
  private _shDegree = 0;

  constructor(
    private readonly device: GPUDevice,
    private readonly bindGroupLayout: GPUBindGroupLayout,
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

  /** SH degree of the current cloud. */
  get shDegree(): number {
    return this._shDegree;
  }

  /** Whether there is anything to draw. */
  get hasContent(): boolean {
    return this._count > 0 && this.bindGroup !== null;
  }

  /**
   * Upload the packed half-precision splat buffer (`splatStrideForDegree`
   * `u32` words/splat) and initialise the sorted index buffer to identity
   * order. Replaces any previous cloud.
   */
  upload(splatData: Uint32Array, shDegree: number): void {
    this.releaseBuffers();
    const stride = splatStrideForDegree(shDegree);
    const count = Math.floor(splatData.length / stride);
    this._count = count;
    this._shDegree = shDegree;
    if (count === 0) {
      this.bindGroup = null;
      return;
    }

    this.splatBuffer = this.device.createBuffer({
      size: splatData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(
      this.splatBuffer,
      0,
      splatData as GPUAllowSharedBufferSource,
    );

    // Identity order until the first sort result arrives.
    const order = new Uint32Array(count);
    for (let i = 0; i < count; i++) order[i] = i;
    this.orderBuffer = this.device.createBuffer({
      size: order.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.orderBuffer, 0, order);

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.splatBuffer } },
        { binding: 2, resource: { buffer: this.orderBuffer } },
      ],
    });
  }

  /** Replace the sorted index buffer with a fresh back-to-front order. */
  updateOrder(indices: Uint32Array): void {
    if (!this.orderBuffer || indices.length !== this._count) return;
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

  /** Record the draw call: one instanced quad (4 verts) per splat. */
  draw(pass: GPURenderPassEncoder, pipeline: GPURenderPipeline): void {
    if (!this.hasContent || !this.bindGroup) return;
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(4, this._count);
  }

  /** Clear the current cloud (frees GPU buffers). */
  clear(): void {
    this.releaseBuffers();
    this._count = 0;
    this.bindGroup = null;
  }

  /** Free all GPU resources including the uniform buffer. */
  dispose(): void {
    this.releaseBuffers();
    this.uniformBuffer.destroy();
  }

  private releaseBuffers(): void {
    this.splatBuffer?.destroy();
    this.orderBuffer?.destroy();
    this.splatBuffer = null;
    this.orderBuffer = null;
  }
}
