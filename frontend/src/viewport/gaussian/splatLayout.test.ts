import { describe, expect, it } from "vitest";
import {
  GAUSSIAN_SPLAT_LAYOUT_VERSION,
  assertGaussianSplatLayout,
  floatToHalf,
  gaussianFeatureTexelsForDegree,
  halfToFloat,
  packQuaternion,
  planGaussianTextureArray,
  splatStrideForDegree,
  unpackQuaternion,
} from "./splatLayout";

describe("Gaussian packed transform layout", () => {
  it("uses the documented degree 0-4 strides", () => {
    expect([0, 1, 2, 3, 4].map(splatStrideForDegree)).toEqual([12, 17, 24, 35, 48]);
  });

  it("rejects degrees above 4", () => {
    expect(() => splatStrideForDegree(5)).toThrow(/SH degree/);
    expect(() => gaussianFeatureTexelsForDegree(5)).toThrow(/SH degree/);
  });

  it("accepts matching version, stride, count, and buffer length", () => {
    const buffer = new Uint32Array(2 * splatStrideForDegree(2));
    expect(() =>
      assertGaussianSplatLayout(
        {
          count: 2,
          shDegree: 2,
          shStride: splatStrideForDegree(2),
          layoutVersion: GAUSSIAN_SPLAT_LAYOUT_VERSION,
        },
        buffer,
      ),
    ).not.toThrow();
  });

  it("rejects an old or missing layout version instead of decoding it", () => {
    const base = { count: 1, shDegree: 0, shStride: splatStrideForDegree(0) };
    expect(() =>
      assertGaussianSplatLayout({ ...base, layoutVersion: 1 }),
    ).toThrow(/layout version/i);
    expect(() =>
      assertGaussianSplatLayout(base),
    ).toThrow(/layout version/i);
  });

  it("rejects stride and buffer-length mismatches", () => {
    const meta = {
      count: 2,
      shDegree: 3,
      shStride: splatStrideForDegree(3),
      layoutVersion: GAUSSIAN_SPLAT_LAYOUT_VERSION,
    };
    expect(() =>
      assertGaussianSplatLayout({ ...meta, shStride: meta.shStride - 1 }),
    ).toThrow(/stride/i);
    expect(() =>
      assertGaussianSplatLayout(meta, new Uint32Array(meta.shStride)),
    ).toThrow(/buffer length/i);
  });

  it("plans page layers for the texture addressing contract", () => {
    expect([0, 1, 2, 3, 4].map(gaussianFeatureTexelsForDegree)).toEqual([
      2, 4, 8, 13, 20,
    ]);
    expect(planGaussianTextureArray(17, 3, 4, 64)).toEqual({
      width: 4,
      height: 4,
      splatsPerPage: 16,
      pageCount: 2,
      transformLayers: 2,
      featureLayers: 26,
      featureTexelsPerSplat: 13,
    });
  });

  it("rejects a texture plan when attribute-page layers exceed the device", () => {
    expect(planGaussianTextureArray(5, 3, 2, 13)).toBeNull();
  });
});

describe("floatToHalf", () => {
  it("round-trips every finite half bit pattern", () => {
    for (let h = 0; h < 0x10000; h++) {
      if (((h >> 10) & 0x1f) === 0x1f) continue;
      expect(floatToHalf(halfToFloat(h))).toBe(h);
    }
  });

  it("rounds to nearest even and saturates to infinity", () => {
    expect(floatToHalf(1 + 2 ** -11)).toBe(0x3c00);
    expect(floatToHalf(1 + 3 * 2 ** -11)).toBe(0x3c02);
    expect(floatToHalf(1e6)).toBe(0x7c00);
    expect(floatToHalf(-1e6)).toBe(0xfc00);
    expect(floatToHalf(1e-10)).toBe(0);
    expect(floatToHalf(Number.NaN) & 0x7c00).toBe(0x7c00);
  });
});

describe("packQuaternion", () => {
  function rotationAngle(a: number[], b: number[]): number {
    const dot = Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!);
    return 2 * Math.acos(Math.min(1, dot));
  }

  it("keeps rotations within 0.3 degrees for random unit quaternions", () => {
    let seed = 12345;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32 - 0.5;
    };
    let worst = 0;
    for (let i = 0; i < 5000; i++) {
      const q = [rnd(), rnd(), rnd(), rnd()];
      const n = Math.hypot(...q);
      const unit = q.map((v) => v / n);
      const out = unpackQuaternion(packQuaternion(unit[0]!, unit[1]!, unit[2]!, unit[3]!));
      worst = Math.max(worst, rotationAngle(unit, out));
    }
    expect((worst * 180) / Math.PI).toBeLessThan(0.3);
  });

  it("round-trips axis-aligned and negated quaternions", () => {
    for (const q of [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [-1, 0, 0, 0], [0, 0, 0, -1]]) {
      const out = unpackQuaternion(packQuaternion(q[0]!, q[1]!, q[2]!, q[3]!));
      expect(rotationAngle(q, out)).toBeLessThan(1e-3);
    }
  });

  it("falls back to identity for a zero quaternion", () => {
    expect(unpackQuaternion(packQuaternion(0, 0, 0, 0))[0]).toBeCloseTo(1, 5);
  });
});
