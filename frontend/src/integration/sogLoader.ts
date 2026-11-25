/**
 * SOG / Streamed SOG loading on top of the we-wasm `sog_*` bindings.
 *
 * The WASM side decodes lossless WebP images into the packed Gaussian layout;
 * this module owns fetching (`meta.json`, images, `lod-meta.json` chunks) and
 * chunk scheduling. It is renderer-agnostic: streamed chunks are handed to a
 * {@link SplatChunkSink}.
 */

import type { PreparedSplatChunk } from '../viewport/gaussian/splatPrepare';

/** The slice of the SDK wasm surface this loader needs. */
export interface SogWasm {
  sog_open(metaJson: string): number;
  sog_required_files(handle: number): string[];
  sog_add_image(handle: number, name: string, bytes: Uint8Array): void;
  sog_decode(handle: number, origin?: Float64Array | null): number;
  sog_free(handle: number): void;
  gaussian_splat_meta(handle: number): SogSplatMeta;
  gaussian_splat_buffer_sh(handle: number): Uint32Array;
  free_gaussian_splats(handle: number): void;
}

/** Metadata of a decoded packed Gaussian buffer (`gaussian_splat_meta`). */
export interface SogSplatMeta {
  count: number;
  sourceCount: number;
  shDegree: number;
  shStride: number;
  layoutVersion: number;
  layoutName: string;
  origin: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
}

/** Minimal `fetch` shape so tests can inject a fake. */
export type SogFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

/**
 * Downloads and decodes one unbundled SOG off the calling thread (a worker
 * pool in the SDK). `origin` pins the render origin; `undefined` lets the
 * dataset choose its own.
 */
export type SogChunkDecoder = (metaUrl: string, origin: readonly number[] | undefined) => Promise<DecodedSog>;

/** Options shared by the SOG loaders. */
export interface SogLoadOptions {
  fetchImpl?: SogFetch;
  signal?: AbortSignal;
  /** Parallel image downloads per dataset (default 4). */
  concurrency?: number;
  /** Decode off-thread instead of with the local `wasm`; `fetchImpl` is then unused. */
  decoder?: SogChunkDecoder;
}

/** A single decoded dataset: packed buffer plus its metadata. */
export interface DecodedSog {
  buffer: Uint32Array;
  meta: SogSplatMeta;
  /** The buffer already repacked for the GPU in upload-sized slices, when decoded off-thread. */
  prepared?: PreparedSplatChunk[];
}

const DEFAULT_CONCURRENCY = 4;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('SOG load aborted', 'AbortError');
}

