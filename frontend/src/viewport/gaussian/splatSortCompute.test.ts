import { describe, it, expect } from "vitest";
import { GpuSplatSorter, MAX_WORKGROUPS_PER_DIM } from "./splatSortCompute";

type Dispatch = { x: number; y: number };
type Write = { buffer: GPUBuffer; data: ArrayBufferView };

const transforms = { label: "transforms" } as unknown as GPUTextureView;

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
    transforms,
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

describe("GpuSplatSorter active prefix", () => {
  it("dispatches the key pass over only the active splats of a larger buffer", () => {
    const { device, dispatches, writes } = makeDevice();
    const sorter = new GpuSplatSorter(device);
    sorter.resize(100_000);
    sorter.sort(device.createCommandEncoder(), transforms, {} as GPUBuffer, [0, 0, 0], [0, 0, 1], 0, 100, undefined, 1000);

    // Key pass is the first dispatch: ceil(1000 / 256) = 4 groups, not 391.
    expect(dispatches[0]).toEqual({ x: 4, y: 1 });
    const params = writes.find((w) => w.data.byteLength === 48);
    // The sorter writes the params as a bare ArrayBuffer; word 3 is the element count.
    expect(new Uint32Array(params!.data as unknown as ArrayBuffer)[3]).toBe(1000);
  });

  it("clamps the active count to the allocated size and skips an empty prefix", () => {
    const { device, dispatches } = makeDevice();
    const sorter = new GpuSplatSorter(device);
    sorter.resize(512);
    sorter.sort(device.createCommandEncoder(), transforms, {} as GPUBuffer, [0, 0, 0], [0, 0, 1], 0, 100, undefined, 10_000);
    expect(dispatches[0]).toEqual({ x: 2, y: 1 });

    dispatches.length = 0;
    sorter.sort(device.createCommandEncoder(), transforms, {} as GPUBuffer, [0, 0, 0], [0, 0, 1], 0, 100, undefined, 0);
    expect(dispatches).toHaveLength(0);
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
      sorter.sort(encoder, transforms, {} as GPUBuffer, [0, 0, 0], [0, 0, 1], 0, 100);
    }
    const resets = writes.filter((w) => w.buffer === args);
    expect(resets).toHaveLength(2);
    for (const reset of resets) {
      // [vertexCount, instanceCount, firstVertex, firstInstance]
      expect(Array.from(reset.data as Uint32Array)).toEqual([4, 0, 0, 0]);
    }
  });
});

