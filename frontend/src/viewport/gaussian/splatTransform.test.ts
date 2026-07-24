import { describe, it, expect } from 'vitest';
import {
  transformPackedSplats,
  recenterSplats,
  splatBoundsCenter,
  mergePackedSplats,
} from './splatTransform';
import { splatStrideForDegree } from './splatLayout';

/** Build a single band-0 splat record with the given position and identity quat. */
function makeSplat(pos: [number, number, number], quat: [number, number, number, number]): Uint32Array {
  const stride = splatStrideForDegree(0); // 12 words
  const buf = new Uint32Array(stride);
  const f32 = new Float32Array(buf.buffer);
  f32[0] = pos[0];
  f32[1] = pos[1];
  f32[2] = pos[2];
  // scale words 3..5 left as 0
  f32[6] = quat[0];
  f32[7] = quat[1];
  f32[8] = quat[2];
  f32[9] = quat[3];
  return buf;
}

function readPos(buf: Uint32Array): [number, number, number] {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.length);
  return [f32[0]!, f32[1]!, f32[2]!];
}

function readQuat(buf: Uint32Array): [number, number, number, number] {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.length);
  return [f32[6]!, f32[7]!, f32[8]!, f32[9]!];
}

describe('transformPackedSplats', () => {
  const stride = splatStrideForDegree(0);

  it('translates positions with zero rotation', () => {
    const splat = makeSplat([1, 2, 3], [1, 0, 0, 0]);
    const out = transformPackedSplats(splat, stride, [10, 20, 30], 0);
    expect(readPos(out)).toEqual([11, 22, 33]);
  });

  it('rotates positions 90° about Z', () => {
    const splat = makeSplat([1, 0, 5], [1, 0, 0, 0]);
    const out = transformPackedSplats(splat, stride, [0, 0, 0], Math.PI / 2);
    const [x, y, z] = readPos(out);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(1, 5);
    expect(z).toBeCloseTo(5, 5);
  });

  it('rotates then translates', () => {
    const splat = makeSplat([1, 0, 0], [1, 0, 0, 0]);
    const out = transformPackedSplats(splat, stride, [2, 3, 0], Math.PI / 2);
    const [x, y] = readPos(out);
    expect(x).toBeCloseTo(2, 5);
    expect(y).toBeCloseTo(4, 5);
  });

  it('pre-multiplies the orientation quaternion by the yaw rotation', () => {
    // Identity orientation rotated 90° about Z → (cos45, 0, 0, sin45).
    const splat = makeSplat([0, 0, 0], [1, 0, 0, 0]);
    const out = transformPackedSplats(splat, stride, [0, 0, 0], Math.PI / 2);
    const [w, x, y, z] = readQuat(out);
    expect(w).toBeCloseTo(Math.SQRT1_2, 5);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('does not mutate the input buffer', () => {
    const splat = makeSplat([1, 2, 3], [1, 0, 0, 0]);
    const before = new Uint32Array(splat);
    transformPackedSplats(splat, stride, [5, 5, 5], 1);
    expect(splat).toEqual(before);
  });
});

describe('splatBoundsCenter / recenterSplats', () => {
  const stride = splatStrideForDegree(0);

  it('computes the bbox centre of a two-splat cloud', () => {
    const a = makeSplat([0, 0, 0], [1, 0, 0, 0]);
    const b = makeSplat([4, 6, 8], [1, 0, 0, 0]);
    const merged = mergePackedSplats([a, b]);
    expect(splatBoundsCenter(merged, stride)).toEqual([2, 3, 4]);
  });

  it('recenters positions so the bbox centre maps to the origin', () => {
    const a = makeSplat([0, 0, 0], [1, 0, 0, 0]);
    const b = makeSplat([4, 6, 8], [1, 0, 0, 0]);
    const merged = mergePackedSplats([a, b]);
    const centered = recenterSplats(merged, stride, [2, 3, 4]);
    expect(splatBoundsCenter(centered, stride)).toEqual([0, 0, 0]);
  });

  it('returns [0,0,0] for an empty buffer', () => {
    expect(splatBoundsCenter(new Uint32Array(0), stride)).toEqual([0, 0, 0]);
  });
});

describe('mergePackedSplats', () => {
  it('returns an empty buffer when all inputs are empty', () => {
    expect(mergePackedSplats([new Uint32Array(0), new Uint32Array(0)])).toEqual(new Uint32Array(0));
  });

  it('concatenates buffers end to end', () => {
    const a = new Uint32Array([1, 2, 3]);
    const b = new Uint32Array([4, 5]);
    expect(Array.from(mergePackedSplats([a, b]))).toEqual([1, 2, 3, 4, 5]);
  });

  it('passes a single non-empty buffer through unchanged', () => {
    const a = new Uint32Array([1, 2, 3]);
    expect(mergePackedSplats([new Uint32Array(0), a])).toBe(a);
  });
});
