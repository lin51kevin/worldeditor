/**
 * Lightweight event bus for viewport commands.
 *
 * Allows UI components (MenuBar, Toolbar) to send commands to the viewport
 * renderer without needing a direct reference.
 */

export type ViewportEvent =
  | { type: 'zoom-to-fit' }
  | { type: 'zoom-to-selected'; roadId: string }
  | { type: 'zoom-to-junction'; junctionId: string }
  | { type: 'pan-to-road'; roadId: string }
  | { type: 'pan-to-junction'; junctionId: string }
  | { type: 'pan-to-signal'; roadId: string; signalId: string }
  | { type: 'pan-to-object'; roadId: string; objectId: string }
  | { type: 'pan-to-lane'; roadId: string; sectionIndex: number; laneId: number }
  | { type: 'set-dimension'; dimension: '3d' | '2d' }
  | { type: 'set-show-grid'; show: boolean }
  | { type: 'set-show-axis'; show: boolean }
  | { type: 'capture-screenshot'; filename?: string };

type ViewportEventListener = (event: ViewportEvent) => void;

const listeners = new Set<ViewportEventListener>();

/** Subscribe to viewport events. Returns an unsubscribe function. */
export function onViewportEvent(listener: ViewportEventListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Emit a viewport event to all subscribers. */
export function emitViewportEvent(event: ViewportEvent): void {
  for (const listener of listeners) {
    listener(event);
  }
}
