/**
 * Pure-TS reference for the GPU stable splat depth sort.
 *
 * The GPU compute sorter ({@link GpuSplatSorter}) ports this exact algorithm to
 * WGSL. Keeping a CPU reference lets us unit-test the algorithm (key encoding,
 * back-to-front ordering, and — critically — STABILITY) without a WebGPU device.
 * A stable, prefix-sum-based order is deterministic every frame for the same
 * camera (unlike an atomic scatter, whose intra-bucket order is scheduling-
 * dependent and flickers under motion).
 *
 * This exact algorithm + its WGSL port were validated on real hardware (NVIDIA
 * Ampere) via `frontend/public/gpu-sort-harness.html`: all scans (1/2/3-level),
 * and the full sort up to 12,000,000 splats incl. clustered/tie-heavy inputs,
 * passed permutation + monotonic + stability + reuse-determinism checks.
 */

/** Sort key width in bits (the sorter is an 8-bit-digit radix over a 32-bit key). */
export const STABLE_SORT_KEY_BITS = 32;

const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);

/**
 * Map a view-space depth to an ascending radix-sortable u32 such that the
 * smallest key is the FARTHEST splat — an ascending sort then yields back-to-
 * front order (farthest drawn first) for correct premultiplied-alpha blending.
 * Mirrors the WGSL `init_keys`: `~radixSortable(bitcast<u32>(depth))`, full
 * precision (no quantization → no equal-bucket blur).
 */
export function depthToSortKey(depth: number): number {
  _f32[0] = depth;
  const u = _u32[0]!;
  const ascending = (u & 0x80000000) !== 0 ? ~u : u | 0x80000000;
  return ~ascending >>> 0;
}

/** Compute the per-splat sort key for a camera pose (mirrors the WGSL depth pass). */
export function computeSortKeys(
  positions: Float32Array,
  camPos: readonly [number, number, number],
  viewDir: readonly [number, number, number],
): Uint32Array {
  const n = Math.floor(positions.length / 3);
  const keys = new Uint32Array(n);
  const [cx, cy, cz] = camPos;
  const [vx, vy, vz] = viewDir;
  for (let i = 0; i < n; i++) {
    const dx = positions[i * 3]! - cx;
    const dy = positions[i * 3 + 1]! - cy;
    const dz = positions[i * 3 + 2]! - cz;
    keys[i] = depthToSortKey(dx * vx + dy * vy + dz * vz);
  }
  return keys;
}

/**
 * Stable LSD radix argsort (bit by bit) — models the RESULT the GPU 8-bit-digit
 * radix produces. Returns splat indices ordered by ascending key, ties broken by
 * original index (stability), which is what makes the frame-to-frame order
 * deterministic.
 */
export function stableRadixArgsort(keys: Uint32Array, bits = STABLE_SORT_KEY_BITS): Uint32Array {
  const n = keys.length;
  let srcKeys = keys.slice();
  let srcIdx = new Uint32Array(n);
  for (let i = 0; i < n; i++) srcIdx[i] = i;
  let dstKeys = new Uint32Array(n);
  let dstIdx = new Uint32Array(n);
  const prefix = new Uint32Array(n); // exclusive prefix of the zero-bit flags

  for (let b = 0; b < bits; b++) {
    let zeros = 0;
    for (let i = 0; i < n; i++) {
      prefix[i] = zeros;
      if (((srcKeys[i]! >>> b) & 1) === 0) zeros++;
    }
    const totalZeros = zeros;
    for (let i = 0; i < n; i++) {
      const isOne = (srcKeys[i]! >>> b) & 1;
      const pos = isOne ? totalZeros + (i - prefix[i]!) : prefix[i]!;
      dstKeys[pos] = srcKeys[i]!;
      dstIdx[pos] = srcIdx[i]!;
    }
    [srcKeys, dstKeys] = [dstKeys, srcKeys];
    [srcIdx, dstIdx] = [dstIdx, srcIdx];
  }
  return srcIdx;
}

/** Elements scanned per block by the WGSL Blelloch scan (mirrors `SCAN_BLOCK`). */
export const SCAN_BLOCK = 512;

/**
 * Exclusive prefix sum built the way the GPU does it: a per-block Blelloch scan
 * plus a recursively-scanned block-sum add-back (up to 3 levels for our sizes).
 */
export function blockScanExclusive(input: Uint32Array, block = SCAN_BLOCK): Uint32Array {
  const n = input.length;
  const out = input.slice();
  if (n === 0) return out;
  const numBlocks = Math.ceil(n / block);
  const blockSums = new Uint32Array(numBlocks);
  for (let b = 0; b < numBlocks; b++) {
    let sum = 0;
    for (let j = b * block; j < Math.min((b + 1) * block, n); j++) {
      const v = out[j]!;
      out[j] = sum;
      sum += v;
    }
    blockSums[b] = sum;
  }
  if (numBlocks > 1) {
    const scanned = blockScanExclusive(blockSums, block);
    for (let i = 0; i < n; i++) out[i] = out[i]! + scanned[Math.floor(i / block)]!;
  }
  return out;
}

/**
 * Full CPU simulation of the GPU sort pipeline (init → per-bit flags → block
 * scan → total → stable scatter), using {@link blockScanExclusive}. Mirrors
 * {@link GpuSplatSorter} step-for-step so a test can lock the orchestration
 * against {@link stableRadixArgsort}.
 */
export function simulateGpuStableSort(
  keys: Uint32Array,
  bits = STABLE_SORT_KEY_BITS,
): Uint32Array {
  const n = keys.length;
  let order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  for (let b = 0; b < bits; b++) {
    const flags = new Uint32Array(n);
    for (let i = 0; i < n; i++) flags[i] = 1 - ((keys[order[i]!]! >>> b) & 1);
    const prefix = blockScanExclusive(flags);
    const totalZeros = prefix[n - 1]! + flags[n - 1]!;
    const next = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const e = order[i]!;
      const bit = (keys[e]! >>> b) & 1;
      next[bit === 0 ? prefix[i]! : totalZeros + (i - prefix[i]!)] = e;
    }
    order = next;
  }
  return order;
}
