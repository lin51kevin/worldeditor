/**
 * Linear-time depth sorting for 3D Gaussian Splatting.
 *
 * The primary pass follows the PlayCanvas/SuperSplat sorter: bounds for groups
 * of 256 centers feed a coarse histogram, which assigns more of the adaptive
 * 10-20 bit counting-sort key space to populated depth regions. Small bucket
 * collisions are refined in place; unusually large collisions use a bounded
 * four-pass radix refinement so the final order is strictly back-to-front.
 */

/** A 3-component vector. */
export type Vec3 = readonly [number, number, number];

/** A sorted permutation and the drawable prefix in front of the camera. */
export interface SplatSortResult {
  readonly indices: Uint32Array;
  readonly visibleCount: number;
}

/** Precomputed cloud bounds reused for every camera sort. */
export interface PreparedSplatSort {
  readonly positions: Float32Array;
  /** Per 256 centers: bounding-sphere x, y, z, radius, and center count. */
  readonly chunks: Float32Array;
  readonly boundsMin: Vec3;
  readonly boundsMax: Vec3;
  readonly extent: number;
}

const CHUNK_SIZE = 256;
const HISTOGRAM_BINS = 32;
const INSERTION_LIMIT = 32;

/** Build reusable cloud/chunk bounds in one O(N) pass. */
export function prepareSplatSort(positions: Float32Array): PreparedSplatSort {
  const n = Math.floor(positions.length / 3);
  const chunks = new Float32Array(Math.ceil(n / CHUNK_SIZE) * 5);
  let gx0 = Infinity;
  let gy0 = Infinity;
  let gz0 = Infinity;
  let gx1 = -Infinity;
  let gy1 = -Infinity;
  let gz1 = -Infinity;

  for (let c = 0; c < chunks.length / 5; c++) {
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    const start = c * CHUNK_SIZE;
    const end = Math.min(n, start + CHUNK_SIZE);
    for (let i = start; i < end; i++) {
      const x = positions[i * 3]!;
      const y = positions[i * 3 + 1]!;
      const z = positions[i * 3 + 2]!;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        continue;
      }
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }

    if (!(x1 >= x0)) {
      x0 = y0 = z0 = x1 = y1 = z1 = 0;
    }
    const cx = (x0 + x1) * 0.5;
    const cy = (y0 + y1) * 0.5;
    const cz = (z0 + z1) * 0.5;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    chunks[c * 5] = cx;
    chunks[c * 5 + 1] = cy;
    chunks[c * 5 + 2] = cz;
    chunks[c * 5 + 3] = Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.5;
    chunks[c * 5 + 4] = end - start;

    gx0 = Math.min(gx0, x0);
    gy0 = Math.min(gy0, y0);
    gz0 = Math.min(gz0, z0);
    gx1 = Math.max(gx1, x1);
    gy1 = Math.max(gy1, y1);
    gz1 = Math.max(gz1, z1);
  }

  if (n === 0) {
    gx0 = gy0 = gz0 = gx1 = gy1 = gz1 = 0;
  }
  const ex = gx1 - gx0;
  const ey = gy1 - gy0;
  const ez = gz1 - gz0;
  return {
    positions,
    chunks,
    boundsMin: [gx0, gy0, gz0],
    boundsMax: [gx1, gy1, gz1],
    extent: Math.sqrt(ex * ex + ey * ey + ez * ez),
  };
}

/**
 * View-space depth of every splat: `dot(viewDir, p - camPos)`.
 * `viewDir` is assumed normalized; positions are 3 floats per splat.
 */
export function computeDepths(positions: Float32Array, camPos: Vec3, viewDir: Vec3): Float32Array {
  const n = positions.length / 3;
  const depths = new Float32Array(n);
  const [cx, cy, cz] = camPos;
  const [vx, vy, vz] = viewDir;
  for (let i = 0; i < n; i++) {
    const dx = positions[i * 3]! - cx;
    const dy = positions[i * 3 + 1]! - cy;
    const dz = positions[i * 3 + 2]! - cz;
    depths[i] = dx * vx + dy * vy + dz * vz;
  }
  return depths;
}

