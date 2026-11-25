/**
 * Region/LOD streaming of a Streamed SOG scene into the renderer's resident
 * store. The camera decides, per tree leaf, which LOD it wants
 * ({@link selectLods}); the units (LOD files) that choice needs are downloaded,
 * decoded off-thread and written into free slots, and units the camera no longer
 * needs are released once their replacements are resident. GPU memory therefore
 * follows the view instead of the whole scene.
 */
import type { PreparedSplatChunk } from '../viewport/gaussian/splatPrepare';
import { prepareSplatSlices, slicePreparedChunk } from '../viewport/gaussian/splatPrepare';
import {
  SlotAllocator,
  boxDistance,
  collectLeaves,
  leavesBounds,
  selectLods,
  unitTable,
  type LodBudgetMode,
  type LodLeaf,
  type LodSelection,
  type LodUnit,
  type SlotRange,
} from './lodSelection';
import type { SplatUploadStatus } from '../viewport/gaussian/splatRenderer';
import { decodeSogDataset, type DecodedSog, type LodMeta, type SogChunkDecoder, type SogWasm } from './sogLoader';

/** The renderer methods the streamer drives (see `ViewportRenderer`). */
export interface ResidentSplatTarget {
  beginGaussianResidentStore(
    capacity: number,
    shDegree: number,
    layoutVersion: number,
    bounds: { min: readonly [number, number, number]; max: readonly [number, number, number] },
    splatModel?: string,
  ): SplatUploadStatus;
  gaussianResidentCapacityLimit(shDegree: number): number;
  writeGaussianResident(prepared: PreparedSplatChunk, first: number): void;
  releaseGaussianResident(first: number, count: number): void;
  setGaussianResidentCount(count: number): void;
  /** Camera position in the render frame, then world units per pixel per meter of depth. */
  getCameraPose(): [number, number, number, number];
  abortGaussianSplatUpload(): void;
  render(): void;
}

/** Tuning for {@link LodStreamer}. */
export interface LodStreamingOptions {
  /** Most splats kept resident (default 8,000,000). */
  budget?: number;
  /** `limit` (default) coarsens only when the budget would be exceeded; `target` spends all of it on detail. */
  mode?: LodBudgetMode;
  /** Distance up to which a leaf uses LOD 0; each doubling adds a level (default: scene diagonal / 24). */
  baseDistance?: number;
  /** Units downloaded and decoded at once (default 3). */
  maxConcurrentLoads?: number;
  /** How long an unneeded unit stays resident before its slots are released (default 4000 ms). */
  evictAfterMs?: number;
  /** How often the camera is sampled (default 250 ms). */
  updateIntervalMs?: number;
}

/** Counters of a running stream. */
export interface LodStreamStats {
  budget: number;
  capacity: number;
  residentSplats: number;
  residentUnits: number;
  loadingUnits: number;
  wantedUnits: number;
  failedUnits: number;
  /** Detail bias the budget forced on the latest plan (0 = none). */
  bias: number;
}

/** Control of a running LOD stream. */
export interface LodStreamHandle {
  setBudget(budget: number): void;
  stats(): LodStreamStats;
  /** Resolves once nothing is queued or loading for the current camera. */
  whenIdle(): Promise<void>;
  /** Stops streaming; what is resident stays on screen. */
  dispose(): void;
}

/** What {@link LodStreamer.start} reports once the first view is resident. */
export interface LodStartResult {
  shDegree: number;
  layoutVersion: number;
  origin: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  residentSplats: number;
  capacity: number;
  uploadStatus: SplatUploadStatus;
  handle: LodStreamHandle;
}

export interface LodStreamerDeps {
  wasm: SogWasm;
  target: ResidentSplatTarget;
  lodMetaUrl: string;
  meta: LodMeta;
  /** Frame the splats are decoded into: file positions minus this. */
  origin: readonly [number, number, number];
  options?: LodStreamingOptions;
  /** Off-thread decoder; absent decodes with `wasm` on the calling thread. */
  decoder?: SogChunkDecoder;
  signal?: AbortSignal;
  /** Injectable for tests. */
  now?: () => number;
}

type UnitState =
  | { status: 'loading' }
  | { status: 'resident'; ranges: SlotRange[]; count: number; lastWanted: number }
  | { status: 'failed'; at: number };

const DEFAULT_BUDGET = 8_000_000;
/** Spare slots over the budget so replacements can load before what they replace is released. */
const CAPACITY_HEADROOM = 1.25;
const RENDER_INTERVAL_MS = 250;
const RETRY_AFTER_MS = 5000;
const MOVE_FRACTION = 0.05;

