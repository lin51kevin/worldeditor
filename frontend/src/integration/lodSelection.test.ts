import { describe, expect, it } from 'vitest';
import {
  SlotAllocator,
  boxDistance,
  collectLeaves,
  leavesBounds,
  resolveLod,
  selectLods,
  unitKey,
  unitTable,
  type LodLeaf,
} from './lodSelection';
import type { LodMeta, LodNode } from './sogLoader';

/** Four unit cubes along x. LOD0: one 1000-splat file each; LOD1: one file per pair; LOD2: one file. */
function sceneMeta(): LodMeta {
  const leaf = (i: number): LodNode => ({
    bound: { min: [i, 0, 0], max: [i + 1, 1, 1] },
    lods: {
      '0': { file: i, offset: 0, count: 1000 },
      '1': { file: i < 2 ? 4 : 5, offset: (i % 2) * 500, count: 500 },
      '2': { file: 6, offset: i * 250, count: 250 },
    },
  });
  return {
    lodLevels: 3,
    filenames: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    tree: {
      bound: { min: [0, 0, 0], max: [4, 1, 1] },
      children: [
        { bound: { min: [0, 0, 0], max: [2, 1, 1] }, children: [leaf(0), leaf(1)] },
        { bound: { min: [2, 0, 0], max: [4, 1, 1] }, children: [leaf(2), leaf(3)] },
      ],
    },
  };
}

const leaves = collectLeaves(sceneMeta());
const table = unitTable(leaves);

describe('collectLeaves / unitTable', () => {
  it('should list the leaves in tree order with their per-LOD runs', () => {
    expect(leaves).toHaveLength(4);
    expect(leaves.map((l) => l.min[0])).toEqual([0, 1, 2, 3]);
    expect(leaves[2]!.lods.get(1)).toEqual({ file: 5, offset: 0, count: 500 });
  });

  it('should total each file over every leaf that references it', () => {
    expect(table.get(unitKey(0, 3))!.count).toBe(1000);
    expect(table.get(unitKey(1, 4))!.count).toBe(1000);
    expect(table.get(unitKey(2, 6))!.count).toBe(1000);
    expect(table.size).toBe(7);
  });

  it('should skip empty runs and levels that are not integers', () => {
    const meta = sceneMeta();
    (meta.tree.children![0]!.children![0] as LodNode).lods = {
      '0': { file: 0, offset: 0, count: 0 },
      x: { file: 1, offset: 0, count: 5 },
    };
    expect(collectLeaves(meta)).toHaveLength(3);
  });

  it('should span the whole scene', () => {
    expect(leavesBounds(leaves)).toEqual({ min: [0, 0, 0], max: [4, 1, 1] });
  });
});

describe('geometry helpers', () => {
  it('should measure distance to a box and be zero inside it', () => {
    expect(boxDistance([0.5, 0.5, 0.5], [0, 0, 0], [1, 1, 1])).toBe(0);
    expect(boxDistance([4, 0.5, 0.5], [0, 0, 0], [1, 1, 1])).toBe(3);
    expect(boxDistance([2, 2, 0.5], [0, 0, 0], [1, 1, 1])).toBeCloseTo(Math.SQRT2, 6);
  });

  it('should resolve to the finest available level at or past the wanted one', () => {
    const sparse = { min: [0, 0, 0], max: [1, 1, 1], lods: new Map([[0, { file: 0, offset: 0, count: 1 }], [2, { file: 1, offset: 0, count: 1 }]]) } as LodLeaf;
    expect(resolveLod(sparse, 0)).toBe(0);
    expect(resolveLod(sparse, 1)).toBe(2);
    expect(resolveLod(sparse, 3)).toBe(2);
  });
});

