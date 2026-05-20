/**
 * Idle-aware render-loop scheduler.
 *
 * Replaces the naive rAF loop that runs every frame even when nothing changes.
 * When `onDirty()` returns false (scene and camera are both clean), the loop
 * stops scheduling further frames. The next call to `markDirty()` wakes it up.
 *
 * Usage:
 *   const loop = createRenderLoop({
 *     onRender: () => { renderFrame(); },
 *     isDirty:  () => sceneDirty || cameraController.isViewDirty,
 *     onDirtyCleared: () => { /* re-enable dirty flags *\/ },
 *   });
 *   loop.start();
 *   // Later: sceneDirty = true → loop.wakeUp() is called automatically by markSceneDirty
 */

export interface RenderLoopOptions {
  /** Called every frame (only when dirty — skipped on idle). */
  onRender: () => void;
  /** Returns true when there is work to do. */
  isDirty: () => boolean;
  /** Called after onRender to reset dirty flags. */
  onDirtyCleared: () => void;
  /** Provide an alternative rAF implementation (for testing). */
  rafProvider?: (cb: (ts: number) => void) => number;
  /** Provide an alternative cancel implementation (for testing). */
  cafProvider?: (id: number) => void;
}

export interface RenderLoop {
  /** Start (or resume) the loop. Safe to call when already running. */
  start: () => void;
  /** Halt the loop immediately. */
  stop: () => void;
  /** Wake the loop from idle (called by markSceneDirty / camera events). */
  wakeUp: () => void;
  /** Returns true when the loop is actively scheduled. */
  isRunning: () => boolean;
}

/** Creates an idle-aware render loop. */
export function createRenderLoop(options: RenderLoopOptions): RenderLoop {
  const raf = options.rafProvider ?? requestAnimationFrame.bind(window);
  const caf = options.cafProvider ?? cancelAnimationFrame.bind(window);

  let animFrameId = 0;
  let running = false;

  function loop(_ts: number): void {
    if (!running) return;

    if (options.isDirty()) {
      options.onRender();
      options.onDirtyCleared();
      animFrameId = raf(loop);
    } else {
      // Nothing to do — stop scheduling until wakeUp() is called.
      running = false;
      animFrameId = 0;
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      animFrameId = raf(loop);
    },

    stop() {
      running = false;
      if (animFrameId !== 0) {
        caf(animFrameId);
        animFrameId = 0;
      }
    },

    wakeUp() {
      if (!running) {
        running = true;
        animFrameId = raf(loop);
      }
    },

    isRunning() {
      return running;
    },
  };
}
