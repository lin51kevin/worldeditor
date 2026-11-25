/**
 * GPU stable depth sort for 3D Gaussian Splatting.
 *
 * Per-frame GPU sort that runs inside the render command encoder, eliminating
 * the worker round-trip latency that caused stale/blurry frames during chase/
 * front-cam playback.
 *
 * ## Pipeline
 *  1. key pass      — per splat: 24-bit normalized depth key, or the reserved
 *                     maximum key when the splat is behind the eye / outside the
 *                     view frustum (see `splatCulling.ts`); per-workgroup survivor
 *                     counts and the total (the indirect draw's instance count);
 *  2. count scan    — exclusive prefix over the per-workgroup survivor counts;
 *  3. compaction    — survivors' indices written contiguously IN INDEX ORDER
 *                     (bitmask + popcount rank, never an atomic race);
 *  4. size pass     — one thread derives the radix sizes from the survivor total;
 *  5. radix sort    — three stable passes over the survivors only.
 * Everything after the key pass scales with the number of VISIBLE splats, not
 * the cloud size: with a 66M-splat cloud and a street-level camera the sort
 * handles the few million splats the frustum actually contains.
 *
 * ## Algorithm: stable 8-bit-digit LSD radix over a 24-bit normalized depth key
 * Each splat's view depth is normalized into a 24-bit fixed-point key over the
 * scene depth range [minDepth,maxDepth] — sub-mm resolution (≈6 µm at 200 m), far
 * finer than the splat footprint, so the back-to-front order stays sharp (a coarse
 * 16-bit key at ~1.5 mm/bucket blends equal-bucket splats in index order → haze).
 * A 24-bit key needs only THREE 8-bit passes instead of four for a full 32-bit
 * float key — 25 % less sort work. Each pass:
 *   1. histogram — per-workgroup 256-bin digit counts → digit-major group table;
 *   2. scan      — exclusive prefix over the group table (proven multi-level scan);
 *   3. scatter   — each splat to base[digit,group] + stable local rank.
 * The scatter position comes from a prefix sum (never an atomic race), so the
 * order is a deterministic, stable function of the keys — identical every frame
 * for the same camera, smooth under motion (no twinkle). The local rank comes
 * from a per-digit lane bitmask + popcount ({@link MASK_WORDS}), which is the
 * same value the obvious "count earlier lanes with my digit" loop produces but
 * reads ~8 words instead of walking up to 256 lanes — that loop was the single
 * most expensive part of the sort (~128 shared reads per splat on average).
 *
 * ## Dynamic sizes
 * The survivor count is only known on the GPU, so the radix passes' element
 * count, group count and the scan lengths live in storage buffers written by the
 * size pass. Dispatches stay sized for the worst case (every splat visible); the
 * workgroups beyond the real size return immediately.
 *
 * ## Culling (lossless)
 * Culled splats are exactly the set the vertex stage already discards, so nothing
 * that used to be drawn stops being drawn — it only stops paying the per-instance
 * vertex cost, and its sort cost.
 *
 * ## Validation
 * The exact WGSL + orchestration were verified on real hardware via
 * `frontend/public/gpu-sort-harness.html` and `tools/ply-to-sog/e2e` (pixel-exact
 * against the pre-compaction output at 65.9M splats).
 * Pipelines use `layout: "auto"` so bind-group layouts are inferred from the
 * shaders (no hand-written layout can drift from the WGSL).
 */

import { SPLAT_FRUSTUM_CULL_WGSL } from "./splatCulling";
import { SPLAT_UNIFORM_BYTES } from "./splatUniform";

/** Must match the WGSL `@workgroup_size`. */
const WORKGROUP_SIZE = 256;
/** Elements scanned per Blelloch block (2 per thread). */
const SCAN_BLOCK = WORKGROUP_SIZE * 2;
/** Digit radix (8 bits) and the number of passes to cover the 24-bit key. */
const RADIX = 256;
const KEY_PASSES = 3;
/**
 * u32 words needed for a one-bit-per-lane occupancy mask of a workgroup. The
 * scatter keeps one such mask per digit and derives each lane's stable rank by
 * popcounting the bits below it, instead of scanning all {@link WORKGROUP_SIZE}
 * lanes serially. Costs `RADIX * MASK_WORDS * 4` = 8 KiB of workgroup storage,
 * within the 16 KiB WebGPU guarantees.
 */
const MASK_WORDS = WORKGROUP_SIZE / 32;
/** Max value of the 24-bit normalized depth key (2^24 − 1). */
const KEY_MAX_24 = 16777215;
/** Odd pass count → seed the compacted order into scratch so the final
 *  (even-indexed) pass still lands in the external order buffer. */
