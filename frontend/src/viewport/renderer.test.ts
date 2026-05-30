import { describe, expect, it } from 'vitest';
import { computeGroundPanOffset, resolveMouseDragAction } from './renderer';

describe('resolveMouseDragAction', () => {
  it('maps plain left-button drag to pan', () => {
    expect(resolveMouseDragAction(0, { ctrlKey: false, shiftKey: false, altKey: false })).toBe('pan');
  });

  it('maps right-button drag to fly in 3D (default)', () => {
    expect(resolveMouseDragAction(2, { ctrlKey: false, shiftKey: false, altKey: false })).toBe('fly');
  });

  it('maps right-button drag to orbit in 2D', () => {
    expect(resolveMouseDragAction(2, { ctrlKey: false, shiftKey: false, altKey: false }, '2d')).toBe('orbit');
  });

  it('maps modified left-button drag to orbit', () => {
    expect(resolveMouseDragAction(0, { ctrlKey: true, shiftKey: false, altKey: false })).toBe('orbit');
    expect(resolveMouseDragAction(0, { ctrlKey: false, shiftKey: true, altKey: false })).toBe('orbit');
  });
});

describe('computeGroundPanOffset', () => {
  it('moves the camera opposite to cursor travel so content follows the drag', () => {
    expect(computeGroundPanOffset({ x: 10, y: 5 }, { x: 14, y: 9 })).toEqual({ x: -4, y: -4 });
  });

  it('returns null when a ground intersection is unavailable', () => {
    expect(computeGroundPanOffset(null, { x: 14, y: 9 })).toBeNull();
    expect(computeGroundPanOffset({ x: 10, y: 5 }, null)).toBeNull();
  });
});
