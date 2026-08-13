/**
 * GPU stable depth sort for 3D Gaussian Splatting.
 *
 * Per-frame GPU sort that runs inside the render command encoder, eliminating
 * the worker round-trip latency that caused stale/blurry frames during chase/
 * front-cam playback.
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
 * ## Behind-camera culling (lossless)
 * The key pass already computes each splat's view depth, so it also parks every
 * splat at or behind the eye plane at the reserved maximum key: a stable ascending
 * sort then packs them contiguously at the TAIL of the order buffer. A
 * workgroup-aggregated counter records how many splats survived and writes it as
 * the `instanceCount` of a `drawIndirect` argument buffer, so the render pass
 * rasterizes only the front-of-eye prefix. This is exactly the set the vertex
 * stage already discarded (`viewDepth <= 1e-6`), so nothing that used to be drawn
 * stops being drawn — it only stops paying the per-instance vertex cost
 * (order fetch + three RGBA32F transform fetches + covariance reconstruction).
 * On a chase/front camera in a street-level cloud that is typically half the cloud.
 *
 * ## Validation
 * The exact WGSL + orchestration were verified on real hardware via
 * `frontend/public/gpu-sort-harness.html` (correct + deterministic + stable at
 * up to 12,000,000 splats incl. clustered/tie-heavy inputs; ~28 ms at 12M).
 * Pipelines use `layout: "auto"` so bind-group layouts are inferred from the
 * shaders (no hand-written layout can drift from the WGSL).
 */

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
/** Odd pass count → seed the identity permutation into scratch so the final
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
struct DepthParams { cam:vec3<f32>, count:u32, view:vec3<f32>, _pad:u32, dmin:f32, dmax:f32, _pad2:vec2<f32> };
@group(0) @binding(0) var<uniform> params : DepthParams;
@group(0) @binding(1) var<storage, read> positions : array<f32>;
@group(0) @binding(2) var<storage, read_write> keys : array<u32>;
@group(0) @binding(3) var<storage, read_write> order : array<u32>;
@group(0) @binding(4) var<storage, read_write> draw_args : array<atomic<u32>, 4>;
var<workgroup> wg_visible : atomic<u32>;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn init_keys(@builtin(local_invocation_id) lid : vec3<u32>, @builtin(workgroup_id) wid : vec3<u32>) {
  if (lid.x == 0u) { atomicStore(&wg_visible, 0u); }
  workgroupBarrier();
  let i = (wid.x + wid.y * ${MAX_WORKGROUPS_PER_DIM}u) * ${WORKGROUP_SIZE}u + lid.x;
  // No early return: the two barriers below must stay workgroup-uniform.
  if (i < params.count) {
    let b = i * 3u;
    let dx = positions[b] - params.cam.x;
    let dy = positions[b+1u] - params.cam.y;
    let dz = positions[b+2u] - params.cam.z;
    let depth = dx*params.view.x + dy*params.view.y + dz*params.view.z;
    order[i] = i;
    if (depth <= 1e-6) {
      // At or behind the eye plane — the vertex stage discards these anyway.
      // The reserved maximum key parks them at the tail of the sorted order so
      // the indirect instance count can stop short of them.
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
  // One global atomic per workgroup instead of one per splat (256x less contention).
  if (lid.x == 0u) {
    let v = atomicLoad(&wg_visible);
    if (v > 0u) { atomicAdd(&draw_args[1u], v); }
  }
}`;

const HIST_SHADER = /* wgsl */ `
struct RParams { count:u32, shift:u32, num_groups:u32, _pad:u32 };
@group(0) @binding(0) var<uniform> rp : RParams;
@group(0) @binding(1) var<storage, read> keys : array<u32>;
@group(0) @binding(2) var<storage, read> order : array<u32>;
@group(0) @binding(3) var<storage, read_write> group_hist : array<u32>;
var<workgroup> counts : array<atomic<u32>, ${RADIX}>;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn histogram(@builtin(local_invocation_id) lid : vec3<u32>, @builtin(workgroup_id) wid : vec3<u32>) {
  // Padding groups of the 2-D grid own no group_hist slot; writing from them would
  // clobber another digit's counts. Workgroup-uniform, so barrier-safe.
  let g = wid.x + wid.y * ${MAX_WORKGROUPS_PER_DIM}u;
  if (g >= rp.num_groups) { return; }
  atomicStore(&counts[lid.x], 0u);
  workgroupBarrier();
  let i = g * ${WORKGROUP_SIZE}u + lid.x;
  if (i < rp.count) {
    let d = (keys[order[i]] >> rp.shift) & 0xFFu;
    atomicAdd(&counts[d], 1u);
  }
  workgroupBarrier();
  // Digit-major layout: [digit * num_groups + group].
  group_hist[lid.x * rp.num_groups + g] = atomicLoad(&counts[lid.x]);
}`;

