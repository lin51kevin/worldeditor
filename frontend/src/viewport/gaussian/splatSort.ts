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

/** Number of buckets for the 16-bit counting sort. */
const BUCKETS = 65536;

/**
 * Return splat indices ordered back-to-front (largest depth first) using a
 * 16-bit counting sort. The result is a permutation of `0..N-1`.
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

  const depths = computeDepths(positions, camPos, viewDir);

  let minD = Infinity;
  let maxD = -Infinity;
  for (let i = 0; i < n; i++) {
    const d = depths[i]!;
    if (d < minD) minD = d;
    if (d > maxD) maxD = d;
  }

  // Degenerate range: every splat at the same depth → identity order.
  if (!(maxD > minD)) {
    for (let i = 0; i < n; i++) order[i] = i;
    return order;
  }

  const scale = (BUCKETS - 1) / (maxD - minD);
  const counts = new Uint32Array(BUCKETS);
  const bucket = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    let b = ((depths[i]! - minD) * scale) | 0;
    if (b < 0) b = 0;
    else if (b >= BUCKETS) b = BUCKETS - 1;
    bucket[i] = b;
    counts[b] = counts[b]! + 1;
  }

  // Prefix sum from the HIGH bucket downward so the largest depth (farthest)
  // is emitted first (back-to-front).
  const starts = new Uint32Array(BUCKETS);
  let running = 0;
  for (let b = BUCKETS - 1; b >= 0; b--) {
    starts[b] = running;
    running += counts[b]!;
  }

  for (let i = 0; i < n; i++) {
    const b = bucket[i]!;
    order[starts[b]!++] = i;
  }
  return order;
}
