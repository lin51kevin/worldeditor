import { describe, expect, it } from "vitest";
import {
  GAUSSIAN_FEATURE_HEADER_ELEMENTS,
  GAUSSIAN_SPLAT_TRANSFORM_WORDS,
  gaussianFeatureTexelsForDegree,
  halfToFloat,
  splatStrideForDegree,
  unpackQuaternion,
} from "./splatLayout";
import { TRANSFORM_LAYERS, prepareSplatChunk, prepareSplatSlices, slicePreparedChunk } from "./splatPrepare";

/** Records with distinct scales, unit quaternions and arbitrary SH half bits. */
function makeChunk(count: number, degree: number): Uint32Array {
  const stride = splatStrideForDegree(degree);
  const data = new Uint32Array(count * stride);
  const f32 = new Float32Array(data.buffer);
  let seed = 99;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 0; i < count; i++) {
    const base = i * stride;
    f32[base] = i * 100 + 0.5;
    f32[base + 1] = i * 100 + 1.5;
    f32[base + 2] = i * 100 + 2.5;
    f32[base + 3] = 0.01 * (i + 1);
    f32[base + 4] = 0.02 * (i + 1);
    f32[base + 5] = 0.004 * (i + 1);
    const q = [1 + i, 0.3 * i - 1, 0.5, -0.2 * i];
    const n = Math.hypot(...q);
    for (let c = 0; c < 4; c++) f32[base + 6 + c] = q[c]! / n;
    for (let w = GAUSSIAN_SPLAT_TRANSFORM_WORDS; w < stride; w++) data[base + w] = next();
  }
  return data;
}

