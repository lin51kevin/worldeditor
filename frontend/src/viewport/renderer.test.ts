import { describe, expect, it } from 'vitest';
import { computeGroundPanOffset, resolveMouseDragAction } from './renderer';

describe('resolveMouseDragAction', () => {
  it('maps plain left-button drag to pan', () => {
    expect(resolveMouseDragAction(0, { ctrlKey: false, shiftKey: false })).toBe('pan');
  });

  it('maps right-button drag to orbit', () => {
    expect(resolveMouseDragAction(2, { ctrlKey: false, shiftKey: false })).toBe('orbit');
  });

  it('maps modified left-button drag to orbit', () => {
    expect(resolveMouseDragAction(0, { ctrlKey: true, shiftKey: false })).toBe('orbit');
    expect(resolveMouseDragAction(0, { ctrlKey: false, shiftKey: true })).toBe('orbit');
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
