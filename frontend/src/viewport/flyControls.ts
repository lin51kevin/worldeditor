/**
 * Fly mode keyboard controller — tracks WASD/QE/Shift key states
 * for Unreal Engine-style free-roaming camera navigation.
 *
 * Usage:
 * 1. Call `attach()` to start listening for keyboard events
 * 2. Each frame, call `getMovementVector()` to get direction input
 * 3. Call `detach()` when fly mode ends
 */

export interface FlyMovement {
  /** Forward/backward: +1 = forward (W), -1 = backward (S) */
  forward: number;
  /** Right/left: +1 = right (D), -1 = left (A) */
  right: number;
  /** Up/down: +1 = up (E), -1 = down (Q) */
  up: number;
  /** Whether sprint (Shift) is held */
  sprint: boolean;
}

export class FlyKeyboardController {
  private keys = new Set<string>();
  private _onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private _onKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private _onBlur: (() => void) | null = null;
  private _attached = false;

  /** Start listening for keyboard events on the window.
   * @param wakeUp Optional callback called whenever a tracked key is pressed,
   *   used to restart an idle render loop so fly movement is processed immediately.
   */
  attach(wakeUp?: () => void): void {
    if (this._attached) return;
    this._attached = true;
    this.keys.clear();

    this._onKeyDown = (e: KeyboardEvent) => {
      // Ignore events from text inputs
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      ) return;

      const key = e.key.toLowerCase();
      if (this.isTrackedKey(key)) {
        e.preventDefault();
        this.keys.add(key);
        // Wake the render loop so fly movement is processed even when the
        // loop went idle between pointer-lock entry and the first key press.
        wakeUp?.();
      }
    };

    this._onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      this.keys.delete(key);
      // Also clear 'shift' by checking e.shiftKey
      if (key === 'shift') this.keys.delete('shift');
    };

    this._onBlur = () => {
      this.keys.clear();
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  /** Stop listening for keyboard events and clear all key states. */
  detach(): void {
    if (!this._attached) return;
    this._attached = false;

    if (this._onKeyDown) window.removeEventListener('keydown', this._onKeyDown);
    if (this._onKeyUp) window.removeEventListener('keyup', this._onKeyUp);
    if (this._onBlur) window.removeEventListener('blur', this._onBlur);
    this._onKeyDown = null;
    this._onKeyUp = null;
    this._onBlur = null;
    this.keys.clear();
  }

  /** Get the current movement vector based on pressed keys. */
  getMovementVector(): FlyMovement {
    let forward = 0;
    let right = 0;
    let up = 0;

    if (this.keys.has('w')) forward += 1;
    if (this.keys.has('s')) forward -= 1;
    if (this.keys.has('d')) right += 1;
    if (this.keys.has('a')) right -= 1;
    if (this.keys.has('e')) up += 1;
    if (this.keys.has('q')) up -= 1;

    return {
      forward,
      right,
      up,
      sprint: this.keys.has('shift'),
    };
  }

  /** Whether any movement key is currently pressed. */
  isAnyKeyPressed(): boolean {
    return this.keys.has('w') || this.keys.has('s') ||
      this.keys.has('a') || this.keys.has('d') ||
      this.keys.has('q') || this.keys.has('e');
  }

  /** Whether the controller is currently listening. */
  get attached(): boolean {
    return this._attached;
  }

  private isTrackedKey(key: string): boolean {
    return key === 'w' || key === 's' || key === 'a' || key === 'd' ||
      key === 'q' || key === 'e' || key === 'shift';
  }
}