describe("GpuSplatSorter frustum culling", () => {
  /** Device stub that also records bind-group entries. */
  function makeRecordingDevice() {
    const base = makeDevice();
    const groups: { layout: unknown; entries: { binding: number; resource: { buffer: GPUBuffer } }[] }[] = [];
    const device = base.device as unknown as {
      createBindGroup: (d: (typeof groups)[number]) => object;
      createBuffer: () => object;
    };
    device.createBindGroup = (d) => {
      groups.push(d);
      return {};
    };
    return { ...base, groups };
  }

  const uniformBuffer = { label: "uniform" } as unknown as GPUBuffer;
  const radiiBuffer = { label: "radii" } as unknown as GPUBuffer;

  function depthParams(writes: Write[]): { u32: Uint32Array; f32: Float32Array } {
    const w = writes.filter((x) => x.data.byteLength === 48).pop()!;
    // The sorter hands queue.writeBuffer a raw ArrayBuffer.
    const buf = (w.data as unknown as ArrayBuffer).slice(0);
    return { u32: new Uint32Array(buf), f32: new Float32Array(buf) };
  }

  it("binds the render uniform and radii to the key pass and enables culling", () => {
    const { device, groups, writes } = makeRecordingDevice();
    const sorter = new GpuSplatSorter(device);
    sorter.resize(1000);
    groups.length = 0;
    sorter.sort(
      device.createCommandEncoder(),
      transforms,
      {} as GPUBuffer,
      [0, 0, 0],
      [0, 0, 1],
      0,
      100,
      { uniformBuffer, radiiBuffer, guardNdc: 0.25 },
    );
    const init = groups.find((g) => g.entries.length === 7)!;
    expect(init.entries.find((e) => e.binding === 5)!.resource.buffer).toBe(radiiBuffer);
    expect(init.entries.find((e) => e.binding === 6)!.resource.buffer).toBe(uniformBuffer);
    const { u32, f32 } = depthParams(writes);
    expect(u32[7]).toBe(1);
    expect(f32[10]).toBeCloseTo(0.25, 6);
  });

  it("writes the interactive thinning threshold to the key pass, zero by default", () => {
    const { device, writes } = makeRecordingDevice();
    const sorter = new GpuSplatSorter(device);
    sorter.resize(1000);
    const encoder = device.createCommandEncoder();
    sorter.sort(encoder, transforms, {} as GPUBuffer, [0, 0, 0], [0, 0, 1], 0, 100, {
      uniformBuffer,
      radiiBuffer,
      guardNdc: 0.25,
      thinTau: 6.5,
    });
    expect(depthParams(writes).f32[11]).toBeCloseTo(6.5, 5);
    sorter.sort(encoder, transforms, {} as GPUBuffer, [0, 0, 0], [0, 0, 1], 0, 100, {
      uniformBuffer,
      radiiBuffer,
      guardNdc: 0.25,
    });
    expect(depthParams(writes).f32[11]).toBe(0);
  });

  it("can keep only the dead-slot check, with frustum culling and thinning off", () => {
    const { device, writes } = makeRecordingDevice();
    const sorter = new GpuSplatSorter(device);
    sorter.resize(1000);
    sorter.sort(device.createCommandEncoder(), transforms, {} as GPUBuffer, [0, 0, 0], [0, 0, 1], 0, 100, {
      uniformBuffer,
      radiiBuffer,
      guardNdc: 0.25,
      enabled: false,
      deadSplats: true,
    });

    // Bit 0 = frustum cull, bit 1 = skip splats with a zero radius.
    expect(depthParams(writes).u32[7]).toBe(2);
  });

  it("sets both bits when frustum culling and the dead-slot check are on", () => {
    const { device, writes } = makeRecordingDevice();
    const sorter = new GpuSplatSorter(device);
    sorter.resize(1000);
    sorter.sort(device.createCommandEncoder(), transforms, {} as GPUBuffer, [0, 0, 0], [0, 0, 1], 0, 100, {
      uniformBuffer,
      radiiBuffer,
      guardNdc: 0.25,
      deadSplats: true,
    });

    expect(depthParams(writes).u32[7]).toBe(3);
  });

  it("disables culling when no cull inputs are given", () => {
    const { device, writes, groups } = makeRecordingDevice();
    const sorter = new GpuSplatSorter(device);
    sorter.resize(1000);
    groups.length = 0;
    sorter.sort(device.createCommandEncoder(), transforms, {} as GPUBuffer, [0, 0, 0], [0, 0, 1], 0, 100);
    expect(depthParams(writes).u32[7]).toBe(0);
    // The key pass still needs valid (placeholder) bindings 5 and 6.
    const init = groups.find((g) => g.entries.length === 7)!;
    expect(init.entries.map((e) => e.binding)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("reads the splat centres from the cloud's transform texture", () => {
    const { device, groups } = makeRecordingDevice();
    const sorter = new GpuSplatSorter(device);
    sorter.resize(1000);
    groups.length = 0;
    sorter.sort(device.createCommandEncoder(), transforms, {} as GPUBuffer, [0, 0, 0], [0, 0, 1], 0, 100);
    const init = groups.find((g) => g.entries.length === 7)!;
    expect(init.entries.find((e) => e.binding === 1)!.resource).toBe(transforms);
  });
});

describe("GpuSplatSorter visible-only sorting", () => {
  /** Device stub recording the entry point of every dispatched pipeline, in order. */
  function makeOrderedDevice() {
    const order: string[] = [];
    const dispatchSizes: Array<{ entry: string; x: number; y: number }> = [];
    let current = "";
    const pass = {
      setPipeline: (p: { entry: string }) => {
        current = p.entry;
        order.push(p.entry);
      },
      setBindGroup: () => undefined,
      dispatchWorkgroups: (x: number, y = 1) => {
        dispatchSizes.push({ entry: current, x, y });
      },
      end: () => undefined,
    };
    const device = {
      createShaderModule: () => ({}),
      createComputePipeline: (d: { compute: { entryPoint: string } }) => ({
        entry: d.compute.entryPoint,
        getBindGroupLayout: () => ({}),
      }),
      createBuffer: (d: { size: number }) => ({ size: d.size, destroy: () => undefined }),
      createBindGroup: () => ({}),
      queue: { writeBuffer: () => undefined },
      createCommandEncoder: () => ({ beginComputePass: () => pass }),
    } as unknown as GPUDevice;
    return { device, order, dispatchSizes };
  }

  function run(count: number) {
    const rec = makeOrderedDevice();
    const sorter = new GpuSplatSorter(rec.device);
    sorter.resize(count);
    sorter.sort(rec.device.createCommandEncoder(), transforms, {} as GPUBuffer, [0, 0, 0], [0, 0, 1], 0, 100);
    return rec;
  }

  it("compacts survivors and derives the radix sizes on the GPU before the first histogram", () => {
    const { order } = run(5000);
    const first = (e: string) => order.indexOf(e);
    expect(first("init_keys")).toBe(0);
    expect(first("compact_visible")).toBeGreaterThan(first("init_keys"));
    expect(first("dyn_params")).toBeGreaterThan(first("compact_visible"));
    expect(first("histogram")).toBeGreaterThan(first("dyn_params"));
    expect(order.filter((e) => e === "histogram")).toHaveLength(3);
    expect(order.filter((e) => e === "scatter")).toHaveLength(3);
    expect(order.filter((e) => e === "compact_visible")).toHaveLength(1);
  });

  it("scans the per-workgroup visible counts between the key pass and the compaction", () => {
    const { order } = run(5000);
    const between = order.slice(order.indexOf("init_keys") + 1, order.indexOf("compact_visible"));
    expect(between).toContain("scan_blocks");
  });

  it("launches one compaction workgroup per 256 splats", () => {
    const { dispatchSizes } = run(5000);
    const d = dispatchSizes.find((x) => x.entry === "compact_visible")!;
    expect(d.x * d.y).toBe(Math.ceil(5000 / 256));
  });

  it("sizes the radix passes for the worst case and lets the GPU shrink them", () => {
    const { dispatchSizes } = run(5000);
    for (const d of dispatchSizes.filter((x) => x.entry === "histogram" || x.entry === "scatter")) {
      expect(d.x * d.y).toBe(Math.ceil(5000 / 256));
    }
  });
});
