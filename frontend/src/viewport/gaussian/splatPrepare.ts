/**
 * Splat chunk repacking for the texture-array upload, separated from the GPU
 * code so it can run in a decode worker: repacking is a CPU pass over every
 * splat and cost the main thread seconds on multi-million-splat scenes.
 */
import {
  GAUSSIAN_FEATURE_HEADER_ELEMENTS,
  GAUSSIAN_SPLAT_TRANSFORM_WORDS,
  GAUSSIAN_TRANSFORM_TEXELS,
  floatToHalf,
  gaussianFeatureTexelsForDegree,
  packQuaternion,
  splatStrideForDegree,
} from "./splatLayout";

/** Transform texture layers per splat (position bits + packed quaternion). */
export const TRANSFORM_LAYERS = GAUSSIAN_TRANSFORM_TEXELS;

/** Smallest activated scale kept before the log, so a zero axis stays finite. */
const MIN_SCALE = 1e-12;

/**
 * One chunk of splats in the exact element order of the GPU textures. Each
 * plane is layer-major: layer `L` of splat `i` starts at `(L * count + i) * 4`,
 * so a run of consecutive splats is contiguous in every layer.
 */
export interface PreparedSplatChunk {
  count: number;
  shDegree: number;
  /** `TRANSFORM_LAYERS` planes of `count` RGBA32UI texels: position f32 bits, packed quaternion. */
  transform: Uint32Array;
  /**
   * One plane of `count` RGBA16F texels (raw half-float bits) per feature layer.
   * Elements: log-scale x/y/z, opacity, then the SH coefficients.
   */
  features: Uint16Array;
  /** Splat centres, `count * 3`. */
  positions: Float32Array;
  /** Largest activated scale axis per splat (never zero: a zero radius marks an empty LOD slot). */
  radii: Float32Array;
  /** Half-float opacity bits per splat. */
  opacity: Uint16Array;
}

/** Repack `chunk` (whole layout-v2 records of `shDegree`) for upload. */
export function prepareSplatChunk(chunk: Uint32Array, shDegree: number): PreparedSplatChunk {
  const stride = splatStrideForDegree(shDegree);
  if (chunk.length % stride !== 0) {
    throw new RangeError("Chunk is not a whole number of splat records");
  }
  const count = chunk.length / stride;
  const featureLayers = gaussianFeatureTexelsForDegree(shDegree);
  const shElements = (shDegree + 1) ** 2 * 3;

  const transform = new Uint32Array(count * 4 * TRANSFORM_LAYERS);
  const features = new Uint16Array(count * 4 * featureLayers);
  const positions = new Float32Array(count * 3);
  const radii = new Float32Array(count);
  const opacity = new Uint16Array(count);

  const source = new Float32Array(chunk.buffer, chunk.byteOffset, chunk.length);
  // Half-float features are little-endian pairs inside each 32-bit word.
  const halves = new Uint16Array(chunk.buffer, chunk.byteOffset, chunk.length * 2);
  const plane = count * 4;

  for (let i = 0; i < count; i++) {
    const base = i * stride;
    const t = i * 4;
    const sx = source[base + 3]!;
    const sy = source[base + 4]!;
    const sz = source[base + 5]!;
    transform[t] = chunk[base]!;
    transform[t + 1] = chunk[base + 1]!;
    transform[t + 2] = chunk[base + 2]!;
    transform[t + 3] = packQuaternion(
      source[base + 6]!,
      source[base + 7]!,
      source[base + 8]!,
      source[base + 9]!,
    );

    positions[i * 3] = source[base]!;
    positions[i * 3 + 1] = source[base + 1]!;
    positions[i * 3 + 2] = source[base + 2]!;
    radii[i] = Math.max(sx, sy, sz, MIN_SCALE);

    const half = (base + GAUSSIAN_SPLAT_TRANSFORM_WORDS) * 2;
    opacity[i] = halves[half]!;
    features[t] = floatToHalf(Math.log(Math.max(sx, MIN_SCALE)));
    features[t + 1] = floatToHalf(Math.log(Math.max(sy, MIN_SCALE)));
    features[t + 2] = floatToHalf(Math.log(Math.max(sz, MIN_SCALE)));
    features[t + 3] = halves[half]!;
    for (let e = 0; e < shElements; e++) {
      const slot = GAUSSIAN_FEATURE_HEADER_ELEMENTS + e;
      features[(slot >> 2) * plane + t + (slot & 3)] = halves[half + 1 + e]!;
    }
  }

  return { count, shDegree, transform, features, positions, radii, opacity };
}

/** Splats per prepared slice; bounds the GPU staging copies of one upload call. */
export const PREPARED_SLICE_SPLATS = 524_288;

/** {@link prepareSplatChunk} over consecutive slices of at most `sliceSplats` splats. */
export function prepareSplatSlices(
  chunk: Uint32Array,
  shDegree: number,
  sliceSplats: number = PREPARED_SLICE_SPLATS,
): PreparedSplatChunk[] {
  const stride = splatStrideForDegree(shDegree);
  if (chunk.length % stride !== 0) {
    throw new RangeError("Chunk is not a whole number of splat records");
  }
  const count = chunk.length / stride;
  const slices: PreparedSplatChunk[] = [];
  for (let first = 0; first < count; first += sliceSplats) {
    const end = Math.min(count, first + sliceSplats);
    slices.push(prepareSplatChunk(chunk.subarray(first * stride, end * stride), shDegree));
  }
  return slices;
}

/**
 * Splats `[from, to)` of `chunk` as their own prepared chunk (planes are
 * layer-major, so each layer is copied separately). Returns `chunk` itself when
 * the range covers it all.
 */
export function slicePreparedChunk(chunk: PreparedSplatChunk, from: number, to: number): PreparedSplatChunk {
  if (!(from >= 0 && to <= chunk.count && from <= to)) {
    throw new RangeError("Slice range is outside the prepared chunk");
  }
  if (from === 0 && to === chunk.count) return chunk;
  const count = to - from;
  const transform = new Uint32Array(count * 4 * TRANSFORM_LAYERS);
  for (let layer = 0; layer < TRANSFORM_LAYERS; layer++) {
    transform.set(
      chunk.transform.subarray((layer * chunk.count + from) * 4, (layer * chunk.count + to) * 4),
      layer * count * 4,
    );
  }
  const layers = chunk.features.length / (chunk.count * 4);
  const features = new Uint16Array(count * 4 * layers);
  for (let layer = 0; layer < layers; layer++) {
    features.set(
      chunk.features.subarray((layer * chunk.count + from) * 4, (layer * chunk.count + to) * 4),
      layer * count * 4,
    );
  }
  return {
    count,
    shDegree: chunk.shDegree,
    transform,
    features,
    positions: chunk.positions.slice(from * 3, to * 3),
    radii: chunk.radii.slice(from, to),
    opacity: chunk.opacity.slice(from, to),
  };
}
