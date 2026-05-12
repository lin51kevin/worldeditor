import { describe, it, expect } from 'vitest';
import {
  createGizmoState, startDrag, endDrag, setHovered, setMode,
  computeTranslateDelta, applyTranslate,
} from './gizmoController';

describe('gizmoController', () => {
  it('creates default state', () => {
    const s = createGizmoState();
    expect(s.mode).toBe('translate');
    expect(s.hovered).toBeNull();
    expect(s.active).toBeNull();
    expect(s.position).toEqual([0, 0, 0]);
  });

  it('startDrag sets active axis', () => {
    const s = startDrag(createGizmoState(), 'X');
    expect(s.active).toBe('X');
  });

  it('endDrag clears active axis', () => {
    const s = endDrag(startDrag(createGizmoState(), 'Y'));
    expect(s.active).toBeNull();
  });

  it('setHovered updates hovered', () => {
    const s = setHovered(createGizmoState(), 'Z');
    expect(s.hovered).toBe('Z');
  });

  it('setMode changes mode', () => {
    const s = setMode(createGizmoState(), 'rotate');
    expect(s.mode).toBe('rotate');
  });

  it('computeTranslateDelta returns null without active axis', () => {
    expect(computeTranslateDelta(createGizmoState(), 10, 0, 100)).toBeNull();
  });

  it('computeTranslateDelta returns delta when active', () => {
    const s = startDrag(createGizmoState(), 'X');
    const d = computeTranslateDelta(s, 100, 0, 100);
    expect(d).not.toBeNull();
    expect(d?.axis).toBe('X');
  });

  it('applyTranslate moves X', () => {
    const s = applyTranslate(createGizmoState([0, 0, 0]), { axis: 'X', value: 5 });
    expect(s.position[0]).toBe(5);
    expect(s.position[1]).toBe(0);
  });

  it('applyTranslate moves Y', () => {
    const s = applyTranslate(createGizmoState([1, 2, 3]), { axis: 'Y', value: -1 });
    expect(s.position[1]).toBe(1);
  });
});
