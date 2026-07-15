import { describe, it, expect } from 'vitest';
import {
  splatStrideForDegree,
  shiftSplatOrigin,
  shiftPointCloudOrigin,
} from './splatSampling';

/** Build a packed splat buffer of `n` splats with sequential positions. */
function makeSplats(n: number, shDegree = 0): Uint32Array {
  const stride = splatStrideForDegree(shDegree);
  const buf = new Uint32Array(n * stride);
  const f32 = new Float32Array(buf.buffer);
  for (let i = 0; i < n; i++) {
    f32[i * stride] = i;
    f32[i * stride + 1] = i * 2;
    f32[i * stride + 2] = i * 3;
  }
  return buf;
}

describe('splatSampling.shiftSplatOrigin', () => {
  it('adds the origin to every splat position (shifted copy)', () => {
    const stride = splatStrideForDegree(0);
    const buf = makeSplats(3);
    const out = shiftSplatOrigin(buf, stride, [10, 20, 30]);
    expect(out).not.toBe(buf); // copy, original untouched
    const f32 = new Float32Array(out.buffer);
    expect(f32[0]).toBeCloseTo(10, 5);
    expect(f32[1]).toBeCloseTo(20, 5);
    expect(f32[2]).toBeCloseTo(30, 5);
    expect(f32[stride]).toBeCloseTo(11, 5);
    // Original is unchanged.
    expect(new Float32Array(buf.buffer)[0]).toBe(0);
  });

  it('returns the input unchanged for a zero/undefined origin', () => {
    const stride = splatStrideForDegree(0);
    const buf = makeSplats(2);
    expect(shiftSplatOrigin(buf, stride, [0, 0, 0])).toBe(buf);
    expect(shiftSplatOrigin(buf, stride, undefined)).toBe(buf);
  });
});

describe('splatSampling.shiftPointCloudOrigin', () => {
  it('shifts x,y,z of each 7-float vertex in place, leaving rgba', () => {
    const v = new Float32Array([1, 2, 3, 0.5, 0.6, 0.7, 1, 4, 5, 6, 0.1, 0.2, 0.3, 1]);
    shiftPointCloudOrigin(v, [10, 100, 1000]);
    expect(v[0]).toBeCloseTo(11, 5);
    expect(v[1]).toBeCloseTo(102, 5);
    expect(v[2]).toBeCloseTo(1003, 5);
    expect(v[3]).toBeCloseTo(0.5, 5); // rgba untouched
    expect(v[7]).toBeCloseTo(14, 5);
    expect(v[8]).toBeCloseTo(105, 5);
  });

  it('is a no-op for zero origin', () => {
    const v = new Float32Array([1, 2, 3, 0, 0, 0, 1]);
    shiftPointCloudOrigin(v, [0, 0, 0]);
    expect(Array.from(v)).toEqual([1, 2, 3, 0, 0, 0, 1]);
  });
});
