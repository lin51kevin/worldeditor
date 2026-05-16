import { describe, it, expect, afterEach } from 'vitest';
import { onCursorMove, emitCursorMove } from './cursorEvents';

// cursorEvents.ts uses a module-level Set, so we need to clean up listeners
// after each test to avoid cross-test interference.

describe('cursorEvents', () => {
  const unsubscribers: Array<() => void> = [];

  afterEach(() => {
    // Unsubscribe all registered listeners
    for (const unsub of unsubscribers) unsub();
    unsubscribers.length = 0;
  });

  describe('onCursorMove / emitCursorMove', () => {
    it('should invoke registered listener with correct coordinates', () => {
      let receivedX = 0, receivedY = 0;
      const unsub = onCursorMove((x, y) => {
        receivedX = x;
        receivedY = y;
      });
      unsubscribers.push(unsub);

      emitCursorMove(42, 99);
      expect(receivedX).toBe(42);
      expect(receivedY).toBe(99);
    });

    it('should invoke multiple listeners', () => {
      const calls: Array<[number, number]> = [];
      const u1 = onCursorMove((x, y) => calls.push([x, y]));
      const u2 = onCursorMove((x, y) => calls.push([x, y]));
      unsubscribers.push(u1, u2);

      emitCursorMove(1, 2);
      expect(calls).toHaveLength(2);
    });

    it('should stop calling listener after unsubscribe', () => {
      let callCount = 0;
      const unsub = onCursorMove(() => { callCount++; });
      emitCursorMove(1, 2);
      expect(callCount).toBe(1);

      unsub(); // unsubscribe
      emitCursorMove(3, 4);
      expect(callCount).toBe(1); // not called again
    });

    it('unsubscribing twice should not throw', () => {
      const unsub = onCursorMove(() => {});
      unsub();
      expect(() => unsub()).not.toThrow();
    });

    it('should emit to zero listeners without error', () => {
      expect(() => emitCursorMove(0, 0)).not.toThrow();
    });
  });
});
