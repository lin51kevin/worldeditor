import { describe, it, expect } from "vitest";
import {
  STABLE_SORT_KEY_BITS,
  depthToSortKey,
  computeSortKeys,
  stableRadixArgsort,
  blockScanExclusive,
  simulateGpuStableSort,
} from "./stableSplatSortReference";

/** Reference back-to-front order: stable sort of indices by ascending key. */
function stableArgsortByKey(keys: Uint32Array): number[] {
  return [...keys.keys()].sort((a, b) => keys[a]! - keys[b]! || a - b);
}

describe("stableSplatSortReference", () => {
  it("maps the farthest depth to the smallest key (drawn first)", () => {
    expect(depthToSortKey(100)).toBeLessThan(depthToSortKey(0));
    expect(depthToSortKey(100)).toBeLessThan(depthToSortKey(50));
    expect(depthToSortKey(1)).toBeLessThan(depthToSortKey(0));
  });

  it("orders splats strictly back-to-front (farthest first)", () => {
    const positions = new Float32Array([1, 0, 0, 5, 0, 0, 3, 0, 0, 2, 0, 0]);
    const keys = computeSortKeys(positions, [0, 0, 0], [1, 0, 0]);
    const order = stableRadixArgsort(keys);
    const depths = [...order].map((i) => positions[i * 3]!);
    expect(depths).toEqual([5, 3, 2, 1]);
  });

  it("matches a stable comparator sort of the keys", () => {
    const keys = new Uint32Array([7, 3, 3, 9, 0, 3, 1, 9, 2, 3]);
    expect([...stableRadixArgsort(keys)]).toEqual(stableArgsortByKey(keys));
  });

  it("breaks ties by original index (stability = no frame-to-frame churn)", () => {
    const keys = new Uint32Array([42, 42, 42, 42]);
    expect([...stableRadixArgsort(keys)]).toEqual([0, 1, 2, 3]);
  });

  it("is a valid permutation for a large random 32-bit key set", () => {
    const n = 5000;
    const keys = new Uint32Array(n);
    let seed = 123456789;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      keys[i] = (seed * 2654435761) >>> 0; // spread across the full 32-bit range
    }
    const order = stableRadixArgsort(keys);
    expect(order.length).toBe(n);
    const seen = new Uint8Array(n);
    for (const idx of order) seen[idx] = 1;
    expect(seen.every((v) => v === 1)).toBe(true);
    expect([...order]).toEqual(stableArgsortByKey(keys));
  });

  it("uses a 32-bit key (8-bit-digit radix, 4 passes)", () => {
    expect(STABLE_SORT_KEY_BITS).toBe(32);
  });

  it("the multi-level block scan equals a plain exclusive prefix sum", () => {
    for (const n of [1, 7, 512, 513, 1000, 262145]) {
      const a = new Uint32Array(n);
      let seed = 987654321;
      for (let i = 0; i < n; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        a[i] = seed % 4;
      }
      const got = blockScanExclusive(a);
      const truth = new Uint32Array(n);
      let sum = 0;
      for (let i = 0; i < n; i++) {
        truth[i] = sum;
        sum += a[i]!;
      }
      let firstMismatch = -1;
      for (let i = 0; i < n; i++) {
        if (got[i] !== truth[i]) {
          firstMismatch = i;
          break;
        }
      }
      expect(firstMismatch, `n=${n}`).toBe(-1);
    }
  });

  it("the full block-scan pipeline simulation matches the reference argsort", () => {
    for (const n of [1, 33, 777, 5000]) {
      const keys = new Uint32Array(n);
      let seed = 424242;
      for (let i = 0; i < n; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        keys[i] = (seed * 2654435761) >>> 0;
      }
      expect([...simulateGpuStableSort(keys)]).toEqual([...stableRadixArgsort(keys)]);
    }
  });
});
