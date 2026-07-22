import { describe, it, expect, vi } from "vitest";
import {
  extractSplatPositions,
  computeViewDir,
  decimateSplatBuffer,
  halfToFloat,
  computeSplatImportance,
  importanceDecimateSplatBuffer,
  sampleSplatBuffer,
  repackAsBand0,
  SplatRenderer,
} from "./splatRenderer";
import { splatStrideForDegree } from "./splatPipeline";
import { GAUSSIAN_SPLAT_LAYOUT_VERSION } from "./splatLayout";
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
 * Build one degree-0 layout-v2 record with a position tag in `x` and the given
 * activated opacity + isotropic scale.
 */
function packDeg0Splat(tag: number, opacity: number, size: number): Uint32Array {
  const words = new Uint32Array(STRIDE0);
  new Float32Array(words.buffer)[0] = tag; // pos.x carries the identifying tag
  const f32 = new Float32Array(words.buffer);
  f32[3] = size;
  f32[4] = size;
  f32[5] = size;
  f32[6] = 1; // identity (w,x,y,z) quaternion
  words[10] = floatToHalf(opacity) & 0xffff; // opacity (low half)
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

  it("preserves tiny f32 scales whose squared covariance would underflow f16", () => {
    const cloud = concatSplats([packDeg0Splat(0, 1, 1e-4)]);
    expect(computeSplatImportance(cloud, STRIDE0)[0]).toBeGreaterThan(0);
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

describe("repackAsBand0", () => {
  it("returns the input unchanged for degree 0", () => {
    const data = new Uint32Array(STRIDE0 * 2);
    expect(repackAsBand0(data, 0, GAUSSIAN_SPLAT_LAYOUT_VERSION)).toBe(data);
  });

  it("strips higher SH bands keeping position + transform + opacity + dc", () => {
    const deg1Stride = splatStrideForDegree(1); // 17 words
    const deg0Stride = splatStrideForDegree(0); // 12 words
    const n = 3;
    const src = new Uint32Array(n * deg1Stride);
    // Fill each record with a recognisable pattern.
    for (let i = 0; i < n; i++) {
      for (let w = 0; w < deg1Stride; w++) {
        src[i * deg1Stride + w] = i * 100 + w;
      }
    }
    const out = repackAsBand0(src, 1, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    expect(out.length).toBe(n * deg0Stride);
    for (let i = 0; i < n; i++) {
      // First 12 words (transform + opacity/DC) must match the source.
      for (let w = 0; w < deg0Stride; w++) {
        expect(out[i * deg0Stride + w]).toBe(i * 100 + w);
      }
    }
  });
});

describe("sampleSplatBuffer", () => {
  it("dispatches to uniform stride sampling", () => {
    const count = 100;
    const records: Uint32Array[] = [];
    for (let i = 0; i < count; i++) records.push(packDeg0Splat(i, 1, i + 1));
    const cloud = concatSplats(records);
    const out = sampleSplatBuffer(cloud, STRIDE0, 10, "uniform");
    // Uniform keeps the first splat (index 0) — importance would drop it.
    expect(extractSplatPositions(out, STRIDE0)[0]).toBe(0);
    expect(out.length / STRIDE0).toBeLessThanOrEqual(10);
  });

  it("dispatches to importance sampling", () => {
    const count = 100;
    const records: Uint32Array[] = [];
    for (let i = 0; i < count; i++) records.push(packDeg0Splat(i, 1, i + 1));
    const cloud = concatSplats(records);
    const out = sampleSplatBuffer(cloud, STRIDE0, 10, "importance");
    const tags = extractSplatPositions(out, STRIDE0);
    const keptIdx: number[] = [];
    for (let i = 0; i < out.length / STRIDE0; i++) keptIdx.push(tags[i * 3]!);
    // Importance keeps high-index (large) splats and drops the low ones.
    expect(keptIdx).toContain(count - 1);
    expect(Math.min(...keptIdx)).toBeGreaterThan(count / 2);
  });
});

describe("SplatRenderer", () => {
  function fakeDevice(overrides: Partial<GPUSupportedLimits> = {}) {
    const textures: Array<{ destroyed: boolean; descriptor: GPUTextureDescriptor }> = [];
    return {
      createBuffer: () => ({ destroy() {} }),
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
      queue: { writeBuffer: vi.fn(), writeTexture: vi.fn() },
      limits: {
        maxTextureDimension2D: 64,
        maxTextureArrayLayers: 256,
        maxBufferSize: 1_073_741_824,
        maxStorageBufferBindingSize: 1_073_741_824,
        ...overrides,
      },
      __textures: textures,
    } as unknown as GPUDevice;
  }

  function syncSorter(): SplatSorter {
    let positions: Float32Array<ArrayBufferLike> = new Float32Array(0);
    return {
      init(p) {
        positions = p;
      },
      sort(_camPos, _viewDir, generation, done) {
        const n = positions.length / 3;
        const idx = new Uint32Array(n);
        for (let i = 0; i < n; i++) idx[i] = i;
        done(idx, Math.min(2, n), generation);
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
    r.upload(
      new Uint32Array(2 * splatStrideForDegree(1)),
      1,
      GAUSSIAN_SPLAT_LAYOUT_VERSION,
    );
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
    r.upload(new Uint32Array(3 * STRIDE0), 0, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    writeSpy.mockClear();
    r.onCamera(camera, "3d", 50, 800, 600);
    // At least the uniform write plus the sorted-order write occurred.
    expect(writeSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("uses 0.3 px² low-pass and direct gamma-space SH output by default", () => {
    const device = fakeDevice();
    const writeSpy = device.queue.writeBuffer as ReturnType<typeof vi.fn>;
    const r = new SplatRenderer(
      device,
      {} as GPUBindGroupLayout,
      {} as GPURenderPipeline,
      syncSorter(),
    );
    r.upload(new Uint32Array(STRIDE0), 0, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    writeSpy.mockClear();
    r.onCamera(camera, "3d", 50, 800, 600);
    const uniform = writeSpy.mock.calls
      .map((call) => call[2])
      .find((data): data is Float32Array => data instanceof Float32Array);
    expect(uniform?.[40]).toBeCloseTo(0.3, 5);
    expect(uniform?.[41]).toBe(0);
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
    r.upload(new Uint32Array(3 * STRIDE0), 0, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    onOrderChanged.mockClear();
    r.onCamera(camera, "3d", 50, 800, 600);
    expect(onOrderChanged).toHaveBeenCalledTimes(1);
  });

  it("threads the visible count from the sorter into the draw call", () => {
    const r = new SplatRenderer(
      fakeDevice(),
      {} as GPUBindGroupLayout,
      {} as GPURenderPipeline,
      syncSorter(),
    );
    r.upload(new Uint32Array(3 * STRIDE0), 0, GAUSSIAN_SPLAT_LAYOUT_VERSION);
    r.onCamera(camera, "3d", 50, 800, 600);
    const pass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      draw: vi.fn(),
    } as unknown as GPURenderPassEncoder;

    r.draw(pass);

    expect(pass.draw).toHaveBeenCalledWith(4, 2);
  });

  it("keeps full count and SH when textures fit but one storage binding would not", () => {
    const degree = 3;
    const stride = splatStrideForDegree(degree);
    const device = fakeDevice({
      maxTextureDimension2D: 4,
      maxTextureArrayLayers: 64,
      // Enough for the 10-entry global order, not the 1,400-byte packed cloud.
      maxStorageBufferBindingSize: 64,
    });

    const r = new SplatRenderer(
      device,
      {} as GPUBindGroupLayout,
      {} as GPURenderPipeline,
      syncSorter(),
    );
    const status = r.upload(
      new Uint32Array(10 * stride),
      degree,
      GAUSSIAN_SPLAT_LAYOUT_VERSION,
    );
    expect(r.hasContent).toBe(true);
    expect(r.count).toBe(10);
    expect(status.uploadedCount).toBe(10);
    expect(status.requestedShDegree).toBe(3);
    expect(status.effectiveShDegree).toBe(3);
    expect(status.resourceMode).toBe("texture-array");
    expect(status.fallbackReason).toBeNull();
  });

  it("reports the packed compatibility fallback when texture arrays are unavailable", () => {
    const device = {
      createBuffer: () => ({ destroy() {} }),
      createBindGroup: () => ({}),
      queue: { writeBuffer: vi.fn() },
      limits: {
        maxBufferSize: 1_048_576,
        maxStorageBufferBindingSize: 1_048_576,
      },
    } as unknown as GPUDevice;
    const r = new SplatRenderer(
      device,
      {} as GPUBindGroupLayout,
      {} as GPURenderPipeline,
      syncSorter(),
    );

    const status = r.upload(
      new Uint32Array(3 * splatStrideForDegree(2)),
      2,
      GAUSSIAN_SPLAT_LAYOUT_VERSION,
    );

    expect(status.outcome).toBe("fallback");
    expect(status.uploadedCount).toBe(3);
    expect(status.effectiveShDegree).toBe(2);
    expect(status.resourceMode).toBe("packed-storage-fallback");
    expect(status.fallbackReason).toBe("texture-arrays-unavailable");
  });

  it("fails explicitly instead of reducing count or SH when full texture/order capacity is exceeded", () => {
    const degree = 3;
    const stride = splatStrideForDegree(degree);
    const r = new SplatRenderer(
      fakeDevice({
        maxTextureDimension2D: 2,
        maxTextureArrayLayers: 13,
        maxStorageBufferBindingSize: 32,
      }),
      {} as GPUBindGroupLayout,
      {} as GPURenderPipeline,
      syncSorter(),
    );

    const status = r.upload(
      new Uint32Array(5 * stride),
      degree,
      GAUSSIAN_SPLAT_LAYOUT_VERSION,
      "uniform",
      1,
      "full",
    );

    expect(status.outcome).toBe("failed");
    expect(status.sourceCount).toBe(5);
    expect(status.uploadedCount).toBe(0);
    expect(status.effectiveShDegree).toBe(3);
    expect(status.fallbackReason).toMatch(/capacity/);
    expect(r.hasContent).toBe(false);
  });

  it("reports full-mode order-buffer exhaustion without drawing a partial cloud", () => {
    const r = new SplatRenderer(
      fakeDevice({
        maxTextureDimension2D: 8,
        maxTextureArrayLayers: 64,
        maxStorageBufferBindingSize: 16,
      }),
      {} as GPUBindGroupLayout,
      {} as GPURenderPipeline,
      syncSorter(),
    );

    const status = r.upload(
      new Uint32Array(5 * STRIDE0),
      0,
      GAUSSIAN_SPLAT_LAYOUT_VERSION,
    );

    expect(status).toMatchObject({
      outcome: "failed",
      sourceCount: 5,
      uploadedCount: 0,
      effectiveShDegree: 0,
      resourceMode: "none",
      fallbackReason: "order-buffer-capacity-exceeded",
    });

  });

  it("rejects a pre-decimated source when switched to full mode", () => {
    const r = new SplatRenderer(
      fakeDevice(),
      {} as GPUBindGroupLayout,
      {} as GPURenderPipeline,
      syncSorter(),
    );
    const status = r.upload(
      new Uint32Array(5 * STRIDE0),
      0,
      GAUSSIAN_SPLAT_LAYOUT_VERSION,
      "uniform",
      1,
      "full",
      10,
    );
    expect(status).toMatchObject({
      outcome: "failed",
      sourceCount: 10,
      uploadedCount: 0,
      fallbackReason: "source-data-decimated",
    });
  });

  it("keeps explicit decimated mode bounded by texture capacity", () => {
    const degree = 3;
    const stride = splatStrideForDegree(degree);
    const r = new SplatRenderer(
      fakeDevice({
        maxTextureDimension2D: 2,
        maxTextureArrayLayers: 13,
        maxStorageBufferBindingSize: 1_024,
      }),
      {} as GPUBindGroupLayout,
      {} as GPURenderPipeline,
      syncSorter(),
    );

    const status = r.upload(
      new Uint32Array(20 * stride),
      degree,
      GAUSSIAN_SPLAT_LAYOUT_VERSION,
      "uniform",
      1,
      "decimated",
    );

    expect(status.outcome).toBe("fallback");
    expect(status.uploadedCount).toBeLessThanOrEqual(4);
    expect(status.uploadedCount).toBeGreaterThan(0);
    expect(status.effectiveShDegree).toBe(3);
  });

  it("caps the kept splat count to the quality fraction", () => {
    const r = new SplatRenderer(
      fakeDevice(),
      {} as GPUBindGroupLayout,
      {} as GPURenderPipeline,
      syncSorter(),
    );
    // 100 splats at 25% quality → ~25 kept (device limit is unbounded here).
    // Quality only applies in "decimated" mode.
    r.upload(
      new Uint32Array(100 * STRIDE0),
      0,
      GAUSSIAN_SPLAT_LAYOUT_VERSION,
      "uniform",
      0.25,
      "decimated",
    );
    expect(r.count).toBeGreaterThan(0);
    expect(r.count).toBeLessThanOrEqual(25);
  });

  it("ignores the quality fraction in full mode (keeps every splat)", () => {
    const r = new SplatRenderer(
      fakeDevice(),
      {} as GPUBindGroupLayout,
      {} as GPURenderPipeline,
      syncSorter(),
    );
    // Same 25% quality, but full mode keeps all 100 (device limit unbounded).
    r.upload(
      new Uint32Array(100 * STRIDE0),
      0,
      GAUSSIAN_SPLAT_LAYOUT_VERSION,
      "uniform",
      0.25,
      "full",
    );
    expect(r.count).toBe(100);
  });

  it("keeps every splat at full quality when it fits", () => {
    const r = new SplatRenderer(
      fakeDevice(),
      {} as GPUBindGroupLayout,
      {} as GPURenderPipeline,
      syncSorter(),
    );
    r.upload(
      new Uint32Array(40 * STRIDE0),
      0,
      GAUSSIAN_SPLAT_LAYOUT_VERSION,
      "uniform",
      1,
    );
    expect(r.count).toBe(40);
  });
});
