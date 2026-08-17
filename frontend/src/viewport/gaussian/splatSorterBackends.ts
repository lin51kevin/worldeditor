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

/** Only report round-trips slow enough to be visible as an unsorted frame. */
const SLOW_SORT_LOG_MS = 100;

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
    frustum?: Float32Array | null,
  ): void {
    const result = sortSplatsByDepth(this.positions, camPos, viewDir, this.prepared, frustum);
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
export function createWorkerSplatSorter(label = 'splat'): SplatSorter {
  if (typeof Worker === 'undefined') {
    return new MainThreadSplatSorter();
  }

  const worker = new SplatSortWorker();

  interface PendingSort {
    done: (indices: Uint32Array, visibleCount: number, generation: number) => void;
    epoch: number;
    postedAt: number;
  }
  const pending = new Map<number, PendingSort>();

  // Backpressure for `init`: keep at most one positions upload in flight. While
  // one is unacknowledged, stash only the LATEST positions (replacing any
  // previous stash, whose buffer is GC'd since it was never transferred) and
  // send it once the worker acks. Without this, playback posts a fresh
  // (transferred) positions buffer every frame and, when the worker can't keep
  // up, the queued messages pin their buffers and grow memory until a crash.
  let initInFlight = false;
  let stashedInit: Float32Array | null = null;
  // Bumped on every `init`. While positions are stashed the worker still holds
  // the PREVIOUS cloud, so a sort it answers is sized for that cloud — callers
  // must never apply it to the new one (they would keep an unsorted order and
  // render visibly smeared). Sorts are therefore held back until the stashed
  // positions are posted, and any straggler from an older epoch is discarded.
  let epoch = 0;
  let deferredSort: (() => void) | null = null;

  const postInit = (positions: Float32Array): void => {
    initInFlight = true;
    // Transfer ownership of the positions buffer to the worker (zero-copy) —
    // the caller relinquishes it, so no duplicate lives on the main thread.
    worker.postMessage({ type: 'init', positions }, [positions.buffer]);
  };

  worker.onmessage = (
    ev: MessageEvent<{
      type: string;
      indices: Uint32Array;
      visibleCount: number;
      generation: number;
    }>,
  ) => {
    if (ev.data.type === 'inited') {
      initInFlight = false;
      if (stashedInit) {
        const next = stashedInit;
        stashedInit = null;
        postInit(next);
      }
      // The worker's queue now ends with the current positions, so a held-back
      // sort posted here is answered against them.
      const run = deferredSort;
      deferredSort = null;
      run?.();
      return;
    }
    if (ev.data.type === 'sorted') {
      const entry = pending.get(ev.data.generation);
      if (!entry) return;
      pending.delete(ev.data.generation);
      const elapsed = performance.now() - entry.postedAt;
      // Until the sort lands the cloud renders in its previous (or identity)
      // order, so a slow one is directly visible as smearing.
      if (elapsed >= SLOW_SORT_LOG_MS) {
        console.info(
          `[splatSort:${label}] ${ev.data.indices.length} splats sorted in ${elapsed.toFixed(0)}ms`,
        );
      }
      if (entry.epoch !== epoch) {
        console.info(
          `[splatSort:${label}] discarded a result for superseded positions ` +
            `(epoch ${entry.epoch} vs ${epoch})`,
        );
        return;
      }
      entry.done(ev.data.indices, ev.data.visibleCount, ev.data.generation);
    }
  };

  return {
    init(positions: Float32Array): void {
      pending.clear();
      deferredSort = null;
      epoch++;
      if (initInFlight) {
        // Coalesce: keep only the newest positions until the worker is free.
        stashedInit = positions;
      } else {
        postInit(positions);
      }
    },
    sort(camPos, viewDir, generation, done, frustum): void {
      const post = (): void => {
        pending.set(generation, { done, epoch, postedAt: performance.now() });
        worker.postMessage({
          type: 'sort',
          camPos,
          viewDir,
          generation,
          frustum: frustum ?? null,
        });
      };
      if (stashedInit) {
        deferredSort = post;
        return;
      }
      post();
    },
    dispose(): void {
      pending.clear();
      stashedInit = null;
      deferredSort = null;
      initInFlight = false;
      worker.terminate();
    },
  };
}
