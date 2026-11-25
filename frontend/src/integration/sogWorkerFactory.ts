/**
 * Inline decode-worker factory, kept apart from the pool so the pool and its
 * session stay free of bundler-specific imports.
 */
import type { SogWorkerLike } from './sogDecodePool';
import type { SogWorkerFactory } from './sogDecoderSession';

/** Resolve a factory for the bundled worker, or undefined where workers are unavailable. */
export async function loadSogWorkerFactory(): Promise<SogWorkerFactory | undefined> {
  if (typeof Worker === 'undefined') return undefined;
  try {
    const { default: SogDecodeWorker } = await import('./sogDecodeWorker.ts?worker&inline');
    return () => new SogDecodeWorker() as unknown as SogWorkerLike;
  } catch (error) {
    console.warn('[SOG] decode worker could not be loaded, decoding on the main thread', error);
    return undefined;
  }
}
