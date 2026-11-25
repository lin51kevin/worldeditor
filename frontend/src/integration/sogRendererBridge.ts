/**
 * Glue between the SOG loaders and the renderer's chunked Gaussian upload.
 * Kept separate from `rnkNextSdk.ts` so it can be tested with a fake renderer.
 */
import { assertGaussianSplatLayout } from '../viewport/gaussian/splatLayout';
import { PREPARED_SLICE_SPLATS, type PreparedSplatChunk } from '../viewport/gaussian/splatPrepare';
import type { SplatUploadStatus } from '../viewport/gaussian/splatRenderer';
import type { GaussianSplatInfo, GaussianSplatSogOptions } from './rnkNextSdk';
import {
  decodeSogDataset,
  loadStreamedSog,
  type SogChunkDecoder,
  type SogSplatMeta,
  type SogWasm,
  type SplatChunkSink,
} from './sogLoader';

/** The renderer methods the bridge drives (see `ViewportRenderer`). */
export interface ChunkedSplatTarget {
  beginGaussianSplatUpload(
    totalCount: number,
    shDegree: number,
    layoutVersion: number,
    sourceCount?: number,
  ): SplatUploadStatus;
  appendGaussianSplats(chunk: Uint32Array, prepared?: PreparedSplatChunk): boolean;
  endGaussianSplatUpload(bounds: { min: readonly [number, number, number]; max: readonly [number, number, number] }): SplatUploadStatus;
  abortGaussianSplatUpload(): void;
  getGaussianSplatUploadStatus(): Readonly<SplatUploadStatus> | null;
  render(): void;
}

/** Off-thread decoding for one load; empty keeps decoding on the calling thread. */
export interface SogDecoding {
  decoder?: SogChunkDecoder;
  decoderConcurrency?: number;
}

/** Splats handed to the GPU per append when a whole SOG is already decoded. */
export const SOG_UPLOAD_SLICE_SPLATS = PREPARED_SLICE_SPLATS;

/**
 * Append `buffer` in upload-sized slices; `prepared[k]` is slice `k` already
 * repacked. Returns false as soon as the renderer rejects a slice.
 */
function appendSlices(
  target: ChunkedSplatTarget,
  buffer: Uint32Array,
  count: number,
  stride: number,
  prepared: PreparedSplatChunk[] | undefined,
): boolean {
  for (let first = 0, k = 0; first < count; first += SOG_UPLOAD_SLICE_SPLATS, k++) {
    const end = Math.min(count, first + SOG_UPLOAD_SLICE_SPLATS);
    if (!target.appendGaussianSplats(buffer.subarray(first * stride, end * stride), prepared?.[k])) return false;
  }
  return true;
}

const ZERO: [number, number, number] = [0, 0, 0];

/** Origin the caller asked for: explicit, else the absolute frame for world-aligned loads. */
function requestedOrigin(options: GaussianSplatSogOptions): readonly [number, number, number] | undefined {
  return options.origin ?? (options.worldAligned ? ZERO : undefined);
}

/** Thrown inside a chunk sink to stop the download once the renderer rejected the cloud. */
class UploadFailure extends Error {
  constructor(
    readonly status: Readonly<SplatUploadStatus>,
    readonly shDegree: number,
    readonly layoutVersion: number,
  ) {
    super(`Gaussian upload failed: ${status.fallbackReason ?? 'unknown'}`);
    this.name = 'UploadFailure';
  }
}

function failedInfo(failure: UploadFailure): GaussianSplatInfo {
  return {
    count: 0,
    min: [...ZERO],
    max: [...ZERO],
    origin: [...ZERO],
    shDegree: failure.shDegree,
    layoutVersion: failure.layoutVersion,
    uploadStatus: failure.status as SplatUploadStatus,
  };
}

/** Load an unbundled SOG (`meta.json`) and upload it in slices. */
export async function loadSogIntoRenderer(
  wasm: SogWasm,
  target: ChunkedSplatTarget,
  metaUrl: string,
  options: GaussianSplatSogOptions = {},
  decoding: SogDecoding = {},
): Promise<GaussianSplatInfo> {
  const decoded = await decodeSogDataset(wasm, metaUrl, {
    signal: options.signal,
    origin: requestedOrigin(options),
    ...(decoding.decoder ? { decoder: decoding.decoder } : {}),
  });
  const { buffer, meta } = decoded;
  assertGaussianSplatLayout(meta, buffer);

  const info = (uploadStatus: SplatUploadStatus): GaussianSplatInfo => ({
    count: meta.count,
    min: meta.min,
    max: meta.max,
    origin: meta.origin,
    shDegree: meta.shDegree,
    layoutVersion: meta.layoutVersion,
    uploadStatus,
  });

  const begin = target.beginGaussianSplatUpload(meta.count, meta.shDegree, meta.layoutVersion);
  if (begin.outcome === 'failed') return info(begin);
  try {
    if (!appendSlices(target, buffer, meta.count, meta.shStride, decoded.prepared)) {
      return info(target.getGaussianSplatUploadStatus() ?? begin);
    }
  } catch (error) {
    target.abortGaussianSplatUpload();
    throw error;
  }
  const status = target.endGaussianSplatUpload({ min: meta.min, max: meta.max });
  target.render();
  return info(status);
}

/** Stream a Streamed SOG (`lod-meta.json`) into the renderer chunk by chunk. */
export async function loadStreamedSogIntoRenderer(
  wasm: SogWasm,
  target: ChunkedSplatTarget,
  lodMetaUrl: string,
  options: GaussianSplatSogOptions = {},
  decoding: SogDecoding = {},
): Promise<GaussianSplatInfo> {
  let begun = false;
  let shDegree = 0;
  let layoutVersion = 0;
  let endStatus: SplatUploadStatus | null = null;

  const sink: SplatChunkSink = {
    begin(first) {
      shDegree = first.shDegree;
      layoutVersion = first.layoutVersion;
      const status = target.beginGaussianSplatUpload(first.totalCount, first.shDegree, first.layoutVersion);
      if (status.outcome === 'failed') throw new UploadFailure(status, shDegree, layoutVersion);
      begun = true;
    },
    append(chunk: Uint32Array, meta: SogSplatMeta, prepared?: PreparedSplatChunk[]) {
      if (!appendSlices(target, chunk, meta.count, meta.shStride, prepared)) {
        const status = target.getGaussianSplatUploadStatus();
        begun = false;
        throw new UploadFailure(status as SplatUploadStatus, shDegree, layoutVersion);
      }
    },
    end(bounds) {
      endStatus = target.endGaussianSplatUpload(bounds);
    },
  };

  try {
    const result = await loadStreamedSog(wasm, lodMetaUrl, sink, {
      signal: options.signal,
      lod: options.lod,
      onProgress: options.onProgress,
      origin: requestedOrigin(options),
      ...(decoding.decoder ? { decoder: decoding.decoder, decoderConcurrency: decoding.decoderConcurrency } : {}),
    });
    target.render();
    return {
      count: result.count,
      min: result.min,
      max: result.max,
      origin: result.origin,
      shDegree: result.shDegree,
      layoutVersion,
      uploadStatus: endStatus as unknown as SplatUploadStatus,
    };
  } catch (error) {
    if (error instanceof UploadFailure) return failedInfo(error);
    if (begun) target.abortGaussianSplatUpload();
    throw error;
  }
}