const INIT_TO_SCRATCH = KEY_PASSES % 2 === 1;
/**
 * WebGPU's guaranteed `maxComputeWorkgroupsPerDimension`. A 1-D dispatch wider
 * than this is a validation error that kills the whole command encoder (a >16.7M
 * splat cloud needs >65535 groups of 256), so every dispatch is folded into a 2-D
 * grid of exactly this width and the shaders re-linearize `workgroup_id`. Using a
 * fixed width (not the dispatch size) keeps `wid.x + wid.y * GRID` exact in both
 * cases: below the limit the grid is `(groups, 1)` so `wid.y` is always 0.
 */
export const MAX_WORKGROUPS_PER_DIM = 65535;

/**
 * `drawIndirect` argument buffer contents at the start of every sort:
 * `[vertexCount, instanceCount, firstVertex, firstInstance]`. The four corners of
 * the splat quad are fixed; `instanceCount` is accumulated by the key pass.
 */
const DRAW_ARGS_RESET = new Uint32Array([4, 0, 0, 0]);

/** Byte size of the splat render uniform the key pass reads (see `splatUniform.ts`). */
const CULL_UNIFORM_BYTES = SPLAT_UNIFORM_BYTES;

/**
 * Inputs that let the key pass cull splats outside the view frustum, not just
 * behind the eye. Culled splats are left out of the sort and of the indirect
 * draw's instance count.
 */
export interface SplatSortCull {
  /** The splat render uniform (`SplatUniforms`), already holding this frame's camera. */
  readonly uniformBuffer: GPUBuffer;
  /** One f32 per splat: its largest activated scale axis. */
  readonly radiiBuffer: GPUBuffer;
  /** Extra NDC margin so a re-sort that lags a moving camera shows no empty border. */
  readonly guardNdc: number;
  /**
   * Interactive thinning threshold in pixels (0/absent = off): splats smaller than
   * this on screen survive with probability (size/tau)², capping the visible count.
   */
  readonly thinTau?: number;
}

const ceilDiv = (a: number, b: number): number => Math.floor((a + b - 1) / b);

/** Dispatch `groups` workgroups as a 2-D grid within the per-dimension limit. */
function dispatchLinear(pass: GPUComputePassEncoder, groups: number): void {
  pass.dispatchWorkgroups(
    Math.min(groups, MAX_WORKGROUPS_PER_DIM),
    ceilDiv(groups, MAX_WORKGROUPS_PER_DIM),
  );
}

// ─── WGSL (as validated in the harness, plus 2-D workgroup-grid linearization) ──

const INIT_SHADER = /* wgsl */ `
${SPLAT_FRUSTUM_CULL_WGSL}
struct DepthParams { cam:vec3<f32>, count:u32, view:vec3<f32>, cull_enabled:u32, dmin:f32, dmax:f32, guard:f32, thin_tau:f32 };
@group(0) @binding(0) var<uniform> params : DepthParams;
@group(0) @binding(1) var<storage, read> positions : array<f32>;
@group(0) @binding(2) var<storage, read_write> keys : array<u32>;
@group(0) @binding(3) var<storage, read_write> wg_counts : array<u32>;
@group(0) @binding(4) var<storage, read_write> draw_args : array<atomic<u32>, 4>;
@group(0) @binding(5) var<storage, read> radii : array<f32>;
@group(0) @binding(6) var<uniform> cu : SplatUniforms;
var<workgroup> wg_visible : atomic<u32>;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn init_keys(@builtin(local_invocation_id) lid : vec3<u32>, @builtin(workgroup_id) wid : vec3<u32>) {
  if (lid.x == 0u) { atomicStore(&wg_visible, 0u); }
  workgroupBarrier();
  let g = wid.x + wid.y * ${MAX_WORKGROUPS_PER_DIM}u;
  let i = g * ${WORKGROUP_SIZE}u + lid.x;
  // No early return: the two barriers below must stay workgroup-uniform.
  if (i < params.count) {
    let b = i * 3u;
    let pos = vec3<f32>(positions[b], positions[b+1u], positions[b+2u]);
    let d = pos - params.cam;
    let depth = d.x*params.view.x + d.y*params.view.y + d.z*params.view.z;
    var culled = depth <= 1e-6;
    if (!culled && params.cull_enabled == 1u) {
      culled = splat_frustum_culled(pos, radii[i], params.guard);
    }
    if (!culled && params.cull_enabled == 1u) {
      culled = splat_thinned(i, pos, radii[i], params.thin_tau);
    }
    if (culled) {
      // Behind the eye or outside the frustum — the vertex stage discards these
      // anyway. The reserved maximum key marks them for the compaction pass.
      keys[i] = ${KEY_MAX_24}u;
    } else {
      // Normalize depth into a 24-bit fixed-point key over [dmin,dmax], then INVERT
      // so an ASCENDING sort draws the FARTHEST splat (t=1) first (back-to-front).
      // Everything keyed here is in front of the eye, so a negative dmin (cloud
      // AABB straddling the camera) only wastes key range — clamp it away.
      let lo = max(params.dmin, 0.0);
      let range = max(params.dmax - lo, 1e-9);
      let t = clamp((depth - lo) / range, 0.0, 1.0);
      // n in [1,KEY_MAX] keeps every visible key strictly below the culled key.
      let n = 1u + u32(t * ${KEY_MAX_24 - 1}.0 + 0.5);
      keys[i] = ${KEY_MAX_24}u - n;
      atomicAdd(&wg_visible, 1u);
    }
  }
  workgroupBarrier();
  if (lid.x == 0u) {
    let v = atomicLoad(&wg_visible);
    // Padding groups of the 2-D grid own no slot.
    if (g * ${WORKGROUP_SIZE}u < params.count) { wg_counts[g] = v; }
    // One global atomic per workgroup instead of one per splat (256x less contention).
    if (v > 0u) { atomicAdd(&draw_args[1u], v); }
  }
}`;