/**
 * Adaptive key-space size used by PlayCanvas/SuperSplat:
 * `clamp(round(log2(n / 4)), 10, 20)`.
 */
export function depthBucketCount(n: number): number {
  const bits = Math.max(10, Math.min(20, Math.round(Math.log2(Math.max(1, n / 4)))));
  return 2 ** bits;
}

/**
 * Extract the four *side* frustum planes (left, right, bottom, top) from a
 * column-major view-projection matrix, in world space (Gribb–Hartmann).
 *
 * Returns 16 floats = 4 planes × `(nx, ny, nz, d)`, each normalized so
 * `nx*x + ny*y + nz*z + d` is the signed distance from the plane; a point is
 * inside the frustum when every plane distance is `>= 0`. Near/far planes are
 * intentionally omitted — behind-camera splats are already dropped by the
 * front-facing `visibleCount`, and far splats shrink to sub-pixel and are
 * discarded in the shader.
 */
export function frustumSidePlanes(viewProj: Float32Array): Float32Array {
  const m = viewProj;
  // Rows of the (column-major) matrix: row r = [m[r], m[r+4], m[r+8], m[r+12]].
  const row = (r: number): [number, number, number, number] => [
    m[r]!,
    m[r + 4]!,
    m[r + 8]!,
    m[r + 12]!,
  ];
  const r0 = row(0);
  const r1 = row(1);
  const r3 = row(3);
  const planes = new Float32Array(16);
  const set = (i: number, a: number, b: number, c: number, d: number): void => {
    const len = Math.hypot(a, b, c) || 1;
    planes[i * 4] = a / len;
    planes[i * 4 + 1] = b / len;
    planes[i * 4 + 2] = c / len;
    planes[i * 4 + 3] = d / len;
  };
  set(0, r3[0] + r0[0], r3[1] + r0[1], r3[2] + r0[2], r3[3] + r0[3]); // left
  set(1, r3[0] - r0[0], r3[1] - r0[1], r3[2] - r0[2], r3[3] - r0[3]); // right
  set(2, r3[0] + r1[0], r3[1] + r1[1], r3[2] + r1[2], r3[3] + r1[3]); // bottom
  set(3, r3[0] - r1[0], r3[1] - r1[1], r3[2] - r1[2], r3[3] - r1[3]); // top
  return planes;
}

// Scratch is reused because the same worker repeatedly sorts one cloud. The
// returned order is not cached: its buffer is transferred to the main thread.
let scratchDepths: Float32Array | null = null;
let scratchDepthBits: Uint32Array | null = null;
let scratchBucket: Uint32Array | null = null;
let scratchCounts: Uint32Array | null = null;
let scratchStarts: Uint32Array | null = null;
let scratchOrder: Uint32Array | null = null;
let scratchChunkVis: Uint8Array | null = null;
let scratchPartition: Uint32Array | null = null;
const histogramWeight = new Float64Array(HISTOGRAM_BINS);
const histogramBase = new Uint32Array(HISTOGRAM_BINS);
const histogramBuckets = new Uint32Array(HISTOGRAM_BINS);
const histogramRemainder = new Float64Array(HISTOGRAM_BINS);
const radixCounts = new Uint32Array(256);

function projectedDepthRange(
  prepared: PreparedSplatSort,
  camPos: Vec3,
  viewDir: Vec3,
): readonly [number, number] {
  const cameraDepth = camPos[0] * viewDir[0] + camPos[1] * viewDir[1] + camPos[2] * viewDir[2];
  let minDepth = -cameraDepth;
  let maxDepth = -cameraDepth;
  for (let axis = 0; axis < 3; axis++) {
    const a = prepared.boundsMin[axis]! * viewDir[axis]!;
    const b = prepared.boundsMax[axis]! * viewDir[axis]!;
    minDepth += Math.min(a, b);
    maxDepth += Math.max(a, b);
  }
  return [minDepth, maxDepth];
}

