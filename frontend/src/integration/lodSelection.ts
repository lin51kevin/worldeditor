/**
 * Pure LOD selection for Streamed SOG scenes: which (LOD, file) units a camera
 * wants resident under a splat budget, and the slot allocator that places them
 * in the renderer's fixed-capacity store. No rendering or network code here.
 *
 * A Streamed SOG file holds one LOD of one or more tree leaves and is decoded
 * whole, so the unit of residency is the file; the budget is counted in units.
 */
import type { LodMeta, LodNode } from './sogLoader';

type Vec3 = readonly [number, number, number];

/** One tree leaf: its bounds and, per LOD level, where its splats live. */
export interface LodLeaf {
  min: Vec3;
  max: Vec3;
  lods: ReadonlyMap<number, { file: number; offset: number; count: number }>;
}

/** A (LOD, file) pair: the smallest thing that can be made resident. */
export interface LodUnit {
  key: string;
  lod: number;
  file: number;
  /** Splats in the whole file. */
  count: number;
}

export type LodBudgetMode = 'target' | 'limit';

export interface LodSelectOptions {
  /** Distance (render units) up to which a leaf uses LOD 0; each doubling beyond adds a level. */
  baseDistance: number;
  /** Splats the selection may hold. */
  budget: number;
  /** `target` spends the whole budget on detail; `limit` only coarsens when it would be exceeded. */
  mode: LodBudgetMode;
  /** Levels of slack before a leaf switches LOD again (default 0.25) to avoid flicker. */
  hysteresis?: number;
}

export interface LodSelection {
  /** Chosen LOD per leaf (index-aligned with the leaves). */
  lods: number[];
  /** Units the selection needs. */
  units: Map<string, LodUnit>;
  /** Splats in `units`. */
  splats: number;
  /** Detail bias the budget forced (0 = none; positive = coarser). */
  bias: number;
}

export const unitKey = (lod: number, file: number): string => `${lod}:${file}`;

/** Leaves of the spatial tree in tree order. */
export function collectLeaves(meta: LodMeta): LodLeaf[] {
  const leaves: LodLeaf[] = [];
  const visit = (node: LodNode): void => {
    if (node.children && node.children.length > 0) {
      node.children.forEach(visit);
      return;
    }
    if (!node.lods) return;
    const lods = new Map<number, { file: number; offset: number; count: number }>();
    for (const [level, run] of Object.entries(node.lods)) {
      const lod = Number(level);
      if (Number.isInteger(lod) && lod >= 0 && run.count > 0) lods.set(lod, run);
    }
    if (lods.size > 0) leaves.push({ min: node.bound.min, max: node.bound.max, lods });
  };
  visit(meta.tree);
  return leaves;
}

/** Every unit the scene has, with its whole-file splat count. */
export function unitTable(leaves: readonly LodLeaf[]): Map<string, LodUnit> {
  const units = new Map<string, LodUnit>();
  for (const leaf of leaves) {
    for (const [lod, run] of leaf.lods) {
      const key = unitKey(lod, run.file);
      const unit = units.get(key);
      if (unit) unit.count += run.count;
      else units.set(key, { key, lod, file: run.file, count: run.count });
    }
  }
  return units;
}

/** Union of all leaf bounds. */
export function leavesBounds(leaves: readonly LodLeaf[]): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const leaf of leaves) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, leaf.min[a]!);
      max[a] = Math.max(max[a]!, leaf.max[a]!);
    }
  }
  return { min, max };
}

/** Distance from `p` to the box, 0 inside. */
export function boxDistance(p: Vec3, min: Vec3, max: Vec3): number {
  let sq = 0;
  for (let a = 0; a < 3; a++) {
    const d = Math.max(min[a]! - p[a]!, 0, p[a]! - max[a]!);
    sq += d * d;
  }
  return Math.sqrt(sq);
}

/** The leaf's LOD closest to `wanted`: the finest at or past it, else the coarsest it has. */
export function resolveLod(leaf: LodLeaf, wanted: number): number {
  let atOrAfter = Infinity;
  let coarsest = -1;
  for (const lod of leaf.lods.keys()) {
    if (lod >= wanted && lod < atOrAfter) atOrAfter = lod;
    if (lod > coarsest) coarsest = lod;
  }
  return Number.isFinite(atOrAfter) ? atOrAfter : coarsest;
}

const BIAS_SEARCH_STEPS = 24;
const BIAS_CEILING = 64;

/**
 * Choose a LOD for every leaf from the camera `position`, within the budget.
 * A leaf's LOD is `floor(log2(distance / baseDistance) + bias)`; the smallest
 * `bias` whose units fit the budget is found by bisection (splats are monotone
 * in it). `previous` (last call's `lods`) adds hysteresis.
 */