describe('selectLods', () => {
  const generous = { baseDistance: 1, budget: 1_000_000, mode: 'limit' as const };

  it('should use finer levels near the camera and coarser ones far away', () => {
    const selection = selectLods(leaves, table, [0.5, 0.5, 0.5], generous);

    expect(selection.lods).toEqual([0, 0, 0, 1]);
    expect(selection.bias).toBe(0);
    expect([...selection.units.keys()].sort()).toEqual(['0:0', '0:1', '0:2', '1:5']);
    // Three 1000-splat LOD 0 files plus file 5 (1000 splats, two leaves).
    expect(selection.splats).toBe(4000);
  });

  it('should keep LOD 0 everywhere in target mode while the budget allows', () => {
    const selection = selectLods(leaves, table, [0.5, 0.5, 0.5], { ...generous, mode: 'target' });

    expect(selection.lods).toEqual([0, 0, 0, 0]);
    expect(selection.splats).toBe(4000);
  });

  it('should coarsen until the selection fits a smaller budget', () => {
    const selection = selectLods(leaves, table, [0.5, 0.5, 0.5], { baseDistance: 1, budget: 2500, mode: 'target' });

    expect(selection.splats).toBeLessThanOrEqual(2500);
    // Detail goes where the camera is: the nearest leaf keeps the finest level it can afford.
    expect(selection.lods[0]).toBeLessThanOrEqual(selection.lods[3]!);
    expect(selection.bias).toBeGreaterThan(-11);
  });

  it('should raise the bias in limit mode only when the default would overflow', () => {
    const roomy = selectLods(leaves, table, [0.5, 0.5, 0.5], { baseDistance: 1, budget: 4000, mode: 'limit' });
    const tight = selectLods(leaves, table, [0.5, 0.5, 0.5], { baseDistance: 1, budget: 2000, mode: 'limit' });

    expect(roomy.bias).toBe(0);
    expect(tight.bias).toBeGreaterThan(0);
    expect(tight.splats).toBeLessThanOrEqual(2000);
  });

  it('should return the coarsest selection when even that exceeds the budget', () => {
    const selection = selectLods(leaves, table, [0.5, 0.5, 0.5], { baseDistance: 1, budget: 10, mode: 'limit' });

    expect(selection.lods).toEqual([2, 2, 2, 2]);
  });

  it('should not rank a huge leaf that swallows the camera finer than a small leaf next to it', () => {
    const run = (file: number) => ({ file, offset: 0, count: 100 });
    const big: LodLeaf = { min: [-1000, -1000, -1000], max: [1000, 1000, 1000], lods: new Map([[0, run(0)], [1, run(1)], [2, run(2)]]) };
    const small: LodLeaf = { min: [1, 0, 0], max: [2, 1, 1], lods: new Map([[0, run(3)], [1, run(4)], [2, run(5)]]) };
    const pair = [big, small];
    const selection = selectLods(pair, unitTable(pair), [0.5, 0.5, 0.5], { baseDistance: 1, budget: 1_000_000, mode: 'limit' });

    expect(selection.lods[1]).toBe(0);
    expect(selection.lods[0]).toBe(2);
  });

  it('should change level with the camera', () => {
    const near0 = selectLods(leaves, table, [0.5, 0.5, 0.5], generous);
    const near3 = selectLods(leaves, table, [3.5, 0.5, 0.5], generous);

    expect(near0.lods[0]).toBe(0);
    expect(near3.lods[3]).toBe(0);
    expect(near3.lods[0]).toBeGreaterThan(near0.lods[0]!);
  });

  it('should not flip a leaf back and forth right at a level boundary', () => {
    // Leaf 3 sits 2.0 from x=1.0: exactly on the LOD 0/1 boundary. A hair closer would drop it to LOD 0.
    const before = selectLods(leaves, table, [1.0, 0.5, 0.5], generous);
    const across = selectLods(leaves, table, [1.05, 0.5, 0.5], generous, before.lods);
    const fresh = selectLods(leaves, table, [1.05, 0.5, 0.5], generous);

    expect(before.lods[3]).toBe(1);
    expect(fresh.lods[3]).toBe(0);
    expect(across.lods).toEqual(before.lods);
  });

  it('should treat a missing LOD as the closest available one', () => {
    const meta = sceneMeta();
    delete (meta.tree.children![1]!.children![1] as LodNode).lods!['1'];
    const sparse = collectLeaves(meta);

    const selection = selectLods(sparse, unitTable(sparse), [0.5, 0.5, 0.5], generous);

    expect(selection.lods[3]).toBe(2);
  });

  it('should handle an empty scene', () => {
    const selection = selectLods([], new Map(), [0, 0, 0], generous);

    expect(selection).toMatchObject({ lods: [], splats: 0 });
  });
});

describe('SlotAllocator', () => {
  it('should hand out one run when it fits and track the free space', () => {
    const slots = new SlotAllocator(100);

    expect(slots.alloc(30)).toEqual([{ first: 0, count: 30 }]);
    expect(slots.alloc(50)).toEqual([{ first: 30, count: 50 }]);
    expect(slots.freeCount).toBe(20);
  });

  it('should refuse a request larger than the free space without changing anything', () => {
    const slots = new SlotAllocator(10);
    slots.alloc(6);

    expect(slots.alloc(5)).toBeNull();
    expect(slots.freeCount).toBe(4);
  });

  it('should serve a request from several runs when none is big enough alone', () => {
    const slots = new SlotAllocator(100);
    const a = slots.alloc(30)!;
    const b = slots.alloc(30)!;
    slots.alloc(30);
    slots.release(a);
    slots.release(b);
    // Free: [0,60) merged and [90,100); a 65-slot request needs both.
    const pieces = slots.alloc(65)!;

    expect(pieces.reduce((sum, p) => sum + p.count, 0)).toBe(65);
    expect(pieces.length).toBe(2);
    expect(slots.freeCount).toBe(5);
  });

  it('should merge released neighbours back into one run', () => {
    const slots = new SlotAllocator(100);
    const a = slots.alloc(40)!;
    const b = slots.alloc(40)!;
    slots.release(b);
    slots.release(a);

    expect(slots.alloc(100)).toEqual([{ first: 0, count: 100 }]);
  });

  it('should prefer the smallest free run that fits', () => {
    const slots = new SlotAllocator(100);
    const a = slots.alloc(10)!;
    slots.alloc(10);
    const c = slots.alloc(30)!;
    slots.alloc(10);
    slots.release(a);
    slots.release(c);
    // Free runs: [0,10) of 10 and [20,50) of 30 and [60,100) of 40; a 10-slot request takes the first.
    expect(slots.alloc(10)).toEqual([{ first: 0, count: 10 }]);
  });

  it('should allocate nothing for an empty request', () => {
    expect(new SlotAllocator(5).alloc(0)).toEqual([]);
  });
});
