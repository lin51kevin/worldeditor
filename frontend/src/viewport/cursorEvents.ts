/**
 * Lightweight cursor position event bus.
 * Bypasses React state to avoid re-renders on every mouse move.
 */

type CursorListener = (x: number, y: number) => void;
const listeners = new Set<CursorListener>();

export function onCursorMove(listener: CursorListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function emitCursorMove(x: number, y: number): void {
  for (const listener of listeners) {
    listener(x, y);
  }
}
