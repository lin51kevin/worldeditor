/**
 * Deprecated GPU Compute Sort for 3D Gaussian Splatting.
 *
 * @deprecated Disabled: its depth pass reads the legacy packed splat storage
 * buffer. The active texture-array renderer sorts positions in a worker and
 * uploads one global order buffer. Do not reconnect this implementation without
 * replacing its packed attribute binding with the texture addressing contract.
 *
 * Replaces the CPU 16-bit counting sort with a per-frame GPU sort that runs
 * inside the same command encoder as the render pass. This eliminates the async
 * delay of the worker-based sort and provides perfect 32-bit depth ordering.
 *
 * Algorithm: 3-pass counting sort
 *   Pass 1 — Depth & bucket assignment: compute depth per splat, quantize to
 *            bucket, atomicAdd to histogram, store bucket per splat.
 *   Pass 2 — Prefix sum: exclusive scan of the histogram (bottom-up + top-down
 *            in shared memory, multi-level for >WORKGROUP_SIZE buckets).
 *   Pass 3 — Scatter: write each splat's index to its sorted output slot,
 *            back-to-front (largest depth first).
 */

/** Number of sort buckets — higher = better depth precision. */
const BUCKET_COUNT = 65536;
/** Must match the WGSL `WORKGROUP_SIZE` constant. */
const WORKGROUP_SIZE = 256;

// ─── WGSL Compute Shaders ─────────────────────────────────────────────────────

const DEPTH_SHADER = /* wgsl */ `
// Pass 1: Compute per-splat depth, assign bucket, build histogram.

struct SortParams {
  cam_pos   : vec3<f32>,
  count     : u32,
  view_dir  : vec3<f32>,
  stride    : u32,
  min_depth : f32,
  inv_range : f32,
  _pad      : vec2<f32>,
};

@group(0) @binding(0) var<uniform>       params    : SortParams;
@group(0) @binding(1) var<storage, read>  splats    : array<u32>;
@group(0) @binding(2) var<storage, read_write> histogram : array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> buckets   : array<u32>;

const BUCKET_COUNT : u32 = ${BUCKET_COUNT}u;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn depth_main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) { return; }

  // Read position (first 3 f32 words of the splat record).
  let base = i * params.stride;
  let px = bitcast<f32>(splats[base]);
  let py = bitcast<f32>(splats[base + 1u]);
  let pz = bitcast<f32>(splats[base + 2u]);

  // View-space depth: dot(viewDir, pos - camPos).
  let dx = px - params.cam_pos.x;
  let dy = py - params.cam_pos.y;
  let dz = pz - params.cam_pos.z;
  let depth = dx * params.view_dir.x + dy * params.view_dir.y + dz * params.view_dir.z;

  // Quantize to bucket [0, BUCKET_COUNT-1], REVERSED so bucket 0 = farthest.
  // This ensures the prefix sum matches the back-to-front scatter order.
  let t = (depth - params.min_depth) * params.inv_range;
  var b = BUCKET_COUNT - 1u - u32(clamp(t, 0.0, f32(BUCKET_COUNT - 1u)));
  buckets[i] = b;
  atomicAdd(&histogram[b], 1u);
}
`;

