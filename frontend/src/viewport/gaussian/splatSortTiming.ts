/**
 * Measures how long the GPU depth sort really takes, with timestamp queries, so
 * the sort rate can follow the hardware and the visible splat count instead of a
 * fixed estimate. Where the device lacks `timestamp-query` it stays inert and the
 * caller keeps its estimate.
 */

/** Smoothing of the measured sort time; one slow sample moves the average by this fraction. */
const EMA_WEIGHT = 0.3;
/** Timestamps are in nanoseconds. */
const NS_PER_MS = 1e6;

export class GpuSortTimer {
  private readonly querySet: GPUQuerySet | null = null;
  private readonly resolveBuffer: GPUBuffer | null = null;
  private readonly readBuffer: GPUBuffer | null = null;
  private pending = false;
  private _ms: number | null = null;

  constructor(device: GPUDevice) {
    if (!device.features?.has?.("timestamp-query") || typeof device.createQuerySet !== "function") return;
    try {
      this.querySet = device.createQuerySet({ type: "timestamp", count: 2 });
      this.resolveBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      this.readBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    } catch {
      this.querySet = null;
    }
  }

  /** Smoothed duration of the whole sort in ms, or `null` until measured / when unsupported. */
  get ms(): number | null {
    return this._ms;
  }

  /** Query set to stamp this sort with, or `null` when unsupported or the last sample is still being read. */
  begin(): GPUQuerySet | null {
    return this.pending ? null : this.querySet;
  }

  /** Resolve the stamps after the sort was encoded, and read them back once the frame is submitted. */
  end(encoder: GPUCommandEncoder, stamped: boolean): void {
    if (!stamped || !this.querySet || !this.resolveBuffer || !this.readBuffer) return;
    this.pending = true;
    encoder.resolveQuerySet(this.querySet, 0, 2, this.resolveBuffer, 0);
    encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readBuffer, 0, 16);
    // The frame is submitted in the same task; the read is queued behind it.
    setTimeout(() => void this.read(), 0);
  }

  private async read(): Promise<void> {
    const buffer = this.readBuffer!;
    try {
      await buffer.mapAsync(GPUMapMode.READ);
      const stamps = new BigUint64Array(buffer.getMappedRange().slice(0));
      buffer.unmap();
      const elapsed = Number(stamps[1]! - stamps[0]!) / NS_PER_MS;
      if (elapsed > 0 && Number.isFinite(elapsed)) {
        this._ms = this._ms === null ? elapsed : this._ms + (elapsed - this._ms) * EMA_WEIGHT;
      }
    } catch {
      // A lost device or unsubmitted frame: keep the previous estimate.
    } finally {
      this.pending = false;
    }
  }

  dispose(): void {
    this.querySet?.destroy();
    this.resolveBuffer?.destroy();
    this.readBuffer?.destroy();
  }
}
