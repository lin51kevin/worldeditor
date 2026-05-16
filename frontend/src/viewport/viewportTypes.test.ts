import { describe, it, expect } from 'vitest';
import { resolveMouseDragAction, mouseButtonMask, computeGroundPanOffset } from './viewportTypes';

describe('viewportTypes utilities', () => {
  describe('resolveMouseDragAction', () => {
    it('returns orbit for right button (button=2)', () => {
      expect(resolveMouseDragAction(2, { ctrlKey: false, shiftKey: false })).toBe('orbit');
    });

    it('returns pan for middle button (button=1)', () => {
      expect(resolveMouseDragAction(1, { ctrlKey: false, shiftKey: false })).toBe('pan');
    });

    it('returns null for unknown button (e.g. button=3)', () => {
      expect(resolveMouseDragAction(3, { ctrlKey: false, shiftKey: false })).toBeNull();
    });

    it('returns pan for left button (button=0) without modifiers', () => {
      expect(resolveMouseDragAction(0, { ctrlKey: false, shiftKey: false })).toBe('pan');
    });

    it('returns orbit for left button + ctrlKey', () => {
      expect(resolveMouseDragAction(0, { ctrlKey: true, shiftKey: false })).toBe('orbit');
    });

    it('returns orbit for left button + shiftKey', () => {
      expect(resolveMouseDragAction(0, { ctrlKey: false, shiftKey: true })).toBe('orbit');
    });
  });

  describe('mouseButtonMask', () => {
    it('returns 1 for left button (button=0)', () => {
      expect(mouseButtonMask(0)).toBe(1);
    });

    it('returns 4 for middle button (button=1)', () => {
      expect(mouseButtonMask(1)).toBe(4);
    });

    it('returns 2 for right button (button=2)', () => {
      expect(mouseButtonMask(2)).toBe(2);
    });

    it('returns 0 for unknown button', () => {
      expect(mouseButtonMask(5)).toBe(0);
    });
  });

  describe('computeGroundPanOffset', () => {
    it('returns null when previous is null', () => {
      expect(computeGroundPanOffset(null, { x: 5, y: 5 })).toBeNull();
    });

    it('returns null when current is null', () => {
      expect(computeGroundPanOffset({ x: 5, y: 5 }, null)).toBeNull();
    });

    it('returns null when both are null', () => {
      expect(computeGroundPanOffset(null, null)).toBeNull();
    });

    it('returns difference (previous - current)', () => {
      const result = computeGroundPanOffset({ x: 10, y: 20 }, { x: 3, y: 7 });
      expect(result).toEqual({ x: 7, y: 13 });
    });

    it('handles negative offsets', () => {
      const result = computeGroundPanOffset({ x: 1, y: 2 }, { x: 5, y: 8 });
      expect(result).toEqual({ x: -4, y: -6 });
    });
  });
});