function allocateHistogramBuckets(
  prepared: PreparedSplatSort,
  camPos: Vec3,
  viewDir: Vec3,
  minDepth: number,
  range: number,
  bucketCount: number,
): void {
  histogramWeight.fill(0);
  histogramBuckets.fill(0);
  histogramRemainder.fill(-1);
  const cameraDepth = camPos[0] * viewDir[0] + camPos[1] * viewDir[1] + camPos[2] * viewDir[2];
  const directionLength = Math.hypot(viewDir[0], viewDir[1], viewDir[2]);
  const chunks = prepared.chunks;
  for (let c = 0; c < chunks.length / 5; c++) {
    const depth =
      chunks[c * 5]! * viewDir[0] +
      chunks[c * 5 + 1]! * viewDir[1] +
      chunks[c * 5 + 2]! * viewDir[2] -
      cameraDepth;
    const radius = chunks[c * 5 + 3]! * directionLength;
    const count = chunks[c * 5 + 4]!;
    const first = Math.max(
      0,
      Math.min(
        HISTOGRAM_BINS - 1,
        Math.floor(((depth - radius - minDepth) / range) * HISTOGRAM_BINS),
      ),
    );
    const last = Math.max(
      first,
      Math.min(
        HISTOGRAM_BINS - 1,
        Math.floor(((depth + radius - minDepth) / range) * HISTOGRAM_BINS),
      ),
    );
    const share = count / (last - first + 1);
    for (let bin = first; bin <= last; bin++) histogramWeight[bin]! += share;
  }

  let totalWeight = 0;
  let populated = 0;
  for (let bin = 0; bin < HISTOGRAM_BINS; bin++) {
    totalWeight += histogramWeight[bin]!;
    if (histogramWeight[bin]! > 0) populated++;
  }
  if (!(totalWeight > 0)) {
    histogramWeight.fill(1);
    totalWeight = HISTOGRAM_BINS;
    populated = HISTOGRAM_BINS;
  }

  let remaining = bucketCount - Math.min(bucketCount, populated);
  let assigned = 0;
  for (let bin = 0; bin < HISTOGRAM_BINS; bin++) {
    if (histogramWeight[bin]! <= 0) continue;
    const exact = (histogramWeight[bin]! / totalWeight) * remaining;
    const extra = Math.floor(exact);
    histogramBuckets[bin] = 1 + extra;
    histogramRemainder[bin] = exact - extra;
    assigned += extra;
  }
  remaining -= assigned;
  while (remaining-- > 0) {
    let best = 0;
    for (let bin = 1; bin < HISTOGRAM_BINS; bin++) {
      if (histogramRemainder[bin]! > histogramRemainder[best]!) best = bin;
    }
    histogramBuckets[best]! += 1;
    histogramRemainder[best] = -1;
  }

  let base = 0;
  for (let bin = 0; bin < HISTOGRAM_BINS; bin++) {
    histogramBase[bin] = base;
    base += histogramBuckets[bin]!;
  }
}

