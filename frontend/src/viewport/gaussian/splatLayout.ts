/** Packed Gaussian layout with f32 transforms and f16 opacity/SH. */
export const GAUSSIAN_SPLAT_LAYOUT_VERSION = 2;

/** Stable diagnostic name for {@link GAUSSIAN_SPLAT_LAYOUT_VERSION}. */
export const GAUSSIAN_SPLAT_LAYOUT_NAME = "transform-f32-opacity-sh-f16";

/** f32 words occupied by position(3), activated scale(3), and quaternion(4). */
export const GAUSSIAN_SPLAT_TRANSFORM_WORDS = 10;

/**
 * RGBA32UI texels per splat in the GPU-resident layout: position (3 f32 bits)
 * plus the 32-bit packed quaternion.
 */
export const GAUSSIAN_TRANSFORM_TEXELS = 1;

/** Leading f16 elements of the feature texels: log-scale(3) then opacity. */
export const GAUSSIAN_FEATURE_HEADER_ELEMENTS = 4;

/** Highest spherical-harmonic degree the renderer accepts. */
export const GAUSSIAN_MAX_SH_DEGREE = 4;

/** RGBA16F texels per splat: scale/opacity header plus all SH coefficients. */
export function gaussianFeatureTexelsForDegree(shDegree: number): number {
  if (!Number.isInteger(shDegree) || shDegree < 0 || shDegree > GAUSSIAN_MAX_SH_DEGREE) {
    throw new RangeError(`Unsupported Gaussian SH degree: ${shDegree}`);
  }
  const coeffs = (shDegree + 1) * (shDegree + 1);
  return Math.ceil((GAUSSIAN_FEATURE_HEADER_ELEMENTS + coeffs * 3) / 4);
}

/** Physical texture-array geometry for one Gaussian upload. */
export interface GaussianTextureArrayLayout {
  width: number;
  height: number;
  splatsPerPage: number;
  pageCount: number;
  transformLayers: number;
  featureLayers: number;
  featureTexelsPerSplat: number;
}

/**
 * Plan the paged texture-array layout. A splat index maps to `(x, y, page)`;
 * each page occupies one RGBA32UI transform layer and a degree-dependent
 * number of RGBA16F scale/opacity/SH layers.
 */
export function planGaussianTextureArray(
  count: number,
  shDegree: number,
  maxTextureDimension2D: number,
  maxTextureArrayLayers: number,
): GaussianTextureArrayLayout | null {
  if (!Number.isSafeInteger(count) || count <= 0) return null;
  const dimension = Math.floor(maxTextureDimension2D);
  const maxLayers = Math.floor(maxTextureArrayLayers);
  if (dimension <= 0 || maxLayers <= 0) return null;

  const featureTexelsPerSplat = gaussianFeatureTexelsForDegree(shDegree);
  const maxPages = Math.min(
    Math.floor(maxLayers / GAUSSIAN_TRANSFORM_TEXELS),
    Math.floor(maxLayers / featureTexelsPerSplat),
  );
  if (maxPages <= 0) return null;

  const maxSplatsPerPage = dimension * dimension;
  const pageCount = Math.ceil(count / maxSplatsPerPage);
  if (pageCount > maxPages) return null;

  const width =
    pageCount === 1
      ? Math.min(dimension, Math.max(1, Math.ceil(Math.sqrt(count))))
      : dimension;
  const height =
    pageCount === 1 ? Math.ceil(count / width) : dimension;
  const splatsPerPage = width * height;
  return {
    width,
    height,
    splatsPerPage,
    pageCount,
    transformLayers: pageCount * GAUSSIAN_TRANSFORM_TEXELS,
    featureLayers: pageCount * featureTexelsPerSplat,
    featureTexelsPerSplat,
  };
}

/** Metadata required to validate a packed Gaussian buffer before decoding it. */
export interface GaussianSplatLayoutMeta {
  count: number;
  shDegree: number;
  shStride: number;
  layoutVersion?: number;
}

/**
 * `u32` words per splat in layout version 2:
 * `position_f32(3) + scale_f32(3) + quaternion_f32(4) +
 * ceil((opacity_f16(1) + (degree+1)²*3 SH_f16) / 2)`.
 */
export function splatStrideForDegree(shDegree: number): number {
  if (!Number.isInteger(shDegree) || shDegree < 0 || shDegree > GAUSSIAN_MAX_SH_DEGREE) {
    throw new RangeError(`Unsupported Gaussian SH degree: ${shDegree}`);
  }
  const coeffs = (shDegree + 1) * (shDegree + 1);
  return GAUSSIAN_SPLAT_TRANSFORM_WORDS + Math.ceil((1 + coeffs * 3) / 2);
}

/** IEEE-754 binary16 (half) bit pattern → `f32`. */
export function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * frac * 2 ** -24; // signed zero / subnormal
  if (exp === 0x1f) return frac ? NaN : sign * Infinity;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

