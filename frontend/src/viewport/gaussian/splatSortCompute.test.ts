import { describe, it, expect } from "vitest";
import { GpuSplatSorter, MAX_WORKGROUPS_PER_DIM } from "./splatSortCompute";

type Dispatch = { x: number; y: number };
type Write = { buffer: GPUBuffer; data: ArrayBufferView };

/** Minimal WebGPU stub that records every `dispatchWorkgroups` call. */
function makeDevice(): {
  device: GPUDevice;
  dispatches: Dispatch[];
  writes: Write[];
} {
  const dispatches: Dispatch[] = [];
  const writes: Write[] = [];
  const pass = {
    setPipeline: () => undefined,
    setBindGroup: () => undefined,
    dispatchWorkgroups: (x: number, y = 1) => {
      dispatches.push({ x, y });
    },
    end: () => undefined,
  };
  const device = {
    createShaderModule: () => ({}),
    createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBuffer: () => ({ destroy: () => undefined }),
    createBindGroup: () => ({}),
    queue: {
      writeBuffer: (buffer: GPUBuffer, _offset: number, data: ArrayBufferView) => {
        writes.push({ buffer, data });
      },
    },
    createCommandEncoder: () => ({ beginComputePass: () => pass }),
  } as unknown as GPUDevice;
  return { device, dispatches, writes };
}

function runSort(count: number): Dispatch[] {
  const { device, dispatches } = makeDevice();
  const sorter = new GpuSplatSorter(device);
  sorter.resize(count);
  sorter.sort(
    device.createCommandEncoder(),
    {} as GPUBuffer,
    {} as GPUBuffer,
    [0, 0, 0],
    [0, 0, 1],
    0,
    100,
  );
  return dispatches;
}

describe("GpuSplatSorter dispatch grid", () => {
  it("keeps a small cloud on a single dispatch row", () => {
    const dispatches = runSort(1000);
    expect(dispatches.length).toBeGreaterThan(0);
    for (const d of dispatches) expect(d.y).toBe(1);
  });

  it("never exceeds the per-dimension workgroup limit for a 22M splat cloud", () => {
    // 22.1M splats needs 86372 groups of 256 — the case that invalidated the
    // whole command encoder (blank frame) with a 1-D dispatch.
    const count = 22_111_000;
    const dispatches = runSort(count);
    for (const d of dispatches) {
      expect(d.x).toBeLessThanOrEqual(MAX_WORKGROUPS_PER_DIM);
      expect(d.x).toBeGreaterThan(0);
      expect(d.y).toBeGreaterThan(0);
    }
    // The widest grid must still cover one workgroup per 256 splats.
    const covered = Math.max(...dispatches.map((d) => d.x * d.y));
    expect(covered).toBeGreaterThanOrEqual(Math.ceil(count / 256));
  });

  it("uses exactly the grid width the shaders linearize against", () => {
    const groups = MAX_WORKGROUPS_PER_DIM + 1;
    const dispatches = runSort(groups * 256);
    // Any grid taller than one row must be exactly MAX wide, else
    // `wid.x + wid.y * MAX` in the WGSL would skip or alias workgroups.
    for (const d of dispatches) {
      if (d.y > 1) expect(d.x).toBe(MAX_WORKGROUPS_PER_DIM);
    }
  });
});

describe("GpuSplatSorter indirect draw arguments", () => {
  it("exposes a draw-args buffer once sized", () => {
    const { device } = makeDevice();
    const sorter = new GpuSplatSorter(device);
    expect(sorter.drawArgsBuffer).toBeNull();
    sorter.resize(1000);
    expect(sorter.drawArgsBuffer).not.toBeNull();
    sorter.dispose();
    expect(sorter.drawArgsBuffer).toBeNull();
  });

  it("resets the visible counter to zero before every sort", () => {
    const { device, writes } = makeDevice();
    const sorter = new GpuSplatSorter(device);
    sorter.resize(1000);
    const args = sorter.drawArgsBuffer;
    const encoder = device.createCommandEncoder();
    for (let i = 0; i < 2; i++) {
      sorter.sort(encoder, {} as GPUBuffer, {} as GPUBuffer, [0, 0, 0], [0, 0, 1], 0, 100);
    }
    const resets = writes.filter((w) => w.buffer === args);
    expect(resets).toHaveLength(2);
    for (const reset of resets) {
      // [vertexCount, instanceCount, firstVertex, firstInstance]
      expect(Array.from(reset.data as Uint32Array)).toEqual([4, 0, 0, 0]);
    }
  });
});