const SCATTER_SHADER = /* wgsl */ `
struct RParams { count:u32, shift:u32, num_groups:u32, _pad:u32 };
@group(0) @binding(0) var<uniform> rp : RParams;
@group(0) @binding(1) var<storage, read> keys : array<u32>;
@group(0) @binding(2) var<storage, read> order_src : array<u32>;
@group(0) @binding(3) var<storage, read> group_base : array<u32>;
@group(0) @binding(4) var<storage, read_write> order_dst : array<u32>;
// One 256-bit occupancy mask per digit: bit L is set when lane L holds that digit.
var<workgroup> lane_masks : array<atomic<u32>, ${RADIX * MASK_WORDS}>;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn scatter(@builtin(local_invocation_id) lid : vec3<u32>, @builtin(workgroup_id) wid : vec3<u32>) {
  let g = wid.x + wid.y * ${MAX_WORKGROUPS_PER_DIM}u;
  if (g >= rp.num_groups) { return; }
  // Each lane clears its own contiguous slice; ${RADIX * MASK_WORDS} words / ${WORKGROUP_SIZE} lanes.
  for (var k = 0u; k < ${MASK_WORDS}u; k = k + 1u) {
    atomicStore(&lane_masks[lid.x * ${MASK_WORDS}u + k], 0u);
  }
  let i = g * ${WORKGROUP_SIZE}u + lid.x;
  let in_range = i < rp.count;
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
  order_dst[group_base[d * rp.num_groups + g] + rank] = e;
}`;

const SCAN_SHADER = /* wgsl */ `
struct PrefixParams { n:u32, _pad:vec3<u32> };
@group(0) @binding(0) var<uniform> prefix_params : PrefixParams;
@group(0) @binding(1) var<storage, read_write> data : array<u32>;
@group(0) @binding(2) var<storage, read_write> block_sums : array<u32>;
const WG_SIZE : u32 = ${WORKGROUP_SIZE}u;
const BLOCK : u32 = ${SCAN_BLOCK}u;
var<workgroup> shmem : array<u32, ${SCAN_BLOCK}>;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn scan_blocks(@builtin(local_invocation_id) lid : vec3<u32>, @builtin(workgroup_id) wid : vec3<u32>) {
  let b = wid.x + wid.y * ${MAX_WORKGROUPS_PER_DIM}u;
  if (b >= (prefix_params.n + BLOCK - 1u) / BLOCK) { return; }
  let block_offset = b * BLOCK;
  let idx0 = block_offset + lid.x;
  let idx1 = block_offset + lid.x + WG_SIZE;
  shmem[lid.x] = select(0u, data[idx0], idx0 < prefix_params.n);
  shmem[lid.x + WG_SIZE] = select(0u, data[idx1], idx1 < prefix_params.n);
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
  if (idx0 < prefix_params.n) { data[idx0] = shmem[lid.x]; }
  if (idx1 < prefix_params.n) { data[idx1] = shmem[lid.x + WG_SIZE]; }
}`;

const ADD_SHADER = /* wgsl */ `
struct PrefixParams { n:u32, _pad:vec3<u32> };
@group(0) @binding(0) var<uniform> prefix_params : PrefixParams;
@group(0) @binding(1) var<storage, read_write> data : array<u32>;
@group(0) @binding(2) var<storage, read> block_sums : array<u32>;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn add_offsets(@builtin(local_invocation_id) lid : vec3<u32>, @builtin(workgroup_id) wid : vec3<u32>) {
  let g = wid.x + wid.y * ${MAX_WORKGROUPS_PER_DIM}u;
  let idx = g * ${WORKGROUP_SIZE}u + lid.x;
  if (idx >= prefix_params.n) { return; }
  data[idx] += block_sums[g / 2u];
}`;

const DEPTH_PARAMS_SIZE = 48;

interface SortPipelines {
  readonly init: GPUComputePipeline;
  readonly hist: GPUComputePipeline;
  readonly scatter: GPUComputePipeline;
  readonly scan: GPUComputePipeline;
  readonly add: GPUComputePipeline;
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
  private bs0: GPUBuffer | null = null;
  private bs1: GPUBuffer | null = null;
  private bs2: GPUBuffer | null = null;
  private depthParams: GPUBuffer | null = null;
  private drawArgs: GPUBuffer | null = null; // [4, visibleCount, 0, 0] for drawIndirect
  private ppN: GPUBuffer | null = null;
  private ppNb0: GPUBuffer | null = null;
  private ppNb1: GPUBuffer | null = null;
  private rParams: GPUBuffer[] = [];

