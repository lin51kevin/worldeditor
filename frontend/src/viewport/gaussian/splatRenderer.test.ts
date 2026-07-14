import { describe, it, expect, vi } from "vitest";
import {
  extractSplatPositions,
  computeViewDir,
  decimateSplatBuffer,
  halfToFloat,
  computeSplatImportance,
  importanceDecimateSplatBuffer,
  SplatRenderer,
} from "./splatRenderer";
import { splatStrideForDegree } from "./splatPipeline";
import type { SplatSorter } from "./splatSortController";
import type { CameraState } from "../cameraController";

// Degree-0 packed u32 stride used throughout these tests.
const STRIDE0 = splatStrideForDegree(0);

describe("extractSplatPositions", () => {
  it("pulls the leading xyz of each splat record", () => {
    const data = new Uint32Array(2 * STRIDE0);
    const f32 = new Float32Array(data.buffer);
    f32[0] = 1;
    f32[1] = 2;
    f32[2] = 3;
    f32[STRIDE0] = 4;
    f32[STRIDE0 + 1] = 5;
    f32[STRIDE0 + 2] = 6;
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
    const data = new Uint32Array(3 * STRIDE0);
    expect(decimateSplatBuffer(data, STRIDE0, 10)).toBe(data);
  });

  it("reduces the splat count to at most the budget via stride sampling", () => {
    const count = 100;
    const data = new Uint32Array(count * STRIDE0);
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
    const data = new Uint32Array(5 * STRIDE0);
    expect(decimateSplatBuffer(data, STRIDE0, 0)).toBe(data);
  });
});

/** Encode a finite positive `f32` to a half-precision bit pattern (truncated). */
function floatToHalf(v: number): number {
  const f = new Float32Array([v]);
  const i = new Uint32Array(f.buffer)[0]!;
  const sign = (i >>> 16) & 0x8000;
  const exp = ((i >>> 23) & 0xff) - 127 + 15;
  const mant = i & 0x7fffff;
  if (exp <= 0) return sign; // underflow → signed zero (avoids subnormals in tests)
  if (exp >= 0x1f) return sign | 0x7c00;
  return (sign | (exp << 10) | (mant >> 13)) & 0xffff;
}

/**
 * Build one degree-0 packed splat record (stride 8 `u32`) with a position tag
 * in `x` and the given activated opacity + isotropic covariance size.
 */
function packDeg0Splat(tag: number, opacity: number, size: number): Uint32Array {
  const words = new Uint32Array(STRIDE0);
  new Float32Array(words.buffer)[0] = tag; // pos.x carries the identifying tag
  const hSize = floatToHalf(size);
  words[3] = hSize & 0xffff; // σxx (low half)
  words[4] = (hSize << 16) >>> 0; // σyy (high half)
  words[5] = (hSize << 16) >>> 0; // σzz (high half)
  words[6] = floatToHalf(opacity) & 0xffff; // opacity (low half)
  return words;
}

function concatSplats(records: Uint32Array[]): Uint32Array {
  const out = new Uint32Array(records.length * STRIDE0);
  records.forEach((r, i) => out.set(r, i * STRIDE0));
  return out;
}

describe("halfToFloat", () => {
  it("round-trips finite values within half precision", () => {
    for (const v of [0.5, 1, 2.5, 0.1, 3.75]) {
      expect(halfToFloat(floatToHalf(v))).toBeCloseTo(v, 2);
    }
  });
});

describe("computeSplatImportance", () => {
  it("is zero for zero opacity and grows with opacity and size", () => {
    const cloud = concatSplats([
      packDeg0Splat(0, 0, 4), // opacity 0 → importance 0
      packDeg0Splat(1, 1, 1),
      packDeg0Splat(2, 1, 4), // larger size → larger importance
    ]);
    const imp = computeSplatImportance(cloud, STRIDE0);
    expect(imp[0]).toBeCloseTo(0, 5);
    expect(imp[2]).toBeGreaterThan(imp[1]!);
  });
});

describe("importanceDecimateSplatBuffer", () => {
  it("returns the input unchanged when it already fits", () => {
    const cloud = concatSplats([packDeg0Splat(0, 1, 1), packDeg0Splat(1, 1, 2)]);
    expect(importanceDecimateSplatBuffer(cloud, STRIDE0, 10)).toBe(cloud);
  });

  it("keeps the highest-importance splats within the budget", () => {
    const n = 100;
    const records: Uint32Array[] = [];
    // Importance increases with index (size = i + 1).
    for (let i = 0; i < n; i++) records.push(packDeg0Splat(i, 1, i + 1));
    const cloud = concatSplats(records);
    const budget = 10;
    const out = importanceDecimateSplatBuffer(cloud, STRIDE0, budget);
    const keptCount = out.length / STRIDE0;
    expect(keptCount).toBeLessThanOrEqual(budget);
    expect(keptCount).toBeGreaterThan(0);
    const tags = extractSplatPositions(out, STRIDE0);
    const keptIdx: number[] = [];
    for (let i = 0; i < keptCount; i++) keptIdx.push(tags[i * 3]!);
    // The single most important splat (index n-1) survives.
    expect(keptIdx).toContain(n - 1);
    // Selection is biased to high importance: no low-importance splat kept.
    expect(Math.min(...keptIdx)).toBeGreaterThan(n / 2);
  });

  it("falls back to uniform sampling when all splats are equally important", () => {
    const n = 20;
    const records: Uint32Array[] = [];
    for (let i = 0; i < n; i++) records.push(packDeg0Splat(i, 1, 1));
    const cloud = concatSplats(records);
    const out = importanceDecimateSplatBuffer(cloud, STRIDE0, 5);
    expect(out.length / STRIDE0).toBeLessThanOrEqual(5);
    expect(out.length / STRIDE0).toBeGreaterThan(0);
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
    r.upload(new Uint32Array(2 * STRIDE0), 1);
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
    r.upload(new Uint32Array(3 * STRIDE0), 0);
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
    r.upload(new Uint32Array(3 * STRIDE0), 0);
    onOrderChanged.mockClear();
    r.onCamera(camera, "3d", 50, 800, 600);
    expect(onOrderChanged).toHaveBeenCalledTimes(1);
  });

  it("decimates a cloud that exceeds the device storage-buffer limit", () => {
    // Limit fits only 2 degree-0 splats (STRIDE0 u32 words * 4 bytes each).
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
    r.upload(new Uint32Array(100 * STRIDE0), 0);
    expect(r.hasContent).toBe(true);
    expect(r.count).toBeLessThanOrEqual(2);
    expect(r.count).toBeGreaterThan(0);
  });
});
