/**
 * Orchestrates depth sorting of Gaussian splats against the live camera.
 *
 * The heavy sort runs through a pluggable [`SplatSorter`] (a Web Worker in
 * production, or a synchronous double in tests). Re-sorting only happens when
 * the camera has moved or rotated beyond a threshold, so a static view costs
 * nothing per frame. Results are tagged with a monotonic `generation` so that
 * out-of-order worker replies are discarded.
 */
import type { Vec3 } from "./splatSort";

/** A camera pose relevant to depth sorting. */
export interface CameraPose {
  readonly camPos: Vec3;
  readonly viewDir: Vec3;
}

/** Backend that performs the actual sort (worker or synchronous fallback). */
export interface SplatSorter {
  /**
   * Provide the splat positions (3 floats per splat). Called on splat change.
   * The sorter takes ownership of `positions` (a worker backend transfers its
   * buffer), so the caller must not reuse the array afterwards.
   */
  init(positions: Float32Array): void;
  /** Sort for a camera pose; invoke `done(indices, generation)` when ready. */
  sort(
    camPos: Vec3,
    viewDir: Vec3,
    generation: number,
    done: (indices: Uint32Array, generation: number) => void,
  ): void;
  /** Release any held resources (terminate the worker). */
  dispose(): void;
}

/** Default position move (world units) that triggers a re-sort. */
const DEFAULT_POS_THRESHOLD = 0.05;
/** Default view-direction change (1 - cos θ) that triggers a re-sort. */
const DEFAULT_DIR_THRESHOLD = 0.001;

function dist2(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Monotonic millisecond clock (falls back to `Date.now` where unavailable). */
function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Whether the camera moved enough since `prev` to warrant a re-sort.
 * Resorts unconditionally when `prev` is `null` (first frame).
 */
export function shouldResort(
  prev: CameraPose | null,
  next: CameraPose,
  posThreshold: number,
  dirThreshold: number,
): boolean {
  if (!prev) return true;
  if (dist2(prev.camPos, next.camPos) > posThreshold * posThreshold) return true;
  // 1 - cos(angle) between view directions (assumes roughly unit vectors).
  const cos = dot(prev.viewDir, next.viewDir);
  return 1 - cos > dirThreshold;
}

/**
 * Drives splat re-sorting and forwards fresh index buffers to `onSorted`.
 */
export class SplatSortController {
  private lastPose: CameraPose | null = null;
  private generation = 0;
  private latestDelivered = -1;
  private splatCount = 0;
  /**
   * Minimum interval (ms) between re-sorts. `0` = re-sort every qualifying
   * frame (realtime). A positive value caps the splat *refresh rate*: the
   * camera still renders every frame, but the (expensive) depth re-sort runs at
   * most once per interval, trading slightly staler ordering during fast motion
   * for lower worker load on very large clouds.
   */
  private minIntervalMs = 0;
  /** Timestamp (ms) of the last dispatched sort, for the refresh-rate gate. */
  private lastSortTime = Number.NEGATIVE_INFINITY;
  /** Latest camera pose skipped by the refresh-rate gate. */
  private pendingPose: CameraPose | null = null;
  /** Timer that guarantees a final resting sort when render-on-demand goes idle. */
  private refreshTimer: TimerHandle | null = null;

  constructor(
    private readonly sorter: SplatSorter,
    private readonly onSorted: (indices: Uint32Array) => void,
    private readonly posThreshold = DEFAULT_POS_THRESHOLD,
    private readonly dirThreshold = DEFAULT_DIR_THRESHOLD,
  ) {}

  /** Replace the splat set; resets sort state so the next frame re-sorts. */
  setSplats(positions: Float32Array): void {
    this.splatCount = positions.length / 3;
    this.lastPose = null;
    this.generation = 0;
    this.latestDelivered = -1;
    this.lastSortTime = Number.NEGATIVE_INFINITY;
    this.clearPendingRefresh();
    this.sorter.init(positions);
  }

  /** Notify of a new camera pose; triggers a sort if it moved enough. */
  onCamera(camPos: Vec3, viewDir: Vec3): void {
    if (this.splatCount === 0) return;
    const next: CameraPose = { camPos, viewDir };
    if (!shouldResort(this.lastPose, next, this.posThreshold, this.dirThreshold)) {
      return;
    }
    // Refresh-rate gate: skip (without committing the pose) until the interval
    // has elapsed, so a later frame within the same motion still re-sorts. The
    // final frame after the camera settles always passes, guaranteeing a
    // correct resting order.
    if (this.minIntervalMs > 0) {
      const now = nowMs();
      const elapsed = now - this.lastSortTime;
      if (elapsed < this.minIntervalMs) {
        this.pendingPose = next;
        this.schedulePendingRefresh(this.minIntervalMs - elapsed);
        return;
      }
      this.lastSortTime = now;
    }
    this.clearPendingRefresh();
    this.dispatchSort(next);
  }

  /**
   * Cap the re-sort (refresh) rate. `fps <= 0` means realtime (no cap). Also
   * clears the last-sort timestamp so the next `onCamera` isn't gated by a
   * stale timer after switching modes.
   */
  setRefreshFps(fps: number): void {
    this.minIntervalMs = fps > 0 ? 1000 / fps : 0;
    this.lastSortTime = Number.NEGATIVE_INFINITY;
    this.clearPendingRefresh();
  }

  /** Deliver a sort result, ignoring any that are older than the newest seen. */
  deliver(indices: Uint32Array, generation: number): void {
    if (generation < this.latestDelivered) return;
    this.latestDelivered = generation;
    this.onSorted(indices);
  }

  /** Force a re-sort on the next `onCamera` call. */
  invalidate(): void {
    this.lastPose = null;
    this.clearPendingRefresh();
  }

  dispose(): void {
    this.clearPendingRefresh();
    this.sorter.dispose();
  }

  private dispatchSort(next: CameraPose): void {
    this.lastPose = next;
    const generation = this.generation++;
    this.sorter.sort(next.camPos, next.viewDir, generation, (idx, gen) =>
      this.deliver(idx, gen),
    );
  }

  private schedulePendingRefresh(delayMs: number): void {
    if (this.refreshTimer !== null) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      const next = this.pendingPose;
      this.pendingPose = null;
      if (!next || this.splatCount === 0) return;
      this.lastSortTime = nowMs();
      this.dispatchSort(next);
    }, Math.max(0, delayMs));
  }

  private clearPendingRefresh(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.pendingPose = null;
  }
}
