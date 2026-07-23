import { describe, it, expect } from 'vitest';
import {
  computeDepths,
  sortSplatsByDepth,
  depthBucketCount,
  frustumSidePlanes,
} from './splatSort';

/** Build a flat positions array from `[x,y,z]` tuples. */
function positions(...pts: Array<[number, number, number]>): Float32Array {
  const out = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => {
    out[i * 3] = p[0];
    out[i * 3 + 1] = p[1];
    out[i * 3 + 2] = p[2];
  });
  return out;
}

describe('computeDepths', () => {
  it('returns dot(viewDir, p - camPos) per splat', () => {
    const p = positions([0, 0, 0], [0, 0, 5], [0, 0, 10]);
    const depths = computeDepths(p, [0, 0, 0], [0, 0, 1]);
    expect(Array.from(depths)).toEqual([0, 5, 10]);
  });

  it('accounts for camera position', () => {
    const p = positions([0, 0, 10]);
    const depths = computeDepths(p, [0, 0, 4], [0, 0, 1]);
    expect(depths[0]).toBeCloseTo(6, 5);
  });
});

describe('sortSplatsByDepth', () => {
  it('orders splats back-to-front (farthest first)', () => {
    // Three splats at increasing distance along +Z.
    const p = positions([0, 0, 1], [0, 0, 3], [0, 0, 2]);
    const { indices: idx } = sortSplatsByDepth(p, [0, 0, 0], [0, 0, 1]);
    // Farthest (index 1, z=3) first; nearest (index 0, z=1) last.
    expect(Array.from(idx)).toEqual([1, 2, 0]);
  });

  it('returns a full permutation of indices', () => {
    const p = positions([1, 0, 0], [0, 1, 0], [0, 0, 1], [2, 2, 2], [3, 1, 0]);
    const { indices: idx } = sortSplatsByDepth(p, [0, 0, 0], [1, 1, 1]);
    expect(idx.length).toBe(5);
    expect(Array.from(idx).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('handles zero splats', () => {
    const { indices: idx, visibleCount } = sortSplatsByDepth(
      new Float32Array(0),
      [0, 0, 0],
      [0, 0, 1],
    );
    expect(idx.length).toBe(0);
    expect(visibleCount).toBe(0);
  });

  it('handles a single splat', () => {
    const { indices: idx, visibleCount } = sortSplatsByDepth(
      positions([5, 5, 5]),
      [0, 0, 0],
      [0, 0, 1],
    );
    expect(Array.from(idx)).toEqual([0]);
    expect(visibleCount).toBe(1);
  });

  it('is stable when all depths are equal', () => {
    const p = positions([1, 0, 0], [2, 0, 0], [3, 0, 0]);
    // viewDir is +Z, all splats have z=0 → equal depth.
    const { indices: idx } = sortSplatsByDepth(p, [0, 0, 0], [0, 0, 1]);
    expect(idx.length).toBe(3);
    expect(Array.from(idx).sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it('draws every entry for a degenerate depth range that straddles the camera', () => {
    const p = positions([0, 0, -0.0000001], [0, 0, 0.0000001]);
    const { indices, visibleCount } = sortSplatsByDepth(
      p,
      [0, 0, 0],
      [0, 0, 1],
    );

    expect(Array.from(indices)).toEqual([0, 1]);
    expect(visibleCount).toBe(2);
  });

  it('produces a monotonic non-increasing depth sequence', () => {
    const p = positions([0, 0, 7], [0, 0, 1], [0, 0, 4], [0, 0, 9], [0, 0, 2]);
    const camPos: [number, number, number] = [0, 0, 0];
    const viewDir: [number, number, number] = [0, 0, 1];
    const { indices: idx } = sortSplatsByDepth(p, camPos, viewDir);
    const depths = computeDepths(p, camPos, viewDir);
    for (let i = 1; i < idx.length; i++) {
      expect(depths[idx[i - 1]]).toBeGreaterThanOrEqual(depths[idx[i]]);
    }
  });

  it('orders a large cloud whose bucket count exceeds 16 bits', () => {
    // n large enough that depthBucketCount > 65536 (needs Uint32 bucket
    // indices — a Uint16 store would truncate and scramble the order).
    const n = 500_000;
    expect(depthBucketCount(n)).toBeGreaterThan(65536);
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) p[i * 3 + 2] = i * 0.001; // strictly increasing z
    const { indices: idx } = sortSplatsByDepth(p, [0, 0, 0], [0, 0, 1]);
    expect(idx.length).toBe(n);
    expect(new Set(idx).size).toBe(n); // a full permutation (no truncation)
    // Coarse-block monotonicity: sampling every 1% the depth must be strictly
    // decreasing (blocks are far wider than one bucket, so no ties). A Uint16
    // bucket store would wrap indices >65535 and scramble this ordering.
    const depths = computeDepths(p, [0, 0, 0], [0, 0, 1]);
    const step = Math.floor(n / 100);
    for (let k = step; k < n; k += step) {
      expect(depths[idx[k - step]]).toBeGreaterThan(depths[idx[k]]);
    }
  });

  it('strictly orders dense thin depth layers despite huge outlier ranges', () => {
    const denseCount = 8_192;
    const p = new Float32Array((denseCount + 2) * 3);
    p[2] = -1e9;
    for (let i = 0; i < denseCount; i++) {
      // Scramble a 0.125-wide layer so a uniform global bucket map collapses it.
      const rank = (i * 4051) % denseCount;
      p[(i + 1) * 3 + 2] = 100 + rank / 65_536;
    }
    p[(denseCount + 1) * 3 + 2] = 1e9;

    const camPos: [number, number, number] = [0, 0, 0];
    const viewDir: [number, number, number] = [0, 0, 1];
    const { indices } = sortSplatsByDepth(p, camPos, viewDir);
    const depths = computeDepths(p, camPos, viewDir);

    expect(new Set(indices).size).toBe(denseCount + 2);
    for (let i = 1; i < indices.length; i++) {
      expect(depths[indices[i - 1]]).toBeGreaterThanOrEqual(depths[indices[i]]);
    }
  });

  it('returns only the sorted prefix in front as the camera crosses the cloud', () => {
    const p = positions([0, 0, -2], [0, 0, 0], [0, 0, 2]);
    const before = sortSplatsByDepth(p, [0, 0, -3], [0, 0, 1]);
    const inside = sortSplatsByDepth(p, [0, 0, 1], [0, 0, 1]);
    const after = sortSplatsByDepth(p, [0, 0, 3], [0, 0, 1]);

    expect(before.visibleCount).toBe(3);
    expect(inside.visibleCount).toBe(1);
    expect(Array.from(inside.indices.slice(0, inside.visibleCount))).toEqual([2]);
    expect(after.visibleCount).toBe(0);
  });
});

describe('depthBucketCount', () => {
  it('scales with splat count and clamps to [2^10, 2^20]', () => {
    expect(depthBucketCount(1)).toBe(2 ** 10); // tiny → floor
    expect(depthBucketCount(100)).toBe(2 ** 10); // still floor
    expect(depthBucketCount(12_436_553)).toBe(2 ** 20); // huge → ceiling
    // Mid-range is a power of two within the clamp window.
    const mid = depthBucketCount(1_000_000);
    expect(mid).toBeGreaterThanOrEqual(2 ** 10);
    expect(mid).toBeLessThanOrEqual(2 ** 20);
    expect(Math.log2(mid) % 1).toBe(0);
  });
});

describe('frustumSidePlanes', () => {
  // Identity view-projection → the side frustum is the NDC box x,y ∈ [-1, 1].
  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const dist = (planes: Float32Array, p: number, x: number, y: number, z: number): number =>
    planes[p * 4]! * x + planes[p * 4 + 1]! * y + planes[p * 4 + 2]! * z + planes[p * 4 + 3]!;

  it('derives four inward-facing side planes', () => {
    const planes = frustumSidePlanes(identity);
    expect(planes.length).toBe(16);
    // The center is inside every plane (distance >= 0).
    for (let p = 0; p < 4; p++) expect(dist(planes, p, 0, 0, 0)).toBeGreaterThanOrEqual(0);
    // A point far to +x lies outside at least one plane.
    const outside = [0, 1, 2, 3].some((p) => dist(planes, p, 5, 0, 0) < 0);
    expect(outside).toBe(true);
  });
});

describe('sortSplatsByDepth frustum culling', () => {
  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const planes = frustumSidePlanes(identity);
  const cam: [number, number, number] = [0, 0, -10];
  const dir: [number, number, number] = [0, 0, 1];

  it('excludes front-facing splats whose chunk is fully outside the frustum', () => {
    const p = positions([100, 0, 0], [100, 0, 5], [100, 0, 10]);
    // Without a frustum every front-facing splat is drawable.
    expect(sortSplatsByDepth(p, cam, dir).visibleCount).toBe(3);
    // With the frustum the whole (off-screen) chunk is culled.
    expect(sortSplatsByDepth(p, cam, dir, undefined, planes).visibleCount).toBe(0);
  });

  it('keeps splats inside the frustum', () => {
    const p = positions([0, 0, 0], [0.2, 0, 5], [-0.3, 0, 10]);
    const result = sortSplatsByDepth(p, cam, dir, undefined, planes);
    expect(result.visibleCount).toBe(3);
    // The drawn prefix is still strictly back-to-front (farthest first).
    expect(result.indices[0]).toBe(2);
  });
});
