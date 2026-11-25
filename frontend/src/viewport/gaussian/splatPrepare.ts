/**
 * Splat chunk repacking for the texture-array upload, separated from the GPU
 * code so it can run in a decode worker: repacking is a CPU pass over every
 * splat and cost the main thread seconds on multi-million-splat scenes.
 */
import {
  GAUSSIAN_SPLAT_TRANSFORM_WORDS,
  gaussianFeatureTexelsForDegree,
  splatStrideForDegree,
} from "./splatLayout";

/** Transform texture layers per splat (centre+scale, rotation, remaining words). */
export const TRANSFORM_LAYERS = 3;

/**
 * One chunk of splats in the exact element order of the GPU textures. Each
 * plane is layer-major: layer `L` of splat `i` starts at `(L * count + i) * 4`,
 * so a run of consecutive splats is contiguous in every layer.
 */
export interface PreparedSplatChunk {
  count: number;
  shDegree: number;
  /** `TRANSFORM_LAYERS` planes of `count` RGBA32F texels. */
  transform: Float32Array;
  /** One plane of `count` RGBA16F texels (raw half-float bits) per feature layer. */
  features: Uint16Array;
  /** Splat centres, `count * 3`. */
  positions: Float32Array;
  /** Largest activated scale axis per splat, for the sort's frustum culling. */
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
  const featureElements = 1 + (shDegree + 1) ** 2 * 3;

  const transform = new Float32Array(count * 4 * TRANSFORM_LAYERS);
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
    const x = source[base]!;
    const y = source[base + 1]!;
    const z = source[base + 2]!;
    const sx = source[base + 3]!;
    const sy = source[base + 4]!;
    const sz = source[base + 5]!;
    transform[t] = x;
    transform[t + 1] = y;
    transform[t + 2] = z;
    transform[t + 3] = sx;
    transform[plane + t] = sy;
    transform[plane + t + 1] = sz;
    transform[plane + t + 2] = source[base + 6]!;
    transform[plane + t + 3] = source[base + 7]!;
    transform[2 * plane + t] = source[base + 8]!;
    transform[2 * plane + t + 1] = source[base + 9]!;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    radii[i] = Math.max(sx, sy, sz);

    const half = (base + GAUSSIAN_SPLAT_TRANSFORM_WORDS) * 2;
    opacity[i] = halves[half]!;
    for (let e = 0; e < featureElements; e++) {
      features[(e >> 2) * plane + t + (e & 3)] = halves[half + e]!;
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
