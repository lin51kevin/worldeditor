import { describe, it, expect, vi } from 'vitest';
import { shouldResort, SplatSortController, type SplatSorter } from './splatSortController';
import { MainThreadSplatSorter } from './splatSorterBackends';

describe('shouldResort', () => {
  const camA = { camPos: [0, 0, 0] as const, viewDir: [0, 0, 1] as const };

  it('resorts on the first request (no previous)', () => {
    expect(shouldResort(null, camA, 0.1, 0.02)).toBe(true);
  });

  it('skips when camera barely moved', () => {
    const camB = { camPos: [0.01, 0, 0] as const, viewDir: [0, 0, 1] as const };
    expect(shouldResort(camA, camB, 0.1, 0.02)).toBe(false);
  });

  it('resorts when position moves beyond threshold', () => {
    const camB = { camPos: [0.5, 0, 0] as const, viewDir: [0, 0, 1] as const };
    expect(shouldResort(camA, camB, 0.1, 0.02)).toBe(true);
  });

  it('resorts when the view direction rotates beyond threshold', () => {
    const camB = {
      camPos: [0, 0, 0] as const,
      viewDir: [0.2, 0, 0.98] as const,
    };
    expect(shouldResort(camA, camB, 0.1, 0.02)).toBe(true);
  });

  it('uses a strict angular threshold', () => {
    const threshold = 0.02;
    const atThreshold = {
      camPos: camA.camPos,
      viewDir: [Math.sin(threshold), 0, Math.cos(threshold)] as const,
    };
    const beyondThreshold = {
      camPos: camA.camPos,
      viewDir: [Math.sin(threshold + 0.001), 0, Math.cos(threshold + 0.001)] as const,
    };
    expect(shouldResort(camA, atThreshold, 0.1, threshold)).toBe(false);
    expect(shouldResort(camA, beyondThreshold, 0.1, threshold)).toBe(true);
  });
});

