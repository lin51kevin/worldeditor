import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MIN_LINE_PIXELS,
  createMinLineWidthSync,
  lineWidthBucket,
  minLineWidthForBucket,
} from './minLineWidthSync';

describe('minLineWidthForBucket', () => {
  it('keeps every mpp inside a bucket at or above MIN_LINE_PIXELS', () => {
    for (let mpp = 0.01; mpp < 4; mpp *= 1.03) {
      const px = minLineWidthForBucket(lineWidthBucket(mpp)) / mpp;
      expect(px).toBeGreaterThanOrEqual(MIN_LINE_PIXELS - 1e-9);
      expect(px).toBeLessThanOrEqual(MIN_LINE_PIXELS * Math.SQRT2 + 1e-9);
    }
  });
});

describe('createMinLineWidthSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('seeds immediately', () => {
    const apply = vi.fn();
    createMinLineWidthSync(apply).seed(0.1);
    expect(apply).toHaveBeenCalledWith(minLineWidthForBucket(lineWidthBucket(0.1)));
  });

  it('ignores scale changes inside the current bucket', () => {
    const apply = vi.fn();
    const sync = createMinLineWidthSync(apply);
    sync.seed(0.1);
    sync.update(0.1 * 1.05);
    vi.runAllTimers();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('applies the last bucket of a zoom gesture once, after the debounce', () => {
    const apply = vi.fn();
    const sync = createMinLineWidthSync(apply, 200);
    sync.seed(0.1);
    sync.update(0.2);
    sync.update(0.4);
    sync.update(0.45);
    expect(apply).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    expect(apply).toHaveBeenCalledTimes(2);
    const width = apply.mock.calls[1]![0] as number;
    // Sized for the coarsest zoom of the gesture, not the bucket-entry mpp.
    expect(width / 0.45).toBeGreaterThanOrEqual(MIN_LINE_PIXELS);
  });

  it('dispose cancels a pending apply', () => {
    const apply = vi.fn();
    const sync = createMinLineWidthSync(apply);
    sync.seed(0.1);
    sync.update(1);
    sync.dispose();
    vi.runAllTimers();
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
