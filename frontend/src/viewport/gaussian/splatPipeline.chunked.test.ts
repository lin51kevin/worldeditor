import { describe, expect, it, vi } from "vitest";
import { GaussianSplatResources, splatStrideForDegree } from "./splatPipeline";
import { GAUSSIAN_SPLAT_LAYOUT_VERSION } from "./splatLayout";
import { prepareSplatChunk, slicePreparedChunk } from "./splatPrepare";

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
    const texelBytes = texture.descriptor.format === "rgba32uint" ? 16 : 8;
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

  it("should write identity order for every splat and keep no separate centre buffer", () => {
    const data = makeSplats(37, 1);
    const rec = recordingDevice();
    const resources = chunkedUpload(rec, data, 1, [10, 20, 7]);

    const order = new Uint32Array(37);
    for (const w of rec.bufferWrites) {
      if (w.buffer === (resources.gpuOrderBuffer as unknown)) order.set(w.data as Uint32Array, w.offset / 4);
    }
    expect(Array.from(order)).toEqual(Array.from({ length: 37 }, (_, i) => i));
    // Order + radii only: the sort reads centres from the transform texture.
    expect(rec.buffers.filter((b) => b.size === 37 * 3 * 4)).toHaveLength(0);
  });

  it("should store each splat's centre bits in its transform texel for the GPU sort", () => {
    const data = makeSplats(37, 1);
    const rec = recordingDevice();
    chunkedUpload(rec, data, 1, [10, 20, 7]);

    const [transformLayers] = replay(rec);
    const texels = new Uint32Array(transformLayers!.flatMap((layer) => Array.from(new Uint32Array(layer.buffer))));
    const stride = splatStrideForDegree(1);
    for (let i = 0; i < 37; i++) {
      expect(Array.from(texels.subarray(i * 4, i * 4 + 3))).toEqual(Array.from(data.subarray(i * stride, i * stride + 3)));
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
    expect(resources.gpuTransformView).not.toBeNull();
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

describe("GaussianSplatResources resident store", () => {
  function storeOf(capacity: number, degree = 0) {
    const rec = recordingDevice();
    const resources = new GaussianSplatResources(rec.device, {} as GPUBindGroupLayout);
    resources.beginResidentStore(capacity, degree, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    return { rec, resources };
  }

  it("should be drawable through the GPU sort as soon as it is allocated, with every slot counted", () => {
    const { resources } = storeOf(16);

    expect(resources.residentStore).toBe(true);
    expect(resources.hasContent).toBe(true);
    expect(resources.count).toBe(16);
    expect(resources.capacity).toBe(16);
    expect(resources.resourceMode).toBe("texture-array");
  });

  it("should write prepared splats into the slots it is given", () => {
    const { rec, resources } = storeOf(40);
    const data = makeSplats(5, 0);

    resources.writeResident(prepareSplatChunk(data, 0), 12);

    const radiiBuffer = resources.gpuRadiiBuffer as unknown as RecordedBuffer;
    const write = rec.bufferWrites.find((w) => w.buffer === radiiBuffer)!;
    expect(write.offset).toBe(12 * 4);
    expect((write.data as Float32Array).length).toBe(5);
    expect(rec.textureWrites.some((w) => w.origin.x + w.origin.y * 4 + w.origin.z * 16 === 12)).toBe(true);
  });

  it("should not write an identity order, since the GPU sort produces it", () => {
    const { rec, resources } = storeOf(40);

    resources.writeResident(prepareSplatChunk(makeSplats(5, 0), 0), 0);

    const orderBuffer = resources.gpuOrderBuffer as unknown as RecordedBuffer;
    expect(rec.bufferWrites.filter((w) => w.buffer === orderBuffer)).toHaveLength(0);
  });

  it("should empty released slots by zeroing their radii", () => {
    const { rec, resources } = storeOf(40);
    resources.writeResident(prepareSplatChunk(makeSplats(5, 0), 0), 10);
    const radii = resources.gpuRadiiBuffer as unknown as RecordedBuffer;
    rec.bufferWrites.length = 0;

    resources.releaseResident(10, 5);

    const write = rec.bufferWrites.find((w) => w.buffer === radii)!;
    expect(write.offset).toBe(10 * 4);
    expect(Array.from(write.data as Float32Array)).toEqual([0, 0, 0, 0, 0]);
  });

  it("should reject writes outside the capacity, with the wrong SH degree, or without a store", () => {
    const { resources } = storeOf(8);

    expect(() => resources.writeResident(prepareSplatChunk(makeSplats(5, 0), 0), 4)).toThrow(/capacity/);
    expect(() => resources.writeResident(prepareSplatChunk(makeSplats(2, 1), 1), 0)).toThrow(/SH degree/);
    expect(() => resources.releaseResident(6, 4)).toThrow(/capacity/);

    const rec = recordingDevice();
    const plain = new GaussianSplatResources(rec.device, {} as GPUBindGroupLayout);
    expect(() => plain.writeResident(prepareSplatChunk(makeSplats(1, 0), 0), 0)).toThrow(/No resident/);
    expect(() => plain.releaseResident(0, 1)).toThrow(/No resident/);
  });

  it("should refuse sequential chunk appends", () => {
    const { resources } = storeOf(8);

    expect(() => resources.appendChunkedUpload(makeSplats(2, 0))).toThrow(/slot writes/);
  });

  it("should write the same texels as a sequential upload, wherever the slots are", () => {
    const data = makeSplats(12, 1);
    const sequential = recordingDevice();
    chunkedUpload(sequential, data, 1, [12]);

    const { rec, resources } = storeOf(12, 1);
    const prepared = prepareSplatChunk(data, 1);
    // Out of order and split across two writes.
    resources.writeResident(slicePreparedChunk(prepared, 5, 12), 5);
    resources.writeResident(slicePreparedChunk(prepared, 0, 5), 0);

    expect(replay(rec)).toEqual(replay(sequential));
  });

  it("should free everything when cleared", () => {
    const { rec, resources } = storeOf(8);

    resources.clear();

    expect(resources.hasContent).toBe(false);
    expect(resources.residentStore).toBe(false);
    expect(rec.textures.every((t) => t.destroyed)).toBe(true);
  });
});

describe("GaussianSplatResources progressive chunked upload", () => {
  function drawn(resources: GaussianSplatResources) {
    const pass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      draw: vi.fn(),
      drawIndirect: vi.fn(),
    } as unknown as GPURenderPassEncoder;
    resources.draw(pass, {} as GPURenderPipeline);
    return pass;
  }

  it("should expose the appended prefix as drawable content with the full capacity", () => {
    const rec = recordingDevice();
    const resources = new GaussianSplatResources(rec.device, {} as GPUBindGroupLayout);
    resources.beginChunkedUpload(8, 0, GAUSSIAN_SPLAT_LAYOUT_VERSION, true);

    expect(resources.progressive).toBe(true);
    expect(resources.hasContent).toBe(false);
    expect(resources.capacity).toBe(8);

    resources.appendChunkedUpload(makeSplats(3, 0));
    expect(resources.hasContent).toBe(true);
    expect(resources.count).toBe(3);
    expect(resources.capacity).toBe(8);
    expect(resources.resourceMode).toBe("texture-array");

    resources.appendChunkedUpload(makeSplats(5, 0));
    resources.endChunkedUpload();
    expect(resources.count).toBe(8);
    expect(resources.progressive).toBe(false);
    expect(resources.capacity).toBe(8);
  });

  it("should draw nothing until the GPU sort has produced an order, then draw its instances", () => {
    const rec = recordingDevice();
    const resources = new GaussianSplatResources(rec.device, {} as GPUBindGroupLayout);
    resources.beginChunkedUpload(8, 0, GAUSSIAN_SPLAT_LAYOUT_VERSION, true);
    resources.appendChunkedUpload(makeSplats(3, 0));

    const before = drawn(resources);
    expect(before.draw).not.toHaveBeenCalled();
    expect(before.drawIndirect).not.toHaveBeenCalled();

    const args = {} as GPUBuffer;
    resources.setIndirectDraw(args);
    expect(drawn(resources).drawIndirect).toHaveBeenCalledWith(args, 0);
  });

  it("should keep the bind group created at begin when the upload ends", () => {
    const rec = recordingDevice();
    const resources = new GaussianSplatResources(rec.device, {} as GPUBindGroupLayout);
    resources.beginChunkedUpload(4, 0, GAUSSIAN_SPLAT_LAYOUT_VERSION, true);
    resources.appendChunkedUpload(makeSplats(4, 0));
    const created = (rec.device.createBindGroup as ReturnType<typeof vi.fn>).mock.calls.length;

    resources.endChunkedUpload();

    expect((rec.device.createBindGroup as ReturnType<typeof vi.fn>).mock.calls.length).toBe(created);
    expect(resources.hasContent).toBe(true);
  });

  it("should write the same textures as a non-progressive upload", () => {
    const data = makeSplats(37, 1);
    const plain = recordingDevice();
    chunkedUpload(plain, data, 1, [10, 20, 7]);

    const progressive = recordingDevice();
    const resources = new GaussianSplatResources(progressive.device, {} as GPUBindGroupLayout);
    resources.beginChunkedUpload(37, 1, GAUSSIAN_SPLAT_LAYOUT_VERSION, true);
    const stride = splatStrideForDegree(1);
    let offset = 0;
    for (const size of [10, 20, 7]) {
      resources.appendChunkedUpload(data.slice(offset * stride, (offset + size) * stride));
      offset += size;
    }
    resources.endChunkedUpload();

    expect(replay(progressive)).toEqual(replay(plain));
  });

  it("should free everything when aborted mid-upload", () => {
    const rec = recordingDevice();
    const resources = new GaussianSplatResources(rec.device, {} as GPUBindGroupLayout);
    resources.beginChunkedUpload(4, 0, GAUSSIAN_SPLAT_LAYOUT_VERSION, true);
    resources.appendChunkedUpload(makeSplats(2, 0));

    resources.abortChunkedUpload();

    expect(resources.hasContent).toBe(false);
    expect(resources.progressive).toBe(false);
    expect(rec.textures.every((t) => t.destroyed)).toBe(true);
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
