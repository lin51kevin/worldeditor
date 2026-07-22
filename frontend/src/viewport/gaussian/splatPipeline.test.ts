import { describe, it, expect, vi } from "vitest";
import {
  GaussianSplatResources,
  splatStrideForDegree,
} from "./splatPipeline";
import { GAUSSIAN_SPLAT_LAYOUT_VERSION } from "./splatLayout";

/** Minimal fake GPUDevice recording buffer writes and draw-relevant calls. */
function fakeDevice() {
  const writes: Array<{ buffer: unknown; data: ArrayBufferView }> = [];
  const created: Array<{ size: number; destroyed: boolean }> = [];
  const device = {
    createBuffer: (desc: { size: number }) => {
      const buf = { size: desc.size, destroyed: false, destroy() {
        this.destroyed = true;
      } };
      created.push(buf);
      return buf;
    },
    createBindGroup: () => ({}),
    queue: {
      writeBuffer: (buffer: unknown, _offset: number, data: ArrayBufferView) => {
        writes.push({ buffer, data });
      },
    },
  } as unknown as GPUDevice;
  return { device, writes, created };
}

function textureDevice(
  limits: Pick<
    GPUSupportedLimits,
    | "maxTextureDimension2D"
    | "maxTextureArrayLayers"
    | "maxBufferSize"
    | "maxStorageBufferBindingSize"
  > = {
    maxTextureDimension2D: 4,
    maxTextureArrayLayers: 64,
    maxBufferSize: 1_048_576,
    maxStorageBufferBindingSize: 1_048_576,
  },
) {
  const buffers: Array<{ size: number; destroyed: boolean }> = [];
  const textures: Array<{
    descriptor: GPUTextureDescriptor;
    destroyed: boolean;
  }> = [];
  const textureWrites: Array<{
    destination: GPUTexelCopyTextureInfo;
    data: Uint8Array;
    layout: GPUTexelCopyBufferLayout;
    size: GPUExtent3D;
  }> = [];
  const device = {
    limits,
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
    createBindGroup: () => ({}),
    queue: {
      writeBuffer: vi.fn(),
      writeTexture: (
        destination: GPUTexelCopyTextureInfo,
        data: Uint8Array,
        layout: GPUTexelCopyBufferLayout,
        size: GPUExtent3D,
      ) => textureWrites.push({ destination, data, layout, size }),
    },
  } as unknown as GPUDevice;
  return { device, buffers, textures, textureWrites };
}

function splats(count: number, degree = 0): Uint32Array {
  return new Uint32Array(count * splatStrideForDegree(degree));
}