const COMPACT_SHADER = /* wgsl */ `
struct CompactParams { _a:vec3<f32>, count:u32 };
@group(0) @binding(0) var<uniform> params : CompactParams;
@group(0) @binding(1) var<storage, read> keys : array<u32>;
@group(0) @binding(2) var<storage, read> group_base : array<u32>;
@group(0) @binding(3) var<storage, read_write> order_out : array<u32>;
var<workgroup> masks : array<atomic<u32>, ${MASK_WORDS}>;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn compact_visible(@builtin(local_invocation_id) lid : vec3<u32>, @builtin(workgroup_id) wid : vec3<u32>) {
  let g = wid.x + wid.y * ${MAX_WORKGROUPS_PER_DIM}u;
  // Workgroup-uniform, so the barriers below stay legal.
  if (g * ${WORKGROUP_SIZE}u >= params.count) { return; }
  if (lid.x < ${MASK_WORDS}u) { atomicStore(&masks[lid.x], 0u); }
  workgroupBarrier();
  let i = g * ${WORKGROUP_SIZE}u + lid.x;
  let visible = i < params.count && keys[i] != ${KEY_MAX_24}u;
  let word = lid.x >> 5u;
  let bit = lid.x & 31u;
  if (visible) { atomicOr(&masks[word], 1u << bit); }
  workgroupBarrier();
  if (!visible) { return; }
  // Survivors keep their index order: rank = visible lanes strictly before this one.
  var rank = 0u;
  for (var k = 0u; k < word; k = k + 1u) {
    rank = rank + countOneBits(atomicLoad(&masks[k]));
  }
  rank = rank + countOneBits(atomicLoad(&masks[word]) & ((1u << bit) - 1u));
  order_out[group_base[g] + rank] = i;
}`;

