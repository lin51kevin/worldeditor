/**
 * viewportRef — module-level reference to the active ViewportRenderer instance.
 *
 * This allows external code (like the snapshot dialog) to call renderer methods
 * without threading refs through the entire component tree.
 * Set by Viewport on mount, cleared on unmount.
 */
import type { ViewportRenderer } from './renderer';

let _renderer: ViewportRenderer | null = null;

/** Set the active renderer reference (called by Viewport on mount). */
export function setViewportRenderer(renderer: ViewportRenderer | null): void {
  _renderer = renderer;
}

/** Get the active renderer reference (may be null if viewport not mounted). */
export function getViewportRenderer(): ViewportRenderer | null {
  return _renderer;
}
