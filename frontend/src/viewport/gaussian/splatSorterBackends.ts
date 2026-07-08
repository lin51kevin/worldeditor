/**
 * Concrete [`SplatSorter`] backends.
 *
 * - {@link MainThreadSplatSorter} sorts synchronously on the calling thread; a
 *   dependency-free fallback used when Web Workers are unavailable (and in
 *   tests).
 * - {@link createWorkerSplatSorter} offloads sorting to a dedicated Web Worker
 *   ({@link ./splatSortWorker}) so large clouds never block rendering.
 */
import type { SplatSorter } from "./splatSortController";
import { sortSplatsByDepth, type Vec3 } from "./splatSort";
// Inline the worker (base64 blob) rather than emitting a separate chunk, so the
// rnk-next library build stays a single self-contained ESM file that can be
// vendored into host apps without shipping/serving an extra asset.
import SplatSortWorker from "./splatSortWorker.ts?worker&inline";

/** Sorts on the main thread. Cheap fallback; fine for small clouds. */
export class MainThreadSplatSorter implements SplatSorter {
  private positions: Float32Array = new Float32Array(0);

  init(positions: Float32Array): void {
    this.positions = positions;
  }

  sort(
    camPos: Vec3,
    viewDir: Vec3,
    generation: number,
    done: (indices: Uint32Array, generation: number) => void,
  ): void {
    done(sortSplatsByDepth(this.positions, camPos, viewDir), generation);
  }

  dispose(): void {
    this.positions = new Float32Array(0);
  }
}

/**
 * Create a Web Worker-backed sorter. Falls back to the main-thread sorter when
 * the `Worker` API is unavailable (e.g. during SSR or in a limited runtime).
 */
export function createWorkerSplatSorter(): SplatSorter {
  if (typeof Worker === "undefined") {
    return new MainThreadSplatSorter();
  }

  const worker = new SplatSortWorker();

  let pending: ((indices: Uint32Array, generation: number) => void) | null =
    null;

  worker.onmessage = (
    ev: MessageEvent<{ type: string; indices: Uint32Array; generation: number }>,
  ) => {
    if (ev.data.type === "sorted" && pending) {
      pending(ev.data.indices, ev.data.generation);
    }
  };

  return {
    init(positions: Float32Array): void {
      // Copy so the caller keeps ownership of its buffer.
      const copy = positions.slice();
      worker.postMessage({ type: "init", positions: copy }, [copy.buffer]);
    },
    sort(camPos, viewDir, generation, done): void {
      pending = done;
      worker.postMessage({
        type: "sort",
        camPos,
        viewDir,
        generation,
      });
    },
    dispose(): void {
      worker.terminate();
    },
  };
}