const DYN_SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read> draw_args : array<u32>;
@group(0) @binding(1) var<storage, read_write> radix_dyn : array<u32>;
@group(0) @binding(2) var<storage, read_write> n_hist : array<u32>;
@group(0) @binding(3) var<storage, read_write> n_nb0 : array<u32>;
@group(0) @binding(4) var<storage, read_write> n_nb1 : array<u32>;
@compute @workgroup_size(1)
fn dyn_params() {
  let m = draw_args[1];
  let groups = (m + ${WORKGROUP_SIZE - 1}u) / ${WORKGROUP_SIZE}u;
  let hist_len = groups * ${RADIX}u;
  let nb0 = (hist_len + ${SCAN_BLOCK - 1}u) / ${SCAN_BLOCK}u;
  let nb1 = (nb0 + ${SCAN_BLOCK - 1}u) / ${SCAN_BLOCK}u;
  radix_dyn[0] = m;
  radix_dyn[1] = groups;
  n_hist[0] = hist_len;
  n_nb0[0] = nb0;
  n_nb1[0] = nb1;
}`;

const HIST_SHADER = /* wgsl */ `
struct RParams { count:u32, shift:u32, num_groups:u32, _pad:u32 };
@group(0) @binding(0) var<uniform> rp : RParams;
@group(0) @binding(1) var<storage, read> keys : array<u32>;
@group(0) @binding(2) var<storage, read> order : array<u32>;
@group(0) @binding(3) var<storage, read_write> group_hist : array<u32>;
// [element count, group count] of THIS frame's survivors.
@group(0) @binding(4) var<storage, read> radix_dyn : array<u32>;
var<workgroup> counts : array<atomic<u32>, ${RADIX}>;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn histogram(@builtin(local_invocation_id) lid : vec3<u32>, @builtin(workgroup_id) wid : vec3<u32>) {
  // Groups past the survivors own no group_hist slot; writing from them would
  // clobber another digit's counts. Workgroup-uniform, so barrier-safe.
  let g = wid.x + wid.y * ${MAX_WORKGROUPS_PER_DIM}u;
  let num_groups = radix_dyn[1];
  if (g >= num_groups) { return; }
  atomicStore(&counts[lid.x], 0u);
  workgroupBarrier();
  let i = g * ${WORKGROUP_SIZE}u + lid.x;
  if (i < radix_dyn[0]) {
    let d = (keys[order[i]] >> rp.shift) & 0xFFu;
    atomicAdd(&counts[d], 1u);
  }
  workgroupBarrier();
  // Digit-major layout: [digit * num_groups + group].
  group_hist[lid.x * num_groups + g] = atomicLoad(&counts[lid.x]);
}`;

const SCATTER_SHADER = /* wgsl */ `
struct RParams { count:u32, shift:u32, num_groups:u32, _pad:u32 };
@group(0) @binding(0) var<uniform> rp : RParams;
@group(0) @binding(1) var<storage, read> keys : array<u32>;
@group(0) @binding(2) var<storage, read> order_src : array<u32>;
@group(0) @binding(3) var<storage, read> group_base : array<u32>;
@group(0) @binding(4) var<storage, read_write> order_dst : array<u32>;
@group(0) @binding(5) var<storage, read> radix_dyn : array<u32>;
// One 256-bit occupancy mask per digit: bit L is set when lane L holds that digit.
var<workgroup> lane_masks : array<atomic<u32>, ${RADIX * MASK_WORDS}>;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn scatter(@builtin(local_invocation_id) lid : vec3<u32>, @builtin(workgroup_id) wid : vec3<u32>) {
  let g = wid.x + wid.y * ${MAX_WORKGROUPS_PER_DIM}u;
  let num_groups = radix_dyn[1];
  if (g >= num_groups) { return; }
  // Each lane clears its own contiguous slice; ${RADIX * MASK_WORDS} words / ${WORKGROUP_SIZE} lanes.
  for (var k = 0u; k < ${MASK_WORDS}u; k = k + 1u) {
    atomicStore(&lane_masks[lid.x * ${MASK_WORDS}u + k], 0u);
  }
  let i = g * ${WORKGROUP_SIZE}u + lid.x;
  let in_range = i < radix_dyn[0];
  var d = 0u;
  var e = 0u;
  if (in_range) { e = order_src[i]; d = (keys[e] >> rp.shift) & 0xFFu; }
  let word = lid.x >> 5u;
  let bit = lid.x & 31u;
  workgroupBarrier();
  if (in_range) { atomicOr(&lane_masks[d * ${MASK_WORDS}u + word], 1u << bit); }
  workgroupBarrier();
  if (!in_range) { return; }
  // Stable local rank = same-digit lanes strictly before this one. Popcounting an
  // occupancy bitmask reads at most ${MASK_WORDS} words instead of walking all
  // ${WORKGROUP_SIZE} lanes serially (that loop was the sort's dominant cost).
  var rank = 0u;
  for (var k = 0u; k < word; k = k + 1u) {
    rank = rank + countOneBits(atomicLoad(&lane_masks[d * ${MASK_WORDS}u + k]));
  }
  rank = rank + countOneBits(atomicLoad(&lane_masks[d * ${MASK_WORDS}u + word]) & ((1u << bit) - 1u));
  order_dst[group_base[d * num_groups + g] + rank] = e;
}`;

const SCAN_SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read> prefix_n : array<u32>;
@group(0) @binding(1) var<storage, read_write> data : array<u32>;
@group(0) @binding(2) var<storage, read_write> block_sums : array<u32>;
const WG_SIZE : u32 = ${WORKGROUP_SIZE}u;
const BLOCK : u32 = ${SCAN_BLOCK}u;
var<workgroup> shmem : array<u32, ${SCAN_BLOCK}>;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn scan_blocks(@builtin(local_invocation_id) lid : vec3<u32>, @builtin(workgroup_id) wid : vec3<u32>) {
  let n = prefix_n[0];
  let b = wid.x + wid.y * ${MAX_WORKGROUPS_PER_DIM}u;
  if (b >= (n + BLOCK - 1u) / BLOCK) { return; }
  let block_offset = b * BLOCK;
  let idx0 = block_offset + lid.x;
  let idx1 = block_offset + lid.x + WG_SIZE;
  shmem[lid.x] = select(0u, data[idx0], idx0 < n);
  shmem[lid.x + WG_SIZE] = select(0u, data[idx1], idx1 < n);
  workgroupBarrier();
  var offset = 1u;
  for (var d = BLOCK >> 1u; d > 0u; d >>= 1u) {
    workgroupBarrier();
    if (lid.x < d) {
      let ai = offset * (2u*lid.x + 1u) - 1u;
      let bi = offset * (2u*lid.x + 2u) - 1u;
      shmem[bi] += shmem[ai];
    }
    offset <<= 1u;
  }
  if (lid.x == 0u) { block_sums[b] = shmem[BLOCK - 1u]; shmem[BLOCK - 1u] = 0u; }
  workgroupBarrier();
  for (var d = 1u; d < BLOCK; d <<= 1u) {
    offset >>= 1u;
    workgroupBarrier();
    if (lid.x < d) {
      let ai = offset * (2u*lid.x + 1u) - 1u;
      let bi = offset * (2u*lid.x + 2u) - 1u;
      let t = shmem[ai];
      shmem[ai] = shmem[bi];
      shmem[bi] += t;
    }
  }
  workgroupBarrier();
  if (idx0 < n) { data[idx0] = shmem[lid.x]; }
  if (idx1 < n) { data[idx1] = shmem[lid.x + WG_SIZE]; }
}`;