  private scanHistBG: GPUBindGroup | null = null;
  private scanBs0BG: GPUBindGroup | null = null;
  private scanBs1BG: GPUBindGroup | null = null;
  private addBs0BG: GPUBindGroup | null = null;
  private addHistBG: GPUBindGroup | null = null;
  private orderRef: GPUBuffer | null = null;
  private histBG: GPUBindGroup[] = [];
  private scatterBG: GPUBindGroup[] = [];

  private count = 0;
  private numGroups = 0;
  private histLen = 0;
  private nb0 = 0;
  private nb1 = 0;
  private nb2 = 0;

  constructor(private readonly device: GPUDevice) {}

  /**
   * `drawIndirect` argument buffer whose `instanceCount` is the number of splats
   * in front of the eye, written by the most recent {@link sort}. Valid only
   * together with the order buffer that same sort produced.
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
      hist: cp(HIST_SHADER, "histogram"),
      scatter: cp(SCATTER_SHADER, "scatter"),
      scan: cp(SCAN_SHADER, "scan_blocks"),
      add: cp(ADD_SHADER, "add_offsets"),
    };
    return this.pipelines;
  }

  private makeStorage(bytes: number): GPUBuffer {
    return this.device.createBuffer({
      size: Math.max(bytes, 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  private makeUniform(values: readonly number[]): GPUBuffer {
    // 32 bytes: PrefixParams `{ n:u32, _pad:vec3<u32> }` is 32B in WGSL (the
    // vec3 aligns to offset 16), so its uniform binding requires ≥32 bytes.
    const buf = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const a = new Uint32Array(8);
    a.set(values);
    this.device.queue.writeBuffer(buf, 0, a);
    return buf;
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
    this.histLen = RADIX * this.numGroups;
    this.nb0 = ceilDiv(this.histLen, SCAN_BLOCK);
    this.nb1 = ceilDiv(this.nb0, SCAN_BLOCK);
    this.nb2 = ceilDiv(this.nb1, SCAN_BLOCK);

    this.keys = this.makeStorage(count * 4);
    this.scratch = this.makeStorage(count * 4);
    this.groupHist = this.makeStorage(this.histLen * 4);
    this.bs0 = this.makeStorage(this.nb0 * 4);
    this.bs1 = this.makeStorage(this.nb1 * 4);
    this.bs2 = this.makeStorage(this.nb2 * 4);
    this.depthParams = this.device.createBuffer({
      size: DEPTH_PARAMS_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.drawArgs = this.device.createBuffer({
      size: DRAW_ARGS_RESET.byteLength,
      usage:
        GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Size-dependent uniforms: written ONCE here, never per-frame.
    this.ppN = this.makeUniform([this.histLen]);
    this.ppNb0 = this.makeUniform([this.nb0]);
    this.ppNb1 = this.makeUniform([this.nb1]);
    this.rParams = [];
    for (let p = 0; p < KEY_PASSES; p++) {
      this.rParams.push(this.makeUniform([count, p * 8, this.numGroups, 0]));
    }

    const bg = (pipe: GPUComputePipeline, bufs: GPUBuffer[]): GPUBindGroup =>
      this.device.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: bufs.map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
    this.scanHistBG = bg(pipes.scan, [this.ppN, this.groupHist, this.bs0]);
    this.scanBs0BG = bg(pipes.scan, [this.ppNb0, this.bs0, this.bs1]);
    this.scanBs1BG = bg(pipes.scan, [this.ppNb1, this.bs1, this.bs2]);
    this.addBs0BG = bg(pipes.add, [this.ppNb0, this.bs0, this.bs1]);
    this.addHistBG = bg(pipes.add, [this.ppN, this.groupHist, this.bs0]);
  }

  /** (Re)build the bind groups that reference the external order buffer. */
  private ensureOrderBindGroups(orderBuffer: GPUBuffer): void {
    if (this.orderRef === orderBuffer) return;
    this.orderRef = orderBuffer;
    const pipes = this.ensureInit();
    const keys = this.keys!;
    const scratch = this.scratch!;
    const groupHist = this.groupHist!;
    const bg = (pipe: GPUComputePipeline, bufs: GPUBuffer[]): GPUBindGroup =>
      this.device.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: bufs.map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
    this.histBG = [];
    this.scatterBG = [];
    for (let p = 0; p < KEY_PASSES; p++) {
      // Parity chosen so the FINAL pass writes into `orderBuffer` regardless of
      // whether KEY_PASSES is odd or even (pass 0's source is seeded by init()).
      const dstIsOrder = (KEY_PASSES - 1 - p) % 2 === 0;
      const src = dstIsOrder ? scratch : orderBuffer;
      const dst = dstIsOrder ? orderBuffer : scratch;
      const rp = this.rParams[p]!;
      this.histBG.push(bg(pipes.hist, [rp, keys, src, groupHist]));
      this.scatterBG.push(bg(pipes.scatter, [rp, keys, src, groupHist, dst]));
    }
  }

