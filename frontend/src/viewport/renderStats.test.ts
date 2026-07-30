import { describe, expect, it } from 'vitest';
import {
  createFrameStatsState,
  updateFrameStats,
  frameTimeToFps,
} from './renderStats';

describe('renderStats', () => {
  it('records only the timestamp on the first frame', () => {
    const s = updateFrameStats(createFrameStatsState(), 1000);
    expect(s.lastRenderTs).toBe(1000);
    expect(s.frameTimeMs).toBe(0);
  });

  it('seeds the EMA with the first measured interval', () => {
    let s = updateFrameStats(createFrameStatsState(), 1000);
    s = updateFrameStats(s, 1016); // 16 ms interval
    expect(s.frameTimeMs).toBeCloseTo(16, 5);
    expect(s.lastRenderTs).toBe(1016);
  });

  it('smooths subsequent intervals toward the new sample', () => {
    let s = updateFrameStats(createFrameStatsState(), 1000);
    s = updateFrameStats(s, 1010); // seed 10 ms
    s = updateFrameStats(s, 1030); // 20 ms interval, blended with alpha 0.1
    // 10 + 0.1 * (20 - 10) = 11
    expect(s.frameTimeMs).toBeCloseTo(11, 5);
  });

  it('ignores stalls / idle-wake intervals above the cap', () => {
    let s = updateFrameStats(createFrameStatsState(), 1000);
    s = updateFrameStats(s, 1016); // seed 16 ms
    const seeded = s.frameTimeMs;
    s = updateFrameStats(s, 1016 + 5000); // 5 s gap (idle wake) — ignored
    expect(s.frameTimeMs).toBe(seeded);
    expect(s.lastRenderTs).toBe(1016 + 5000);
  });

  it('ignores non-advancing timestamps', () => {
    let s = updateFrameStats(createFrameStatsState(), 100);
    s = updateFrameStats(s, 116);
    const before = s.frameTimeMs;
    s = updateFrameStats(s, 116); // delta 0
    expect(s.frameTimeMs).toBe(before);
  });

  it('converts frame time to FPS and guards against divide-by-zero', () => {
    expect(frameTimeToFps(16)).toBeCloseTo(62.5, 5);
    expect(frameTimeToFps(0)).toBe(0);
  });
});
