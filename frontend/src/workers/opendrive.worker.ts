/**
 * Web Worker for OpenDRIVE XML parsing via WASM.
 *
 * Loads the WASM module independently from the main thread and performs
 * heavy XML parsing off the UI thread to prevent jank on large maps.
 *
 * Messages:
 *   IN:  { type: 'parse', xml: string, fileName: string }
 *   OUT: { type: 'progress', phase: string, percent: number }
 *   OUT: { type: 'result', project: object }
 *   OUT: { type: 'error', message: string }
 */

/* eslint-disable no-restricted-globals */

const ctx = self as unknown as Worker;

let wasmModule: typeof import('../../wasm/pkg/we_wasm') | null = null;
let wasmInitPromise: Promise<typeof import('../../wasm/pkg/we_wasm')> | null = null;

async function getWasm() {
  if (wasmModule) return wasmModule;
  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      const wasm = await import('../../wasm/pkg/we_wasm');
      await (wasm.default as unknown as () => Promise<void>)();
      wasmModule = wasm;
      return wasm;
    })().catch((err) => {
      wasmInitPromise = null;
      throw err;
    });
  }
  return wasmInitPromise;
}

ctx.addEventListener('message', async (event: MessageEvent) => {
  const { type } = event.data;

  if (type !== 'parse') {
    ctx.postMessage({ type: 'error', message: `Unknown message type: ${type}` });
    return;
  }

  const { xml, fileName } = event.data as { xml: string; fileName: string };

  try {
    // Phase: initializing WASM
    ctx.postMessage({ type: 'progress', phase: 'parsing', percent: 10 });

    const wasm = await getWasm();

    // Phase: parsing XML
    ctx.postMessage({ type: 'progress', phase: 'parsing', percent: 30 });

    const project = wasm.parse_opendrive(xml);

    // Phase: complete
    ctx.postMessage({ type: 'progress', phase: 'parsing', percent: 100 });
    ctx.postMessage({ type: 'result', project, fileName });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.postMessage({ type: 'error', message });
  }
});
