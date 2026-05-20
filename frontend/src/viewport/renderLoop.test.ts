import { describe, expect, it, vi } from 'vitest';
import { createRenderLoop } from './renderLoop';

/**
 * renderLoop idle-stop unit tests.
 *
 * The loop state machine:
 *   start()  → schedules loop via rAF, sets running=true immediately
 *   loop()    → if dirty: render + reschedule; if clean: running=false (idle)
 *   wakeUp()  → if not running: reschedules, running=true
 *   stop()    → cancels rAF, running=false
 *
 * Invariant: isRunning() = true ⇔ a rAF callback is currently scheduled.
 */

describe('renderLoop idle-stop', () => {
  let scheduledCb: ((ts: number) => void) | null = null;
  let nextId = 1;

  const rafMock = vi.fn((cb: (ts: number) => void) => {
    scheduledCb = cb;
    return nextId++;
  });
  const cafMock = vi.fn((_id: number) => {
    scheduledCb = null;
  });

  const isDirty = vi.fn(() => false);
  const onRender = vi.fn();
  const onDirtyCleared = vi.fn();

  function makeLoop() {
    isDirty.mockReset();
    onRender.mockReset();
    onDirtyCleared.mockReset();
    rafMock.mockReset();
    cafMock.mockReset();
    scheduledCb = null;
    nextId = 1;

    return createRenderLoop({
      isDirty,
      onRender,
      onDirtyCleared,
      rafProvider: rafMock,
      cafProvider: cafMock,
    });
  }

  /** Advance the mock rAF by one tick; isDirty return value is controlled by the mock. */
  function advanceTick(dirty: boolean) {
    isDirty.mockReturnValueOnce(dirty);
    scheduledCb?.(0);
  }

  // ── start() ──────────────────────────────────────────────────────────────

  it('onRender is NOT called synchronously on start() (loop is async)', () => {
    isDirty.mockReturnValue(true);
    const loop = makeLoop();
    loop.start();
    // rAF schedules the loop for the next frame; onRender fires on the tick.
    expect(onRender).not.toHaveBeenCalled();
  });

  it('renders on first tick when dirty', () => {
    isDirty.mockReturnValue(true);
    const loop = makeLoop();
    loop.start();
    advanceTick(true);
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it('onRender is NOT called when scene is clean on first tick', () => {
    isDirty.mockReturnValue(false);
    const loop = makeLoop();
    loop.start();
    advanceTick(false);
    expect(onRender).not.toHaveBeenCalled();
  });

  // ── idle-stop ────────────────────────────────────────────────────────────

  it('loop stops (isRunning=false) after first clean tick', () => {
    isDirty.mockReturnValue(false);
    const loop = makeLoop();
    loop.start();
    expect(loop.isRunning()).toBe(true); // scheduled
    advanceTick(false); // clean → loop stops itself
    expect(loop.isRunning()).toBe(false);
  });

  it('loop continues (isRunning=true) after dirty tick', () => {
    isDirty.mockReturnValue(true);
    const loop = makeLoop();
    loop.start();
    advanceTick(true);
    expect(loop.isRunning()).toBe(true); // rescheduled
  });

  // ── wakeUp ──────────────────────────────────────────────────────────────

  it('wakeUp resumes a stopped loop', () => {
    isDirty.mockReturnValue(false);
    const loop = makeLoop();
    loop.start();
    advanceTick(false); // idle
    expect(loop.isRunning()).toBe(false);

    isDirty.mockReturnValue(true);
    loop.wakeUp();
    expect(loop.isRunning()).toBe(true); // re-scheduled
    expect(rafMock).toHaveBeenCalled();
  });

  it('wakeUp while loop is already running is a no-op (no extra rAF)', () => {
    isDirty.mockReturnValue(true);
    const loop = makeLoop();
    loop.start();
    advanceTick(true); // running
    const rafCountBefore = rafMock.mock.calls.length;
    loop.wakeUp();
    expect(rafMock.mock.calls.length).toBe(rafCountBefore);
  });

  // ── stop ─────────────────────────────────────────────────────────────────

  it('stop cancels pending rAF and sets isRunning=false', () => {
    isDirty.mockReturnValue(true);
    const loop = makeLoop();
    loop.start();
    loop.stop();
    expect(cafMock).toHaveBeenCalled();
    expect(loop.isRunning()).toBe(false);
  });

  it('stop while not running is a no-op', () => {
    const loop = makeLoop();
    loop.stop(); // no crash
    expect(cafMock).not.toHaveBeenCalled();
  });
});
