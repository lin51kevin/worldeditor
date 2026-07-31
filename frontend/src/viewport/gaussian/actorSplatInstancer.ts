/**
 * GPU-persistent actor (NPC/ego) Gaussian splat renderer with instanced
 * per-frame transform updates.
 *
 * Each unique model URL has one GPU buffer uploaded ONCE.  Per frame only a
 * tiny per-instance transforms buffer (M × 32 bytes) is written and the sort
 * worker receives new world-space positions (O(N×3) CPU work, off main thread).
 *
 * This replaces the old `actorSplatRenderer` path which did an O(N×12) JS
 * transform loop on the main thread PLUS a full GPU re-upload every frame.
 *
 * Binding layout (actor-instanced pipeline):
 *   group(0) binding(0) — SplatUniforms  (same as packed shader)
 *   group(0) binding(1) — merged model-local splats (Uint32, static per set)
 *   group(0) binding(2) — depth order   (Uint32, written by sort worker)
 *   group(0) binding(3) — per-splat instance IDs (Uint32, static per set)
 *   group(1) binding(0) — per-instance ActorTransform (Float32, written per frame)
 */
import { GAUSSIAN_SPLAT_ACTOR_INSTANCED_SHADER } from './actorSplatInstancedShader';
import { SPLAT_UNIFORM_BYTES, buildSplatUniform } from './splatUniform';
import type { CameraState } from '../cameraController';
import { SplatSortController, type SplatSorter } from './splatSortController';
import { createWorkerSplatSorter } from './splatSorterBackends';
import { computeViewDir } from './splatRenderer';
import { frustumSidePlanes } from './splatSort';
import { MSAA_SAMPLE_COUNT } from '../rendererResources';

/** Degree-0 packed layout-v2 stride in u32 words. */
const DEGREE0_STRIDE = 12;

/** Float32 elements per instance in the transforms GPU buffer (padded to 8). */
const TRANSFORM_FLOATS = 8;

/** One actor instance posed in the render frame (world minus scene origin). */
export interface ActorInstance {
  url: string;
  cos_yaw: number;
  sin_yaw: number;
  hw: number;  // cos(heading/2) — yaw quaternion w
  hz: number;  // sin(heading/2) — yaw quaternion z
  px: number;  // render-frame position x (world x − scene_origin.x)
  py: number;
  pz: number;
}

interface ModelEntry {
  gpuBuffer: GPUBuffer;
  count: number;
  /** Model-local XYZ positions (3 floats/splat) for the off-thread sort. */
  localPositions: Float32Array;
  /** Full packed data (CPU copy) for merged-buffer rebuilds. */
  cpuData: Uint32Array;
}

/** GPU-persistent instanced actor splat manager + renderer. */
export class ActorSplatInstancer {
  private readonly models = new Map<string, ModelEntry>();

  // Merged state (rebuilt on actor-set change)
  private mergedSplatBuffer: GPUBuffer | null = null;
  private instanceIdsBuffer: GPUBuffer | null = null;
  private orderBuffer: GPUBuffer | null = null;
  private totalCount = 0;
  private lastInstanceKey = '';

  // Per-frame tiny write
  private transformsBuffer: GPUBuffer | null = null;
  private group1: GPUBindGroup | null = null;
  private lastTransformCapacity = 0;

  // Bind group 0 + uniform buffer
  private group0: GPUBindGroup | null = null;
  private readonly uniformBuffer: GPUBuffer;

  // Sort (off-thread CPU worker)
  private readonly sort: SplatSortController;
  private _visibleCount = 0;

  // Pipeline + layouts
  private readonly pipeline: GPURenderPipeline;
  private readonly bgl0: GPUBindGroupLayout;
  private readonly bgl1: GPUBindGroupLayout;