describe('SplatSortController', () => {
  /** Synchronous in-line sorter used as a test double for the worker. */
  function fakeSorter(): SplatSorter & { calls: number } {
    const s = {
      calls: 0,
      positions: new Float32Array(0),
      init(p: Float32Array) {
        this.positions = p;
      },
      sort(camPos, viewDir, generation, done) {
        this.calls++;
        // Trivial identity order sized to the splat count.
        const n = this.positions.length / 3;
        const idx = new Uint32Array(n);
        for (let i = 0; i < n; i++) idx[i] = i;
        done(idx, n, generation);
      },
      dispose() {},
    } as SplatSorter & { calls: number };
    return s;
  }

  it('sorts on first frame then skips tiny camera moves', () => {
    const sorter = fakeSorter();
    const onSorted = vi.fn();
    const ctrl = new SplatSortController(sorter, onSorted);
    ctrl.setSplats(new Float32Array([0, 0, 0, 0, 0, 1]));

    ctrl.onCamera([0, 0, 0], [0, 0, 1]);
    expect(sorter.calls).toBe(1);
    expect(onSorted).toHaveBeenCalledTimes(1);

    // Negligible move: no resort.
    ctrl.onCamera([0.000001, 0, 0], [0, 0, 1]);
    expect(sorter.calls).toBe(1);

    // Large move: resort.
    ctrl.onCamera([5, 0, 0], [0, 0, 1]);
    expect(sorter.calls).toBe(2);
  });

  it('ignores stale async results even when the older result arrives first', () => {
    const pending: Record<
      number,
      (indices: Uint32Array, visibleCount: number, generation: number) => void
    > = {};
    const sorter: SplatSorter = {
      init() {},
      sort(_camPos, _viewDir, generation, done) {
        pending[generation] = done;
      },
      dispose() {},
    };
    const onSorted = vi.fn();
    const ctrl = new SplatSortController(sorter, onSorted);
    ctrl.setSplats(new Float32Array([0, 0, 0]));

    ctrl.onCamera([0, 0, 0], [0, 0, 1]); // generation 0
    ctrl.onCamera([9, 0, 0], [0, 0, 1]); // generation 1

    const oldIndices = new Uint32Array([0]);
    const newIndices = new Uint32Array([1]);
    pending[0]!(oldIndices, 1, 0);
    pending[1]!(newIndices, 1, 1);
    expect(onSorted).toHaveBeenCalledTimes(1);
    expect(onSorted).toHaveBeenLastCalledWith(newIndices, 1);
  });

  it('clears state and skips sorting when no splats', () => {
    const sorter = fakeSorter();
    const ctrl = new SplatSortController(sorter, vi.fn());
    ctrl.setSplats(new Float32Array(0));
    ctrl.onCamera([0, 0, 0], [0, 0, 1]);
    expect(sorter.calls).toBe(0);
  });

  it('caps the re-sort rate via setRefreshFps', () => {
    const now = vi.spyOn(performance, 'now');
    try {
      const sorter = fakeSorter();
      const ctrl = new SplatSortController(sorter, vi.fn());
      ctrl.setSplats(new Float32Array([0, 0, 0, 0, 0, 1]));
      ctrl.setRefreshFps(10); // min 100ms between re-sorts

      now.mockReturnValue(0);
      ctrl.onCamera([0, 0, 0], [0, 0, 1]);
      expect(sorter.calls).toBe(1); // first sort passes

      // A large move only 50ms later is gated (< 100ms interval).
      now.mockReturnValue(50);
      ctrl.onCamera([5, 0, 0], [0, 0, 1]);
      expect(sorter.calls).toBe(1);

      // Once the interval elapses, the next qualifying move re-sorts.
      now.mockReturnValue(150);
      ctrl.onCamera([10, 0, 0], [0, 0, 1]);
      expect(sorter.calls).toBe(2);
    } finally {
      now.mockRestore();
    }
  });

  it('dispatches a delayed final sort when refresh-rate gating skips a camera move', () => {
    vi.useFakeTimers();
    const now = vi.spyOn(performance, 'now');
    try {
      const sorter = fakeSorter();
      const ctrl = new SplatSortController(sorter, vi.fn());
      ctrl.setSplats(new Float32Array([0, 0, 0, 0, 0, 1]));
      ctrl.setRefreshFps(10); // min 100ms between re-sorts

      now.mockReturnValue(0);
      ctrl.onCamera([0, 0, 0], [0, 0, 1]);
      expect(sorter.calls).toBe(1);

      now.mockReturnValue(50);
      ctrl.onCamera([5, 0, 0], [0, 0, 1]);
      expect(sorter.calls).toBe(1);

      now.mockReturnValue(100);
      vi.advanceTimersByTime(50);
      expect(sorter.calls).toBe(2);
    } finally {
      now.mockRestore();
      vi.useRealTimers();
    }
  });

  it('uses cloud scale so movement re-sorts a small scene', () => {
    const sorter = fakeSorter();
    const ctrl = new SplatSortController(sorter, vi.fn());
    ctrl.setSplats(new Float32Array([0, 0, 0, 0, 0, 0.01]));

    ctrl.onCamera([0, 0, 0], [0, 0, 1]);
    ctrl.onCamera([0.0001, 0, 0], [0, 0, 1]);

    expect(sorter.calls).toBe(2);
  });

  it('integrates with the main-thread sorter to produce back-to-front order', () => {
    const onSorted = vi.fn();
    const ctrl = new SplatSortController(new MainThreadSplatSorter(), onSorted);
    // Splats at z = 1, 3, 2.
    ctrl.setSplats(new Float32Array([0, 0, 1, 0, 0, 3, 0, 0, 2]));
    ctrl.onCamera([0, 0, 0], [0, 0, 1]);
    expect(onSorted).toHaveBeenCalledTimes(1);
    const idx = onSorted.mock.calls[0][0] as Uint32Array;
    expect(Array.from(idx)).toEqual([1, 2, 0]);
    expect(onSorted).toHaveBeenLastCalledWith(idx, 3);
  });
});
