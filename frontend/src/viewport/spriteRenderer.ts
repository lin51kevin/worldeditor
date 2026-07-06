/**
 * SpriteRenderer — Renders textured billboard sprites (traffic lights, road signs)
 * and ground-aligned textured quads (road paint arrows) using WebGPU.
 *
 * Sprites are grouped by texture for batched draw calls.
 */

import { TextureManager } from './textureManager';
import { SPRITE_SHADER, ROAD_PAINT_SHADER } from './viewportShaders';

/** A sprite instance to render as a billboard (faces camera). */
export interface SpriteInstance {
  /** World position [x, y, z] — center of the billboard. */
  position: [number, number, number];
  /** Texture URL path (resolved from manifest). */
  textureUrl: string;
  /** Display size in world units [width, height] (meters). Renderer converts to pixels via pixelsPerMeter. */
  size: [number, number];
}

/** A road paint instance to render flat on the road surface. */
export interface PaintInstance {
  /** World position [x, y, z] — center of the paint quad. */
  position: [number, number, number];
  /** Rotation angle in radians (heading along road). */
  rotation: number;
  /** Texture URL path. */
  textureUrl: string;
  /** Size in world units [width, height]. */
  size: [number, number];
}

/** Vertex layout: position (3f) + uv (2f) + offset (2f) = 7 floats, stride 28. */
const SPRITE_VERTEX_STRIDE = 28;
/** Road paint vertex layout: position (3f) + uv (2f) = 5 floats, stride 20. */
const PAINT_VERTEX_STRIDE = 20;

/** GPU buffer headroom factor. */
const BUFFER_HEADROOM = 2.0;

export class SpriteRenderer {
  private device: GPUDevice;
  private textureManager: TextureManager;

  // Sprite (billboard) pipeline
  private spritePipeline: GPURenderPipeline | null = null;
  private spriteUniformBuffer: GPUBuffer | null = null;
  private spriteBindGroupLayout0: GPUBindGroupLayout | null = null;
  private spriteBindGroupLayout1: GPUBindGroupLayout | null = null;
  private spriteBindGroup0: GPUBindGroup | null = null;

  // Road paint pipeline
  private paintPipeline: GPURenderPipeline | null = null;

  // Per-texture vertex buffers and bind groups for sprites
  private spriteBatches: Map<string, { buffer: GPUBuffer; vertexCount: number; bindGroup1: GPUBindGroup }> = new Map();
  // Per-texture vertex buffers and bind groups for paints
  private paintBatches: Map<string, { buffer: GPUBuffer; vertexCount: number; bindGroup1: GPUBindGroup }> = new Map();
  // Track which URLs have already been finalized (no need to refresh)
  private finalizedUrls: Set<string> = new Set();



  constructor(device: GPUDevice, textureManager: TextureManager) {
    this.device = device;
    this.textureManager = textureManager;
  }

  /** Initialize pipelines. Call after device is ready. */
  init(format: GPUTextureFormat): void {
    this.createPipelines(format);
  }

