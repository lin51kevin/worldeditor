/**
 * Web Worker body of {@link SogDecodePool}: owns one WASM instance and decodes
 * one SOG dataset per request. Bundled inline (`?worker&inline`) by the SDK.
 */
import initWasm, {
  free_gaussian_splats,
  gaussian_splat_buffer_sh,
  gaussian_splat_meta,
  sog_add_image,
  sog_decode,
  sog_free,
  sog_open,
  sog_required_files,
} from '../../wasm/pkg/we_wasm';
import { decodeFetched, fetchSogFiles, type SogWasm } from './sogLoader';
import type { SogWorkerRequest, SogWorkerResponse } from './sogDecodePool';
import { prepareSplatSlices, type PreparedSplatChunk } from '../viewport/gaussian/splatPrepare';

const ctx = self as unknown as {
  postMessage(message: SogWorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<SogWorkerRequest>) => void) | null;
};

let ready: Promise<SogWasm> | null = null;

// Named imports keep the inline bundle to the decode path instead of the whole glue.
const bindings = {
  sog_open,
  sog_required_files,
  sog_add_image,
  sog_decode,
  sog_free,
  gaussian_splat_meta,
  gaussian_splat_buffer_sh,
  free_gaussian_splats,
} as unknown as SogWasm;

function start(source: unknown): Promise<SogWasm> {
  return (initWasm as unknown as (input: unknown) => Promise<unknown>)({ module_or_path: source }).then(
    () => bindings,
  );
}

/** Own the typed array's backing store so it can be transferred without a copy. */
function transferable(view: Uint32Array): ArrayBuffer {
  const whole = view.byteOffset === 0 && view.buffer.byteLength === view.byteLength;
  return (whole ? view.buffer : view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)) as ArrayBuffer;
}

async function decode(id: number, url: string, origin: number[] | undefined): Promise<void> {
  let wasm: SogWasm;
  try {
    wasm = await (ready ?? Promise.reject(new Error('SOG worker was not initialised')));
  } catch (error) {
    ctx.postMessage({ type: 'fail', id, message: messageOf(error), unavailable: true });
    return;
  }
  try {
    const decoded = decodeFetched(wasm, await fetchSogFiles(wasm, url, {}), origin);
    // Repack for the GPU here so the main thread only has to hand rows to writeTexture.
    const prepared = prepareSplatSlices(decoded.buffer, decoded.meta.shDegree);
    const buffer = transferable(decoded.buffer);
    ctx.postMessage({ type: 'done', id, buffer, meta: decoded.meta, prepared }, [buffer, ...planeBuffers(prepared)]);
  } catch (error) {
    ctx.postMessage({ type: 'fail', id, message: messageOf(error) });
  }
}

function planeBuffers(slices: PreparedSplatChunk[]): ArrayBuffer[] {
  return slices.flatMap((s) => [s.transform, s.features, s.positions, s.radii, s.opacity].map((p) => p.buffer as ArrayBuffer));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

ctx.onmessage = (event) => {
  const request = event.data;
  if (request.type === 'init') {
    ready = start(request.source);
    // A failed init is reported against the first job rather than as an unhandled rejection.
    ready.catch(() => undefined);
  } else {
    void decode(request.id, request.url, request.origin);
  }
};
