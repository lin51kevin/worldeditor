import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { FlyKeyboardController } from './flyControls';

describe('FlyKeyboardController', () => {
  let ctrl: FlyKeyboardController;

  beforeEach(() => {
    ctrl = new FlyKeyboardController();
  });

  afterEach(() => {
    ctrl.detach();
  });

  it('starts detached', () => {
    expect(ctrl.attached).toBe(false);
  });

  it('attach sets attached to true', () => {
    ctrl.attach();
    expect(ctrl.attached).toBe(true);
  });

  it('detach sets attached to false', () => {
    ctrl.attach();
    ctrl.detach();
    expect(ctrl.attached).toBe(false);
  });

  it('double attach is safe', () => {
    ctrl.attach();
    ctrl.attach();
    expect(ctrl.attached).toBe(true);
  });

  it('returns zero movement when no keys pressed', () => {
    ctrl.attach();
    const mv = ctrl.getMovementVector();
    expect(mv.forward).toBe(0);
    expect(mv.right).toBe(0);
    expect(mv.up).toBe(0);
    expect(mv.sprint).toBe(false);
  });

  it('tracks W key as forward', () => {
    ctrl.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    const mv = ctrl.getMovementVector();
    expect(mv.forward).toBe(1);
    expect(ctrl.isAnyKeyPressed()).toBe(true);
  });

  it('tracks S key as backward', () => {
    ctrl.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    expect(ctrl.getMovementVector().forward).toBe(-1);
  });

  it('tracks A key as left', () => {
    ctrl.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(ctrl.getMovementVector().right).toBe(-1);
  });

  it('tracks D key as right', () => {
    ctrl.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    expect(ctrl.getMovementVector().right).toBe(1);
  });

  it('tracks E key as up', () => {
    ctrl.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
    expect(ctrl.getMovementVector().up).toBe(1);
  });

  it('tracks Q key as down', () => {
    ctrl.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
    expect(ctrl.getMovementVector().up).toBe(-1);
  });

  it('tracks Shift as sprint', () => {
    ctrl.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    expect(ctrl.getMovementVector().sprint).toBe(true);
  });

  it('releases key on keyup', () => {
    ctrl.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    expect(ctrl.getMovementVector().forward).toBe(1);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }));
    expect(ctrl.getMovementVector().forward).toBe(0);
    expect(ctrl.isAnyKeyPressed()).toBe(false);
  });

  it('clears all keys on window blur', () => {
    ctrl.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(ctrl.isAnyKeyPressed()).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(ctrl.isAnyKeyPressed()).toBe(false);
  });

  it('W and S cancel out', () => {
    ctrl.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    expect(ctrl.getMovementVector().forward).toBe(0);
  });

  it('clears keys on detach', () => {
    ctrl.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    ctrl.detach();
    expect(ctrl.isAnyKeyPressed()).toBe(false);
  });

  it('ignores non-tracked keys', () => {
    ctrl.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }));
    expect(ctrl.isAnyKeyPressed()).toBe(false);
    expect(ctrl.getMovementVector().forward).toBe(0);
  });
});
