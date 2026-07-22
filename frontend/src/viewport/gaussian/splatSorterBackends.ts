/**
 * Concrete [`SplatSorter`] backends.
 *
 * - {@link MainThreadSplatSorter} sorts synchronously on the calling thread; a
 *   dependency-free fallback used when Web Workers are unavailable (and in
 *   tests).
 * - {@link createWorkerSplatSorter} offloads sorting to a dedicated Web Worker
 *   ({@link ./splatSortWorker}) so large clouds never block rendering.
 */
import type { SplatSorter } from './splatSortController';
import {
  prepareSplatSort,
  sortSplatsByDepth,
  type PreparedSplatSort,
  type Vec3,
} from './splatSort';
// Inline the worker (base64 blob) rather than emitting a separate chunk, so the
// rnk-next library build stays a single self-contained ESM file that can be
// vendored into host apps without shipping/serving an extra asset.
import SplatSortWorker from './splatSortWorker.ts?worker&inline';

/** Sorts on the main thread. Cheap fallback; fine for small clouds. */
export class MainThreadSplatSorter implements SplatSorter {
  private positions: Float32Array = new Float32Array(0);
  private prepared: PreparedSplatSort = prepareSplatSort(this.positions);

  init(positions: Float32Array): void {
    this.positions = positions;
    this.prepared = prepareSplatSort(positions);
  }

  sort(
    camPos: Vec3,
    viewDir: Vec3,
    generation: number,
    done: (indices: Uint32Array, visibleCount: number, generation: number) => void,
  ): void {
    const result = sortSplatsByDepth(this.positions, camPos, viewDir, this.prepared);
    done(result.indices, result.visibleCount, generation);
  }

  dispose(): void {
    this.positions = new Float32Array(0);
    this.prepared = prepareSplatSort(this.positions);
  }
}

/**
 * Create a Web Worker-backed sorter. Falls back to the main-thread sorter when
 * the `Worker` API is unavailable (e.g. during SSR or in a limited runtime).
 */
export function createWorkerSplatSorter(): SplatSorter {
  if (typeof Worker === 'undefined') {
    return new MainThreadSplatSorter();
  }

  const worker = new SplatSortWorker();

  const pending = new Map<
    number,
    (indices: Uint32Array, visibleCount: number, generation: number) => void
  >();

  worker.onmessage = (
    ev: MessageEvent<{
      type: string;
      indices: Uint32Array;
      visibleCount: number;
      generation: number;
    }>,
  ) => {
    if (ev.data.type === 'sorted') {
      const done = pending.get(ev.data.generation);
      if (!done) return;
      pending.delete(ev.data.generation);
      done(ev.data.indices, ev.data.visibleCount, ev.data.generation);
    }
  };

  return {
    init(positions: Float32Array): void {
      pending.clear();
      // Transfer ownership of the positions buffer to the worker (zero-copy) —
      // the caller relinquishes it, so no duplicate lives on the main thread.
      worker.postMessage({ type: 'init', positions }, [positions.buffer]);
    },
    sort(camPos, viewDir, generation, done): void {
      pending.set(generation, done);
      worker.postMessage({
        type: 'sort',
        camPos,
        viewDir,
        generation,
      });
    },
    dispose(): void {
      pending.clear();
      worker.terminate();
    },
  };
}
