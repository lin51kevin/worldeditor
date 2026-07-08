import { describe, it, expect } from "vitest";
import { computeDepths, sortSplatsByDepth } from "./splatSort";

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

describe("computeDepths", () => {
  it("returns dot(viewDir, p - camPos) per splat", () => {
    const p = positions([0, 0, 0], [0, 0, 5], [0, 0, 10]);
    const depths = computeDepths(p, [0, 0, 0], [0, 0, 1]);
    expect(Array.from(depths)).toEqual([0, 5, 10]);
  });

  it("accounts for camera position", () => {
    const p = positions([0, 0, 10]);
    const depths = computeDepths(p, [0, 0, 4], [0, 0, 1]);
    expect(depths[0]).toBeCloseTo(6, 5);
  });
});

describe("sortSplatsByDepth", () => {
  it("orders splats back-to-front (farthest first)", () => {
    // Three splats at increasing distance along +Z.
    const p = positions([0, 0, 1], [0, 0, 3], [0, 0, 2]);
    const idx = sortSplatsByDepth(p, [0, 0, 0], [0, 0, 1]);
    // Farthest (index 1, z=3) first; nearest (index 0, z=1) last.
    expect(Array.from(idx)).toEqual([1, 2, 0]);
  });

  it("returns a full permutation of indices", () => {
    const p = positions([1, 0, 0], [0, 1, 0], [0, 0, 1], [2, 2, 2], [3, 1, 0]);
    const idx = sortSplatsByDepth(p, [0, 0, 0], [1, 1, 1]);
    expect(idx.length).toBe(5);
    expect(Array.from(idx).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it("handles zero splats", () => {
    const idx = sortSplatsByDepth(new Float32Array(0), [0, 0, 0], [0, 0, 1]);
    expect(idx.length).toBe(0);
  });

  it("handles a single splat", () => {
    const idx = sortSplatsByDepth(positions([5, 5, 5]), [0, 0, 0], [0, 0, 1]);
    expect(Array.from(idx)).toEqual([0]);
  });

  it("is stable when all depths are equal", () => {
    const p = positions([1, 0, 0], [2, 0, 0], [3, 0, 0]);
    // viewDir is +Z, all splats have z=0 → equal depth.
    const idx = sortSplatsByDepth(p, [0, 0, 0], [0, 0, 1]);
    expect(idx.length).toBe(3);
    expect(Array.from(idx).sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it("produces a monotonic non-increasing depth sequence", () => {
    const p = positions(
      [0, 0, 7],
      [0, 0, 1],
      [0, 0, 4],
      [0, 0, 9],
      [0, 0, 2],
    );
    const camPos: [number, number, number] = [0, 0, 0];
    const viewDir: [number, number, number] = [0, 0, 1];
    const idx = sortSplatsByDepth(p, camPos, viewDir);
    const depths = computeDepths(p, camPos, viewDir);
    for (let i = 1; i < idx.length; i++) {
      expect(depths[idx[i - 1]]).toBeGreaterThanOrEqual(depths[idx[i]]);
    }
  });
});