const ADD_SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read> prefix_n : array<u32>;
@group(0) @binding(1) var<storage, read_write> data : array<u32>;
@group(0) @binding(2) var<storage, read> block_sums : array<u32>;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn add_offsets(@builtin(local_invocation_id) lid : vec3<u32>, @builtin(workgroup_id) wid : vec3<u32>) {
  let g = wid.x + wid.y * ${MAX_WORKGROUPS_PER_DIM}u;
  let idx = g * ${WORKGROUP_SIZE}u + lid.x;
  if (idx >= prefix_n[0]) { return; }
  data[idx] += block_sums[g / 2u];
}`;

const DEPTH_PARAMS_SIZE = 48;

interface SortPipelines {
  readonly init: GPUComputePipeline;
  readonly compact: GPUComputePipeline;
  readonly dyn: GPUComputePipeline;
  readonly hist: GPUComputePipeline;
  readonly scatter: GPUComputePipeline;
  readonly scan: GPUComputePipeline;
  readonly add: GPUComputePipeline;
}

/**
 * A multi-level exclusive prefix scan over one `u32` buffer: bind groups for each
 * level plus the worst-case sizes its dispatches are encoded for. The element
 * counts the shaders actually use come from the `n` storage buffers.
 */
interface ScanPlan {
  readonly level0: GPUBindGroup;
  readonly level1: GPUBindGroup;
  readonly level2: GPUBindGroup;
  readonly addLevel1: GPUBindGroup;
  readonly addLevel0: GPUBindGroup;
  readonly length: number;
  readonly nb0: number;
  readonly nb1: number;
  readonly nb2: number;
}

/**
 * Per-frame GPU stable radix sort for Gaussian splats.
 *
 * The sorted index order is written directly into the render pipeline's order
 * buffer (used as one ping-pong index buffer), so there is no CPU↔GPU round-trip
 * and the result is available in the same frame.
 */
export class GpuSplatSorter {
  private pipelines: SortPipelines | null = null;

  private keys: GPUBuffer | null = null;      // 32-bit depth keys (not permuted)
  private scratch: GPUBuffer | null = null;   // second ping-pong index buffer
  private groupHist: GPUBuffer | null = null; // [RADIX * numGroups], scanned in place
  private wgCounts: GPUBuffer | null = null;  // survivors per key-pass workgroup, scanned in place
  /** Block-sum buffers of the histogram scan (level 0..2) and of the count scan. */
  private histSums: GPUBuffer[] = [];
  private countSums: GPUBuffer[] = [];
  private depthParams: GPUBuffer | null = null;
  private drawArgs: GPUBuffer | null = null; // [4, visibleCount, 0, 0] for drawIndirect
  private placeholderBuffers: { radii: GPUBuffer; uniform: GPUBuffer } | null = null;
  /** `[survivors, groups]` plus the scan lengths derived from them, written by the size pass. */
  private radixDyn: GPUBuffer | null = null;
  private dynLengths: GPUBuffer[] = [];
  /** Fixed scan lengths of the count scan, written once. */
  private countLengths: GPUBuffer[] = [];
  private rParams: GPUBuffer[] = [];

  private histScan: ScanPlan | null = null;
  private countScan: ScanPlan | null = null;
  private dynBG: GPUBindGroup | null = null;
  private orderRef: GPUBuffer | null = null;
  private histBG: GPUBindGroup[] = [];
  private scatterBG: GPUBindGroup[] = [];

  private count = 0;
  private numGroups = 0;

  constructor(private readonly device: GPUDevice) {}

  /**
   * `drawIndirect` argument buffer whose `instanceCount` is the number of splats
   * the most recent {@link sort} kept (in front of the eye and inside the
   * frustum). Valid only together with the order buffer that same sort produced.
   */
  get drawArgsBuffer(): GPUBuffer | null {
    return this.drawArgs;
  }

  private ensureInit(): SortPipelines {
    if (this.pipelines) return this.pipelines;
    const device = this.device;
    // `layout: "auto"` infers each bind-group layout from the shader, so a
    // hand-written layout can never drift out of sync with the WGSL bindings.
    const cp = (code: string, entryPoint: string): GPUComputePipeline =>
      device.createComputePipeline({
        layout: "auto",
        compute: { module: device.createShaderModule({ code }), entryPoint },
      });
    this.pipelines = {
      init: cp(INIT_SHADER, "init_keys"),
      compact: cp(COMPACT_SHADER, "compact_visible"),
      dyn: cp(DYN_SHADER, "dyn_params"),
      hist: cp(HIST_SHADER, "histogram"),
      scatter: cp(SCATTER_SHADER, "scatter"),
      scan: cp(SCAN_SHADER, "scan_blocks"),
      add: cp(ADD_SHADER, "add_offsets"),
    };
    return this.pipelines;
  }

  private makeStorage(bytes: number): GPUBuffer {
    return this.device.createBuffer({
      size: Math.max(bytes, 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  /** A 16-byte storage buffer holding one u32 length. */
  private makeLength(value: number): GPUBuffer {
    const buf = this.makeStorage(16);
    this.device.queue.writeBuffer(buf, 0, new Uint32Array([value, 0, 0, 0]));
    return buf;
  }

  private makeUniform(values: readonly number[]): GPUBuffer {
    const buf = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const a = new Uint32Array(8);
    a.set(values);
    this.device.queue.writeBuffer(buf, 0, a);
    return buf;
  }

  private bindGroup(pipe: GPUComputePipeline, bufs: readonly GPUBuffer[]): GPUBindGroup {
    return this.device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: bufs.map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
  }

  /**
   * Build the bind groups of a 3-level scan of `data`. `lengths` are the storage
   * buffers holding the scan length of `data` and of the two block-sum levels.
   */
  private makeScanPlan(
    pipes: SortPipelines,
    data: GPUBuffer,
    sums: readonly GPUBuffer[],
    lengths: readonly GPUBuffer[],
    length: number,
  ): ScanPlan {
    const nb0 = ceilDiv(length, SCAN_BLOCK);
    const nb1 = ceilDiv(nb0, SCAN_BLOCK);
    const nb2 = ceilDiv(nb1, SCAN_BLOCK);
    return {
      level0: this.bindGroup(pipes.scan, [lengths[0]!, data, sums[0]!]),
      level1: this.bindGroup(pipes.scan, [lengths[1]!, sums[0]!, sums[1]!]),
      level2: this.bindGroup(pipes.scan, [lengths[2]!, sums[1]!, sums[2]!]),
      addLevel1: this.bindGroup(pipes.add, [lengths[1]!, sums[0]!, sums[1]!]),
      addLevel0: this.bindGroup(pipes.add, [lengths[0]!, data, sums[0]!]),
      length,
      nb0,
      nb1,
      nb2,
    };
  }

  /** Allocate per-splat buffers and pre-write the size-dependent uniforms. */
  resize(count: number): void {
    if (count === this.count) return;
    const pipes = this.ensureInit();
    this.releaseBuffers();
    this.count = count;
    this.orderRef = null; // force per-order bind groups to rebuild
    if (count === 0) return;

    this.numGroups = ceilDiv(count, WORKGROUP_SIZE);
    const histLen = RADIX * this.numGroups;
    const histNb0 = ceilDiv(histLen, SCAN_BLOCK);
    const histNb1 = ceilDiv(histNb0, SCAN_BLOCK);
    const histNb2 = ceilDiv(histNb1, SCAN_BLOCK);
    const countNb0 = ceilDiv(this.numGroups, SCAN_BLOCK);
    const countNb1 = ceilDiv(countNb0, SCAN_BLOCK);
    const countNb2 = ceilDiv(countNb1, SCAN_BLOCK);

    this.keys = this.makeStorage(count * 4);
    this.scratch = this.makeStorage(count * 4);
    this.groupHist = this.makeStorage(histLen * 4);
    this.wgCounts = this.makeStorage(this.numGroups * 4);
    this.histSums = [histNb0, histNb1, histNb2].map((n) => this.makeStorage(n * 4));
    this.countSums = [countNb0, countNb1, countNb2].map((n) => this.makeStorage(n * 4));
    this.depthParams = this.device.createBuffer({
      size: DEPTH_PARAMS_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.drawArgs = this.device.createBuffer({
      size: DRAW_ARGS_RESET.byteLength,
      usage:
        GPUBufferUsage.INDIRECT |
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    });

    // Written ONCE here, never per-frame: the count scan always covers every group.
    this.countLengths = [this.numGroups, countNb0, countNb1].map((n) => this.makeLength(n));
    // Rewritten by the size pass every sort.
    this.radixDyn = this.makeStorage(16);
    this.dynLengths = [0, 1, 2].map(() => this.makeStorage(16));
    this.rParams = [];
    for (let p = 0; p < KEY_PASSES; p++) {
      this.rParams.push(this.makeUniform([count, p * 8, this.numGroups, 0]));
    }

    this.histScan = this.makeScanPlan(pipes, this.groupHist, this.histSums, this.dynLengths, histLen);
    this.countScan = this.makeScanPlan(pipes, this.wgCounts, this.countSums, this.countLengths, this.numGroups);
    this.dynBG = this.bindGroup(pipes.dyn, [this.drawArgs, this.radixDyn, ...this.dynLengths]);
  }

  /** (Re)build the bind groups that reference the external order buffer. */
  private ensureOrderBindGroups(orderBuffer: GPUBuffer): void {
    if (this.orderRef === orderBuffer) return;
    this.orderRef = orderBuffer;
    const pipes = this.ensureInit();
    const keys = this.keys!;
    const scratch = this.scratch!;
    const groupHist = this.groupHist!;
    const radixDyn = this.radixDyn!;
    this.histBG = [];
    this.scatterBG = [];
    for (let p = 0; p < KEY_PASSES; p++) {
      // Parity chosen so the FINAL pass writes into `orderBuffer` regardless of
      // whether KEY_PASSES is odd or even (pass 0's source is seeded by compaction).
      const dstIsOrder = (KEY_PASSES - 1 - p) % 2 === 0;
      const src = dstIsOrder ? scratch : orderBuffer;
      const dst = dstIsOrder ? orderBuffer : scratch;
      const rp = this.rParams[p]!;
      this.histBG.push(this.bindGroup(pipes.hist, [rp, keys, src, groupHist, radixDyn]));
      this.scatterBG.push(this.bindGroup(pipes.scatter, [rp, keys, src, groupHist, dst, radixDyn]));
    }
  }

  /** Encode an exclusive prefix scan described by `plan` (up to 3 levels). */
  private encodeScan(encoder: GPUCommandEncoder, pipes: SortPipelines, plan: ScanPlan): void {
    // Each dependent step runs in its OWN compute pass: WebGPU only guarantees
    // storage visibility BETWEEN passes, not between dispatches within one pass.
    const step = (pipeline: GPUComputePipeline, group: GPUBindGroup, groups: number): void => {
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      dispatchLinear(pass, groups);
      pass.end();
    };
    step(pipes.scan, plan.level0, plan.nb0);
    if (plan.nb0 > 1) {
      step(pipes.scan, plan.level1, plan.nb1);
      if (plan.nb1 > 1) {
        step(pipes.scan, plan.level2, plan.nb2); // nb2 === 1 → level-1 sums fully scanned
        step(pipes.add, plan.addLevel1, ceilDiv(plan.nb0, WORKGROUP_SIZE));
      }
      step(pipes.add, plan.addLevel0, ceilDiv(plan.length, WORKGROUP_SIZE));
    }
  }

  /**
   * Encode the stable radix sort into `encoder` (before the render pass).
   * Writes the back-to-front index order of the surviving splats into
   * `orderBuffer`. `minDepth`/`maxDepth` bound the 24-bit normalized depth key
   * (splats outside clamp to the extremes).
   */
  sort(
    encoder: GPUCommandEncoder,
    positionsBuffer: GPUBuffer,
    orderBuffer: GPUBuffer,
    camPos: readonly [number, number, number],
    viewDir: readonly [number, number, number],
    minDepth: number,
    maxDepth: number,
    cull?: SplatSortCull,
  ): void {
    const pipes = this.ensureInit();
    if (this.count === 0 || !this.keys) return;
    this.ensureOrderBindGroups(orderBuffer);

    const dp = new ArrayBuffer(DEPTH_PARAMS_SIZE);
    const f = new Float32Array(dp);
    const u = new Uint32Array(dp);
    f[0] = camPos[0]; f[1] = camPos[1]; f[2] = camPos[2];
    u[3] = this.count;
    f[4] = viewDir[0]; f[5] = viewDir[1]; f[6] = viewDir[2];
    u[7] = cull ? 1 : 0;
    f[8] = minDepth; f[9] = maxDepth;
    f[10] = cull?.guardNdc ?? 0;
    f[11] = cull?.thinTau ?? 0;
    this.device.queue.writeBuffer(this.depthParams!, 0, dp);
    // Queue writes are ordered before command buffers submitted afterwards, so the
    // counter is guaranteed zero when the key pass below starts accumulating.
    this.device.queue.writeBuffer(this.drawArgs!, 0, DRAW_ARGS_RESET);

    const groups = ceilDiv(this.count, WORKGROUP_SIZE);
    const run = (pipeline: GPUComputePipeline, group: GPUBindGroup, size: number | null): void => {
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      if (size === null) pass.dispatchWorkgroups(1);
      else dispatchLinear(pass, size);
      pass.end();
    };

    // Key pass. Needs `positions`, so its bind group is built here, not in resize().
    run(
      pipes.init,
      this.device.createBindGroup({
        layout: pipes.init.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.depthParams! } },
          { binding: 1, resource: { buffer: positionsBuffer } },
          { binding: 2, resource: { buffer: this.keys } },
          { binding: 3, resource: { buffer: this.wgCounts! } },
          { binding: 4, resource: { buffer: this.drawArgs! } },
          { binding: 5, resource: { buffer: cull?.radiiBuffer ?? this.placeholders().radii } },
          { binding: 6, resource: { buffer: cull?.uniformBuffer ?? this.placeholders().uniform } },
        ],
      }),
      groups,
    );

    // Compact the survivors into pass 0's source buffer (scratch when KEY_PASSES
    // is odd, else the order buffer) so the final pass lands in `orderBuffer`.
    this.encodeScan(encoder, pipes, this.countScan!);
    const compactTarget = INIT_TO_SCRATCH ? this.scratch! : orderBuffer;
    run(
      pipes.compact,
      this.bindGroup(pipes.compact, [this.depthParams!, this.keys, this.wgCounts!, compactTarget]),
      groups,
    );
    run(pipes.dyn, this.dynBG!, null);

    for (let p = 0; p < KEY_PASSES; p++) {
      run(pipes.hist, this.histBG[p]!, this.numGroups);
      this.encodeScan(encoder, pipes, this.histScan!);
      run(pipes.scatter, this.scatterBG[p]!, this.numGroups);
    }
    // Parity is chosen in ensureOrderBindGroups so the final pass lands in `orderBuffer`.
  }

  /** Valid-but-unused bindings for the key pass when culling is off. */
  private placeholders(): { radii: GPUBuffer; uniform: GPUBuffer } {
    if (!this.placeholderBuffers) {
      this.placeholderBuffers = {
        radii: this.makeStorage(4),
        uniform: this.device.createBuffer({
          size: CULL_UNIFORM_BYTES,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
      };
    }
    return this.placeholderBuffers;
  }

  private releaseBuffers(): void {
    this.placeholderBuffers?.radii.destroy();
    this.placeholderBuffers?.uniform.destroy();
    this.placeholderBuffers = null;
    for (const buf of [
      this.keys,
      this.scratch,
      this.groupHist,
      this.wgCounts,
      this.depthParams,
      this.drawArgs,
      this.radixDyn,
      ...this.histSums,
      ...this.countSums,
      ...this.dynLengths,
      ...this.countLengths,
      ...this.rParams,
    ]) {
      buf?.destroy();
    }
    this.keys = this.scratch = this.groupHist = this.wgCounts = null;
    this.depthParams = this.drawArgs = this.radixDyn = null;
    this.histSums = [];
    this.countSums = [];
    this.dynLengths = [];
    this.countLengths = [];
    this.rParams = [];
    this.histScan = this.countScan = null;
    this.dynBG = null;
    this.histBG = [];
    this.scatterBG = [];
    this.orderRef = null;
  }

  dispose(): void {
    this.releaseBuffers();
    this.count = 0;
    this.pipelines = null;
  }
}
