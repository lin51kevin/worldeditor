import { describe, expect, it, vi } from "vitest";
import { GaussianSplatResources, splatStrideForDegree } from "./splatPipeline";
import { GAUSSIAN_SPLAT_LAYOUT_VERSION } from "./splatLayout";
import { prepareSplatChunk } from "./splatPrepare";

interface RecordedTexture {
  descriptor: GPUTextureDescriptor;
  destroyed: boolean;
}

interface RecordedBuffer {
  size: number;
  destroyed: boolean;
}

/** Fake device that records texture/buffer writes so final GPU state can be rebuilt. */
function recordingDevice(dimension = 4) {
  const buffers: RecordedBuffer[] = [];
  const textures: RecordedTexture[] = [];
  const textureWrites: Array<{
    texture: unknown;
    origin: { x: number; y: number; z: number };
    data: Uint8Array;
    bytesPerRow: number;
    size: { width: number; height: number };
  }> = [];
  const bufferWrites: Array<{ buffer: RecordedBuffer; offset: number; data: ArrayBufferView }> = [];
  const device = {
    limits: {
      maxTextureDimension2D: dimension,
      maxTextureArrayLayers: 64,
      maxBufferSize: 1_048_576,
      maxStorageBufferBindingSize: 1_048_576,
    },
    createBuffer: (desc: { size: number }) => {
      const buffer = {
        size: desc.size,
        destroyed: false,
        destroy() {
          this.destroyed = true;
        },
      };
      buffers.push(buffer);
      return buffer;
    },
    createTexture: (descriptor: GPUTextureDescriptor) => {
      const texture = {
        descriptor,
        destroyed: false,
        createView: () => ({}),
        destroy() {
          this.destroyed = true;
        },
      };
      textures.push(texture);
      return texture;
    },
    createBindGroup: vi.fn(() => ({})),
    queue: {
      writeBuffer: (buffer: RecordedBuffer, offset: number, data: ArrayBufferView) =>
        bufferWrites.push({ buffer, offset, data }),
      writeTexture: (
        destination: GPUTexelCopyTextureInfo,
        data: Uint8Array,
        layout: GPUTexelCopyBufferLayout,
        size: GPUExtent3D,
      ) =>
        textureWrites.push({
          texture: destination.texture,
          origin: destination.origin as { x: number; y: number; z: number },
          data: new Uint8Array(data),
          bytesPerRow: layout.bytesPerRow as number,
          size: size as { width: number; height: number },
        }),
    },
  } as unknown as GPUDevice;
  return { device, buffers, textures, textureWrites, bufferWrites };
}

/** Replay recorded writes into per-layer byte arrays: layers[textureIndex][z]. */
function replay(rec: ReturnType<typeof recordingDevice>): Uint8Array[][] {
  return rec.textures.map((texture) => {
    const size = texture.descriptor.size as GPUExtent3DDictStrict;
    const texelBytes = texture.descriptor.format === "rgba32float" ? 16 : 8;
    const layers = Array.from(
      { length: size.depthOrArrayLayers ?? 1 },
      () => new Uint8Array(size.width * size.height * texelBytes),
    );
    for (const write of rec.textureWrites.filter((w) => w.texture === texture)) {
      for (let row = 0; row < write.size.height; row++) {
        const bytes = write.data.subarray(
          row * write.bytesPerRow,
          row * write.bytesPerRow + write.size.width * texelBytes,
        );
        layers[write.origin.z]!.set(bytes, ((write.origin.y + row) * size.width + write.origin.x) * texelBytes);
      }
    }
    return layers;
  });
}

/** Deterministic layout-v2 records: floats in the transform block, arbitrary bits after. */
function makeSplats(count: number, degree: number): Uint32Array {
  const stride = splatStrideForDegree(degree);
  const data = new Uint32Array(count * stride);
  const f32 = new Float32Array(data.buffer);
  let seed = 12345;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 10; k++) f32[i * stride + k] = i * 10 + k + 0.5;
    for (let k = 10; k < stride; k++) data[i * stride + k] = next();
  }
  return data;
}

