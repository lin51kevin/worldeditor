/**
 * Glue between the SOG loaders and the renderer's chunked Gaussian upload.
 * Kept separate from `rnkNextSdk.ts` so it can be tested with a fake renderer.
 */
import { assertGaussianSplatLayout } from '../viewport/gaussian/splatLayout';
import { PREPARED_SLICE_SPLATS, type PreparedSplatChunk } from '../viewport/gaussian/splatPrepare';
import type { SplatUploadStatus } from '../viewport/gaussian/splatRenderer';
import type { GaussianSplatInfo, GaussianSplatSogOptions } from './rnkNextSdk';
import { LodStoreFailure, LodStreamer, type ResidentSplatTarget } from './lodStreamer';
import {
  decodeSogDataset,
  fetchLodMeta,
  loadStreamedSog,
  type SogChunkDecoder,
  type SogShCap,
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
    splatModel?: string,
    progressive?: boolean,
  ): SplatUploadStatus;
  appendGaussianSplats(chunk: Uint32Array, prepared?: PreparedSplatChunk): boolean;
  endGaussianSplatUpload(bounds: { min: readonly [number, number, number]; max: readonly [number, number, number] }): SplatUploadStatus;
  abortGaussianSplatUpload(): void;
  getGaussianSplatUploadStatus(): Readonly<SplatUploadStatus> | null;
  /** Whether the upload in progress is already drawn (absent = never). */
  isGaussianUploadProgressive?(): boolean;
  render(): void;
}

/** Off-thread decoding for one load; empty keeps decoding on the calling thread. */
export interface SogDecoding {
  decoder?: SogChunkDecoder;
  decoderConcurrency?: number;
}

/** Splats handed to the GPU per append when a whole SOG is already decoded. */
export const SOG_UPLOAD_SLICE_SPLATS = PREPARED_SLICE_SPLATS;

/** Minimum gap between explicit frames while a progressive upload is still running. */
export const PROGRESSIVE_RENDER_INTERVAL_MS = 250;

/**
 * Shows a scene while it is still uploading: renders after the first appended
 * slice (then at most every {@link PROGRESSIVE_RENDER_INTERVAL_MS}) and fires
 * `onFirstReady` exactly once, either at that first frame or, when the renderer
 * does not draw partial clouds, when the load completes.
 */
class LoadView {
  private fired = false;
  private lastRenderMs = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly target: ChunkedSplatTarget,
    private readonly options: GaussianSplatSogOptions,
  ) {}

  appended(): void {
    if (!this.options.progressive || !this.target.isGaussianUploadProgressive?.()) return;
    const now = performance.now();
    if (!this.fired) {
      this.fired = true;
      this.lastRenderMs = now;
      this.target.render();
      this.options.onFirstReady?.();
    } else if (now - this.lastRenderMs >= PROGRESSIVE_RENDER_INTERVAL_MS) {
      this.lastRenderMs = now;
      this.target.render();
    }
  }

  complete(): void {
    if (this.fired) return;
    this.fired = true;
    this.options.onFirstReady?.();
  }
}

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
  onSlice?: (splats: number) => void,
): boolean {
  for (let first = 0, k = 0; first < count; first += SOG_UPLOAD_SLICE_SPLATS, k++) {
    const end = Math.min(count, first + SOG_UPLOAD_SLICE_SPLATS);
    if (!target.appendGaussianSplats(buffer.subarray(first * stride, end * stride), prepared?.[k])) return false;
    onSlice?.(end - first);
  }
  return true;
}

const ZERO: [number, number, number] = [0, 0, 0];

/** Origin the caller asked for: explicit, else the absolute frame for world-aligned loads. */
function requestedOrigin(options: GaussianSplatSogOptions): readonly [number, number, number] | undefined {
  return options.origin ?? (options.worldAligned ? ZERO : undefined);
}