  private createPipelines(format: GPUTextureFormat): void {
    // Shared uniform bind group layout (group 0)
    this.spriteBindGroupLayout0 = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      }],
    });

    // Texture bind group layout (group 1)
    this.spriteBindGroupLayout1 = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });

    // Uniform buffer: mat4x4 (64) + vec2 (8) + f32 (4) + pad (4) = 80 bytes
    this.spriteUniformBuffer = this.device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.spriteBindGroup0 = this.device.createBindGroup({
      layout: this.spriteBindGroupLayout0,
      entries: [{ binding: 0, resource: { buffer: this.spriteUniformBuffer } }],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.spriteBindGroupLayout0, this.spriteBindGroupLayout1],
    });

    // Sprite billboard pipeline
    const spriteModule = this.device.createShaderModule({ code: SPRITE_SHADER });
    this.spritePipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: spriteModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: SPRITE_VERTEX_STRIDE,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },   // position
            { shaderLocation: 1, offset: 12, format: 'float32x2' },  // uv
            { shaderLocation: 2, offset: 20, format: 'float32x2' },  // offset
          ],
        }],
      },
      fragment: {
        module: spriteModule,
        entryPoint: 'fs_main',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          },
        }],
      },
      depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater-equal' },
      multisample: { count: 4 },
      primitive: { topology: 'triangle-list' },
    });

    // Road paint pipeline
    const paintModule = this.device.createShaderModule({ code: ROAD_PAINT_SHADER });
    this.paintPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: paintModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: PAINT_VERTEX_STRIDE,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },   // position
            { shaderLocation: 1, offset: 12, format: 'float32x2' },  // uv
          ],
        }],
      },
      fragment: {
        module: paintModule,
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
        depthCompare: 'greater-equal',
        depthBias: 4,
        depthBiasSlopeScale: 2.0,
      },
      multisample: { count: 4 },
      primitive: { topology: 'triangle-list' },
    });
  }

  /** Upload billboard sprite instances. Groups by texture URL. */
  uploadSprites(sprites: SpriteInstance[]): void {
    this.clearBatches(this.spriteBatches);
    this.finalizedUrls.clear();

    // Group by texture URL
    const groups = new Map<string, SpriteInstance[]>();
    for (const s of sprites) {
      const arr = groups.get(s.textureUrl) ?? [];
      arr.push(s);
      groups.set(s.textureUrl, arr);
    }

    for (const [url, instances] of groups) {
      const vertexData = this.buildSpriteVertices(instances);
      if (vertexData.length === 0) continue;

      const buffer = this.device.createBuffer({
        size: vertexData.byteLength * BUFFER_HEADROOM,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      new Float32Array(buffer.getMappedRange(0, vertexData.byteLength)).set(vertexData);
      buffer.unmap();

      const texture = this.textureManager.getTexture(url);
      const bindGroup1 = this.device.createBindGroup({
        layout: this.spriteBindGroupLayout1!,
        entries: [
          { binding: 0, resource: texture.createView() },
          { binding: 1, resource: this.textureManager.getSampler() },
        ],
      });

      this.spriteBatches.set(url, {
        buffer,
        vertexCount: vertexData.length / 7, // 7 floats per vertex
        bindGroup1,
      });
    }
  }

  /** Upload ground-aligned road paint instances. Groups by texture URL. */
  uploadPaints(paints: PaintInstance[]): void {
    this.clearBatches(this.paintBatches);
    this.finalizedUrls.clear();

    const groups = new Map<string, PaintInstance[]>();
    for (const p of paints) {
      const arr = groups.get(p.textureUrl) ?? [];
      arr.push(p);
      groups.set(p.textureUrl, arr);
    }

    for (const [url, instances] of groups) {
      const vertexData = this.buildPaintVertices(instances);
      if (vertexData.length === 0) continue;

      const buffer = this.device.createBuffer({
        size: vertexData.byteLength * BUFFER_HEADROOM,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      new Float32Array(buffer.getMappedRange(0, vertexData.byteLength)).set(vertexData);
      buffer.unmap();

      const texture = this.textureManager.getTexture(url);
      const bindGroup1 = this.device.createBindGroup({
        layout: this.spriteBindGroupLayout1!,
        entries: [
          { binding: 0, resource: texture.createView() },
          { binding: 1, resource: this.textureManager.getSampler() },
        ],
      });

      this.paintBatches.set(url, {
        buffer,
        vertexCount: vertexData.length / 5, // 5 floats per vertex
        bindGroup1,
      });
    }
  }

  /** Update uniform buffer with current frame's view-projection matrix. */
  updateUniforms(viewProj: Float32Array, viewportWidth: number, viewportHeight: number, spriteScale: number): void {
    if (!this.spriteUniformBuffer) return;
    const data = new Float32Array(20); // 16 (mat4) + 2 (viewport) + 1 (scale) + 1 (pad)
    data.set(viewProj, 0);
    data[16] = viewportWidth;
    data[17] = viewportHeight;
    data[18] = spriteScale;
    data[19] = 0; // padding
    this.device.queue.writeBuffer(this.spriteUniformBuffer, 0, data);
  }

  /** Render all sprite batches into the given pass. */
  renderSprites(pass: GPURenderPassEncoder): void {
    if (!this.spritePipeline || this.spriteBatches.size === 0) return;
    pass.setPipeline(this.spritePipeline);
    pass.setBindGroup(0, this.spriteBindGroup0!);

    for (const batch of this.spriteBatches.values()) {
      pass.setBindGroup(1, batch.bindGroup1);
      pass.setVertexBuffer(0, batch.buffer);
      pass.draw(batch.vertexCount);
    }
  }

  /** Render all road paint batches into the given pass. */
  renderPaints(pass: GPURenderPassEncoder): void {
    if (!this.paintPipeline || this.paintBatches.size === 0) return;
    pass.setPipeline(this.paintPipeline);
    pass.setBindGroup(0, this.spriteBindGroup0!);

    for (const batch of this.paintBatches.values()) {
      pass.setBindGroup(1, batch.bindGroup1);
      pass.setVertexBuffer(0, batch.buffer);
      pass.draw(batch.vertexCount);
    }
  }

  /** Returns true if there are any sprites or paints to render. */
  hasContent(): boolean {
    return this.spriteBatches.size > 0 || this.paintBatches.size > 0;
  }

  /** Rebuild bind groups when textures finish loading (call periodically). */
  refreshBindGroups(): boolean {
    let changed = false;
    for (const [url, batch] of this.spriteBatches) {
      if (this.finalizedUrls.has(url)) continue;
      if (!this.textureManager.isLoaded(url)) continue;
      const texture = this.textureManager.getTexture(url);
      const newBg = this.device.createBindGroup({
        layout: this.spriteBindGroupLayout1!,
        entries: [
          { binding: 0, resource: texture.createView() },
          { binding: 1, resource: this.textureManager.getSampler() },
        ],
      });
      batch.bindGroup1 = newBg;
      this.finalizedUrls.add(url);
      changed = true;
    }
    for (const [url, batch] of this.paintBatches) {
      if (this.finalizedUrls.has(url)) continue;
      if (!this.textureManager.isLoaded(url)) continue;
      const texture = this.textureManager.getTexture(url);
      const newBg = this.device.createBindGroup({
        layout: this.spriteBindGroupLayout1!,
        entries: [
          { binding: 0, resource: texture.createView() },
          { binding: 1, resource: this.textureManager.getSampler() },
        ],
      });
      batch.bindGroup1 = newBg;
      this.finalizedUrls.add(url);
      changed = true;
    }
    return changed;
  }

  destroy(): void {
    this.clearBatches(this.spriteBatches);
    this.clearBatches(this.paintBatches);
    this.spriteUniformBuffer?.destroy();
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Build sprite billboard vertices: 6 vertices per sprite (2 triangles).
   * Each vertex: [pos.x, pos.y, pos.z, u, v, offset.x, offset.y] = 7 floats.
   * The offset is in screen pixels (billboard expansion done in shader).
   */
  private buildSpriteVertices(sprites: SpriteInstance[]): Float32Array {
    const FLOATS_PER_SPRITE = 6 * 7; // 6 verts × 7 floats
    const data = new Float32Array(sprites.length * FLOATS_PER_SPRITE);
    let idx = 0;

    for (const s of sprites) {
      const [px, py, pz] = s.position;
      const hw = s.size[0] * 0.5; // half width in world units (meters)
      const hh = s.size[1] * 0.5; // half height in world units (meters)

      // 6 vertices forming 2 triangles (CCW):
      //   0--2    Tri1: 0,1,2   Tri2: 2,1,3
      //   |/ |    but we use 0,1,2 and 2,1,3 re-ordered
      //   1--3
      const corners: [number, number, number, number][] = [
        [-hw,  hh, 0, 0], // top-left:     offset=(-hw, +hh), uv=(0,0)
        [-hw, -hh, 0, 1], // bottom-left:  offset=(-hw, -hh), uv=(0,1)
        [ hw,  hh, 1, 0], // top-right:    offset=(+hw, +hh), uv=(1,0)
        [ hw, -hh, 1, 1], // bottom-right: offset=(+hw, -hh), uv=(1,1)
      ];

      // Triangle 1: TL, BL, TR
      for (const ci of [0, 1, 2] as const) {
        const c = corners[ci]!;
        data[idx++] = px; data[idx++] = py; data[idx++] = pz;
        data[idx++] = c[2];  data[idx++] = c[3];
        data[idx++] = c[0]; data[idx++] = c[1];
      }
      // Triangle 2: TR, BL, BR
      for (const ci of [2, 1, 3] as const) {
        const c = corners[ci]!;
        data[idx++] = px; data[idx++] = py; data[idx++] = pz;
        data[idx++] = c[2];  data[idx++] = c[3];
        data[idx++] = c[0]; data[idx++] = c[1];
      }
    }

    return data.subarray(0, idx);
  }

  /**
   * Build road paint vertices: 6 vertices per paint (2 triangles).
   * Each vertex: [pos.x, pos.y, pos.z, u, v] = 5 floats.
   * The quad is oriented along the road using rotation (heading).
   */
  private buildPaintVertices(paints: PaintInstance[]): Float32Array {
    const FLOATS_PER_PAINT = 6 * 5; // 6 verts × 5 floats
    const data = new Float32Array(paints.length * FLOATS_PER_PAINT);
    let idx = 0;

    for (const p of paints) {
      const [cx, cy, cz] = p.position;
      const hw = p.size[0] * 0.5;
      const hh = p.size[1] * 0.5;
      const cos = Math.cos(p.rotation);
      const sin = Math.sin(p.rotation);

      // Local corners (along-road = +Y, lateral = +X)
      // After rotation: forward → heading direction
      const localCorners: [number, number, number, number][] = [
        [-hw,  hh, 0, 0], // top-left (forward-left)
        [-hw, -hh, 0, 1], // bottom-left (rear-left)
        [ hw,  hh, 1, 0], // top-right (forward-right)
        [ hw, -hh, 1, 1], // bottom-right (rear-right)
      ];

      const worldCorners = localCorners.map(([lx, ly, u, v]) => {
        // Rotate local -> world: wx = lx*sin + ly*cos, wy = -lx*cos + ly*sin
        const wx = cx + (lx * sin + ly * cos);
        const wy = cy + (-lx * cos + ly * sin);
        return [wx, wy, cz, u, v] as [number, number, number, number, number];
      });

      // Triangle 1: TL, BL, TR
      for (const ci of [0, 1, 2] as const) {
        const wc = worldCorners[ci]!;
        data[idx++] = wc[0]; data[idx++] = wc[1]; data[idx++] = wc[2];
        data[idx++] = wc[3]; data[idx++] = wc[4];
      }
      // Triangle 2: TR, BL, BR
      for (const ci of [2, 1, 3] as const) {
        const wc = worldCorners[ci]!;
        data[idx++] = wc[0]; data[idx++] = wc[1]; data[idx++] = wc[2];
        data[idx++] = wc[3]; data[idx++] = wc[4];
      }
    }

    return data.subarray(0, idx);
  }

  private clearBatches(batches: Map<string, { buffer: GPUBuffer; vertexCount: number; bindGroup1: GPUBindGroup }>): void {
    for (const batch of batches.values()) {
      batch.buffer.destroy();
    }
    batches.clear();
  }
}