const halfScratchF32 = new Float32Array(1);
const halfScratchU32 = new Uint32Array(halfScratchF32.buffer);

/** `f32` → nearest-even IEEE-754 binary16 bit pattern (overflow → ±Inf). */
export function floatToHalf(value: number): number {
  halfScratchF32[0] = value;
  const x = halfScratchU32[0]!;
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  const e = exp - 112;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - e;
    let h = mant >>> shift;
    const rem = mant & ((1 << shift) - 1);
    const mid = 1 << (shift - 1);
    if (rem > mid || (rem === mid && (h & 1))) h++;
    return sign | h;
  }
  let h = sign | (e << 10) | (mant >>> 13);
  const rem = mant & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (h & 1))) h++;
  return h;
}

const QUAT_SCALE = Math.SQRT1_2;

/**
 * Smallest-three quaternion in 32 bits: the largest-magnitude component's index
 * (2 bits, top) and the other three (10 bits each, ascending component order),
 * sign-flipped so the dropped component is positive. Input is `(w, x, y, z)`.
 */
export function packQuaternion(w: number, x: number, y: number, z: number): number {
  const norm = Math.hypot(w, x, y, z);
  if (!(norm > 1e-20)) return packQuaternion(1, 0, 0, 0);
  const inv = 1 / norm;
  const q0 = w * inv;
  const q1 = x * inv;
  const q2 = y * inv;
  const q3 = z * inv;
  let idx = 0;
  let best = Math.abs(q0);
  if (Math.abs(q1) > best) { idx = 1; best = Math.abs(q1); }
  if (Math.abs(q2) > best) { idx = 2; best = Math.abs(q2); }
  if (Math.abs(q3) > best) { idx = 3; }
  const largest = idx === 0 ? q0 : idx === 1 ? q1 : idx === 2 ? q2 : q3;
  const s = largest < 0 ? -1 : 1;
  const a = idx === 0 ? q1 : q0;
  const b = idx <= 1 ? q2 : q1;
  const c = idx <= 2 ? q3 : q2;
  return (
    ((idx << 30) | quantizeQuatComponent(a * s) | (quantizeQuatComponent(b * s) << 10) |
      (quantizeQuatComponent(c * s) << 20)) >>> 0
  );
}

function quantizeQuatComponent(v: number): number {
  return Math.round(Math.min(1, Math.max(-1, v / QUAT_SCALE)) * 511) + 511;
}

/** Inverse of {@link packQuaternion}; returns `(w, x, y, z)`. */
export function unpackQuaternion(packed: number): [number, number, number, number] {
  const idx = packed >>> 30;
  const dec = (bits: number) => ((bits - 511) / 511) * QUAT_SCALE;
  const a = dec(packed & 1023);
  const b = dec((packed >>> 10) & 1023);
  const c = dec((packed >>> 20) & 1023);
  const m = Math.sqrt(Math.max(0, 1 - a * a - b * b - c * c));
  if (idx === 0) return [m, a, b, c];
  if (idx === 1) return [a, m, b, c];
  if (idx === 2) return [a, b, m, c];
  return [a, b, c, m];
}

/** Reject metadata or bytes that do not match the current packed layout. */
export function assertGaussianSplatLayout(
  meta: GaussianSplatLayoutMeta,
  buffer?: Uint32Array,
): void {
  if (meta.layoutVersion !== GAUSSIAN_SPLAT_LAYOUT_VERSION) {
    throw new Error(
      `Unsupported Gaussian layout version ${String(meta.layoutVersion)}; ` +
        `expected ${GAUSSIAN_SPLAT_LAYOUT_VERSION} (${GAUSSIAN_SPLAT_LAYOUT_NAME})`,
    );
  }
  if (!Number.isInteger(meta.count) || meta.count < 0) {
    throw new Error(`Invalid Gaussian splat count: ${meta.count}`);
  }
  const expectedStride = splatStrideForDegree(meta.shDegree);
  if (meta.shStride !== expectedStride) {
    throw new Error(
      `Gaussian layout stride mismatch: metadata=${meta.shStride}, expected=${expectedStride}`,
    );
  }
  if (buffer && buffer.length !== meta.count * expectedStride) {
    throw new Error(
      `Gaussian buffer length mismatch: words=${buffer.length}, ` +
        `expected=${meta.count * expectedStride}`,
    );
  }
}

/** Validate a renderer upload that has no count/stride metadata object. */
export function assertGaussianSplatBuffer(
  buffer: Uint32Array,
  shDegree: number,
  layoutVersion: number,
): number {
  const stride = splatStrideForDegree(shDegree);
  assertGaussianSplatLayout({
    count: Math.floor(buffer.length / stride),
    shDegree,
    shStride: stride,
    layoutVersion,
  });
  if (buffer.length % stride !== 0) {
    throw new Error(
      `Gaussian buffer length ${buffer.length} is not aligned to stride ${stride}`,
    );
  }
  return stride;
}
