/**
 * gizmoController.ts — Manages 3D translate/rotate/scale gizmo interaction.
 *
 * Tracks gizmo state and computes drag deltas for the active axis.
 */

export type GizmoAxis = 'X' | 'Y' | 'Z' | 'All';
export type GizmoMode = 'translate' | 'rotate' | 'scale';

export interface GizmoState {
  position: [number, number, number];
  mode: GizmoMode;
  hovered: GizmoAxis | null;
  active: GizmoAxis | null;
  scale: number;
}

export interface GizmoDelta {
  axis: GizmoAxis;
  value: number;
}

/** Creates the initial gizmo state. */
export function createGizmoState(position?: [number, number, number]): GizmoState {
  return {
    position: position ?? [0, 0, 0],
    mode: 'translate',
    hovered: null,
    active: null,
    scale: 1,
  };
}

/** Set the active axis when the user starts dragging. */
export function startDrag(state: GizmoState, axis: GizmoAxis): GizmoState {
  return { ...state, active: axis };
}

/** Clear the active axis when the user releases. */
export function endDrag(state: GizmoState): GizmoState {
  return { ...state, active: null };
}

/** Update hovered axis (from mouse-over hit testing). */
export function setHovered(state: GizmoState, axis: GizmoAxis | null): GizmoState {
  if (state.hovered === axis) return state;
  return { ...state, hovered: axis };
}

/** Switch the gizmo mode. */
export function setMode(state: GizmoState, mode: GizmoMode): GizmoState {
  return { ...state, mode };
}

/** Compute a world-space translation delta from screen drag (dx, dy) in pixels. */
export function computeTranslateDelta(
  state: GizmoState,
  dx: number,
  dy: number,
  pixelsPerUnit: number,
): GizmoDelta | null {
  if (!state.active || state.mode !== 'translate') return null;
  const units = (dx - dy) / pixelsPerUnit; // simplified 1D projection
  return { axis: state.active, value: units };
}

/** Apply a translation delta to the gizmo position. */
export function applyTranslate(state: GizmoState, delta: GizmoDelta): GizmoState {
  const pos: [number, number, number] = [...state.position];
  switch (delta.axis) {
    case 'X': pos[0] += delta.value; break;
    case 'Y': pos[1] += delta.value; break;
    case 'Z': pos[2] += delta.value; break;
    case 'All': pos[0] += delta.value; pos[1] += delta.value; break;
  }
  return { ...state, position: pos };
}
