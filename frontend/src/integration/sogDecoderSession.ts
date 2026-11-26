/**
 * Opens the off-thread SOG decoder for one load, falling back to decoding on
 * the calling thread whenever workers are unavailable.
 */
import {
  SogDecodePool,
  SogWorkerUnavailable,
  type SogWasmSource,
  type SogWorkerLike,
} from './sogDecodePool';
import { decodeSogDataset, type SogChunkDecoder, type SogWasm } from './sogLoader';

/** Upper bound on decode workers; beyond this the main-thread upload is the bottleneck. */
export const MAX_SOG_DECODE_WORKERS = 6;

/** Decoder settings a loader needs, plus how to release them. */
export interface SogDecoderSession {
  /** Undefined when decoding stays on the calling thread. */
  decoder?: SogChunkDecoder;
  /** Chunks the loader may keep decoding ahead of the consumer. */
  decoderConcurrency?: number;
  dispose(): void;
}

/** Creates one pool worker; the SDK supplies the inline worker bundle. */
export type SogWorkerFactory = () => SogWorkerLike;

const NONE: SogDecoderSession = { dispose: () => undefined };

/** Workers for a streamed load: leave cores for the page and the GPU process. */
export function defaultDecodeWorkers(hardwareConcurrency: number | undefined): number {
  return Math.max(1, Math.min(MAX_SOG_DECODE_WORKERS, (hardwareConcurrency ?? 4) - 2));
}

/**
 * Open the decoder for one SDK load: workers when the host gave a WASM
 * location and the bundled worker loads, otherwise an empty session.
 * `streamed` loads use several workers, a single dataset one.
 */
export async function openSogDecoderFor(
  wasm: SogWasm,
  source: SogWasmSource | undefined,
  streamed: boolean,
  load: { decodeWorkers?: number; signal?: AbortSignal },
  loadFactory: () => Promise<SogWorkerFactory | undefined>,
): Promise<SogDecoderSession> {
  const workers = load.decodeWorkers ?? (streamed ? defaultDecodeWorkers(globalThis.navigator?.hardwareConcurrency) : 1);
  if (workers <= 0 || source === undefined) return NONE;
  return openSogDecoder({ wasm, source, workers, createWorker: await loadFactory(), signal: load.signal });
}

export interface OpenSogDecoderOptions {
  /** Local decode instance, used when the pool turns out to be unusable. */
  wasm: SogWasm;
  /** Where workers load the WASM from; undefined means workers cannot be used. */
  source: SogWasmSource | undefined;
  /** Worker count; 0 keeps decoding on the calling thread. */
  workers: number;
  createWorker: SogWorkerFactory | undefined;
  signal?: AbortSignal;
}

/** Start a pool for one load; never throws, degrades to an empty session. */
export function openSogDecoder(options: OpenSogDecoderOptions): SogDecoderSession {
  const { wasm, source, workers, createWorker, signal } = options;
  if (workers <= 0 || source === undefined || !createWorker) return NONE;

  let pool: SogDecodePool;
  try {
    pool = new SogDecodePool(workers, createWorker, source);
  } catch (error) {
    console.warn('[SOG] decode workers unavailable, decoding on the main thread', error);
    return NONE;
  }

  let degraded = false;
  const decoder: SogChunkDecoder = async (url, origin, shCap) => {
    if (!degraded) {
      try {
        return await pool.decode(url, origin, shCap);
      } catch (error) {
        if (!(error instanceof SogWorkerUnavailable)) throw error;
        degraded = true;
        console.warn('[SOG] decode workers unavailable, decoding on the main thread', error);
      }
    }
    return decodeSogDataset(wasm, url, { origin, signal, shCap });
  };

  const onAbort = (): void => pool.dispose(new DOMException('SOG load aborted', 'AbortError'));
  signal?.addEventListener('abort', onAbort, { once: true });

  return {
    decoder,
    decoderConcurrency: pool.size + 1,
    dispose: () => {
      signal?.removeEventListener('abort', onAbort);
      pool.dispose();
    },
  };
}
