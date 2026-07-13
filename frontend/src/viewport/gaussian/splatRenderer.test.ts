import { describe, it, expect, vi } from "vitest";
import {
  extractSplatPositions,
  computeViewDir,
  decimateSplatBuffer,
  SplatRenderer,
} from "./splatRenderer";
import { splatStrideForDegree } from "./splatPipeline";
import type { SplatSorter } from "./splatSortController";
import type { CameraState } from "../cameraController";

// Degree-0 stride (13) used throughout these tests.
const STRIDE0 = splatStrideForDegree(0);

describe("extractSplatPositions", () => {
  it("pulls the leading xyz of each splat record", () => {
    const data = new Float32Array(2 * STRIDE0);
    data[0] = 1;
    data[1] = 2;
    data[2] = 3;
    data[STRIDE0] = 4;
    data[STRIDE0 + 1] = 5;
    data[STRIDE0 + 2] = 6;
    expect(Array.from(extractSplatPositions(data, STRIDE0))).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });
});

describe("computeViewDir", () => {
  it("returns the normalized target-minus-position direction", () => {
    const dir = computeViewDir([0, 0, 0], [0, 0, 10]);
    expect(dir[0]).toBeCloseTo(0, 5);
    expect(dir[1]).toBeCloseTo(0, 5);
    expect(dir[2]).toBeCloseTo(1, 5);
  });

  it("falls back to +Z for a degenerate (zero-length) direction", () => {
    const dir = computeViewDir([1, 1, 1], [1, 1, 1]);
    expect(dir).toEqual([0, 0, 1]);
  });
});

describe("decimateSplatBuffer", () => {
  it("returns the input unchanged when it already fits", () => {
    const data = new Float32Array(3 * STRIDE0);
    expect(decimateSplatBuffer(data, STRIDE0, 10)).toBe(data);
  });

  it("reduces the splat count to at most the budget via stride sampling", () => {
    const count = 100;
    const data = new Float32Array(count * STRIDE0);
    for (let i = 0; i < count; i++) data[i * STRIDE0] = i; // tag x with index
    const out = decimateSplatBuffer(data, STRIDE0, 10);
    const keptCount = out.length / STRIDE0;
    expect(keptCount).toBeLessThanOrEqual(10);
    expect(keptCount).toBeGreaterThan(0);
    // First kept splat is the original first splat (index 0).
    expect(out[0]).toBe(0);
    // Kept splats preserve full per-splat records (stride-aligned).
    expect(out.length % STRIDE0).toBe(0);
  });

  it("keeps everything when the budget is non-positive is a no-op guard", () => {
    const data = new Float32Array(5 * STRIDE0);
    expect(decimateSplatBuffer(data, STRIDE0, 0)).toBe(data);
  });
});

describe("SplatRenderer", () => {
  function fakeDevice() {
    return {
      createBuffer: () => ({ destroy() {} }),
      createBindGroup: () => ({}),
      queue: { writeBuffer: vi.fn() },
    } as unknown as GPUDevice;
  }

  function syncSorter(): SplatSorter {
    let positions = new Float32Array(0);
    return {
      init(p) {
        positions = p;
      },
      sort(_camPos, _viewDir, generation, done) {
        const n = positions.length / 3;
        const idx = new Uint32Array(n);
        for (let i = 0; i < n; i++) idx[i] = i;
        done(idx, generation);
      },
      dispose() {},
    };
  }

  const camera = {
    position: [0, -10, 5],
    target: [0, 0, 0],
    up: [0, 0, 1],
    fovY: Math.PI / 4,
    near: 0.1,
    far: 1000,
  } as CameraState;

  it("reports content after upload and clears it", () => {
    const r = new SplatRenderer(
      fakeDevice(),
      {} as GPUBindGroupLayout,
      {} as GPURenderPipeline,
      syncSorter(),
    );
    expect(r.hasContent).toBe(false);
    r.upload(new Float32Array(2 * STRIDE0), 1);
    expect(r.hasContent).toBe(true);
    r.clear();
    expect(r.hasContent).toBe(false);
  });

  it("updates the uniform and sorts on camera changes", () => {
    const device = fakeDevice();
    const writeSpy = device.queue.writeBuffer as ReturnType<typeof vi.fn>;
    const r = new SplatRenderer(
      device,
      {} as GPUBindGroupLayout,
      {} as GPURenderPipeline,
      syncSorter(),
    );
    r.upload(new Float32Array(3 * STRIDE0), 0);
    writeSpy.mockClear();
    r.onCamera(camera, "3d", 50, 800, 600);
    // At least the uniform write plus the sorted-order write occurred.
    expect(writeSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("does nothing on camera changes when empty", () => {
    const device = fakeDevice();
    const writeSpy = device.queue.writeBuffer as ReturnType<typeof vi.fn>;
    const r = new SplatRenderer(
      device,
      {} as GPUBindGroupLayout,
      {} as GPURenderPipeline,
      syncSorter(),
    );
    writeSpy.mockClear();
    r.onCamera(camera, "3d", 50, 800, 600);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("invokes onOrderChanged when a fresh sort is applied (wakes render loop)", () => {
    const onOrderChanged = vi.fn();
    const r = new SplatRenderer(
      fakeDevice(),
      {} as GPUBindGroupLayout,
      {} as GPURenderPipeline,
      syncSorter(),
      onOrderChanged,
    );
    r.upload(new Float32Array(3 * STRIDE0), 0);
    onOrderChanged.mockClear();
    r.onCamera(camera, "3d", 50, 800, 600);
    expect(onOrderChanged).toHaveBeenCalledTimes(1);
  });

  it("decimates a cloud that exceeds the device storage-buffer limit", () => {
    // Limit fits only 2 degree-0 splats (13 floats * 4 bytes = 52 B each).
    const device = {
      createBuffer: () => ({ destroy() {} }),
      createBindGroup: () => ({}),
      queue: { writeBuffer: vi.fn() },
      limits: { maxStorageBufferBindingSize: 2 * STRIDE0 * 4 },
    } as unknown as GPUDevice;
    const r = new SplatRenderer(
      device,
      {} as GPUBindGroupLayout,
      {} as GPURenderPipeline,
      syncSorter(),
    );
    r.upload(new Float32Array(100 * STRIDE0), 0);
    expect(r.hasContent).toBe(true);
    expect(r.count).toBeLessThanOrEqual(2);
    expect(r.count).toBeGreaterThan(0);
  });
});
