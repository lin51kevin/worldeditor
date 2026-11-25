/**
 * Worker pool that downloads and decodes SOG datasets off the main thread.
 *
 * Decoding lossless WebP into the packed Gaussian layout is CPU-bound and, run
 * on the SDK's main-thread WASM instance, froze the page for tens of seconds on
 * large scenes. Each worker owns its own WASM instance and handles one dataset
 * at a time; the packed buffer comes back as a transferred `ArrayBuffer`.
 */
import type { PreparedSplatChunk } from '../viewport/gaussian/splatPrepare';
import type { DecodedSog, SogChunkDecoder, SogSplatMeta } from './sogLoader';

/** Where a worker loads the WASM binary from (all structured-cloneable). */
export type SogWasmSource = string | ArrayBuffer | Uint8Array | WebAssembly.Module;

/** Main thread -> worker. */
export type SogWorkerRequest =
  | { type: 'init'; source: SogWasmSource }
  | { type: 'decode'; id: number; url: string; origin?: number[] };

/** Worker -> main thread. */
export type SogWorkerResponse =
  | { type: 'done'; id: number; buffer: ArrayBuffer; meta: SogSplatMeta; prepared?: PreparedSplatChunk[] }
  | { type: 'fail'; id: number; message: string; unavailable?: boolean };

/** The slice of `Worker` the pool uses, so tests can substitute a fake. */
export interface SogWorkerLike {
  postMessage(message: SogWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: SogWorkerResponse }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

/** The pool cannot decode at all (worker blocked, script or WASM failed to load). */
export class SogWorkerUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SogWorkerUnavailable';
  }
}

/**
 * Turn the host's `wasmInput` into something a blob worker can load: relative
 * URLs are resolved against the page, since a blob worker has no useful base.
 */
export function resolveWasmSource(
  input: string | URL | Request | ArrayBuffer | Uint8Array | WebAssembly.Module | undefined,
): SogWasmSource | undefined {
  if (input === undefined) return undefined;
  if (typeof input === 'string') return new URL(input, globalThis.location?.href).href;
  if (input instanceof URL) return input.href;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return input;
}

interface Job {
  id: number;
  url: string;
  origin: readonly number[] | undefined;
  resolve(decoded: DecodedSog): void;
  reject(reason: unknown): void;
}

interface Slot {
  worker: SogWorkerLike;
  job: Job | null;
}

export class SogDecodePool {
  private readonly slots: Slot[] = [];
  private readonly queue: Job[] = [];
  private nextId = 1;
  private closed: Error | null = null;
  private unavailable: SogWorkerUnavailable | null = null;

  constructor(size: number, createWorker: () => SogWorkerLike, source: SogWasmSource) {
    for (let i = 0; i < Math.max(1, size); i++) {
      const worker = createWorker();
      const slot: Slot = { worker, job: null };
      worker.onmessage = (event) => this.onMessage(slot, event.data);
      worker.onerror = (event) =>
        this.fail(new SogWorkerUnavailable(`SOG decode worker failed: ${event.message ?? 'unknown error'}`));
      worker.postMessage({ type: 'init', source });
      this.slots.push(slot);
    }
  }

  /** Number of workers decoding in parallel. */
  get size(): number {
    return this.slots.length;
  }

  /** Download and decode the SOG at `metaUrl` on the next free worker. */
  readonly decode: SogChunkDecoder = (url, origin) =>
    new Promise<DecodedSog>((resolve, reject) => {
      const stopped = this.closed ?? this.unavailable;
      if (stopped) {
        reject(stopped);
        return;
      }
      this.queue.push({ id: this.nextId++, url, origin, resolve, reject });
      this.pump();
    });

  /** Terminate every worker; pending and queued jobs reject with `reason`. */
  dispose(reason: Error = new Error('SOG decode pool disposed')): void {
    if (this.closed) return;
    this.closed = reason;
    for (const slot of this.slots) slot.worker.terminate();
    this.rejectAll(reason);
  }

  private pump(): void {
    for (const slot of this.slots) {
      if (slot.job) continue;
      const job = this.queue.shift();
      if (!job) return;
      slot.job = job;
      slot.worker.postMessage({
        type: 'decode',
        id: job.id,
        url: job.url,
        ...(job.origin ? { origin: Array.from(job.origin) } : {}),
      });
    }
  }

  private onMessage(slot: Slot, message: SogWorkerResponse): void {
    const job = slot.job;
    if (this.closed || !job || job.id !== message.id) return;
    slot.job = null;
    if (message.type === 'done') {
      job.resolve({
        buffer: new Uint32Array(message.buffer),
        meta: message.meta,
        ...(message.prepared ? { prepared: message.prepared } : {}),
      });
    } else if (message.unavailable) {
      this.fail(new SogWorkerUnavailable(message.message));
      job.reject(this.unavailable);
    } else {
      job.reject(new Error(message.message));
    }
    this.pump();
  }

  private fail(error: SogWorkerUnavailable): void {
    if (this.closed || this.unavailable) return;
    this.unavailable = error;
    for (const slot of this.slots) slot.worker.terminate();
    this.rejectAll(error);
  }

  private rejectAll(reason: Error): void {
    for (const slot of this.slots) {
      slot.job?.reject(reason);
      slot.job = null;
    }
    for (const job of this.queue.splice(0)) job.reject(reason);
  }
}