const PREFIX_SUM_SHADER = /* wgsl */ `
// Pass 2: Work-efficient exclusive prefix sum on the histogram.
// Processes BUCKET_COUNT elements using a two-level approach:
//   Level 1: Each workgroup scans a block of WG_SIZE*2 elements.
//   Level 2: A single workgroup scans the block sums.
//   Level 3: Add block offsets back.

struct PrefixParams {
  n        : u32,
  _pad     : vec3<u32>,
};

@group(0) @binding(0) var<uniform>             prefix_params : PrefixParams;
@group(0) @binding(1) var<storage, read_write> data          : array<u32>;
@group(0) @binding(2) var<storage, read_write> block_sums    : array<u32>;

const WG_SIZE : u32 = ${WORKGROUP_SIZE}u;
const BLOCK   : u32 = ${WORKGROUP_SIZE * 2}u;

var<workgroup> shmem : array<u32, ${WORKGROUP_SIZE * 2}>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn scan_blocks(@builtin(global_invocation_id) gid : vec3<u32>,
               @builtin(local_invocation_id) lid : vec3<u32>,
               @builtin(workgroup_id) wid : vec3<u32>) {
  let block_offset = wid.x * BLOCK;
  let idx0 = block_offset + lid.x;
  let idx1 = block_offset + lid.x + WG_SIZE;

  // Load into shared memory.
  shmem[lid.x]          = select(0u, data[idx0], idx0 < prefix_params.n);
  shmem[lid.x + WG_SIZE] = select(0u, data[idx1], idx1 < prefix_params.n);
  workgroupBarrier();

  // Up-sweep (reduce).
  var offset = 1u;
  for (var d = BLOCK >> 1u; d > 0u; d >>= 1u) {
    workgroupBarrier();
    if (lid.x < d) {
      let ai = offset * (2u * lid.x + 1u) - 1u;
      let bi = offset * (2u * lid.x + 2u) - 1u;
      shmem[bi] += shmem[ai];
    }
    offset <<= 1u;
  }

  // Store block sum and clear last element.
  if (lid.x == 0u) {
    block_sums[wid.x] = shmem[BLOCK - 1u];
    shmem[BLOCK - 1u] = 0u;
  }
  workgroupBarrier();

  // Down-sweep.
  for (var d = 1u; d < BLOCK; d <<= 1u) {
    offset >>= 1u;
    workgroupBarrier();
    if (lid.x < d) {
      let ai = offset * (2u * lid.x + 1u) - 1u;
      let bi = offset * (2u * lid.x + 2u) - 1u;
      let t = shmem[ai];
      shmem[ai] = shmem[bi];
      shmem[bi] += t;
    }
  }
  workgroupBarrier();

  // Write back.
  if (idx0 < prefix_params.n) { data[idx0] = shmem[lid.x]; }
  if (idx1 < prefix_params.n) { data[idx1] = shmem[lid.x + WG_SIZE]; }
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn scan_top(@builtin(local_invocation_id) lid : vec3<u32>) {
  // Scan the block_sums array (fits in one workgroup for <= 512 blocks).
  let n = prefix_params.n;
  shmem[lid.x]          = select(0u, block_sums[lid.x],          lid.x < n);
  shmem[lid.x + WG_SIZE] = select(0u, block_sums[lid.x + WG_SIZE], lid.x + WG_SIZE < n);
  workgroupBarrier();

  var offset = 1u;
  for (var d = BLOCK >> 1u; d > 0u; d >>= 1u) {
    workgroupBarrier();
    if (lid.x < d) {
      let ai = offset * (2u * lid.x + 1u) - 1u;
      let bi = offset * (2u * lid.x + 2u) - 1u;
      if (bi < BLOCK) { shmem[bi] += shmem[ai]; }
    }
    offset <<= 1u;
  }
  if (lid.x == 0u) { shmem[BLOCK - 1u] = 0u; }
  workgroupBarrier();
  for (var d = 1u; d < BLOCK; d <<= 1u) {
    offset >>= 1u;
    workgroupBarrier();
    if (lid.x < d) {
      let ai = offset * (2u * lid.x + 1u) - 1u;
      let bi = offset * (2u * lid.x + 2u) - 1u;
      if (bi < BLOCK) {
        let t = shmem[ai];
        shmem[ai] = shmem[bi];
        shmem[bi] += t;
      }
    }
  }
  workgroupBarrier();
  if (lid.x < n)          { block_sums[lid.x] = shmem[lid.x]; }
  if (lid.x + WG_SIZE < n) { block_sums[lid.x + WG_SIZE] = shmem[lid.x + WG_SIZE]; }
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn add_block_offsets(@builtin(global_invocation_id) gid : vec3<u32>,
                     @builtin(workgroup_id) wid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= prefix_params.n) { return; }
  data[idx] += block_sums[wid.x / 2u];  // Each dispatch covers BLOCK elements per workgroup
}
`;

const ADD_OFFSETS_SHADER = /* wgsl */ `
// Pass 2b: Add scanned block sums back to each element.
struct PrefixParams {
  n    : u32,
  _pad : vec3<u32>,
};

@group(0) @binding(0) var<uniform>             prefix_params : PrefixParams;
@group(0) @binding(1) var<storage, read_write> data          : array<u32>;
@group(0) @binding(2) var<storage, read>       block_sums    : array<u32>;

const BLOCK : u32 = ${WORKGROUP_SIZE * 2}u;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn add_offsets(@builtin(global_invocation_id) gid : vec3<u32>,
              @builtin(workgroup_id) wid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= prefix_params.n) { return; }
  data[idx] += block_sums[wid.x / 2u];
}
`;

