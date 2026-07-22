/**
 * Depth sorting for 3D Gaussian Splatting.
 *
 * Splats must be blended back-to-front (farthest first) for correct
 * premultiplied "over" alpha compositing. Depth is the view-space distance
 * `dot(viewDir, splat - camPos)`; larger means farther from the camera.
 *
 * A 16-bit counting sort (antimatter15/splat approach) keeps this near O(N)
 * even for ~1M splats, far cheaper than a comparison sort every frame.
 */

/** A 3-component vector. */
export type Vec3 = readonly [number, number, number];

/**
 * View-space depth of every splat: `dot(viewDir, splat - camPos)`.
 * `viewDir` is assumed normalized; positions are 3 floats per splat.
 */
export function computeDepths(
  positions: Float32Array,
  camPos: Vec3,
  viewDir: Vec3,
): Float32Array {
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
 * Bucket count for the depth counting sort, adaptive to the splat count —
 * mirrors PlayCanvas/SuperSplat (`compareBits = clamp(round(log2(n/4)), 12, 20)`).
 * More splats → finer depth quantization (up to 2²⁰ ≈ 1.05M buckets). A coarse
 * fixed 2¹⁶ sort puts ~n/65536 splats in each bucket with *arbitrary* intra-
 * bucket order; once the whole (multi-million) cloud is drawn that mis-ordering
 * reads as a hazy / soft image. Finer buckets → correct back-to-front blend
 * order → crisp result.
 */
export function depthBucketCount(n: number): number {
  const bits = Math.max(12, Math.min(20, Math.round(Math.log2(Math.max(1, n / 4)))));
  return 2 ** bits;
}

// Persistent scratch reused across sorts (the sort re-runs for the same cloud
// every time the camera moves). Reusing these avoids allocating tens of MB per
// re-sort — the per-frame allocation + GC churn that previously stalled the
// worker. `order` is intentionally NOT cached: it is transferred to the main
// thread each sort, so its ownership leaves this module.
let scratchDepths: Float32Array | null = null;
let scratchBucket: Uint32Array | null = null;
let scratchCounts: Uint32Array | null = null;
let scratchStarts: Uint32Array | null = null;

/**
 * Return splat indices ordered back-to-front (largest depth first) using an
 * adaptive-precision counting sort ({@link depthBucketCount} buckets). The
 * result is a permutation of `0..N-1`.
 */
export function sortSplatsByDepth(
  positions: Float32Array,
  camPos: Vec3,
  viewDir: Vec3,
): Uint32Array {
  const n = positions.length / 3;
  const order = new Uint32Array(n);
  if (n <= 1) {
    if (n === 1) order[0] = 0;
    return order;
  }

  const buckets = depthBucketCount(n);

  // (Re)allocate reusable scratch to fit the current cloud / bucket count.
  if (!scratchDepths || scratchDepths.length !== n) scratchDepths = new Float32Array(n);
  if (!scratchBucket || scratchBucket.length !== n) scratchBucket = new Uint32Array(n);
  if (!scratchCounts || scratchCounts.length !== buckets) {
    scratchCounts = new Uint32Array(buckets);
    scratchStarts = new Uint32Array(buckets);
  } else {
    scratchCounts.fill(0);
  }
  const depths = scratchDepths;
  const bucket = scratchBucket;
  const counts = scratchCounts;
  const starts = scratchStarts!;

  // View-space depth per splat + range, in one pass (no extra allocation).
  const cx = camPos[0], cy = camPos[1], cz = camPos[2];
  const vx = viewDir[0], vy = viewDir[1], vz = viewDir[2];
  let minD = Infinity;
  let maxD = -Infinity;
  for (let i = 0; i < n; i++) {
    const dx = positions[i * 3]! - cx;
    const dy = positions[i * 3 + 1]! - cy;
    const dz = positions[i * 3 + 2]! - cz;
    const d = dx * vx + dy * vy + dz * vz;
    depths[i] = d;
    if (d < minD) minD = d;
    if (d > maxD) maxD = d;
  }

  // Degenerate range: every splat at the same depth → identity order.
  if (!(maxD > minD)) {
    for (let i = 0; i < n; i++) order[i] = i;
    return order;
  }

  const scale = (buckets - 1) / (maxD - minD);
  for (let i = 0; i < n; i++) {
    let b = ((depths[i]! - minD) * scale) | 0;
    if (b < 0) b = 0;
    else if (b >= buckets) b = buckets - 1;
    bucket[i] = b;
    counts[b]! += 1;
  }

  // Prefix sum from the HIGH bucket downward so the largest depth (farthest)
  // is emitted first (back-to-front).
  let running = 0;
  for (let b = buckets - 1; b >= 0; b--) {
    starts[b] = running;
    running += counts[b]!;
  }

  for (let i = 0; i < n; i++) {
    const b = bucket[i]!;
    order[starts[b]!++] = i;
  }
  return order;
}
