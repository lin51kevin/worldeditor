import { describe, it, expect, vi } from "vitest";
import {
  GaussianSplatResources,
  splatStrideForDegree,
} from "./splatPipeline";

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

function splats(count: number, degree = 0): Float32Array {
  return new Float32Array(count * splatStrideForDegree(degree));
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
    res.upload(splats(3, 1), 1);
    expect(res.count).toBe(3);
    expect(res.shDegree).toBe(1);
    expect(res.hasContent).toBe(true);
    // Two writes: splat data + identity order.
    const orderWrite = writes.find((w) => w.data instanceof Uint32Array);
    expect(orderWrite).toBeDefined();
    expect(Array.from(orderWrite!.data as Uint32Array)).toEqual([0, 1, 2]);
  });

  it("treats a zero-length upload as empty", () => {
    const { device } = fakeDevice();
    const res = new GaussianSplatResources(device, {} as GPUBindGroupLayout);
    res.upload(new Float32Array(0), 0);
    expect(res.count).toBe(0);
    expect(res.hasContent).toBe(false);
  });

  it("updates order only when the length matches the splat count", () => {
    const { device, writes } = fakeDevice();
    const res = new GaussianSplatResources(device, {} as GPUBindGroupLayout);
    res.upload(splats(3), 0);
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
    res.upload(splats(5), 0);
    const pass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      draw: vi.fn(),
    } as unknown as GPURenderPassEncoder;
    res.draw(pass, {} as GPURenderPipeline);
    expect(pass.draw).toHaveBeenCalledWith(4, 5);
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
    res.upload(splats(2), 0);
    res.clear();
    expect(res.count).toBe(0);
    // Splat + order buffers destroyed (uniform buffer remains).
    const destroyed = created.filter((b) => b.destroyed).length;
    expect(destroyed).toBeGreaterThanOrEqual(2);
  });
});