export function selectLods(
  leaves: readonly LodLeaf[],
  table: ReadonlyMap<string, LodUnit>,
  position: Vec3,
  options: LodSelectOptions,
  previous?: readonly number[],
): LodSelection {
  const base = Math.max(options.baseDistance, 1e-6);
  const hysteresis = options.hysteresis ?? 0.25;
  let maxLod = 0;
  for (const leaf of leaves) for (const lod of leaf.lods.keys()) maxLod = Math.max(maxLod, lod);
  // Rank by distance to the leaf, floored at a quarter of its own diagonal: nearer than that a leaf's
  // splats are as coarse as the leaf is big, so a sparse region whose box swallows the camera does not
  // outrank a small dense one. No clamp at baseDistance, so near leaves still order by distance.
  const level = leaves.map((leaf) => {
    const diag = Math.hypot(leaf.max[0] - leaf.min[0], leaf.max[1] - leaf.min[1], leaf.max[2] - leaf.min[2]);
    return Math.log2(Math.max(boxDistance(position, leaf.min, leaf.max), diag * 0.25, base * 1e-3) / base);
  });

  const evaluate = (bias: number): LodSelection => {
    const lods = new Array<number>(leaves.length);
    const units = new Map<string, LodUnit>();
    let splats = 0;
    for (let i = 0; i < leaves.length; i++) {
      const f = level[i]! + bias;
      let wanted = Math.min(maxLod, Math.max(0, Math.floor(f)));
      const last = previous?.[i];
      if (last !== undefined && last >= 0 && last !== wanted) {
        if (wanted > last && f < last + 1 + hysteresis) wanted = last;
        else if (wanted < last && f > last - hysteresis) wanted = last;
      }
      const lod = resolveLod(leaves[i]!, wanted);
      lods[i] = lod;
      const key = unitKey(lod, leaves[i]!.lods.get(lod)!.file);
      if (!units.has(key)) {
        const unit = table.get(key)!;
        units.set(key, unit);
        splats += unit.count;
      }
    }
    return { lods, units, splats, bias };
  };

  const fits = (s: LodSelection) => s.splats <= options.budget;
  const start = options.mode === 'limit' ? 0 : -(maxLod + 8);
  const first = evaluate(start);
  if (fits(first)) return first;

  let lo = start;
  let hi = BIAS_CEILING;
  let best = evaluate(hi);
  if (!fits(best)) return best;
  for (let step = 0; step < BIAS_SEARCH_STEPS; step++) {
    const mid = (lo + hi) / 2;
    const candidate = evaluate(mid);
    if (fits(candidate)) {
      hi = mid;
      best = candidate;
    } else {
      lo = mid;
    }
  }
  return best;
}

/** A run of consecutive slots. */
export interface SlotRange {
  first: number;
  count: number;
}

/**
 * First-fit allocator over `capacity` splat slots. A request is served from one
 * free run when any fits and otherwise from several, so fragmentation never
 * fails an allocation that the total free space could satisfy.
 */
export class SlotAllocator {
  private free: SlotRange[];

  constructor(readonly capacity: number) {
    this.free = capacity > 0 ? [{ first: 0, count: capacity }] : [];
  }

  /** Slots not currently allocated. */
  get freeCount(): number {
    return this.free.reduce((sum, r) => sum + r.count, 0);
  }

  /** Allocate `count` slots, or `null` (and change nothing) when they do not fit. */
  alloc(count: number): SlotRange[] | null {
    if (count <= 0) return [];
    if (count > this.freeCount) return null;
    let bestIndex = -1;
    for (let i = 0; i < this.free.length; i++) {
      const run = this.free[i]!;
      if (run.count >= count && (bestIndex < 0 || run.count < this.free[bestIndex]!.count)) bestIndex = i;
    }
    if (bestIndex >= 0) return [this.take(bestIndex, count)];
    const pieces: SlotRange[] = [];
    let left = count;
    while (left > 0) {
      let largest = 0;
      for (let i = 1; i < this.free.length; i++) {
        if (this.free[i]!.count > this.free[largest]!.count) largest = i;
      }
      const piece = this.take(largest, Math.min(left, this.free[largest]!.count));
      pieces.push(piece);
      left -= piece.count;
    }
    return pieces.sort((a, b) => a.first - b.first);
  }

  /** Return `ranges` to the pool, merging neighbours. */
  release(ranges: readonly SlotRange[]): void {
    for (const range of ranges) {
      if (range.count > 0) this.free.push({ ...range });
    }
    this.free.sort((a, b) => a.first - b.first);
    const merged: SlotRange[] = [];
    for (const run of this.free) {
      const last = merged[merged.length - 1];
      if (last && last.first + last.count >= run.first) {
        last.count = Math.max(last.count, run.first + run.count - last.first);
      } else {
        merged.push({ ...run });
      }
    }
    this.free = merged;
  }

  private take(index: number, count: number): SlotRange {
    const run = this.free[index]!;
    const taken = { first: run.first, count };
    if (count === run.count) this.free.splice(index, 1);
    else this.free[index] = { first: run.first + count, count: run.count - count };
    return taken;
  }
}
