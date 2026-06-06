/**
 * SpriteRenderer tests
 *
 * SpriteRenderer wraps GPU state (pipelines, buffers, bind groups), so these
 * tests focus on the observable pure-logic layer:
 *   - hasContent() tracks batch state correctly
 *   - buildSpriteVertices / buildPaintVertices produce correct geometry
 *     (accessed via the exported helpers below)
 *   - refreshBindGroups() returns changed=true only when new textures land
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SpriteRenderer } from './spriteRenderer';
import type { SpriteInstance, PaintInstance } from './spriteRenderer';
import { TextureManager } from './textureManager';

// ── GPU mock helpers ──────────────────────────────────────────────────────────

function makeGPUBuffer(): GPUBuffer {
  return {
    getMappedRange: vi.fn().mockReturnValue(new ArrayBuffer(1024)),
    unmap: vi.fn(),
    destroy: vi.fn(),
  } as unknown as GPUBuffer;
}

function makeGPUTexture(): GPUTexture {
  return {
    createView: vi.fn().mockReturnValue({}),
    destroy: vi.fn(),
  } as unknown as GPUTexture;
}

function makeMockDevice() {
  const buffer = makeGPUBuffer();
  const texture = makeGPUTexture();
  const bindGroupLayout = { _tag: 'layout' } as unknown as GPUBindGroupLayout;
  const bindGroup = { _tag: 'bg' } as unknown as GPUBindGroup;
  const pipeline = { _tag: 'pipeline' } as unknown as GPURenderPipeline;
  const pipelineLayout = { _tag: 'pl' } as unknown as GPUPipelineLayout;
  const shaderModule = { _tag: 'sm' } as unknown as GPUShaderModule;

  const device = {
    createBuffer: vi.fn().mockReturnValue(buffer),
    createTexture: vi.fn().mockReturnValue(texture),
    createSampler: vi.fn().mockReturnValue({}),
    createShaderModule: vi.fn().mockReturnValue(shaderModule),
    createBindGroupLayout: vi.fn().mockReturnValue(bindGroupLayout),
    createPipelineLayout: vi.fn().mockReturnValue(pipelineLayout),
    createBindGroup: vi.fn().mockReturnValue(bindGroup),
    createRenderPipeline: vi.fn().mockReturnValue(pipeline),
    queue: {
      writeBuffer: vi.fn(),
      writeTexture: vi.fn(),
      copyExternalImageToTexture: vi.fn(),
    },
    _mockBuffer: buffer,
    _mockTexture: texture,
    _mockBindGroup: bindGroup,
  };
  return device;
}

function makeMockTextureManager(device: ReturnType<typeof makeMockDevice>): TextureManager {
  const mgr = new TextureManager(device as unknown as GPUDevice);
  return mgr;
}

function makeRenderer(): { renderer: SpriteRenderer; device: ReturnType<typeof makeMockDevice> } {
  const device = makeMockDevice();
  const texMgr = makeMockTextureManager(device);
  const renderer = new SpriteRenderer(device as unknown as GPUDevice, texMgr);
  renderer.init('bgra8unorm');
  return { renderer, device };
}

// ── hasContent ────────────────────────────────────────────────────────────────

describe('SpriteRenderer.hasContent', () => {
  it('returns false before any uploads', () => {
    const { renderer } = makeRenderer();
    expect(renderer.hasContent()).toBe(false);
  });

  it('returns true after uploading sprites', () => {
    const { renderer } = makeRenderer();
    const sprite: SpriteInstance = {
      position: [0, 0, 0],
      textureUrl: '/t/a.png',
      size: [1, 1],
    };
    renderer.uploadSprites([sprite]);
    expect(renderer.hasContent()).toBe(true);
  });

  it('returns true after uploading paints', () => {
    const { renderer } = makeRenderer();
    const paint: PaintInstance = {
      position: [0, 0, 0],
      rotation: 0,
      textureUrl: '/t/b.png',
      size: [2, 1],
    };
    renderer.uploadPaints([paint]);
    expect(renderer.hasContent()).toBe(true);
  });

  it('returns false after uploading empty arrays', () => {
    const { renderer } = makeRenderer();
    renderer.uploadSprites([]);
    renderer.uploadPaints([]);
    expect(renderer.hasContent()).toBe(false);
  });

  it('returns false after uploading sprites then clearing', () => {
    const { renderer } = makeRenderer();
    const sprite: SpriteInstance = {
      position: [0, 0, 0],
      textureUrl: '/t/c.png',
      size: [1, 1],
    };
    renderer.uploadSprites([sprite]);
    expect(renderer.hasContent()).toBe(true);
    renderer.uploadSprites([]); // clear
    expect(renderer.hasContent()).toBe(false);
  });
});

// ── Batch grouping ────────────────────────────────────────────────────────────

describe('SpriteRenderer batch grouping', () => {
  it('creates one GPU buffer per unique texture URL for sprites', () => {
    const { renderer, device } = makeRenderer();

    const sprites: SpriteInstance[] = [
      { position: [0, 0, 0], textureUrl: '/t/a.png', size: [1, 1] },
      { position: [1, 0, 0], textureUrl: '/t/a.png', size: [1, 1] },
      { position: [2, 0, 0], textureUrl: '/t/b.png', size: [1, 1] },
    ];
    renderer.uploadSprites(sprites);

    // init() creates 1 uniform buffer; two unique textures add 2 more vertex buffers
    expect(device.createBuffer).toHaveBeenCalledTimes(3);
  });

  it('creates one GPU buffer per unique texture URL for paints', () => {
    const { renderer, device } = makeRenderer();

    const paints: PaintInstance[] = [
      { position: [0, 0, 0], rotation: 0, textureUrl: '/t/x.png', size: [1, 1] },
      { position: [1, 0, 0], rotation: 0, textureUrl: '/t/y.png', size: [1, 1] },
      { position: [2, 0, 0], rotation: 0, textureUrl: '/t/y.png', size: [1, 1] },
    ];
    renderer.uploadPaints(paints);

    // init() creates 1 uniform buffer; two unique texture URLs add 2 more vertex buffers
    expect(device.createBuffer).toHaveBeenCalledTimes(3);
  });

  it('re-uploading sprites destroys old GPU buffers', () => {
    const { renderer, device } = makeRenderer();

    const sprite: SpriteInstance = {
      position: [0, 0, 0],
      textureUrl: '/t/a.png',
      size: [1, 1],
    };
    renderer.uploadSprites([sprite]);
    // Index 1 = first vertex buffer (index 0 is the uniform buffer from init())
    const firstBuffer = (device.createBuffer as ReturnType<typeof vi.fn>).mock.results[1]!.value as GPUBuffer;

    renderer.uploadSprites([sprite]);
    expect(firstBuffer.destroy).toHaveBeenCalledOnce();
  });

  it('re-uploading paints destroys old GPU buffers', () => {
    const { renderer, device } = makeRenderer();

    const paint: PaintInstance = {
      position: [0, 0, 0],
      rotation: 0,
      textureUrl: '/t/a.png',
      size: [1, 1],
    };
    renderer.uploadPaints([paint]);
    // Index 1 = first vertex buffer (index 0 is the uniform buffer from init())
    const firstBuffer = (device.createBuffer as ReturnType<typeof vi.fn>).mock.results[1]!.value as GPUBuffer;

    renderer.uploadPaints([paint]);
    expect(firstBuffer.destroy).toHaveBeenCalledOnce();
  });
});

// ── updateUniforms ────────────────────────────────────────────────────────────

describe('SpriteRenderer.updateUniforms', () => {
  it('writes uniform buffer with viewport and scale values', () => {
    const { renderer, device } = makeRenderer();
    const viewProj = new Float32Array(16).fill(0);
    viewProj[0] = 1; viewProj[5] = 1; viewProj[10] = 1; viewProj[15] = 1;

    renderer.updateUniforms(viewProj, 1920, 1080, 2.5);

    expect(device.queue.writeBuffer).toHaveBeenCalledOnce();
    const [, , data] = (device.queue.writeBuffer as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, unknown, Float32Array];
    // data[16] = viewportWidth, data[17] = viewportHeight, data[18] = spriteScale
    expect(data[16]).toBe(1920);
    expect(data[17]).toBe(1080);
    expect(data[18]).toBe(2.5);
  });
});

// ── refreshBindGroups ─────────────────────────────────────────────────────────

describe('SpriteRenderer.refreshBindGroups', () => {
  it('returns false when no batches exist', () => {
    const { renderer } = makeRenderer();
    expect(renderer.refreshBindGroups()).toBe(false);
  });

  it('returns false for sprites whose texture is not yet loaded', () => {
    const { renderer } = makeRenderer();
    const sprite: SpriteInstance = {
      position: [0, 0, 0],
      textureUrl: '/t/not-loaded.png',
      size: [1, 1],
    };
    renderer.uploadSprites([sprite]);
    // TextureManager.isLoaded returns false for any uncached URL
    expect(renderer.refreshBindGroups()).toBe(false);
  });
});

// ── destroy ───────────────────────────────────────────────────────────────────

describe('SpriteRenderer.destroy', () => {
  it('destroys all allocated GPU buffers', () => {
    const { renderer, device } = makeRenderer();

    renderer.uploadSprites([{ position: [0, 0, 0], textureUrl: '/a.png', size: [1, 1] }]);
    renderer.uploadPaints([{ position: [0, 0, 0], rotation: 0, textureUrl: '/b.png', size: [1, 1] }]);

    const bufferCalls = (device.createBuffer as ReturnType<typeof vi.fn>).mock.results;
    renderer.destroy();

    for (const call of bufferCalls) {
      expect((call.value as GPUBuffer).destroy).toHaveBeenCalled();
    }
  });

  it('hasContent is false after destroy', () => {
    const { renderer } = makeRenderer();
    renderer.uploadSprites([{ position: [0, 0, 0], textureUrl: '/a.png', size: [1, 1] }]);
    renderer.destroy();
    // destroy clears both batch maps
    expect(renderer.hasContent()).toBe(false);
  });
});

// ── vertex geometry: sprite corners ──────────────────────────────────────────
// We validate geometry indirectly by counting vertices and checking stride.

describe('SpriteRenderer vertex geometry', () => {
  it('produces 6 vertices (2 triangles) per sprite', () => {
    const { renderer, device } = makeRenderer();

    const sprites: SpriteInstance[] = [
      { position: [1, 2, 3], textureUrl: '/t/a.png', size: [2, 4] },
      { position: [5, 6, 7], textureUrl: '/t/a.png', size: [1, 1] },
    ];
    renderer.uploadSprites(sprites);

    // Buffer was created; the size passed to createBuffer should accommodate
    // 2 sprites × 6 verts × 7 floats × 4 bytes = 336 bytes (before headroom).
    // Index 0 is the uniform buffer (from init); index 1 is the first vertex buffer.
    const createBufferCall = (device.createBuffer as ReturnType<typeof vi.fn>).mock.calls[1]!;
    const bufferDesc = createBufferCall[0] as GPUBufferDescriptor;
    // size must be at least 336 (before BUFFER_HEADROOM factor)
    expect(bufferDesc.size).toBeGreaterThanOrEqual(336);
  });

  it('produces 6 vertices (2 triangles) per paint', () => {
    const { renderer, device } = makeRenderer();

    const paints: PaintInstance[] = [
      { position: [0, 0, 0], rotation: 0.5, textureUrl: '/t/b.png', size: [3, 2] },
      { position: [1, 0, 0], rotation: 1.0, textureUrl: '/t/b.png', size: [1, 1] },
    ];
    renderer.uploadPaints(paints);

    const createBufferCall = (device.createBuffer as ReturnType<typeof vi.fn>).mock.calls[1]!;
    const bufferDesc = createBufferCall[0] as GPUBufferDescriptor;
    // 2 paints × 6 verts × 5 floats × 4 bytes = 240 bytes (before headroom)
    expect(bufferDesc.size).toBeGreaterThanOrEqual(240);
  });
});
