/**
 * GPU stable depth sort for 3D Gaussian Splatting.
 *
 * Per-frame GPU sort that runs inside the render command encoder, eliminating
 * the worker round-trip latency that caused stale/blurry frames during chase/
 * front-cam playback.
 *
 * ## Algorithm: stable 8-bit-digit LSD radix over the FULL 32-bit depth key
 * Each splat's view depth is mapped to a radix-sortable u32 (exact, no bucketing)
 * so the back-to-front order is precise — matching the CPU sort's sharpness
 * (a coarser 16-bit key blends equal-bucket splats in index order → haze). Four
 * 8-bit passes; each pass:
 *   1. histogram — per-workgroup 256-bin digit counts → digit-major group table;
 *   2. scan      — exclusive prefix over the group table (proven multi-level scan);
 *   3. scatter   — each splat to base[digit,group] + stable local rank.
 * The scatter position comes from a prefix sum (never an atomic race), so the
 * order is a deterministic, stable function of the keys — identical every frame
 * for the same camera, smooth under motion (no twinkle).
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
/** Digit radix (8 bits) and the number of passes to cover a 32-bit key. */
const RADIX = 256;
const KEY_PASSES = 4;

const ceilDiv = (a: number, b: number): number => Math.floor((a + b - 1) / b);

// ─── WGSL (verbatim from the validated harness) ──────────────────────────────

const INIT_SHADER = /* wgsl */ `
struct DepthParams { cam:vec3<f32>, count:u32, view:vec3<f32>, _pad:u32 };
@group(0) @binding(0) var<uniform> params : DepthParams;
@group(0) @binding(1) var<storage, read> positions : array<f32>;
@group(0) @binding(2) var<storage, read_write> keys : array<u32>;
@group(0) @binding(3) var<storage, read_write> order : array<u32>;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn init_keys(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) { return; }
  let b = i * 3u;
  let dx = positions[b] - params.cam.x;
  let dy = positions[b+1u] - params.cam.y;
  let dz = positions[b+2u] - params.cam.z;
  let depth = dx*params.view.x + dy*params.view.y + dz*params.view.z;
  // Radix-sortable u32 of the float depth (ascending), then bit-inverted so an
  // ASCENDING sort draws the FARTHEST splat first (back-to-front). Full precision.
  let u = bitcast<u32>(depth);
  let af = select(u | 0x80000000u, ~u, (u >> 31u) == 1u);
  keys[i] = ~af;
  order[i] = i;
}`;

const HIST_SHADER = /* wgsl */ `
struct RParams { count:u32, shift:u32, num_groups:u32, _pad:u32 };
@group(0) @binding(0) var<uniform> rp : RParams;
@group(0) @binding(1) var<storage, read> keys : array<u32>;
@group(0) @binding(2) var<storage, read> order : array<u32>;
@group(0) @binding(3) var<storage, read_write> group_hist : array<u32>;
var<workgroup> counts : array<atomic<u32>, ${RADIX}>;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn histogram(@builtin(local_invocation_id) lid : vec3<u32>, @builtin(workgroup_id) wid : vec3<u32>, @builtin(global_invocation_id) gid : vec3<u32>) {
  atomicStore(&counts[lid.x], 0u);
  workgroupBarrier();
  let i = gid.x;
  if (i < rp.count) {
    let d = (keys[order[i]] >> rp.shift) & 0xFFu;
    atomicAdd(&counts[d], 1u);
  }
  workgroupBarrier();
  // Digit-major layout: [digit * num_groups + group].
  group_hist[lid.x * rp.num_groups + wid.x] = atomicLoad(&counts[lid.x]);
}`;