function chunkedUpload(rec: ReturnType<typeof recordingDevice>, data: Uint32Array, degree: number, sizes: number[]) {
  const stride = splatStrideForDegree(degree);
  const resources = new GaussianSplatResources(rec.device, {} as GPUBindGroupLayout);
  resources.beginChunkedUpload(data.length / stride, degree, GAUSSIAN_SPLAT_LAYOUT_VERSION);
  let offset = 0;
  for (const size of sizes) {
    resources.appendChunkedUpload(data.slice(offset * stride, (offset + size) * stride));
    offset += size;
  }
  resources.endChunkedUpload();
  return resources;
}

describe("GaussianSplatResources chunked upload", () => {
  const partitions: Array<[string, number[]]> = [
    ["a single chunk", [37]],
    ["one splat at a time", Array.from({ length: 37 }, () => 1)],
    ["chunks not aligned to the texture width", [5, 5, 5, 5, 5, 5, 5, 2]],
    ["chunks spanning pages", [3, 13, 21]],
    ["page-sized chunks", [16, 16, 5]],
  ];

  it.each([0, 1])("should produce the same textures as a whole-buffer upload (SH degree %i)", (degree) => {
    const data = makeSplats(37, degree);
    const whole = recordingDevice();
    new GaussianSplatResources(whole.device, {} as GPUBindGroupLayout).upload(
      data,
      degree,
      GAUSSIAN_SPLAT_LAYOUT_VERSION,
      "texture-array",
    );
    const expected = replay(whole);

    for (const [name, sizes] of partitions) {
      const chunked = recordingDevice();
      chunkedUpload(chunked, data, degree, sizes);
      expect(replay(chunked), name).toEqual(expected);
    }
  });

  it("should write identity order and centres for every splat", () => {
    const data = makeSplats(37, 1);
    const rec = recordingDevice();
    const resources = chunkedUpload(rec, data, 1, [10, 20, 7]);

    const order = new Uint32Array(37);
    const positions = new Float32Array(37 * 3);
    for (const w of rec.bufferWrites) {
      if (w.buffer === (resources.gpuOrderBuffer as unknown)) order.set(w.data as Uint32Array, w.offset / 4);
      if (w.buffer === (resources.gpuPositionsBuffer as unknown)) positions.set(w.data as Float32Array, w.offset / 4);
    }
    const stride = splatStrideForDegree(1);
    const f32 = new Float32Array(data.buffer);
    expect(Array.from(order)).toEqual(Array.from({ length: 37 }, (_, i) => i));
    for (let i = 0; i < 37; i++) {
      expect(Array.from(positions.subarray(i * 3, i * 3 + 3))).toEqual(Array.from(f32.subarray(i * stride, i * stride + 3)));
    }
  });

  it("should write each splat's largest scale axis for frustum culling", () => {
    const data = makeSplats(37, 1);
    const rec = recordingDevice();
    const resources = chunkedUpload(rec, data, 1, [10, 20, 7]);

    const target = resources.gpuRadiiBuffer as unknown as RecordedBuffer;
    expect(target.size).toBe(37 * 4);
    const radii = new Float32Array(37);
    for (const w of rec.bufferWrites) {
      if (w.buffer === target) radii.set(w.data as Float32Array, w.offset / 4);
    }
    // makeSplats stores i*10+k+0.5 in transform word k, so scale (k=3..5) peaks at k=5.
    expect(Array.from(radii)).toEqual(Array.from({ length: 37 }, (_, i) => i * 10 + 5.5));
  });

  it("should also build the radii buffer for a whole-buffer upload and free it on clear", () => {
    const rec = recordingDevice();
    const resources = new GaussianSplatResources(rec.device, {} as GPUBindGroupLayout);
    resources.upload(makeSplats(9, 0), 0, GAUSSIAN_SPLAT_LAYOUT_VERSION, "texture-array");

    const target = resources.gpuRadiiBuffer as unknown as RecordedBuffer;
    expect(target.size).toBe(9 * 4);
    const write = rec.bufferWrites.find((w) => w.buffer === target)!;
    expect(Array.from(write.data as Float32Array)).toEqual(Array.from({ length: 9 }, (_, i) => i * 10 + 5.5));

    resources.clear();
    expect(resources.gpuRadiiBuffer).toBeNull();
    expect(target.destroyed).toBe(true);
  });

  it("should draw the depth-only occluder from the GPU sort's visible list when one exists", () => {
    const rec = recordingDevice();
    const resources = chunkedUpload(rec, makeSplats(8, 0), 0, [8]);
    const colourGroup = (rec.device.createBindGroup as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    const args = {} as GPUBuffer;
    resources.setIndirectDraw(args);
    const pass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      draw: vi.fn(),
      drawIndirect: vi.fn(),
    } as unknown as GPURenderPassEncoder;
    const depthPipeline = {} as GPURenderPipeline;

    resources.drawDepthOnly(pass, depthPipeline);

    expect(pass.setPipeline).toHaveBeenCalledWith(depthPipeline);
    expect(pass.setBindGroup).toHaveBeenCalledWith(0, colourGroup);
    expect(pass.drawIndirect).toHaveBeenCalledWith(args, 0);
    expect(pass.draw).not.toHaveBeenCalled();
  });

  it("should not be drawable until the upload ends", () => {
    const rec = recordingDevice();
    const resources = new GaussianSplatResources(rec.device, {} as GPUBindGroupLayout);
    resources.beginChunkedUpload(8, 0, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    resources.appendChunkedUpload(makeSplats(8, 0));

    expect(resources.hasContent).toBe(false);
    expect(resources.chunkedWritten).toBe(8);

    resources.endChunkedUpload();
    expect(resources.hasContent).toBe(true);
    expect(resources.count).toBe(8);
    expect(resources.resourceMode).toBe("texture-array");
    expect(resources.gpuPositionsBuffer).not.toBeNull();
  });

  it("should reject append and end without a session", () => {
    const rec = recordingDevice();
    const resources = new GaussianSplatResources(rec.device, {} as GPUBindGroupLayout);
    expect(() => resources.appendChunkedUpload(makeSplats(1, 0))).toThrow(/in progress/);
    expect(() => resources.endChunkedUpload()).toThrow(/in progress/);
  });

  it("should reject a chunk that is not whole records or overflows the count, freeing GPU memory", () => {
    const rec = recordingDevice();
    const resources = new GaussianSplatResources(rec.device, {} as GPUBindGroupLayout);
    resources.beginChunkedUpload(2, 0, GAUSSIAN_SPLAT_LAYOUT_VERSION);

    expect(() => resources.appendChunkedUpload(new Uint32Array(5))).toThrow(/whole number/);
    expect(() => resources.appendChunkedUpload(makeSplats(3, 0))).toThrow(/exceeds/);
    expect(resources.chunkedWritten).toBe(0);
  });

  it("should abort and free resources when ended early", () => {
    const rec = recordingDevice();
    const resources = new GaussianSplatResources(rec.device, {} as GPUBindGroupLayout);
    resources.beginChunkedUpload(4, 0, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    resources.appendChunkedUpload(makeSplats(2, 0));

    expect(() => resources.endChunkedUpload()).toThrow(/2 of 4/);
    expect(resources.hasContent).toBe(false);
    expect(rec.textures.every((t) => t.destroyed)).toBe(true);
  });

  it("should reject an unknown layout version and a non-positive count", () => {
    const rec = recordingDevice();
    const resources = new GaussianSplatResources(rec.device, {} as GPUBindGroupLayout);
    expect(() => resources.beginChunkedUpload(4, 0, 1)).toThrow(/layout version/i);
    expect(() => resources.beginChunkedUpload(0, 0, GAUSSIAN_SPLAT_LAYOUT_VERSION)).toThrow(/positive/);
  });

  it("should fail begin without leaking textures when the cloud exceeds the device capacity", () => {
    const rec = recordingDevice(2);
    rec.device.limits.maxTextureArrayLayers = 3;
    const resources = new GaussianSplatResources(rec.device, {} as GPUBindGroupLayout);

    expect(() => resources.beginChunkedUpload(100, 0, GAUSSIAN_SPLAT_LAYOUT_VERSION)).toThrow(/capacity/);
    expect(rec.textures).toHaveLength(0);
  });

  it("should free a previous cloud when a chunked upload begins", () => {
    const rec = recordingDevice();
    const resources = new GaussianSplatResources(rec.device, {} as GPUBindGroupLayout);
    resources.upload(makeSplats(3, 0), 0, GAUSSIAN_SPLAT_LAYOUT_VERSION, "texture-array");
    const firstTextures = [...rec.textures];

    resources.beginChunkedUpload(5, 0, GAUSSIAN_SPLAT_LAYOUT_VERSION);

    expect(firstTextures.every((t) => t.destroyed)).toBe(true);
    expect(resources.hasContent).toBe(false);
  });
});

function preparedUpload(rec: ReturnType<typeof recordingDevice>, data: Uint32Array, degree: number, sizes: number[]) {
  const stride = splatStrideForDegree(degree);
  const resources = new GaussianSplatResources(rec.device, {} as GPUBindGroupLayout);
  resources.beginChunkedUpload(data.length / stride, degree, GAUSSIAN_SPLAT_LAYOUT_VERSION);
  let offset = 0;
  for (const size of sizes) {
    const chunk = data.slice(offset * stride, (offset + size) * stride);
    resources.appendChunkedUpload(chunk, prepareSplatChunk(chunk, degree));
    offset += size;
  }
  resources.endChunkedUpload();
  return resources;
}

describe("GaussianSplatResources prepared chunk upload", () => {
  const partitions: Array<[string, number[]]> = [
    ["a single chunk", [37]],
    ["one splat at a time", Array.from({ length: 37 }, () => 1)],
    ["chunks not aligned to the texture width", [5, 5, 5, 5, 5, 5, 5, 2]],
    ["chunks spanning pages", [3, 13, 21]],
  ];

  it.each([0, 1, 3])("should produce the same textures as packed chunks (SH degree %i)", (degree) => {
    const data = makeSplats(37, degree);
    for (const [name, sizes] of partitions) {
      const packed = recordingDevice();
      chunkedUpload(packed, data, degree, sizes);
      const prepared = recordingDevice();
      preparedUpload(prepared, data, degree, sizes);
      expect(replay(prepared), name).toEqual(replay(packed));
    }
  });

  it("should copy rows straight from the prepared planes when rows are 256-byte aligned", () => {
    const data = makeSplats(700, 1);
    const packed = recordingDevice(16);
    chunkedUpload(packed, data, 1, [100, 300, 300]);
    const prepared = recordingDevice(16);
    preparedUpload(prepared, data, 1, [100, 300, 300]);

    expect(replay(prepared)).toEqual(replay(packed));
    const wide = prepared.textureWrites.filter((w) => w.size.height > 1);
    expect(wide.length).toBeGreaterThan(0);
  });

  it("should write the same side buffers as packed chunks", () => {
    const data = makeSplats(37, 1);
    const packed = recordingDevice();
    const a = chunkedUpload(packed, data, 1, [10, 20, 7]);
    const prepared = recordingDevice();
    const b = preparedUpload(prepared, data, 1, [10, 20, 7]);

    const collect = (rec: ReturnType<typeof recordingDevice>, target: unknown, words: number) => {
      const out = new Uint32Array(37 * words);
      for (const w of rec.bufferWrites) {
        if (w.buffer === target) out.set(new Uint32Array(w.data.buffer, w.data.byteOffset, w.data.byteLength / 4), w.offset / 4);
      }
      return Array.from(out);
    };
    expect(collect(prepared, b.gpuOrderBuffer, 1)).toEqual(collect(packed, a.gpuOrderBuffer, 1));
    expect(collect(prepared, b.gpuPositionsBuffer, 3)).toEqual(collect(packed, a.gpuPositionsBuffer, 3));
    expect(collect(prepared, b.gpuRadiiBuffer, 1)).toEqual(collect(packed, a.gpuRadiiBuffer, 1));
  });

  it("should reject prepared data that does not match the chunk", () => {
    const rec = recordingDevice();
    const resources = new GaussianSplatResources(rec.device, {} as GPUBindGroupLayout);
    resources.beginChunkedUpload(8, 1, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    const chunk = makeSplats(4, 1);

    expect(() => resources.appendChunkedUpload(chunk, prepareSplatChunk(makeSplats(3, 1), 1))).toThrow(/prepared/i);
    expect(() => resources.appendChunkedUpload(chunk, prepareSplatChunk(makeSplats(4, 0), 0))).toThrow(/prepared/i);
  });
});
