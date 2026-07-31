import { describe, expect, it } from 'vitest';
import { snapAngleFromPrev } from './drawConstraints';

describe('snapAngleFromPrev', () => {
  it('snaps a near-horizontal segment to exactly 0 degrees', () => {
    const [x, y] = snapAngleFromPrev([0, 0], [10, 1]);
    expect(x).toBeCloseTo(Math.hypot(10, 1), 6);
    expect(y).toBeCloseTo(0, 6);
  });

  it('snaps a near-45-degree segment to exactly 45 degrees', () => {
    const dist = Math.hypot(10, 9);
    const [x, y] = snapAngleFromPrev([0, 0], [10, 9]);
    expect(x).toBeCloseTo((dist * Math.SQRT2) / 2, 6);
    expect(y).toBeCloseTo((dist * Math.SQRT2) / 2, 6);
  });

  it('preserves segment length', () => {
    const prev: [number, number] = [3, 4];
    const cur: [number, number] = [20, 7];
    const original = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    const [x, y] = snapAngleFromPrev(prev, cur);
    expect(Math.hypot(x - prev[0], y - prev[1])).toBeCloseTo(original, 6);
  });

  it('honours a custom step of 90 degrees', () => {
    // A segment pointing mostly up should snap to straight up (90°).
    const [x, y] = snapAngleFromPrev([0, 0], [1, 10], 90);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(Math.hypot(1, 10), 6);
  });

  it('returns the point unchanged when it coincides with prev', () => {
    expect(snapAngleFromPrev([5, 5], [5, 5])).toEqual([5, 5]);
  });
});