function exactDescendingRadix(order: Uint32Array): void {
  if (!scratchOrder || scratchOrder.length !== order.length) {
    scratchOrder = new Uint32Array(order.length);
  }
  const bits = scratchDepthBits!;
  let source = order;
  let target = scratchOrder;
  for (let shift = 0; shift < 32; shift += 8) {
    radixCounts.fill(0);
    for (let i = 0; i < source.length; i++) {
      const raw = bits[source[i]!]!;
      const ascending = raw & 0x80000000 ? ~raw : raw ^ 0x80000000;
      const key = ~ascending >>> 0;
      radixCounts[(key >>> shift) & 0xff]! += 1;
    }
    let prefix = 0;
    for (let i = 0; i < 256; i++) {
      const count = radixCounts[i]!;
      radixCounts[i] = prefix;
      prefix += count;
    }
    for (let i = 0; i < source.length; i++) {
      const index = source[i]!;
      const raw = bits[index]!;
      const ascending = raw & 0x80000000 ? ~raw : raw ^ 0x80000000;
      const key = ~ascending >>> 0;
      const digit = (key >>> shift) & 0xff;
      target[radixCounts[digit]!] = index;
      radixCounts[digit]! += 1;
    }
    const swap = source;
    source = target;
    target = swap;
  }
  if (source !== order) order.set(source);
}

/**
 * Stable-partition the front-facing prefix `indices[0, visibleCount)` so that
 * splats inside the side frustum come first (preserving back-to-front order),
 * and return the count that remain visible. Culling is done per 256-splat
 * chunk (using the prepared bounding spheres) — cheap (one test per chunk) and
 * naturally anti-popping, since a chunk is dropped only when its whole sphere
 * (inflated by a margin) falls outside a plane. Out-of-frustum entries are
 * moved after the prefix (not removed) so the order buffer stays fully valid.
 */
function cullFrontPrefixByFrustum(
  indices: Uint32Array,
  visibleCount: number,
  prepared: PreparedSplatSort,
  planes: Float32Array,
): number {
  const numChunks = Math.floor(prepared.chunks.length / 5);
  if (numChunks === 0) return visibleCount;
  if (!scratchChunkVis || scratchChunkVis.length !== numChunks) {
    scratchChunkVis = new Uint8Array(numChunks);
  }
  const vis = scratchChunkVis;
  const chunks = prepared.chunks;
  // Inflate each chunk radius so splats whose gaussian tails spill past the
  // center bounds are not clipped at the screen edge (conservative = fewer
  // culled, no visible popping).
  const MARGIN = 1.25;
  for (let c = 0; c < numChunks; c++) {
    const cx = chunks[c * 5]!;
    const cy = chunks[c * 5 + 1]!;
    const cz = chunks[c * 5 + 2]!;
    const r = chunks[c * 5 + 3]! * MARGIN;
    let inside = 1;
    for (let p = 0; p < 4; p++) {
      const d =
        planes[p * 4]! * cx +
        planes[p * 4 + 1]! * cy +
        planes[p * 4 + 2]! * cz +
        planes[p * 4 + 3]!;
      if (d < -r) {
        inside = 0;
        break;
      }
    }
    vis[c] = inside;
  }

  if (!scratchPartition || scratchPartition.length < visibleCount) {
    scratchPartition = new Uint32Array(visibleCount);
  }
  const out = scratchPartition;
  let k = 0;
  for (let i = 0; i < visibleCount; i++) {
    const idx = indices[i]!;
    if (vis[(idx / CHUNK_SIZE) | 0]) out[k++] = idx;
  }
  const inCount = k;
  for (let i = 0; i < visibleCount; i++) {
    const idx = indices[i]!;
    if (!vis[(idx / CHUNK_SIZE) | 0]) out[k++] = idx;
  }
  indices.set(out.subarray(0, visibleCount), 0);
  return inCount;
}

/**
 * Return a strict back-to-front permutation and the prefix with depth >= 0.
 *
 * Passing a prepared cloud avoids rebuilding chunk bounds. When omitted, the
 * bounds are prepared for this call (convenient for tests and one-shot users).
 *
 * When `frustum` (four side planes from {@link frustumSidePlanes}) is supplied,
 * front-facing splats outside the view frustum are excluded from the returned
 * `visibleCount` (culled per chunk), reducing the drawn instance count.
 */