const SCATTER_SHADER = /* wgsl */ `
// Pass 3: Scatter splat indices into sorted order (back-to-front).
// Buckets were assigned in reverse order by the depth pass (0 = farthest),
// so the prefix-summed histogram directly gives back-to-front positions.

struct SortParams {
  cam_pos   : vec3<f32>,
  count     : u32,
  view_dir  : vec3<f32>,
  stride    : u32,
  min_depth : f32,
  inv_range : f32,
  _pad      : vec2<f32>,
};

@group(0) @binding(0) var<uniform>             params    : SortParams;
@group(0) @binding(1) var<storage, read>       buckets   : array<u32>;
@group(0) @binding(2) var<storage, read_write> offsets   : array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> output    : array<u32>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn scatter_main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) { return; }

  let b = buckets[i];
  // Buckets are already reversed in the depth pass (0 = farthest),
  // so the prefix sum directly gives back-to-front output positions.
  let pos = atomicAdd(&offsets[b], 1u);
  output[pos] = i;
}
`;

// ─── GPU Sort Class ───────────────────────────────────────────────────────────

/** Uniform buffer layout for the sort params (48 bytes, std140 aligned). */
const SORT_PARAMS_SIZE = 48; // 3+1+3+1+1+1+2 = 12 floats × 4 bytes

/**
 * GPU-based counting sort for Gaussian splats.
 *
 * Runs entirely on the GPU within a single command encoder submission. The
 * sorted index order is written directly to the provided output buffer (the
 * render pipeline's `orderBuffer`), so there is zero CPU↔GPU round-trip and the
 * result is available in the same frame.
 */
/** @deprecated See the module note; not used by `SplatRenderer`. */
export class GpuSplatSorter {
  private depthPipeline!: GPUComputePipeline;
  private scanBlocksPipeline!: GPUComputePipeline;
  private scanTopPipeline!: GPUComputePipeline;
  private addOffsetsPipeline!: GPUComputePipeline;
  private scatterPipeline!: GPUComputePipeline;

  private paramsBuffer!: GPUBuffer;
  private prefixParamsBuffer!: GPUBuffer;
  private histogramBuffer!: GPUBuffer;
  private bucketsBuffer: GPUBuffer | null = null;
  private blockSumsBuffer!: GPUBuffer;
  private topBlockSumsBuffer!: GPUBuffer;

  private depthBindGroupLayout!: GPUBindGroupLayout;
  private prefixBindGroupLayout!: GPUBindGroupLayout;
  private addOffsetsBindGroupLayout!: GPUBindGroupLayout;
  private scatterBindGroupLayout!: GPUBindGroupLayout;

  private count = 0;
  private stride = 0;
  private initialized = false;

  constructor(private readonly device: GPUDevice) {}

