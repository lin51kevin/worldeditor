import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onViewportEvent, emitViewportEvent, type ViewportEvent } from './viewportEvents';

describe('viewportEvents', () => {
  beforeEach(() => {
    // The module uses a module-level Set, so we can't easily reset between tests.
    // Tests should unsubscribe their own listeners.
  });

  it('should deliver events to a subscriber', () => {
    const handler = vi.fn();
    const unsub = onViewportEvent(handler);

    emitViewportEvent({ type: 'zoom-to-fit' });
    expect(handler).toHaveBeenCalledWith({ type: 'zoom-to-fit' });

    unsub();
  });

  it('should not deliver events after unsubscribe', () => {
    const handler = vi.fn();
    const unsub = onViewportEvent(handler);

    unsub();
    emitViewportEvent({ type: 'zoom-to-fit' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should deliver to multiple subscribers', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const u1 = onViewportEvent(h1);
    const u2 = onViewportEvent(h2);

    emitViewportEvent({ type: 'set-show-grid', show: false });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);

    u1();
    u2();
  });

  it('should only unsubscribe the specific listener', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const u1 = onViewportEvent(h1);
    const u2 = onViewportEvent(h2);

    u1();
    emitViewportEvent({ type: 'zoom-to-fit' });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledTimes(1);

    u2();
  });

  it('should pass through typed payloads correctly', () => {
    const handler = vi.fn();
    const unsub = onViewportEvent(handler);

    const events: ViewportEvent[] = [
      { type: 'zoom-to-selected', roadId: 'road-1' },
      { type: 'zoom-to-junction', junctionId: 'junc-2' },
      { type: 'pan-to-road', roadId: 'road-3' },
      { type: 'pan-to-junction', junctionId: 'junc-4' },
      { type: 'set-dimension', dimension: '2d' },
      { type: 'set-show-grid', show: true },
      { type: 'set-show-axis', show: false },
    ];

    for (const ev of events) {
      emitViewportEvent(ev);
    }

    expect(handler).toHaveBeenCalledTimes(events.length);
    events.forEach((ev, i) => {
      expect(handler).toHaveBeenNthCalledWith(i + 1, ev);
    });

    unsub();
  });

  it('should handle emit with no subscribers without error', () => {
    // Just ensure no throw
    expect(() => emitViewportEvent({ type: 'zoom-to-fit' })).not.toThrow();
  });

  it('should allow double-unsubscribe without error', () => {
    const handler = vi.fn();
    const unsub = onViewportEvent(handler);
    unsub();
    expect(() => unsub()).not.toThrow();
  });
});