const SCATTER_SHADER = /* wgsl */ `
struct RParams { count:u32, shift:u32, num_groups:u32, _pad:u32 };
@group(0) @binding(0) var<uniform> rp : RParams;
@group(0) @binding(1) var<storage, read> keys : array<u32>;
@group(0) @binding(2) var<storage, read> order_src : array<u32>;
@group(0) @binding(3) var<storage, read> group_base : array<u32>;
@group(0) @binding(4) var<storage, read_write> order_dst : array<u32>;
var<workgroup> sdig : array<u32, ${WORKGROUP_SIZE}>;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn scatter(@builtin(local_invocation_id) lid : vec3<u32>, @builtin(workgroup_id) wid : vec3<u32>, @builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  var d = 0xFFFFFFFFu;
  var e = 0u;
  if (i < rp.count) { e = order_src[i]; d = (keys[e] >> rp.shift) & 0xFFu; }
  sdig[lid.x] = d;
  workgroupBarrier();
  if (i >= rp.count) { return; }
  // Stable local rank: # of earlier threads in this group with the same digit.
  var rank = 0u;
  for (var t = 0u; t < lid.x; t = t + 1u) { if (sdig[t] == d) { rank = rank + 1u; } }
  order_dst[group_base[d * rp.num_groups + wid.x] + rank] = e;
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
  let block_offset = wid.x * BLOCK;
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
  if (lid.x == 0u) { block_sums[wid.x] = shmem[BLOCK - 1u]; shmem[BLOCK - 1u] = 0u; }
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
fn add_offsets(@builtin(global_invocation_id) gid : vec3<u32>, @builtin(workgroup_id) wid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= prefix_params.n) { return; }
  data[idx] += block_sums[wid.x / 2u];
}`;

const DEPTH_PARAMS_SIZE = 32;

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
      // Even pass → source is the order buffer; odd pass → source is the scratch.
      const src = p % 2 === 0 ? orderBuffer : scratch;
      const dst = p % 2 === 0 ? scratch : orderBuffer;
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
      pass.dispatchWorkgroups(groups);
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
   * are unused (the key is full-precision), kept for a stable call signature.
   */
  sort(
    encoder: GPUCommandEncoder,
    positionsBuffer: GPUBuffer,
    orderBuffer: GPUBuffer,
    camPos: readonly [number, number, number],
    viewDir: readonly [number, number, number],
    _minDepth: number,
    _maxDepth: number,
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
    this.device.queue.writeBuffer(this.depthParams!, 0, dp);

    // init: seed keys + reset the order buffer to identity (needs the positions
    // buffer, so this bind group is built here rather than in resize()).
    const initBG = this.device.createBindGroup({
      layout: pipes.init.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.depthParams! } },
        { binding: 1, resource: { buffer: positionsBuffer } },
        { binding: 2, resource: { buffer: this.keys } },
        { binding: 3, resource: { buffer: orderBuffer } },
      ],
    });
    const initPass = encoder.beginComputePass();
    initPass.setPipeline(pipes.init);
    initPass.setBindGroup(0, initBG);
    initPass.dispatchWorkgroups(ceilDiv(this.count, WORKGROUP_SIZE));
    initPass.end();

    for (let p = 0; p < KEY_PASSES; p++) {
      const histPass = encoder.beginComputePass();
      histPass.setPipeline(pipes.hist);
      histPass.setBindGroup(0, this.histBG[p]!);
      histPass.dispatchWorkgroups(this.numGroups);
      histPass.end();

      this.encodeScan(encoder, pipes);

      const scatterPass = encoder.beginComputePass();
      scatterPass.setPipeline(pipes.scatter);
      scatterPass.setBindGroup(0, this.scatterBG[p]!);
      scatterPass.dispatchWorkgroups(this.numGroups);
      scatterPass.end();
    }
    // KEY_PASSES is even, so the final order lands in `orderBuffer`.
  }

  private releaseBuffers(): void {
    for (const buf of [this.keys, this.scratch, this.groupHist, this.bs0, this.bs1, this.bs2, this.depthParams, this.ppN, this.ppNb0, this.ppNb1, ...this.rParams]) {
      buf?.destroy();
    }
    this.keys = this.scratch = this.groupHist = null;
    this.bs0 = this.bs1 = this.bs2 = null;
    this.depthParams = this.ppN = this.ppNb0 = this.ppNb1 = null;
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
