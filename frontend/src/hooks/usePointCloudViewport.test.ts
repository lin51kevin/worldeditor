import { describe, it, expect } from 'vitest';
import { applyOrigin, applySplatOrigin } from './usePointCloudViewport';
import { splatStrideForDegree } from '../viewport/gaussian/splatPipeline';

/** Build a 7-float vertex buffer (x,y,z,r,g,b,a) from position triples. */
function buildBuffer(positions: [number, number, number][]): Float32Array {
  const out = new Float32Array(positions.length * 7);
  positions.forEach(([x, y, z], i) => {
    const d = i * 7;
    out[d] = x;
    out[d + 1] = y;
    out[d + 2] = z;
    out[d + 3] = 0.5; // r
    out[d + 4] = 0.5; // g
    out[d + 5] = 0.5; // b
    out[d + 6] = 1.0; // a
  });
  return out;
}

describe('applyOrigin', () => {
  it('should shift positions into the absolute frame when origin is non-zero', () => {
    const buffer = buildBuffer([
      [0, 0, 0],
      [1, 2, 3],
    ]);

    applyOrigin(buffer, [100, 200, 5]);

    expect([buffer[0], buffer[1], buffer[2]]).toEqual([100, 200, 5]);
    expect([buffer[7], buffer[8], buffer[9]]).toEqual([101, 202, 8]);
  });

  it('should leave color channels untouched when shifting', () => {
    const buffer = buildBuffer([[1, 1, 1]]);

    applyOrigin(buffer, [10, 20, 30]);

    expect([buffer[3], buffer[4], buffer[5], buffer[6]]).toEqual([0.5, 0.5, 0.5, 1.0]);
  });

  it('should be a no-op when origin is a zero vector', () => {
    const buffer = buildBuffer([[7, 8, 9]]);

    applyOrigin(buffer, [0, 0, 0]);

    expect([buffer[0], buffer[1], buffer[2]]).toEqual([7, 8, 9]);
  });

  it('should be a no-op when origin is undefined', () => {
    const buffer = buildBuffer([[7, 8, 9]]);

    applyOrigin(buffer, undefined);

    expect([buffer[0], buffer[1], buffer[2]]).toEqual([7, 8, 9]);
  });
});

/** Build a packed splat buffer (stride = splatStrideForDegree) from positions. */
function buildSplats(positions: [number, number, number][], shDegree = 0): Float32Array {
  const stride = splatStrideForDegree(shDegree);
  const out = new Float32Array(positions.length * stride);
  positions.forEach(([x, y, z], i) => {
    const d = i * stride;
    out[d] = x;
    out[d + 1] = y;
    out[d + 2] = z;
    // Fill a non-position field to assert it is left untouched.
    out[d + 3] = 42;
  });
  return out;
}

describe('applySplatOrigin', () => {
  it('should shift splat positions into the absolute frame (degree 0)', () => {
    const buffer = buildSplats([
      [0, 0, 0],
      [1, 2, 3],
    ]);
    const stride = splatStrideForDegree(0);

    const out = applySplatOrigin(buffer, 0, [100, 200, 5]);

    expect([out[0], out[1], out[2]]).toEqual([100, 200, 5]);
    expect([out[stride], out[stride + 1], out[stride + 2]]).toEqual([101, 202, 8]);
  });

  it('should return a new buffer and leave the input origin-relative', () => {
    const buffer = buildSplats([[1, 1, 1]]);

    const out = applySplatOrigin(buffer, 0, [10, 20, 30]);

    expect(out).not.toBe(buffer);
    expect([buffer[0], buffer[1], buffer[2]]).toEqual([1, 1, 1]);
  });

  it('should not touch covariance/opacity/SH fields', () => {
    const buffer = buildSplats([[1, 1, 1]]);

    const out = applySplatOrigin(buffer, 0, [10, 20, 30]);

    expect(out[3]).toBe(42);
  });

  it('should handle a higher SH degree stride correctly', () => {
    const buffer = buildSplats([[0, 0, 0], [5, 6, 7]], 2);
    const stride = splatStrideForDegree(2);

    const out = applySplatOrigin(buffer, 2, [1, 1, 1]);

    expect([out[0], out[1], out[2]]).toEqual([1, 1, 1]);
    expect([out[stride], out[stride + 1], out[stride + 2]]).toEqual([6, 7, 8]);
  });

  it('should return the same reference when origin is zero', () => {
    const buffer = buildSplats([[1, 2, 3]]);

    const out = applySplatOrigin(buffer, 0, [0, 0, 0]);

    expect(out).toBe(buffer);
  });

  it('should return the same reference when origin is undefined', () => {
    const buffer = buildSplats([[1, 2, 3]]);

    const out = applySplatOrigin(buffer, 0, undefined);

    expect(out).toBe(buffer);
  });
});