  /** Lazily create all GPU pipelines and buffers on first use. */
  private ensureInit(): void {
    if (this.initialized) return;
    this.initialized = true;
    const device = this.device;
    // ── Depth pass pipeline ─────────────────────────────────────────────────
    const depthModule = device.createShaderModule({ code: DEPTH_SHADER });
    this.depthBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    this.depthPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.depthBindGroupLayout] }),
      compute: { module: depthModule, entryPoint: "depth_main" },
    });

    // ── Prefix sum pipelines ────────────────────────────────────────────────
    const prefixModule = device.createShaderModule({ code: PREFIX_SUM_SHADER });
    this.prefixBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    this.scanBlocksPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.prefixBindGroupLayout] }),
      compute: { module: prefixModule, entryPoint: "scan_blocks" },
    });
    this.scanTopPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.prefixBindGroupLayout] }),
      compute: { module: prefixModule, entryPoint: "scan_top" },
    });

    // ── Add offsets pipeline ────────────────────────────────────────────────
    const addOffsetsModule = device.createShaderModule({ code: ADD_OFFSETS_SHADER });
    this.addOffsetsBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      ],
    });
    this.addOffsetsPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.addOffsetsBindGroupLayout] }),
      compute: { module: addOffsetsModule, entryPoint: "add_offsets" },
    });

    // ── Scatter pipeline ────────────────────────────────────────────────────
    const scatterModule = device.createShaderModule({ code: SCATTER_SHADER });
    this.scatterBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    this.scatterPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.scatterBindGroupLayout] }),
      compute: { module: scatterModule, entryPoint: "scatter_main" },
    });

    // ── Shared buffers ──────────────────────────────────────────────────────
    this.paramsBuffer = device.createBuffer({
      size: SORT_PARAMS_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.prefixParamsBuffer = device.createBuffer({
      size: 32, // PrefixParams: u32 n (offset 0) + vec3<u32> _pad (offset 16) = 32 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.histogramBuffer = device.createBuffer({
      size: BUCKET_COUNT * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    // Block sums for prefix scan: ceil(BUCKET_COUNT / (WG_SIZE*2)) entries.
    const numBlocks = Math.ceil(BUCKET_COUNT / (WORKGROUP_SIZE * 2));
    this.blockSumsBuffer = device.createBuffer({
      size: Math.max(numBlocks * 4, 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    // Persistent buffer for the top-level block sums scan (avoids per-frame create/destroy).
    this.topBlockSumsBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * Allocate the per-splat bucket buffer sized for `count` splats.
   * Called when the splat count changes (on upload).
   */
  resize(count: number, stride: number): void {
    if (count === this.count && stride === this.stride) return;
    this.count = count;
    this.stride = stride;
    this.bucketsBuffer?.destroy();
    this.bucketsBuffer = null;
    if (count === 0) return;
    this.bucketsBuffer = this.device.createBuffer({
      size: Math.max(count * 4, 4),
      usage: GPUBufferUsage.STORAGE,
    });
  }

  /**
   * Encode the 3-pass GPU sort into the provided command encoder.
   *
   * @param encoder  Active command encoder (sort runs before the render pass).
   * @param splatBuffer  The packed splat storage buffer (positions at word 0-2).
   * @param orderBuffer  Output: sorted index buffer written by the scatter pass.
   * @param camPos   Camera world position.
   * @param viewDir  Normalized view direction (target - position).
   * @param positions  CPU-side positions for depth range computation (cheap one-time scan).
   */
  sort(
    encoder: GPUCommandEncoder,
    splatBuffer: GPUBuffer,
    orderBuffer: GPUBuffer,
    camPos: readonly [number, number, number],
    viewDir: readonly [number, number, number],
    positions: Float32Array,
  ): void {
    this.ensureInit();
    const n = this.count;
    if (n === 0 || !this.bucketsBuffer) return;

    // ── Compute depth range on CPU (fast scan, <1ms for 8M positions) ───────
    let minD = Infinity;
    let maxD = -Infinity;
    const [cx, cy, cz] = camPos;
    const [vx, vy, vz] = viewDir;
    for (let i = 0; i < n; i++) {
      const d =
        (positions[i * 3]! - cx) * vx +
        (positions[i * 3 + 1]! - cy) * vy +
        (positions[i * 3 + 2]! - cz) * vz;
      if (d < minD) minD = d;
      if (d > maxD) maxD = d;
    }
    if (!(maxD > minD)) { maxD = minD + 1; }
    const invRange = (BUCKET_COUNT - 1) / (maxD - minD);

    // ── Upload sort params uniform ──────────────────────────────────────────
    const params = new Float32Array(12);
    params[0] = cx; params[1] = cy; params[2] = cz;
    new Uint32Array(params.buffer)[3] = n;
    params[4] = vx; params[5] = vy; params[6] = vz;
    new Uint32Array(params.buffer)[7] = this.stride;
    params[8] = minD;
    params[9] = invRange;
    this.device.queue.writeBuffer(this.paramsBuffer, 0, params);

    // Clear histogram.
    const zeros = new Uint32Array(BUCKET_COUNT);
    this.device.queue.writeBuffer(this.histogramBuffer, 0, zeros);

    // Prefix params: n = BUCKET_COUNT.
    const pp = new Uint32Array(4);
    pp[0] = BUCKET_COUNT;
    this.device.queue.writeBuffer(this.prefixParamsBuffer, 0, pp);

    // ── Pass 1: Depth + histogram ───────────────────────────────────────────
    const depthBG = this.device.createBindGroup({
      layout: this.depthBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: { buffer: splatBuffer } },
        { binding: 2, resource: { buffer: this.histogramBuffer } },
        { binding: 3, resource: { buffer: this.bucketsBuffer } },
      ],
    });
    const pass1 = encoder.beginComputePass();
    pass1.setPipeline(this.depthPipeline);
    pass1.setBindGroup(0, depthBG);
    pass1.dispatchWorkgroups(Math.ceil(n / WORKGROUP_SIZE));
    pass1.end();

    // ── Pass 2: Prefix sum on histogram ─────────────────────────────────────
    const BLOCK = WORKGROUP_SIZE * 2;
    const numBlocks = Math.ceil(BUCKET_COUNT / BLOCK);

    // Clear block sums.
    const blockZeros = new Uint32Array(numBlocks);
    this.device.queue.writeBuffer(this.blockSumsBuffer, 0, blockZeros);

    // 2a: Scan each block of the histogram.
    const scanBG = this.device.createBindGroup({
      layout: this.prefixBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.prefixParamsBuffer } },
        { binding: 1, resource: { buffer: this.histogramBuffer } },
        { binding: 2, resource: { buffer: this.blockSumsBuffer } },
      ],
    });
    const pass2a = encoder.beginComputePass();
    pass2a.setPipeline(this.scanBlocksPipeline);
    pass2a.setBindGroup(0, scanBG);
    pass2a.dispatchWorkgroups(numBlocks);
    pass2a.end();

    // 2b: Scan the block sums (single workgroup — numBlocks must be <= BLOCK).
    if (numBlocks > 1) {
      // Update prefix params for block sums count.
      const bsp = new Uint32Array(4);
      bsp[0] = numBlocks;
      this.device.queue.writeBuffer(this.prefixParamsBuffer, 0, bsp);

      // Clear and reuse the persistent top-block-sums buffer.
      const topZero = new Uint32Array(4);
      this.device.queue.writeBuffer(this.topBlockSumsBuffer, 0, topZero);

      const scanTopBG = this.device.createBindGroup({
        layout: this.prefixBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.prefixParamsBuffer } },
          { binding: 1, resource: { buffer: this.blockSumsBuffer } },
          { binding: 2, resource: { buffer: this.topBlockSumsBuffer } },
        ],
      });
      const pass2b = encoder.beginComputePass();
      pass2b.setPipeline(this.scanTopPipeline);
      pass2b.setBindGroup(0, scanTopBG);
      pass2b.dispatchWorkgroups(1);
      pass2b.end();

      // 2c: Add block offsets back to each histogram element.
      // Restore prefix params to full histogram size.
      const hpp = new Uint32Array(4);
      hpp[0] = BUCKET_COUNT;
      this.device.queue.writeBuffer(this.prefixParamsBuffer, 0, hpp);

      const addBG = this.device.createBindGroup({
        layout: this.addOffsetsBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.prefixParamsBuffer } },
          { binding: 1, resource: { buffer: this.histogramBuffer } },
          { binding: 2, resource: { buffer: this.blockSumsBuffer } },
        ],
      });
      const pass2c = encoder.beginComputePass();
      pass2c.setPipeline(this.addOffsetsPipeline);
      pass2c.setBindGroup(0, addBG);
      pass2c.dispatchWorkgroups(Math.ceil(BUCKET_COUNT / WORKGROUP_SIZE));
      pass2c.end();
    }

    // ── Pass 3: Scatter (back-to-front) ─────────────────────────────────────
    const scatterBG = this.device.createBindGroup({
      layout: this.scatterBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: { buffer: this.bucketsBuffer } },
        { binding: 2, resource: { buffer: this.histogramBuffer } }, // now contains prefix sums = offsets
        { binding: 3, resource: { buffer: orderBuffer } },
      ],
    });
    const pass3 = encoder.beginComputePass();
    pass3.setPipeline(this.scatterPipeline);
    pass3.setBindGroup(0, scatterBG);
    pass3.dispatchWorkgroups(Math.ceil(n / WORKGROUP_SIZE));
    pass3.end();
  }

  dispose(): void {
    this.bucketsBuffer?.destroy();
    this.bucketsBuffer = null;
    this.count = 0;
    this.stride = 0;
    if (!this.initialized) return;
    this.paramsBuffer.destroy();
    this.prefixParamsBuffer.destroy();
    this.histogramBuffer.destroy();
    this.blockSumsBuffer.destroy();
    this.topBlockSumsBuffer.destroy();
    this.initialized = false;
  }
}