  constructor(
    private readonly device: GPUDevice,
    format: GPUTextureFormat,
    private readonly onOrderChanged?: () => void,
    sorter: SplatSorter = createWorkerSplatSorter(),
  ) {
    this.bgl0 = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' } },
      ],
    });
    this.bgl1 = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' } },
      ],
    });

    const shader = device.createShaderModule({
      label: 'actorSplatInstancedShader',
      code: GAUSSIAN_SPLAT_ACTOR_INSTANCED_SHADER,
    });
    this.pipeline = device.createRenderPipeline({
      label: 'actorSplatInstancedPipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bgl0, this.bgl1] }),
      vertex: { module: shader, entryPoint: 'vs_main' },
      fragment: {
        module: shader,
        entryPoint: 'fs_main',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          },
        }],
      },
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: false,
        depthCompare: 'greater',
      },
      multisample: { count: MSAA_SAMPLE_COUNT },
      primitive: { topology: 'triangle-strip' },
    });

    this.uniformBuffer = device.createBuffer({
      label: 'actorSplatInstancedUniforms',
      size: SPLAT_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.sort = new SplatSortController(sorter, (indices, visibleCount) => {
      if (this.orderBuffer && indices.length <= this.totalCount) {
        this.device.queue.writeBuffer(
          this.orderBuffer, 0, indices.buffer, 0, indices.length * 4,
        );
        this._visibleCount = visibleCount;
      }
      this.onOrderChanged?.();
    });
  }

  get hasContent(): boolean { return this.totalCount > 0; }
  get count(): number { return this.totalCount; }

  /**
   * Upload a model's degree-0 packed splat data to a persistent GPU buffer.
   * No-op if the URL was already uploaded.
   */
  uploadModel(url: string, data: Uint32Array): void {
    if (this.models.has(url)) return;
    const count = Math.floor(data.length / DEGREE0_STRIDE);
    if (count === 0) return;

    const localPositions = new Float32Array(count * 3);
    const dataF = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
    for (let i = 0; i < count; i++) {
      localPositions[i * 3]     = dataF[i * DEGREE0_STRIDE]!;
      localPositions[i * 3 + 1] = dataF[i * DEGREE0_STRIDE + 1]!;
      localPositions[i * 3 + 2] = dataF[i * DEGREE0_STRIDE + 2]!;
    }

    const gpuBuffer = this.device.createBuffer({
      label: `actorModel:${url}`,
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(gpuBuffer, 0, data.buffer, data.byteOffset, data.byteLength);

    this.models.set(url, { gpuBuffer, count, localPositions, cpuData: data.slice() });
  }

  /**
   * Per-frame update: write instance transforms + compute world positions for
   * the off-thread sort.  Main-thread cost is O(M×8) write + O(N×3) loop.
   */
  updateInstances(instances: readonly ActorInstance[]): void {
    const key = instances.map(i => i.url).join('\0');
    if (key !== this.lastInstanceKey) {
      this.rebuildMergedBuffers(instances);
      this.lastInstanceKey = key;
    }
    if (this.totalCount === 0) return;

    const M = instances.length;

    if (!this.transformsBuffer || this.lastTransformCapacity < M) {
      this.transformsBuffer?.destroy();
      this.group1 = null;
      const capacity = Math.max(M, 32);
      this.transformsBuffer = this.device.createBuffer({
        label: 'actorInstanceTransforms',
        size: capacity * TRANSFORM_FLOATS * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.lastTransformCapacity = capacity;
    }

    const transforms = new Float32Array(M * TRANSFORM_FLOATS);
    for (let i = 0; i < M; i++) {
      const inst = instances[i]!;
      const b = i * TRANSFORM_FLOATS;
      transforms[b]     = inst.cos_yaw;
      transforms[b + 1] = inst.sin_yaw;
      transforms[b + 2] = inst.hw;
      transforms[b + 3] = inst.hz;
      transforms[b + 4] = inst.px;
      transforms[b + 5] = inst.py;
      transforms[b + 6] = inst.pz;
      // [b+7] = 0 (padding; Float32Array is zero-initialised)
    }
    this.device.queue.writeBuffer(this.transformsBuffer, 0, transforms);

    if (!this.group1) {
      this.group1 = this.device.createBindGroup({
        layout: this.bgl1,
        entries: [{ binding: 0, resource: { buffer: this.transformsBuffer } }],
      });
    }

    // Compute world-space XYZ only (O(N×3)) and hand off to sort worker.
    let validTotal = 0;
    for (const inst of instances) validTotal += this.models.get(inst.url)?.count ?? 0;
    if (validTotal === this.totalCount) {
      const worldPositions = new Float32Array(this.totalCount * 3);
      let out = 0;
      for (const inst of instances) {
        const model = this.models.get(inst.url);
        if (!model) continue;
        const lp = model.localPositions;
        const n = model.count;
        for (let i = 0; i < n; i++) {
          const lx = lp[i * 3]!;
          const ly = lp[i * 3 + 1]!;
          const lz = lp[i * 3 + 2]!;
          worldPositions[out++] = lx * inst.cos_yaw - ly * inst.sin_yaw + inst.px;
          worldPositions[out++] = lx * inst.sin_yaw + ly * inst.cos_yaw + inst.py;
          worldPositions[out++] = lz + inst.pz;
        }
      }
      // setSplats resets lastPose so the next onCamera always re-sorts.
      this.sort.setSplats(worldPositions);
    }
  }

  /** Per-frame camera update: write uniform buffer + trigger depth re-sort. */
  onCamera(
    camera: CameraState,
    dimensionMode: '2d' | '3d',
    numPixelsPerMeter: number,
    width: number,
    height: number,
    viewProj?: Float32Array,
  ): void {
    if (!this.hasContent) return;
    const uniform = buildSplatUniform(
      camera, dimensionMode, numPixelsPerMeter, width, height, 0 /* shDegree */,
    );
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniform);
    const viewDir = computeViewDir(camera.position, camera.target);
    const frustum = dimensionMode === '3d' && viewProj
      ? frustumSidePlanes(viewProj)
      : undefined;
    this.sort.onCamera(camera.position, viewDir, frustum);
  }

  /** Issue the instanced draw call inside the active render pass. */
  draw(pass: GPURenderPassEncoder): void {
    if (!this.hasContent || !this.group0 || !this.group1) return;
    const drawCount = this._visibleCount > 0 ? this._visibleCount : this.totalCount;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.group0);
    pass.setBindGroup(1, this.group1);
    pass.draw(4, drawCount);
  }

  /** Release all GPU resources and terminate the sort worker. */
  dispose(): void {
    for (const m of this.models.values()) m.gpuBuffer.destroy();
    this.models.clear();
    this.mergedSplatBuffer?.destroy();
    this.instanceIdsBuffer?.destroy();
    this.orderBuffer?.destroy();
    this.transformsBuffer?.destroy();
    this.uniformBuffer.destroy();
    this.sort.dispose();
    this.mergedSplatBuffer = null;
    this.instanceIdsBuffer = null;
    this.orderBuffer = null;
    this.transformsBuffer = null;
    this.group0 = null;
    this.group1 = null;
    this.totalCount = 0;
    this.lastInstanceKey = '';
  }

  private rebuildMergedBuffers(instances: readonly ActorInstance[]): void {
    this.mergedSplatBuffer?.destroy();
    this.instanceIdsBuffer?.destroy();
    this.orderBuffer?.destroy();
    this.mergedSplatBuffer = null;
    this.instanceIdsBuffer = null;
    this.orderBuffer = null;
    this.group0 = null;
    this._visibleCount = 0;

    let total = 0;
    for (const inst of instances) total += this.models.get(inst.url)?.count ?? 0;
    this.totalCount = total;
    if (total === 0) return;

    const merged = new Uint32Array(total * DEGREE0_STRIDE);
    const instanceIds = new Uint32Array(total);
    let splatOffset = 0;
    for (let i = 0; i < instances.length; i++) {
      const model = this.models.get(instances[i]!.url);
      if (!model) continue;
      merged.set(model.cpuData.subarray(0, model.count * DEGREE0_STRIDE), splatOffset);
      const start = splatOffset / DEGREE0_STRIDE;
      instanceIds.fill(i, start, start + model.count);
      splatOffset += model.count * DEGREE0_STRIDE;
    }

    this.mergedSplatBuffer = this.device.createBuffer({
      label: 'actorMergedSplats',
      size: merged.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.mergedSplatBuffer, 0, merged);

    this.instanceIdsBuffer = this.device.createBuffer({
      label: 'actorInstanceIds',
      size: instanceIds.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.instanceIdsBuffer, 0, instanceIds);

    const order = Uint32Array.from({ length: total }, (_, i) => i);
    this.orderBuffer = this.device.createBuffer({
      label: 'actorOrder',
      size: order.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.orderBuffer, 0, order);
    this._visibleCount = total;

    this.group0 = this.device.createBindGroup({
      layout: this.bgl0,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.mergedSplatBuffer } },
        { binding: 2, resource: { buffer: this.orderBuffer } },
        { binding: 3, resource: { buffer: this.instanceIdsBuffer } },
      ],
    });
  }
}