/** Thrown by {@link LodStreamer.start} when the renderer cannot hold the store. */
export class LodStoreFailure extends Error {
  constructor(readonly status: Readonly<SplatUploadStatus>) {
    super(`LOD store could not be allocated: ${status.fallbackReason ?? 'unknown'}`);
    this.name = 'LodStoreFailure';
  }
}

export class LodStreamer {
  private readonly leaves: LodLeaf[];
  private readonly table: Map<string, LodUnit>;
  private readonly urls: string[];
  private readonly origin: [number, number, number];
  private readonly now: () => number;
  private readonly units = new Map<string, UnitState>();
  private readonly idleWaiters: Array<() => void> = [];
  private readonly baseDistance: number;
  private readonly maxConcurrent: number;
  private readonly evictAfterMs: number;
  private readonly updateIntervalMs: number;
  private readonly mode: LodBudgetMode;

  private budget: number;
  private allocator: SlotAllocator | null = null;
  private plan: LodSelection | null = null;
  private lastPlanPosition: [number, number, number] | null = null;
  private queue: LodUnit[] = [];
  private active = 0;
  private residentSplats = 0;
  private dirty = true;
  private disposed = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRenderMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: LodStreamerDeps) {
    const options = deps.options ?? {};
    this.leaves = collectLeaves(deps.meta);
    this.table = unitTable(this.leaves);
    this.origin = [deps.origin[0], deps.origin[1], deps.origin[2]];
    // Leaf bounds are in file coordinates; the renderer works in the decoded frame.
    for (const leaf of this.leaves) {
      leaf.min = shifted(leaf.min, this.origin);
      leaf.max = shifted(leaf.max, this.origin);
    }
    this.urls = deps.meta.filenames.map((name) => new URL(name, deps.lodMetaUrl).href);
    this.now = deps.now ?? (() => performance.now());
    this.budget = Math.max(1, Math.floor(options.budget ?? DEFAULT_BUDGET));
    this.mode = options.mode ?? 'limit';
    this.maxConcurrent = Math.max(1, Math.floor(options.maxConcurrentLoads ?? 3));
    this.evictAfterMs = options.evictAfterMs ?? 4000;
    this.updateIntervalMs = options.updateIntervalMs ?? 250;
    const { min, max } = leavesBounds(this.leaves);
    const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    this.baseDistance = Math.max(options.baseDistance ?? diagonal / 24, 1e-3);
  }

  /**
   * Plan the first view, decode its nearest unit to learn the splat format,
   * allocate the store and bring the whole first view resident, then keep
   * following the camera.
   */
  async start(): Promise<LodStartResult> {
    if (this.leaves.length === 0) throw new Error('lod-meta.json has no leaves with splats');
    this.replan(true);
    const first = this.queue.shift();
    if (!first) throw new Error('LOD plan selected nothing to load');
    const decoded = await this.decode(first);
    const { meta } = decoded;
    const status = this.openStore(decoded);
    // The store may have shrunk the budget the first plan was made for.
    this.dirty = true;
    this.insert(first, decoded);

    this.pump();
    await this.whenIdle();
    this.timer = setInterval(() => this.tick(), this.updateIntervalMs);
    const bounds = leavesBounds(this.leaves);
    return {
      shDegree: meta.shDegree,
      layoutVersion: meta.layoutVersion,
      origin: this.origin,
      min: bounds.min,
      max: bounds.max,
      residentSplats: this.residentSplats,
      capacity: this.allocator!.capacity,
      uploadStatus: status,
      handle: this.handle(),
    };
  }

  private handle(): LodStreamHandle {
    return {
      setBudget: (budget) => this.setBudget(budget),
      stats: () => this.stats(),
      whenIdle: () => this.whenIdle(),
      dispose: () => this.dispose(),
    };
  }

  /** Change the resident budget; takes effect at the next camera sample. */
  setBudget(budget: number): void {
    const next = Math.max(1, Math.floor(budget));
    if (next === this.budget) return;
    this.budget = this.allocator
      ? Math.min(next, Math.floor(this.allocator.capacity / CAPACITY_HEADROOM))
      : next;
    this.dirty = true;
  }

  stats(): LodStreamStats {
    let residentUnits = 0;
    let failedUnits = 0;
    for (const state of this.units.values()) {
      if (state.status === 'resident') residentUnits++;
      else if (state.status === 'failed') failedUnits++;
    }
    return {
      budget: this.budget,
      capacity: this.allocator?.capacity ?? 0,
      residentSplats: this.residentSplats,
      residentUnits,
      loadingUnits: this.active,
      wantedUnits: this.plan?.units.size ?? 0,
      failedUnits,
      bias: this.plan?.bias ?? 0,
    };
  }

  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.timer = null;
    this.renderTimer = null;
    this.queue = [];
    this.flushIdle();
  }

  // ── Planning ────────────────────────────────────────────────────────────────

  private tick(): void {
    if (this.disposed) return;
    const now = this.now();
    for (const state of this.units.values()) {
      if (state.status === 'failed' && now - state.at > RETRY_AFTER_MS) this.dirty = true;
    }
    this.replan(false);
    this.evictExpired();
    this.pump();
  }

  /** Recompute the wanted units for the camera; queue the ones not resident yet. */
  private replan(force: boolean): void {
    const pose = this.deps.target.getCameraPose();
    const position: [number, number, number] = [pose[0], pose[1], pose[2]];
    const last = this.lastPlanPosition;
    const moved =
      !last ||
      Math.hypot(position[0] - last[0], position[1] - last[1], position[2] - last[2]) >
        this.baseDistance * MOVE_FRACTION;
    if (!force && !moved && !this.dirty) return;
    this.dirty = false;
    this.lastPlanPosition = position;
    this.plan = selectLods(
      this.leaves,
      this.table,
      position,
      { baseDistance: this.baseDistance, budget: this.budget, mode: this.mode },
      this.plan?.lods,
    );
    const now = this.now();
    const wanted: Array<{ unit: LodUnit; distance: number }> = [];
    for (const unit of this.plan.units.values()) {
      const state = this.units.get(unit.key);
      if (state?.status === 'resident') {
        state.lastWanted = now;
      } else if (!state || (state.status === 'failed' && now - state.at > RETRY_AFTER_MS)) {
        wanted.push({ unit, distance: this.unitDistance(unit, position) });
      }
    }
    wanted.sort((a, b) => a.distance - b.distance);
    this.queue = wanted.map((w) => w.unit);
  }

  /** Distance from the camera to the nearest leaf that uses `unit`. */
  private unitDistance(unit: LodUnit, position: readonly [number, number, number]): number {
    let nearest = Infinity;
    for (const leaf of this.leaves) {
      const run = leaf.lods.get(unit.lod);
      if (run?.file === unit.file) nearest = Math.min(nearest, boxDistance(position, leaf.min, leaf.max));
    }
    return nearest;
  }

  // ── Loading ─────────────────────────────────────────────────────────────────

  private pump(): void {
    while (!this.disposed && this.active < this.maxConcurrent && this.queue.length > 0) {
      const unit = this.queue.shift()!;
      this.units.set(unit.key, { status: 'loading' });
      this.active++;
      void this.load(unit);
    }
    this.checkIdle();
  }

  private async load(unit: LodUnit): Promise<void> {
    try {
      const decoded = await this.decode(unit);
      if (this.disposed) return;
      this.insert(unit, decoded);
    } catch (error) {
      if (!this.disposed) {
        console.warn(`[LOD] Unit ${unit.key} failed to load`, error);
        this.units.set(unit.key, { status: 'failed', at: this.now() });
      }
    } finally {
      this.active--;
      this.pump();
    }
  }

  private decode(unit: LodUnit): Promise<DecodedSog> {
    const url = this.urls[unit.file]!;
    if (this.deps.decoder) return this.deps.decoder(url, this.origin);
    return decodeSogDataset(this.deps.wasm, url, { signal: this.deps.signal, origin: this.origin });
  }

  /** Allocate the store from the first decoded unit's format. */
  private openStore(decoded: DecodedSog): SplatUploadStatus {
    const { meta } = decoded;
    const limit = this.deps.target.gaussianResidentCapacityLimit(meta.shDegree);
    let largest = 0;
    for (const unit of this.table.values()) largest = Math.max(largest, unit.count);
    const wanted = Math.max(Math.ceil(this.budget * CAPACITY_HEADROOM), largest * 2);
    const capacity = Math.min(limit, wanted);
    if (capacity < decoded.meta.count) {
      throw new LodStoreFailure({
        outcome: 'failed',
        sourceCount: 0,
        uploadedCount: 0,
        requestedShDegree: meta.shDegree,
        effectiveShDegree: meta.shDegree,
        renderMode: 'full',
        resourceMode: 'none',
        fallbackReason: limit <= 0 ? 'gpu-sort-unavailable' : 'texture-array-capacity-exceeded',
      });
    }
    const bounds = leavesBounds(this.leaves);
    const status = this.deps.target.beginGaussianResidentStore(
      capacity,
      meta.shDegree,
      meta.layoutVersion,
      bounds,
      meta.splatModel,
    );
    if (status.outcome === 'failed') throw new LodStoreFailure(status);
    this.allocator = new SlotAllocator(capacity);
    this.budget = Math.min(this.budget, Math.floor(capacity / CAPACITY_HEADROOM));
    return status;
  }

  /** Place a decoded unit in free slots, releasing unneeded units to make room. */
  private insert(unit: LodUnit, decoded: DecodedSog): void {
    const count = decoded.meta.count;
    const ranges = this.allocate(count);
    if (!ranges) {
      console.warn(`[LOD] No room for unit ${unit.key} (${count.toLocaleString()} splats); will retry`);
      this.units.set(unit.key, { status: 'failed', at: this.now() });
      return;
    }
    const slices = decoded.prepared ?? prepareSplatSlices(decoded.buffer, decoded.meta.shDegree);
    this.writeRanges(slices, ranges);
    this.units.set(unit.key, { status: 'resident', ranges, count, lastWanted: this.now() });
    this.residentSplats += count;
    this.deps.target.setGaussianResidentCount(this.residentSplats);
    this.requestRender();
  }

  private allocate(count: number): SlotRange[] | null {
    const allocator = this.allocator!;
    let ranges = allocator.alloc(count);
    if (ranges) return ranges;
    const wantedKeys = this.plan?.units;
    const candidates = [...this.units.entries()]
      .filter((e): e is [string, Extract<UnitState, { status: 'resident' }>] => e[1].status === 'resident' && !wantedKeys?.has(e[0]))
      .sort((a, b) => a[1].lastWanted - b[1].lastWanted);
    for (const [key, state] of candidates) {
      this.evict(key, state);
      ranges = allocator.alloc(count);
      if (ranges) return ranges;
    }
    return null;
  }

  /** Write `slices` (consecutive splats) into `ranges` (consecutive slots). */
  private writeRanges(slices: readonly PreparedSplatChunk[], ranges: readonly SlotRange[]): void {
    let rangeIndex = 0;
    let rangeOffset = 0;
    for (const slice of slices) {
      let done = 0;
      while (done < slice.count) {
        const range = ranges[rangeIndex]!;
        const n = Math.min(slice.count - done, range.count - rangeOffset);
        this.deps.target.writeGaussianResident(slicePreparedChunk(slice, done, done + n), range.first + rangeOffset);
        done += n;
        rangeOffset += n;
        if (rangeOffset === range.count) {
          rangeIndex++;
          rangeOffset = 0;
        }
      }
    }
  }

  // ── Eviction ────────────────────────────────────────────────────────────────

  private evict(key: string, state: Extract<UnitState, { status: 'resident' }>): void {
    for (const range of state.ranges) this.deps.target.releaseGaussianResident(range.first, range.count);
    this.allocator!.release(state.ranges);
    this.units.delete(key);
    this.residentSplats -= state.count;
    this.deps.target.setGaussianResidentCount(this.residentSplats);
    this.requestRender();
  }

  /**
   * Release units that have not been wanted for a while. Skipped while wanted
   * units are still loading: an unneeded unit may be covering their area.
   */
  private evictExpired(): void {
    if (this.active > 0 || this.queue.length > 0) return;
    const now = this.now();
    for (const [key, state] of [...this.units.entries()]) {
      if (state.status !== 'resident' || this.plan?.units.has(key)) continue;
      if (now - state.lastWanted >= this.evictAfterMs) this.evict(key, state);
    }
  }

  // ── Idle / render ───────────────────────────────────────────────────────────

  private isIdle(): boolean {
    return this.disposed || (this.active === 0 && this.queue.length === 0);
  }

  private checkIdle(): void {
    if (this.isIdle()) this.flushIdle();
  }

  private flushIdle(): void {
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }

  /** Ask the host for a frame, at most every {@link RENDER_INTERVAL_MS} with one trailing call. */
  private requestRender(): void {
    const wait = RENDER_INTERVAL_MS - (this.now() - this.lastRenderMs);
    if (wait <= 0) {
      this.lastRenderMs = this.now();
      this.deps.target.render();
      return;
    }
    if (this.renderTimer || this.disposed) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this.lastRenderMs = this.now();
      this.deps.target.render();
    }, wait);
  }
}

function shifted(v: readonly [number, number, number], origin: readonly [number, number, number]): [number, number, number] {
  return [v[0] - origin[0], v[1] - origin[1], v[2] - origin[2]];
}
