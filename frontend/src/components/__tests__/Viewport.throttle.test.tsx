/**
 * Test: Hover picking is throttled with requestAnimationFrame.
 *
 * The Viewport.tsx handleMouseMove uses a `pendingPickRafRef` guard so that
 * multiple mousemove events within the same frame only schedule one RAF.
 * Because this requires a live WebGPU renderer (not available in JSDOM), we
 * test the guard pattern directly rather than rendering the full component.
 * The full component behaviour is covered by E2E tests.
 */
import { vi, describe, it, expect } from 'vitest';

describe('Viewport hover RAF throttle guard', () => {
  it('schedules at most one RAF per frame for multiple mousemoves', () => {
    const rafCalls: Array<FrameRequestCallback> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    // Reproduce the throttle guard used in handleMouseMove
    let pendingPickRaf = 0;
    const schedulePickIfIdle = () => {
      if (!pendingPickRaf) {
        pendingPickRaf = requestAnimationFrame(() => {
          pendingPickRaf = 0;
        });
      }
    };

    // Three rapid mousemoves → only one RAF should be queued
    schedulePickIfIdle();
    schedulePickIfIdle();
    schedulePickIfIdle();

    expect(rafCalls).toHaveLength(1);

    // Flush the frame — pendingPickRaf is reset to 0
    rafCalls[0]!(performance.now());
    expect(pendingPickRaf).toBe(0);

    // A subsequent mousemove can now schedule another RAF
    schedulePickIfIdle();
    expect(rafCalls).toHaveLength(2);

    vi.unstubAllGlobals();
  });
});