async function fetchChecked(url: string, options: SogLoadOptions): Promise<Response> {
  const fetchImpl: SogFetch = options.fetchImpl ?? ((u, init) => fetch(u, init));
  const response = await fetchImpl(url, { signal: options.signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch SOG file (${response.status}): ${url}`);
  }
  return response;
}

/** Run `fn` over `items` with at most `limit` in flight, preserving result order. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}

/** Files of one unbundled SOG, downloaded but not yet decoded. */
export interface FetchedSog {
  metaJson: string;
  images: Map<string, Uint8Array>;
}

/** Download `meta.json` and every image it references. */
export async function fetchSogFiles(
  wasm: SogWasm,
  metaUrl: string,
  options: SogLoadOptions,
): Promise<FetchedSog> {
  const metaJson = await (await fetchChecked(metaUrl, options)).text();
  // A throwaway session lists the image names; it is discarded right away.
  const probe = wasm.sog_open(metaJson);
  let names: string[];
  try {
    names = wasm.sog_required_files(probe);
  } finally {
    wasm.sog_free(probe);
  }
  const fetched = await mapLimit(names, options.concurrency ?? DEFAULT_CONCURRENCY, async (name) => {
    const url = new URL(name, metaUrl).href;
    const bytes = new Uint8Array(await (await fetchChecked(url, options)).arrayBuffer());
    return [name, bytes] as const;
  });
  return { metaJson, images: new Map(fetched) };
}

/** Decode fetched files into a packed buffer (consumes the images). */
export function decodeFetched(wasm: SogWasm, files: FetchedSog, origin?: readonly number[]): DecodedSog {
  const session = wasm.sog_open(files.metaJson);
  let gaussian: number | undefined;
  try {
    for (const [name, bytes] of files.images) wasm.sog_add_image(session, name, bytes);
    gaussian = wasm.sog_decode(session, origin ? Float64Array.from(origin) : undefined);
  } catch (error) {
    wasm.sog_free(session);
    throw error;
  }
  try {
    const meta = wasm.gaussian_splat_meta(gaussian);
    const buffer = wasm.gaussian_splat_buffer_sh(gaussian);
    return { buffer, meta };
  } finally {
    wasm.free_gaussian_splats(gaussian);
  }
}

/** Load a single unbundled SOG (`meta.json` URL) into one packed buffer. */
export async function decodeSogDataset(
  wasm: SogWasm,
  metaUrl: string,
  options: SogLoadOptions & { origin?: readonly number[] } = {},
): Promise<DecodedSog> {
  throwIfAborted(options.signal);
  if (options.decoder) return options.decoder(metaUrl, options.origin);
  const files = await fetchSogFiles(wasm, metaUrl, options);
  throwIfAborted(options.signal);
  return decodeFetched(wasm, files, options.origin);
}

// ── Streamed SOG (lod-meta.json) ────────────────────────────────────────────

/** One node of the Streamed SOG spatial tree. */
export interface LodNode {
  bound: { min: [number, number, number]; max: [number, number, number] };
  children?: LodNode[];
  lods?: Record<string, { file: number; offset: number; count: number }>;
}

/** Parsed `lod-meta.json`. */
export interface LodMeta {
  version?: number;
  count?: number;
  counts?: number[];
  lodLevels: number;
  filenames: string[];
  tree: LodNode;
  environment?: string;
}

/** Validate a `lod-meta.json` document. */
export function parseLodMeta(input: unknown): LodMeta {
  const meta = input as Partial<LodMeta> | null;
  if (!meta || typeof meta !== 'object') throw new Error('lod-meta.json is not an object');
  if (meta.version !== undefined && meta.version > 1) {
    throw new Error(`Unsupported Streamed SOG version ${meta.version}`);
  }
  if (!Array.isArray(meta.filenames) || meta.filenames.length === 0) {
    throw new Error('lod-meta.json has no filenames');
  }
  if (typeof meta.lodLevels !== 'number' || meta.lodLevels < 1) {
    throw new Error('lod-meta.json has no LOD levels');
  }
  if (!meta.tree || typeof meta.tree !== 'object') throw new Error('lod-meta.json has no tree');
  return meta as LodMeta;
}

/** A chunk file and how many Gaussians of the chosen LOD it holds. */
export interface LodChunk {
  file: number;
  count: number;
}

/** Chunk files used by `lod`, in tree order, with their Gaussian counts. */
export function lodChunks(meta: LodMeta, lod: number): LodChunk[] {
  const order: number[] = [];
  const counts = new Map<number, number>();
  const visit = (node: LodNode): void => {
    if (node.children) {
      node.children.forEach(visit);
      return;
    }
    const run = node.lods?.[String(lod)];
    if (!run) return;
    if (!counts.has(run.file)) order.push(run.file);
    counts.set(run.file, (counts.get(run.file) ?? 0) + run.count);
  };
  visit(meta.tree);
  return order.map((file) => ({ file, count: counts.get(file)! }));
}

/** Receives the decoded chunks of a streamed scene. */
export interface SplatChunkSink {
  /** Called once, after the first chunk decoded, before any `append`. */
  begin(info: {
    totalCount: number;
    shDegree: number;
    layoutVersion: number;
    shStride: number;
    origin: [number, number, number];
  }): void;
  /** Called for every chunk in tree order (including the first). */
  append(chunk: Uint32Array, meta: SogSplatMeta, prepared?: PreparedSplatChunk[]): void;
  /** Called after the last chunk with the aggregated local bounds. */
  end(bounds: { min: [number, number, number]; max: [number, number, number] }): void;
}

/** Progress of a streamed load. */
export interface StreamedProgress {
  chunksDone: number;
  chunksTotal: number;
  splatsDone: number;
  splatsTotal: number;
}

/** Options for {@link loadStreamedSog}. */
export interface StreamedLoadOptions extends SogLoadOptions {
  /** LOD level to load (default 0, the full-detail level). */
  lod?: number;
  /** Chunks fetched ahead of decoding (default 2). */
  lookahead?: number;
  /** With a `decoder`: chunks decoding or decoded ahead of the consumer (default 4). */
  decoderConcurrency?: number;
  /** Fixed origin subtracted from every position; default: the first Gaussian of the first chunk. */
  origin?: readonly [number, number, number];
  onProgress?: (progress: StreamedProgress) => void;
}

/** Result summary of a streamed load. */
export interface StreamedResult {
  count: number;
  shDegree: number;
  origin: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Returns `next(i)`, called for i = 0, 1, ... in order, that yields chunk `i`
 * decoded. Without a decoder, chunk files are downloaded `lookahead` ahead and
 * decoded here on demand; with one, up to `decoderConcurrency` chunks decode
 * ahead off-thread. `getOrigin` is read at call time: when it is still unset,
 * chunk 0 runs alone because later chunks must share the origin it picks.
 */
function chunkProducer(
  wasm: SogWasm,
  urls: readonly string[],
  options: StreamedLoadOptions,
  getOrigin: () => readonly number[] | undefined,
): (i: number) => Promise<DecodedSog> {
  const { decoder } = options;
  if (decoder) {
    const ahead = Math.max(1, options.decoderConcurrency ?? 4);
    const pending = new Map<number, Promise<DecodedSog>>();
    const launch = (i: number): void => {
      if (i >= urls.length || pending.has(i)) return;
      const job = decoder(urls[i]!, getOrigin());
      // A read-ahead chunk that fails while we wait on an earlier one must not be reported as unhandled.
      job.catch(() => undefined);
      pending.set(i, job);
    };
    return async (i) => {
      launch(i);
      if (getOrigin() !== undefined) for (let k = i + 1; k <= i + ahead; k++) launch(k);
      const decoded = await pending.get(i)!;
      pending.delete(i);
      return decoded;
    };
  }

  const lookahead = Math.max(1, options.lookahead ?? 2);
  const inFlight = new Map<number, Promise<FetchedSog>>();
  const start = (i: number): void => {
    if (i < urls.length && !inFlight.has(i)) {
      const pending = fetchSogFiles(wasm, urls[i]!, options);
      // A prefetch that fails while we are busy elsewhere must not be reported as unhandled.
      pending.catch(() => undefined);
      inFlight.set(i, pending);
    }
  };
  return async (i) => {
    for (let k = i; k < i + lookahead; k++) start(k);
    const files = await inFlight.get(i)!;
    inFlight.delete(i);
    start(i + lookahead);
    return decodeFetched(wasm, files, getOrigin());
  };
}

/**
 * Stream a Streamed SOG scene into `sink`, one chunk at a time. Chunk files are
 * downloaded `lookahead` ahead of the (single-threaded) decoder; each decoded
 * chunk is handed to the sink and released, so memory stays bounded by a few
 * chunks regardless of scene size.
 */
export async function loadStreamedSog(
  wasm: SogWasm,
  lodMetaUrl: string,
  sink: SplatChunkSink,
  options: StreamedLoadOptions = {},
): Promise<StreamedResult> {
  throwIfAborted(options.signal);
  const lod = options.lod ?? 0;
  const lodMeta = parseLodMeta(await (await fetchChecked(lodMetaUrl, options)).json());
  if (lod < 0 || lod >= lodMeta.lodLevels) throw new Error(`LOD ${lod} is not available`);
  const chunks = lodChunks(lodMeta, lod);
  if (chunks.length === 0) throw new Error(`LOD ${lod} has no chunks`);
  const totalCount = lodMeta.counts?.[lod] ?? chunks.reduce((sum, c) => sum + c.count, 0);

  const urls = chunks.map((c) => new URL(lodMeta.filenames[c.file]!, lodMetaUrl).href);

  let origin: readonly number[] | undefined = options.origin;
  let begun = false;
  let shDegree = 0;
  let splatsDone = 0;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  const next = chunkProducer(wasm, urls, options, () => origin);
  for (let i = 0; i < chunks.length; i++) {
    throwIfAborted(options.signal);
    const decoded = await next(i);
    if (!begun) {
      begun = true;
      origin = decoded.meta.origin;
      shDegree = decoded.meta.shDegree;
      sink.begin({
        totalCount,
        shDegree,
        layoutVersion: decoded.meta.layoutVersion,
        shStride: decoded.meta.shStride,
        origin: decoded.meta.origin,
      });
    } else if (decoded.meta.shDegree !== shDegree) {
      throw new Error('Streamed SOG chunks use different SH degrees');
    }
    sink.append(decoded.buffer, decoded.meta, decoded.prepared);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, decoded.meta.min[k]!);
      max[k] = Math.max(max[k]!, decoded.meta.max[k]!);
    }
    splatsDone += decoded.meta.count;
    options.onProgress?.({
      chunksDone: i + 1,
      chunksTotal: chunks.length,
      splatsDone,
      splatsTotal: totalCount,
    });
  }

  sink.end({ min, max });
  return { count: splatsDone, shDegree, origin: origin as [number, number, number], min, max };
}
