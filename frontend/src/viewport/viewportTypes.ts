/** Traffic signal data (billboard icon). */
export interface SignalData {
  x: number;
  y: number;
  z: number;
  iconType: string;
  rotation: number;
  scale: number;
}

/** Road object data (3D geometry). */
export interface ObjectData {
  x: number;
  y: number;
  z: number;
  objectType: string;
  rotation: number;
  width: number;
  height: number;
  depth: number;
}

/** Marking edge data. */
export interface MarkingData {
  vertices: Float32Array;
  markType: string;
  color: [number, number, number, number];
}

export type MouseDragAction = 'pan' | 'orbit';

export function resolveMouseDragAction(
  button: number,
  modifiers: Pick<MouseEvent, 'ctrlKey' | 'shiftKey'>,
): MouseDragAction | null {
  if (button === 2) return 'orbit';
  if (button === 1) return 'pan';
  if (button !== 0) return null;
  return modifiers.ctrlKey || modifiers.shiftKey ? 'orbit' : 'pan';
}

export function mouseButtonMask(button: number): number {
  switch (button) {
    case 0:
      return 1;
    case 1:
      return 4;
    case 2:
      return 2;
    default:
      return 0;
  }
}

export function computeGroundPanOffset(
  previous: { x: number; y: number } | null,
  current: { x: number; y: number } | null,
): { x: number; y: number } | null {
  if (!previous || !current) return null;
  return {
    x: previous.x - current.x,
    y: previous.y - current.y,
  };
}