  /** Encode a full exclusive prefix scan of `groupHist` (up to 3 levels). */
  private encodeScan(encoder: GPUCommandEncoder, pipes: SortPipelines): void {
    // Each dependent step runs in its OWN compute pass: WebGPU only guarantees
    // storage visibility BETWEEN passes, not between dispatches within one pass.
    const step = (pipeline: GPUComputePipeline, group: GPUBindGroup, groups: number): void => {
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      dispatchLinear(pass, groups);
      pass.end();
    };
    step(pipes.scan, this.scanHistBG!, this.nb0);
    if (this.nb0 > 1) {
      step(pipes.scan, this.scanBs0BG!, this.nb1);
      if (this.nb1 > 1) {
        step(pipes.scan, this.scanBs1BG!, this.nb2); // nb2 === 1 → bs1 fully scanned
        step(pipes.add, this.addBs0BG!, ceilDiv(this.nb0, WORKGROUP_SIZE));
      }
      step(pipes.add, this.addHistBG!, ceilDiv(this.histLen, WORKGROUP_SIZE));
    }
  }

  /**
   * Encode the stable radix sort into `encoder` (before the render pass).
   * Writes the back-to-front index order into `orderBuffer`. `minDepth`/`maxDepth`
   * bound the 24-bit normalized depth key (splats outside clamp to the extremes).
   */
  sort(
    encoder: GPUCommandEncoder,
    positionsBuffer: GPUBuffer,
    orderBuffer: GPUBuffer,
    camPos: readonly [number, number, number],
    viewDir: readonly [number, number, number],
    minDepth: number,
    maxDepth: number,
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
    f[8] = minDepth; f[9] = maxDepth;
    this.device.queue.writeBuffer(this.depthParams!, 0, dp);
    // Queue writes are ordered before command buffers submitted afterwards, so the
    // counter is guaranteed zero when the key pass below starts accumulating.
    this.device.queue.writeBuffer(this.drawArgs!, 0, DRAW_ARGS_RESET);

    // init: seed keys + reset the identity permutation into pass 0's source
    // buffer (scratch when KEY_PASSES is odd, else the order buffer) so the final
    // pass lands in `orderBuffer`. Needs `positions`, so bound here not in resize().
    const initTarget = INIT_TO_SCRATCH ? this.scratch! : orderBuffer;
    const initBG = this.device.createBindGroup({
      layout: pipes.init.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.depthParams! } },
        { binding: 1, resource: { buffer: positionsBuffer } },
        { binding: 2, resource: { buffer: this.keys } },
        { binding: 3, resource: { buffer: initTarget } },
        { binding: 4, resource: { buffer: this.drawArgs! } },
      ],
    });
    const initPass = encoder.beginComputePass();
    initPass.setPipeline(pipes.init);
    initPass.setBindGroup(0, initBG);
    dispatchLinear(initPass, ceilDiv(this.count, WORKGROUP_SIZE));
    initPass.end();

    for (let p = 0; p < KEY_PASSES; p++) {
      const histPass = encoder.beginComputePass();
      histPass.setPipeline(pipes.hist);
      histPass.setBindGroup(0, this.histBG[p]!);
      dispatchLinear(histPass, this.numGroups);
      histPass.end();

      this.encodeScan(encoder, pipes);

      const scatterPass = encoder.beginComputePass();
      scatterPass.setPipeline(pipes.scatter);
      scatterPass.setBindGroup(0, this.scatterBG[p]!);
      dispatchLinear(scatterPass, this.numGroups);
      scatterPass.end();
    }
    // Parity is chosen in ensureOrderBindGroups so the final pass lands in `orderBuffer`.
  }

  private releaseBuffers(): void {
    for (const buf of [this.keys, this.scratch, this.groupHist, this.bs0, this.bs1, this.bs2, this.depthParams, this.drawArgs, this.ppN, this.ppNb0, this.ppNb1, ...this.rParams]) {
      buf?.destroy();
    }
    this.keys = this.scratch = this.groupHist = null;
    this.bs0 = this.bs1 = this.bs2 = null;
    this.depthParams = this.drawArgs = null;
    this.ppN = this.ppNb0 = this.ppNb1 = null;
    this.rParams = [];
    this.scanHistBG = this.scanBs0BG = this.scanBs1BG = null;
    this.addBs0BG = this.addHistBG = null;
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
