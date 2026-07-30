/**
 * Frame-rate statistics for the render loop.
 *
 * The renderer feeds each *actually drawn* frame's timestamp into
 * {@link updateFrameStats}, which keeps an exponential moving average (EMA) of
 * the frame interval so the reported FPS / frame time are smooth rather than
 * jittering on every frame. Consumers (e.g. the trajectory stats HUD) read the
 * snapshot via `ViewportRenderer.getRenderStats()`.
 */

/** Smoothed render-loop performance snapshot. */
export interface RenderStats {
  /** Smoothed frames per second (0 before any frame is drawn). */
  fps: number;
  /** Smoothed single-frame time in milliseconds (0 before any frame). */
  frameTimeMs: number;
  /** Number of Gaussian splats currently uploaded (scene + actor clouds). */
  splatCount: number;
  /** `performance.now()` timestamp of the most recent drawn frame (0 if none). */
  lastRenderTs: number;
}

/** Mutable accumulator the renderer keeps across frames. */
export interface FrameStatsState {
  /** EMA of the frame interval (ms); 0 until the first interval is seen. */
  frameTimeMs: number;
  /** Timestamp of the previous drawn frame (ms); 0 until the first frame. */
  lastRenderTs: number;
}

/** A fresh, zeroed accumulator. */
export function createFrameStatsState(): FrameStatsState {
  return { frameTimeMs: 0, lastRenderTs: 0 };
}

/** EMA smoothing factor: higher = snappier, lower = smoother. */
const FRAME_TIME_ALPHA = 0.1;

/**
 * Fold a newly drawn frame at `now` (ms) into `state`, returning a new state
 * (immutable update). The first call only records the timestamp; subsequent
 * calls blend the measured interval into the EMA. Intervals above `maxDeltaMs`
 * (a stall or a wake from idle) are ignored so they cannot skew the average.
 */
export function updateFrameStats(
  state: FrameStatsState,
  now: number,
  maxDeltaMs = 250,
): FrameStatsState {
  if (state.lastRenderTs <= 0) {
    return { frameTimeMs: state.frameTimeMs, lastRenderTs: now };
  }
  const delta = now - state.lastRenderTs;
  if (delta <= 0 || delta > maxDeltaMs) {
    return { frameTimeMs: state.frameTimeMs, lastRenderTs: now };
  }
  const frameTimeMs =
    state.frameTimeMs <= 0
      ? delta
      : state.frameTimeMs + FRAME_TIME_ALPHA * (delta - state.frameTimeMs);
  return { frameTimeMs, lastRenderTs: now };
}

/**
 * Derive the reported FPS from a smoothed frame time. Returns 0 when no frame
 * time has been measured yet (avoids an Infinity divide).
 */
export function frameTimeToFps(frameTimeMs: number): number {
  return frameTimeMs > 0 ? 1000 / frameTimeMs : 0;
}