describe.each([0, 1, 2, 3, 4])("prepareSplatChunk (SH %i)", (degree) => {
  const count = 7;
  const stride = splatStrideForDegree(degree);
  const chunk = makeChunk(count, degree);
  const f32 = new Float32Array(chunk.buffer);
  const prepared = prepareSplatChunk(chunk, degree);

  it("should report the splat count and sizes of each plane", () => {
    expect(prepared.count).toBe(count);
    expect(prepared.shDegree).toBe(degree);
    expect(prepared.transform).toHaveLength(count * 4 * TRANSFORM_LAYERS);
    expect(prepared.features).toHaveLength(count * 4 * gaussianFeatureTexelsForDegree(degree));
    expect(prepared.positions).toHaveLength(count * 3);
    expect(prepared.radii).toHaveLength(count);
    expect(prepared.opacity).toHaveLength(count);
  });

  it("should keep the position f32 bits and a decodable quaternion in the transform texel", () => {
    for (let i = 0; i < count; i++) {
      for (let lane = 0; lane < 3; lane++) {
        expect(prepared.transform[i * 4 + lane]).toBe(chunk[i * stride + lane]);
      }
      const q = unpackQuaternion(prepared.transform[i * 4 + 3]!);
      const src = [f32[i * stride + 6]!, f32[i * stride + 7]!, f32[i * stride + 8]!, f32[i * stride + 9]!];
      const dot = Math.abs(q[0] * src[0]! + q[1] * src[1]! + q[2] * src[2]! + q[3] * src[3]!);
      expect((2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI).toBeLessThan(0.3);
    }
  });

  it("should store log-scale, opacity and then the SH halves layer by layer", () => {
    const layers = gaussianFeatureTexelsForDegree(degree);
    const shElements = (degree + 1) ** 2 * 3;
    const header = GAUSSIAN_FEATURE_HEADER_ELEMENTS;
    for (let i = 0; i < count; i++) {
      const base = i * stride;
      const element = (e: number) => prepared.features[((e >> 2) * count + i) * 4 + (e & 3)]!;
      for (let axis = 0; axis < 3; axis++) {

        expect(Math.abs(Math.exp(halfToFloat(element(axis))) / f32[base + 3 + axis]! - 1)).toBeLessThan(3e-3);
      }
      expect(element(3)).toBe(chunk[base + GAUSSIAN_SPLAT_TRANSFORM_WORDS]! & 0xffff);
      for (let e = 0; e < shElements; e++) {
        const word = chunk[base + GAUSSIAN_SPLAT_TRANSFORM_WORDS + ((1 + e) >> 1)]!;
        expect(element(header + e)).toBe((word >>> (((1 + e) & 1) * 16)) & 0xffff);
      }
      for (let e = header + shElements; e < layers * 4; e++) expect(element(e)).toBe(0);
    }
  });

  it("should extract centres, the largest scale axis and the opacity bits", () => {
    for (let i = 0; i < count; i++) {
      const base = i * stride;
      expect(Array.from(prepared.positions.subarray(i * 3, i * 3 + 3))).toEqual([f32[base]!, f32[base + 1]!, f32[base + 2]!]);
      expect(prepared.radii[i]).toBe(Math.max(f32[base + 3]!, f32[base + 4]!, f32[base + 5]!));
      expect(prepared.opacity[i]).toBe(chunk[base + GAUSSIAN_SPLAT_TRANSFORM_WORDS]! & 0xffff);
    }
  });
});

describe("prepareSplatChunk input checks", () => {
  it("should reject a buffer that is not a whole number of records", () => {
    expect(() => prepareSplatChunk(new Uint32Array(5), 0)).toThrow(/whole number/);
  });

  it("should handle an empty chunk", () => {
    expect(prepareSplatChunk(new Uint32Array(0), 1).count).toBe(0);
  });

  it("should read a chunk that is a view into a larger buffer", () => {
    const stride = splatStrideForDegree(1);
    const whole = makeChunk(4, 1);
    const view = whole.subarray(stride, 3 * stride);
    const prepared = prepareSplatChunk(view, 1);
    const direct = prepareSplatChunk(whole.slice(stride, 3 * stride), 1);
    expect(Array.from(prepared.transform)).toEqual(Array.from(direct.transform));
    expect(Array.from(prepared.features)).toEqual(Array.from(direct.features));
  });
});

describe("slicePreparedChunk", () => {
  it.each([0, 2])("should equal preparing the same splats on their own (SH %i)", (degree) => {
    const chunk = makeChunk(9, degree);
    const stride = splatStrideForDegree(degree);
    const whole = prepareSplatChunk(chunk, degree);

    const slice = slicePreparedChunk(whole, 3, 8);
    const direct = prepareSplatChunk(chunk.slice(3 * stride, 8 * stride), degree);

    expect(slice.count).toBe(5);
    expect(Array.from(slice.transform)).toEqual(Array.from(direct.transform));
    expect(Array.from(slice.features)).toEqual(Array.from(direct.features));
    expect(Array.from(slice.positions)).toEqual(Array.from(direct.positions));
    expect(Array.from(slice.radii)).toEqual(Array.from(direct.radii));
    expect(Array.from(slice.opacity)).toEqual(Array.from(direct.opacity));
  });

  it("should return the chunk itself for the full range and an empty chunk for an empty one", () => {
    const whole = prepareSplatChunk(makeChunk(4, 1), 1);

    expect(slicePreparedChunk(whole, 0, 4)).toBe(whole);
    expect(slicePreparedChunk(whole, 2, 2).count).toBe(0);
  });

  it("should reject ranges outside the chunk", () => {
    const whole = prepareSplatChunk(makeChunk(4, 1), 1);

    expect(() => slicePreparedChunk(whole, -1, 2)).toThrow(RangeError);
    expect(() => slicePreparedChunk(whole, 1, 5)).toThrow(RangeError);
    expect(() => slicePreparedChunk(whole, 3, 2)).toThrow(RangeError);
  });
});

describe("prepareSplatChunk radii", () => {
  it("should never report a zero radius, which marks an empty LOD slot", () => {
    const chunk = makeChunk(2, 0);
    new Float32Array(chunk.buffer).fill(0, 3, 6);

    expect(prepareSplatChunk(chunk, 0).radii[0]).toBeGreaterThan(0);
  });
});

describe("prepareSplatSlices", () => {
  it("should split a chunk into consecutive slices that together equal the whole", () => {
    const chunk = makeChunk(10, 1);
    const slices = prepareSplatSlices(chunk, 1, 4);

    expect(slices.map((s) => s.count)).toEqual([4, 4, 2]);
    const whole = prepareSplatChunk(chunk, 1);
    const stride = splatStrideForDegree(1);
    const f32 = new Float32Array(chunk.buffer);
    let first = 0;
    for (const slice of slices) {
      for (let i = 0; i < slice.count; i++) {
        expect(slice.positions[i * 3]).toBe(f32[(first + i) * stride]);
        expect(slice.opacity[i]).toBe(whole.opacity[first + i]);
      }
      first += slice.count;
    }
  });

  it("should return no slices for an empty chunk", () => {
    expect(prepareSplatSlices(new Uint32Array(0), 0)).toEqual([]);
  });

  it("should keep a chunk within one slice whole", () => {
    expect(prepareSplatSlices(makeChunk(3, 0), 0).map((s) => s.count)).toEqual([3]);
  });
});