export function sortSplatsByDepth(
  positions: Float32Array,
  camPos: Vec3,
  viewDir: Vec3,
  prepared = prepareSplatSort(positions),
  frustum?: Float32Array | null,
): SplatSortResult {
  const n = Math.floor(positions.length / 3);
  const indices = new Uint32Array(n);
  if (n === 0) return { indices, visibleCount: 0 };

  if (!scratchDepths || scratchDepths.length !== n) {
    scratchDepths = new Float32Array(n);
    scratchDepthBits = new Uint32Array(scratchDepths.buffer);
  }
  const depths = scratchDepths;
  let visibleCount = 0;
  const [cx, cy, cz] = camPos;
  const [vx, vy, vz] = viewDir;
  for (let i = 0; i < n; i++) {
    const depth =
      (positions[i * 3]! - cx) * vx +
      (positions[i * 3 + 1]! - cy) * vy +
      (positions[i * 3 + 2]! - cz) * vz;
    depths[i] = depth;
    if (depth >= 0) visibleCount++;
  }
  if (n === 1) {
    indices[0] = 0;
    return { indices, visibleCount };
  }

  const [minDepth, maxDepth] = projectedDepthRange(prepared, camPos, viewDir);
  const range = maxDepth - minDepth;
  if (!(range > 1e-6)) {
    for (let i = 0; i < n; i++) indices[i] = i;
    // Identity order is sufficient when all projected depths are equivalent.
    // Draw the complete set so a tiny cloud crossing depth=0 cannot lose
    // front-facing entries that happen to sit after the visible prefix.
    return { indices, visibleCount: n };
  }

  const bucketCount = depthBucketCount(n);
  if (!scratchBucket || scratchBucket.length !== n) scratchBucket = new Uint32Array(n);
  if (!scratchCounts || scratchCounts.length !== bucketCount) {
    scratchCounts = new Uint32Array(bucketCount);
    scratchStarts = new Uint32Array(bucketCount);
  } else {
    scratchCounts.fill(0);
  }
  const bucket = scratchBucket;
  const counts = scratchCounts;
  const starts = scratchStarts!;

  allocateHistogramBuckets(prepared, camPos, viewDir, minDepth, range, bucketCount);
  const binScale = HISTOGRAM_BINS / range;
  for (let i = 0; i < n; i++) {
    const relative = (depths[i]! - minDepth) * binScale;
    const bin = Math.max(0, Math.min(HISTOGRAM_BINS - 1, Math.floor(relative)));
    const width = Math.max(1, histogramBuckets[bin]!);
    const fraction = Math.max(0, Math.min(0.999999999, relative - bin));
    const key = Math.min(bucketCount - 1, histogramBase[bin]! + Math.floor(fraction * width));
    bucket[i] = key;
    counts[key]! += 1;
  }

  let running = 0;
  for (let key = bucketCount - 1; key >= 0; key--) {
    starts[key] = running;
    running += counts[key]!;
  }
  for (let i = 0; i < n; i++) {
    const key = bucket[i]!;
    indices[starts[key]!] = i;
    starts[key]! += 1;
  }

  // Quantization must never leak into blend order. Refine bounded small groups
  // locally; a pathological collision falls back to four linear radix passes.
  let offset = 0;
  let needsRadix = false;
  for (let key = bucketCount - 1; key >= 0; key--) {
    const count = counts[key]!;
    if (count > INSERTION_LIMIT) {
      needsRadix = true;
      break;
    }
    for (let i = offset + 1; i < offset + count; i++) {
      const index = indices[i]!;
      const depth = depths[index]!;
      let j = i;
      while (j > offset && depths[indices[j - 1]!]! < depth) {
        indices[j] = indices[j - 1]!;
        j--;
      }
      indices[j] = index;
    }
    offset += count;
  }
  if (needsRadix) exactDescendingRadix(indices);

  if (frustum && frustum.length >= 16 && visibleCount > 0) {
    visibleCount = cullFrontPrefixByFrustum(indices, visibleCount, prepared, frustum);
  }
  return { indices, visibleCount };
}
