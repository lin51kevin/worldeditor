/**
 * Rigid-body transforms for packed (layout v2) Gaussian splat buffers.
 *
 * Used to place a per-actor splat model at its trajectory pose each frame: the
 * model is authored in a local frame (recentred at the origin) and then rotated
 * about the vertical (Z) axis by the actor heading and translated to the actor
 * position. Positions occupy f32 words `[0..2]` of each record and the splat
 * orientation quaternion (w, x, y, z) occupies f32 words `[6..9]`; the activated
 * scale (words `[3..5]`) and the opacity/SH tail are rotation-invariant and left
 * untouched.
 */

import { GAUSSIAN_SPLAT_TRANSFORM_WORDS } from './splatLayout';

/** Position of the splat orientation quaternion within a record (f32 words). */
const QUAT_WORD_OFFSET = 6;

/**
 * Compute the axis-aligned bounding-box centre of a packed splat buffer.
 * Returns `[0, 0, 0]` for an empty buffer.
 */
export function splatBoundsCenter(
  splatData: Uint32Array,
  stride: number,
): [number, number, number] {
  const f32 = new Float32Array(splatData.buffer, splatData.byteOffset, splatData.length);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i + 2 < f32.length; i += stride) {
    const x = f32[i]!, y = f32[i + 1]!, z = f32[i + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) return [0, 0, 0];
  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
}

/**
 * Return a copy of `splatData` with every position shifted by `-center`, moving
 * the cloud so `center` maps to the local origin. Leaves the input unchanged
 * when `center` is zero.
 */
export function recenterSplats(
  splatData: Uint32Array,
  stride: number,
  center: readonly [number, number, number],
): Uint32Array {
  if (center[0] === 0 && center[1] === 0 && center[2] === 0) return splatData;
  const out = new Uint32Array(splatData);
  const f32 = new Float32Array(out.buffer, out.byteOffset, out.length);
  const [cx, cy, cz] = center;
  for (let i = 0; i + 2 < f32.length; i += stride) {
    f32[i] = f32[i]! - cx;
    f32[i + 1] = f32[i + 1]! - cy;
    f32[i + 2] = f32[i + 2]! - cz;
  }
  return out;
}

/**
 * Rotate a local packed splat buffer about the Z axis by `yawRad` and translate
 * it by `translate`. Returns a new buffer; the input is not mutated.
 *
 * Positions are rotated then translated; each splat's orientation quaternion is
 * pre-multiplied by the yaw rotation quaternion so the anisotropic splats turn
 * with the body. Scale and opacity/SH words are copied verbatim.
 */
export function transformPackedSplats(
  splatData: Uint32Array,
  stride: number,
  translate: readonly [number, number, number],
  yawRad: number,
): Uint32Array {
  if (stride < GAUSSIAN_SPLAT_TRANSFORM_WORDS) {
    throw new RangeError(`Splat stride ${stride} is smaller than the transform prefix`);
  }
  const out = new Uint32Array(splatData);
  const f32 = new Float32Array(out.buffer, out.byteOffset, out.length);
  const cos = Math.cos(yawRad);
  const sin = Math.sin(yawRad);
  // Half-angle quaternion for a rotation of `yawRad` about +Z: (w, 0, 0, z).
  const half = yawRad / 2;
  const qw = Math.cos(half);
  const qz = Math.sin(half);
  const [tx, ty, tz] = translate;

  for (let i = 0; i + stride - 1 < f32.length; i += stride) {
    // Position: rotate about Z, then translate.
    const x = f32[i]!;
    const y = f32[i + 1]!;
    const z = f32[i + 2]!;
    f32[i] = x * cos - y * sin + tx;
    f32[i + 1] = x * sin + y * cos + ty;
    f32[i + 2] = z + tz;

    // Orientation: q' = qYaw * q, quaternion words stored as (w, x, y, z).
    const q = i + QUAT_WORD_OFFSET;
    const bw = f32[q]!;
    const bx = f32[q + 1]!;
    const by = f32[q + 2]!;
    const bz = f32[q + 3]!;
    f32[q] = qw * bw - qz * bz;
    f32[q + 1] = qw * bx - qz * by;
    f32[q + 2] = qw * by + qz * bx;
    f32[q + 3] = qw * bz + qz * bw;
  }
  return out;
}

/**
 * Concatenate several equal-stride packed splat buffers into one buffer. All
 * inputs must share the same SH degree / stride. Empty inputs are skipped.
 */
export function mergePackedSplats(buffers: readonly Uint32Array[]): Uint32Array {
  const nonEmpty = buffers.filter((b) => b.length > 0);
  if (nonEmpty.length === 0) return new Uint32Array(0);
  if (nonEmpty.length === 1) return nonEmpty[0]!;
  const total = nonEmpty.reduce((sum, b) => sum + b.length, 0);
  const out = new Uint32Array(total);
  let offset = 0;
  for (const b of nonEmpty) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}