describe("GaussianSplatResources", () => {
  it("starts empty", () => {
    const { device } = fakeDevice();
    const res = new GaussianSplatResources(device, {} as GPUBindGroupLayout);
    expect(res.count).toBe(0);
    expect(res.hasContent).toBe(false);
  });

  it("uploads splats and initialises identity order", () => {
    const { device, writes } = fakeDevice();
    const res = new GaussianSplatResources(device, {} as GPUBindGroupLayout);
    res.upload(splats(3, 1), 1, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    expect(res.count).toBe(3);
    expect(res.shDegree).toBe(1);
    expect(res.hasContent).toBe(true);
    // Two writes: splat data + identity order. The order write is the Uint32Array
    // whose length equals the splat count (the packed splat data is longer).
    const orderWrite = writes.find(
      (w) => w.data instanceof Uint32Array && w.data.length === 3,
    );
    expect(orderWrite).toBeDefined();
    expect(Array.from(orderWrite!.data as Uint32Array)).toEqual([0, 1, 2]);
  });

  it("treats a zero-length upload as empty", () => {
    const { device } = fakeDevice();
    const res = new GaussianSplatResources(device, {} as GPUBindGroupLayout);
    res.upload(new Uint32Array(0), 0, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    expect(res.count).toBe(0);
    expect(res.hasContent).toBe(false);
  });

  it("rejects a buffer from a different packed layout version", () => {
    const { device } = fakeDevice();
    const res = new GaussianSplatResources(device, {} as GPUBindGroupLayout);
    expect(() => res.upload(splats(1), 0, 1)).toThrow(/layout version/i);
  });

  it("updates order only when the length matches the splat count", () => {
    const { device, writes } = fakeDevice();
    const res = new GaussianSplatResources(device, {} as GPUBindGroupLayout);
    res.upload(splats(3), 0, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    const before = writes.length;
    res.updateOrder(new Uint32Array([2, 1, 0]));
    expect(writes.length).toBe(before + 1);
    // Mismatched length is ignored.
    res.updateOrder(new Uint32Array([0, 1]));
    expect(writes.length).toBe(before + 1);
  });

  it("draws one instanced quad (4 verts) per splat", () => {
    const { device } = fakeDevice();
    const res = new GaussianSplatResources(device, {} as GPUBindGroupLayout);
    res.upload(splats(5), 0, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    const pass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      draw: vi.fn(),
    } as unknown as GPURenderPassEncoder;
    res.draw(pass, {} as GPURenderPipeline);
    expect(pass.draw).toHaveBeenCalledWith(4, 5);
  });

  it("draws only the sorted prefix known to be in front of the camera", () => {
    const { device } = fakeDevice();
    const res = new GaussianSplatResources(device, {} as GPUBindGroupLayout);
    res.upload(splats(5), 0, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    res.updateOrder(new Uint32Array([4, 3, 2, 1, 0]), 2);
    const pass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      draw: vi.fn(),
    } as unknown as GPURenderPassEncoder;

    res.draw(pass, {} as GPURenderPipeline);

    expect(pass.draw).toHaveBeenCalledWith(4, 2);
  });

  it("skips drawing when empty", () => {
    const { device } = fakeDevice();
    const res = new GaussianSplatResources(device, {} as GPUBindGroupLayout);
    const pass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      draw: vi.fn(),
    } as unknown as GPURenderPassEncoder;
    res.draw(pass, {} as GPURenderPipeline);
    expect(pass.draw).not.toHaveBeenCalled();
  });

  it("frees buffers on clear", () => {
    const { device, created } = fakeDevice();
    const res = new GaussianSplatResources(device, {} as GPUBindGroupLayout);
    res.upload(splats(2), 0, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    res.clear();
    expect(res.count).toBe(0);
    // Splat + order buffers destroyed (uniform buffer remains).
    const destroyed = created.filter((b) => b.destroyed).length;
    expect(destroyed).toBeGreaterThanOrEqual(2);
  });

  it("uploads f32 transforms and f16 opacity/SH as aligned texture arrays", () => {
    const { device, textures, textureWrites } = textureDevice();
    const res = new GaussianSplatResources(device, {} as GPUBindGroupLayout);

    res.upload(splats(10, 3), 3, GAUSSIAN_SPLAT_LAYOUT_VERSION);

    expect(res.resourceMode).toBe("texture-array");
    expect(res.textureLayout).toMatchObject({
      width: 4,
      height: 3,
      pageCount: 1,
      transformLayers: 3,
      featureLayers: 13,
    });

    expect(textures.map((texture) => texture.descriptor.format)).toEqual([
      "rgba32float",
      "rgba16float",
    ]);
    expect(textureWrites).toHaveLength(16);
    for (const write of textureWrites) {
      expect(write.layout.bytesPerRow! % 256).toBe(0);
      expect((write.size as GPUExtent3DDict).depthOrArrayLayers).toBe(1);
      expect(write.data.byteLength).toBeGreaterThanOrEqual(
        write.layout.bytesPerRow!,
      );
    }
  });

  it("transposes layout-v2 attributes into the shader layer order", () => {
    const { device, textureWrites } = textureDevice();
    const data = splats(1, 0);
    const f32 = new Float32Array(data.buffer);
    for (let i = 0; i < 10; i++) f32[i] = i + 1;
    data[10] = 0x2222_1111;
    data[11] = 0x4444_3333;
    const res = new GaussianSplatResources(device, {} as GPUBindGroupLayout);

    res.upload(data, 0, GAUSSIAN_SPLAT_LAYOUT_VERSION);

    const firstTransform = new Float32Array(textureWrites[0]!.data.buffer);
    const secondTransform = new Float32Array(textureWrites[1]!.data.buffer);
    const thirdTransform = new Float32Array(textureWrites[2]!.data.buffer);
    const features = new Uint16Array(textureWrites[3]!.data.buffer);
    expect(Array.from(firstTransform.subarray(0, 4))).toEqual([1, 2, 3, 4]);
    expect(Array.from(secondTransform.subarray(0, 4))).toEqual([5, 6, 7, 8]);
    expect(Array.from(thirdTransform.subarray(0, 4))).toEqual([9, 10, 0, 0]);
    expect(Array.from(features.subarray(0, 4))).toEqual([
      0x1111, 0x2222, 0x3333, 0x4444,
    ]);
  });

  it("destroys both texture arrays and the global order buffer", () => {
    const { device, textures, buffers } = textureDevice();
    const res = new GaussianSplatResources(device, {} as GPUBindGroupLayout);
    res.upload(splats(4, 2), 2, GAUSSIAN_SPLAT_LAYOUT_VERSION);

    res.clear();

    expect(textures).toHaveLength(2);
    expect(textures.every((texture) => texture.destroyed)).toBe(true);
    // Uniform remains alive on clear; the order buffer is destroyed.
    expect(buffers.filter((buffer) => buffer.destroyed)).toHaveLength(1);
    res.dispose();
    expect(buffers.every((buffer) => buffer.destroyed)).toBe(true);
  });
});
