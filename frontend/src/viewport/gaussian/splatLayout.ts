/** Packed Gaussian layout with f32 transforms and f16 opacity/SH. */
export const GAUSSIAN_SPLAT_LAYOUT_VERSION = 2;

/** Stable diagnostic name for {@link GAUSSIAN_SPLAT_LAYOUT_VERSION}. */
export const GAUSSIAN_SPLAT_LAYOUT_NAME = "transform-f32-opacity-sh-f16";

/** f32 words occupied by position(3), activated scale(3), and quaternion(4). */
export const GAUSSIAN_SPLAT_TRANSFORM_WORDS = 10;

/** RGBA texels per splat needed for position, scale, and quaternion. */
export const GAUSSIAN_TRANSFORM_TEXELS = 3;

/** RGBA16F texels per splat needed for opacity plus all SH coefficients. */
export function gaussianFeatureTexelsForDegree(shDegree: number): number {
  if (!Number.isInteger(shDegree) || shDegree < 0 || shDegree > 3) {
    throw new RangeError(`Unsupported Gaussian SH degree: ${shDegree}`);
  }
  const coeffs = (shDegree + 1) * (shDegree + 1);
  return Math.ceil((1 + coeffs * 3) / 4);
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
 * each page occupies three RGBA32F transform layers and a degree-dependent
 * number of RGBA16F opacity/SH layers.
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
  if (!Number.isInteger(shDegree) || shDegree < 0 || shDegree > 3) {
    throw new RangeError(`Unsupported Gaussian SH degree: ${shDegree}`);
  }
  const coeffs = (shDegree + 1) * (shDegree + 1);
  return GAUSSIAN_SPLAT_TRANSFORM_WORDS + Math.ceil((1 + coeffs * 3) / 2);
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
