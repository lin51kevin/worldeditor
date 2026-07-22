import { describe, expect, it } from "vitest";
import {
  GAUSSIAN_SPLAT_LAYOUT_VERSION,
  assertGaussianSplatLayout,
  gaussianFeatureTexelsForDegree,
  planGaussianTextureArray,
  splatStrideForDegree,
} from "./splatLayout";

describe("Gaussian packed transform layout", () => {
  it("uses the documented degree 0-3 strides", () => {
    expect([0, 1, 2, 3].map(splatStrideForDegree)).toEqual([12, 17, 24, 35]);
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
    expect([0, 1, 2, 3].map(gaussianFeatureTexelsForDegree)).toEqual([
      1, 4, 7, 13,
    ]);
    expect(planGaussianTextureArray(17, 3, 4, 64)).toEqual({
      width: 4,
      height: 4,
      splatsPerPage: 16,
      pageCount: 2,
      transformLayers: 6,
      featureLayers: 26,
      featureTexelsPerSplat: 13,
    });
  });

  it("rejects a texture plan when attribute-page layers exceed the device", () => {
    expect(planGaussianTextureArray(5, 3, 2, 13)).toBeNull();
  });
});
