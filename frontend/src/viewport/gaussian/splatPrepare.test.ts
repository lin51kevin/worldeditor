import { describe, expect, it } from "vitest";
import {
  GAUSSIAN_SPLAT_TRANSFORM_WORDS,
  gaussianFeatureTexelsForDegree,
  splatStrideForDegree,
} from "./splatLayout";
import { prepareSplatChunk, prepareSplatSlices } from "./splatPrepare";

/** Records whose transform words are distinct floats and whose feature words are arbitrary bits. */
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
    for (let w = 0; w < GAUSSIAN_SPLAT_TRANSFORM_WORDS; w++) f32[i * stride + w] = i * 100 + w + 0.5;
    for (let w = GAUSSIAN_SPLAT_TRANSFORM_WORDS; w < stride; w++) data[i * stride + w] = next();
  }
  return data;
}

describe.each([0, 1, 2, 3])("prepareSplatChunk (SH %i)", (degree) => {
  const count = 7;
  const stride = splatStrideForDegree(degree);
  const chunk = makeChunk(count, degree);
  const f32 = new Float32Array(chunk.buffer);
  const prepared = prepareSplatChunk(chunk, degree);

  it("should report the splat count and sizes of each plane", () => {
    expect(prepared.count).toBe(count);
    expect(prepared.shDegree).toBe(degree);
    expect(prepared.transform).toHaveLength(count * 4 * 3);
    expect(prepared.features).toHaveLength(count * 4 * gaussianFeatureTexelsForDegree(degree));
    expect(prepared.positions).toHaveLength(count * 3);
    expect(prepared.radii).toHaveLength(count);
    expect(prepared.opacity).toHaveLength(count);
  });

  it("should lay transform texels out layer by layer with zero padding", () => {
    for (let i = 0; i < count; i++) {
      for (let layer = 0; layer < 3; layer++) {
        for (let lane = 0; lane < 4; lane++) {
          const word = layer * 4 + lane;
          const expected = word < GAUSSIAN_SPLAT_TRANSFORM_WORDS ? f32[i * stride + word]! : 0;
          expect(prepared.transform[(layer * count + i) * 4 + lane]).toBe(expected);
        }
      }
    }
  });

  it("should split feature words into 16-bit lanes layer by layer", () => {
    const layers = gaussianFeatureTexelsForDegree(degree);
    const elements = 1 + (degree + 1) ** 2 * 3;
    for (let i = 0; i < count; i++) {
      for (let layer = 0; layer < layers; layer++) {
        for (let lane = 0; lane < 4; lane++) {
          const element = layer * 4 + lane;
          const expected =
            element < elements
              ? (chunk[i * stride + GAUSSIAN_SPLAT_TRANSFORM_WORDS + (element >> 1)]! >>> ((element & 1) * 16)) & 0xffff
              : 0;
          expect(prepared.features[(layer * count + i) * 4 + lane]).toBe(expected);
        }
      }
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