function requestedShCap(options: GaussianSplatSogOptions): { shCap?: SogShCap } {
  const limit = options.shMaxSplats;
  return limit !== undefined && limit > 0 ? { shCap: { dropShAbove: limit } } : {};
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
    ...requestedShCap(options),
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

  const begin = target.beginGaussianSplatUpload(
    meta.count,
    meta.shDegree,
    meta.layoutVersion,
    undefined,
    meta.splatModel,
    options.progressive === true,
  );
  if (begin.outcome === 'failed') return info(begin);
  const view = new LoadView(target, options);
  const slices = Math.ceil(meta.count / SOG_UPLOAD_SLICE_SPLATS);
  let slicesDone = 0;
  let splatsDone = 0;
  try {
    const appended = appendSlices(target, buffer, meta.count, meta.shStride, decoded.prepared, (n) => {
      splatsDone += n;
      view.appended();
      options.onProgress?.({
        chunksDone: ++slicesDone,
        chunksTotal: slices,
        splatsDone,
        splatsTotal: meta.count,
      });
    });
    if (!appended) return info(target.getGaussianSplatUploadStatus() ?? begin);
  } catch (error) {
    target.abortGaussianSplatUpload();
    throw error;
  }
  const status = target.endGaussianSplatUpload({ min: meta.min, max: meta.max });
  target.render();
  view.complete();
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
  const view = new LoadView(target, options);

  const sink: SplatChunkSink = {
    begin(first) {
      shDegree = first.shDegree;
      layoutVersion = first.layoutVersion;
      const status = target.beginGaussianSplatUpload(
        first.totalCount,
        first.shDegree,
        first.layoutVersion,
        undefined,
        first.splatModel,
        options.progressive === true,
      );
      if (status.outcome === 'failed') throw new UploadFailure(status, shDegree, layoutVersion);
      begun = true;
    },
    append(chunk: Uint32Array, meta: SogSplatMeta, prepared?: PreparedSplatChunk[]) {
      if (!appendSlices(target, chunk, meta.count, meta.shStride, prepared, () => view.appended())) {
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
      ...requestedShCap(options),
      ...(decoding.decoder ? { decoder: decoding.decoder, decoderConcurrency: decoding.decoderConcurrency } : {}),
    });
    target.render();
    view.complete();
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

/**
 * Whether a Streamed SOG has coarser LOD levels to stream. A single-level scene
 * under a splat budget would only ever show the units nearest the camera.
 */
export async function supportsLodStreaming(lodMetaUrl: string, signal?: AbortSignal): Promise<boolean> {
  const meta = await fetchLodMeta(lodMetaUrl, { signal });
  return meta.lodLevels > 1;
}

/**
 * Stream a Streamed SOG scene by view: only the LOD units the camera needs stay
 * resident (see {@link LodStreamer}). Resolves once the first view is on the GPU;
 * the returned `lodStream` keeps following the camera until disposed.
 */
export async function loadLodStreamedIntoRenderer(
  wasm: SogWasm,
  target: ResidentSplatTarget,
  lodMetaUrl: string,
  options: GaussianSplatSogOptions = {},
  decoding: SogDecoding = {},
): Promise<GaussianSplatInfo> {
  const meta = await fetchLodMeta(lodMetaUrl, { signal: options.signal });
  const { min, max } = meta.tree.bound;
  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const origin = options.origin ?? (options.worldAligned ? ZERO : center);
  const tuning = typeof options.lodStreaming === 'object' ? options.lodStreaming : {};
  const streamer = new LodStreamer({
    wasm,
    target,
    lodMetaUrl,
    meta,
    origin,
    signal: options.signal,
    ...(decoding.decoder ? { decoder: decoding.decoder } : {}),
    options: { maxConcurrentLoads: decoding.decoderConcurrency, ...tuning },
  });
  try {
    const result = await streamer.start();
    options.onFirstReady?.();
    return {
      count: result.residentSplats,
      min: result.min,
      max: result.max,
      origin: result.origin,
      shDegree: result.shDegree,
      layoutVersion: result.layoutVersion,
      uploadStatus: result.uploadStatus,
      lodStream: result.handle,
    };
  } catch (error) {
    streamer.dispose();
    if (error instanceof LodStoreFailure) {
      target.abortGaussianSplatUpload();
      return {
        count: 0,
        min: [...ZERO],
        max: [...ZERO],
        origin: [...ZERO],
        shDegree: error.status.requestedShDegree,
        layoutVersion: 0,
        uploadStatus: error.status as SplatUploadStatus,
      };
    }
    throw error;
  }
}
