/**
 * Pure (GPU-free) origin-shift helpers for point clouds and Gaussian splats.
 *
 * These run on either the main thread or inside a Web Worker (they touch no
 * WebGPU objects), which lets the heavy per-point/per-splat origin shift — a
 * full-buffer copy + loop over millions of elements — happen off the main
 * thread during loading. Quality/sample reduction stays in the GPU renderer so
 * the live quality slider keeps operating on the full source buffer.
 */

/**
 * `u32` words per splat in the half-precision packed instance buffer:
 * `pos(3 f32 words) + ceil((6 cov + 1 opacity + (deg+1)²·3 SH) / 2)` half-pairs.
 * Mirrors `GaussianCloud::sh_buffer_stride_f16` in Rust.
 */
export function splatStrideForDegree(shDegree: number): number {
  const coeffs = (shDegree + 1) * (shDegree + 1);
  const halfCount = 7 + coeffs * 3;
  return 3 + Math.ceil(halfCount / 2);
}

/**
 * Shift a packed splat buffer's positions by `origin` (added to x/y/z), moving
 * an origin-relative cloud into the road's absolute world frame. Returns a
 * shifted copy; returns the input unchanged when `origin` is zero/undefined.
 * Positions occupy the first 3 `u32` words of each record (f32 bit patterns).
 */
export function shiftSplatOrigin(
  splatData: Uint32Array,
  stride: number,
  origin: readonly [number, number, number] | undefined,
): Uint32Array {
  if (!origin || (origin[0] === 0 && origin[1] === 0 && origin[2] === 0)) return splatData;
  if (stride < 3) return splatData;
  const [ox, oy, oz] = origin;
  const out = new Uint32Array(splatData);
  const f32 = new Float32Array(out.buffer, out.byteOffset, out.length);
  for (let i = 0; i + 2 < f32.length; i += stride) {
    f32[i] = f32[i]! + ox;
    f32[i + 1] = f32[i + 1]! + oy;
    f32[i + 2] = f32[i + 2]! + oz;
  }
  return out;
}

/**
 * Shift an interleaved 7-float point-cloud render buffer (x,y,z,r,g,b,a) into
 * absolute world coordinates, in place. No-op when `origin` is zero/undefined.
 */
export function shiftPointCloudOrigin(
  vertices: Float32Array,
  origin: readonly [number, number, number] | undefined,
): void {
  if (!origin || (origin[0] === 0 && origin[1] === 0 && origin[2] === 0)) return;
  const [ox, oy, oz] = origin;
  for (let i = 0; i + 2 < vertices.length; i += 7) {
    vertices[i] = vertices[i]! + ox;
    vertices[i + 1] = vertices[i + 1]! + oy;
    vertices[i + 2] = vertices[i + 2]! + oz;
  }
}
