/**
 * Renderer mouse controls — extracted from renderer.ts.
 *
 * Handles canvas-level mouse interactions for:
 * - Tangent handle dragging (control point manipulation)
 * - Camera panning/orbiting (delegated to CameraController)
 * - Wheel zoom
 *
 * This module is responsible for attaching/detaching DOM event listeners
 * on the canvas element and coordinating with the renderer's marker system.
 */

import { applyHandleDrag } from './tangentHandleController';
import type { ControlPointRef } from './tangentHandleController';
import type { CameraController } from './cameraController';
import type { MarkerRenderer } from './markerRenderer';

export interface MouseControlsCallbacks {
  onTangentChanged: ((index: number, tangent: [number, number, number]) => void) | null;
  onControlPointHovered: ((ref: ControlPointRef | null) => void) | null;
  onControlPointSelected: ((ref: ControlPointRef | null) => void) | null;
}

export interface MouseControlsDeps {
  cameraController: CameraController;
  markerRenderer: MarkerRenderer;
  callbacks: MouseControlsCallbacks;
  pickControlPointAtScreen: (sx: number, sy: number) => ControlPointRef | null;
  unprojectToGround: (sx: number, sy: number) => { x: number; y: number } | null;
  getMetersPerPixel: () => number;
  refreshSplineMarkers: (hovered?: ControlPointRef | null, selected?: ControlPointRef | null) => void;
  markSceneDirty: () => void;
  clearColor: { r: number; g: number; b: number; a: number };
}

/**
 * Attach mouse controls to the canvas.
 * Returns a dispose function to remove all listeners.
 */
export function setupMouseControls(
  canvas: HTMLCanvasElement,
  deps: MouseControlsDeps,
): () => void {
  let activeDragHandle: ControlPointRef | null = null;
  let onDocMove: ((e: MouseEvent) => void) | null = null;
  let onDocUp: (() => void) | null = null;

  const detachDocListeners = () => {
    if (onDocMove) { document.removeEventListener('mousemove', onDocMove); onDocMove = null; }
    if (onDocUp) { document.removeEventListener('mouseup', onDocUp); onDocUp = null; }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (deps.cameraController.pointerDragging || activeDragHandle) return;
    if (deps.markerRenderer.knotCount === 0) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const hit = deps.pickControlPointAtScreen(sx, sy);
    if (hit?.index !== deps.markerRenderer.hovered?.index || hit?.type !== deps.markerRenderer.hovered?.type) {
      deps.callbacks.onControlPointHovered?.(hit);
      deps.refreshSplineMarkers(hit, undefined);
    }
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (e.button === 0 && deps.markerRenderer.knotCount >= 2) {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const hit = deps.pickControlPointAtScreen(sx, sy);
      if (hit && (hit.type === 'in' || hit.type === 'out')) {
        activeDragHandle = hit;
        deps.callbacks.onControlPointSelected?.(hit);
        deps.refreshSplineMarkers(undefined, hit);
        canvas.style.cursor = 'crosshair';
        e.stopPropagation();

        detachDocListeners();
        onDocMove = (me: MouseEvent) => {
          if (!activeDragHandle) return;
          const rect2 = canvas.getBoundingClientRect();
          const sx2 = me.clientX - rect2.left;
          const sy2 = me.clientY - rect2.top;
          const world = deps.unprojectToGround(sx2, sy2);
          if (!world) return;
          const newOverrides = applyHandleDrag(
            activeDragHandle,
            world.x,
            world.y,
            deps.markerRenderer.knots,
            deps.markerRenderer.tangentOverrides,
            {},
          );
          deps.markerRenderer.setTangentOverrides(newOverrides.out);
          const idx = activeDragHandle.index;
          const tangent = newOverrides.out[idx];
          if (tangent) deps.callbacks.onTangentChanged?.(idx, tangent);
          const mpp = deps.getMetersPerPixel();
          deps.markerRenderer.refreshSplineCurve(mpp);
          deps.markerRenderer.refreshSplineMarkers(mpp, deps.clearColor);
          deps.markSceneDirty();
        };

        onDocUp = () => {
          canvas.style.cursor = '';
          activeDragHandle = null;
          detachDocListeners();
        };

        document.addEventListener('mousemove', onDocMove);
        document.addEventListener('mouseup', onDocUp);
        return;
      }
    }

    if (!deps.cameraController.beginPointerDrag(e.button, e)) return;
    canvas.style.cursor = 'grabbing';
    detachDocListeners();

    onDocMove = (me: MouseEvent) => {
      if (!deps.cameraController.updatePointerDrag(canvas, me)) {
        canvas.style.cursor = '';
        detachDocListeners();
      }
    };

    onDocUp = () => {
      canvas.style.cursor = '';
      deps.cameraController.endPointerDrag();
      detachDocListeners();
    };

    document.addEventListener('mousemove', onDocMove);
    document.addEventListener('mouseup', onDocUp);
  };

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    deps.cameraController.handleWheel(e.deltaY, e.clientX - rect.left, e.clientY - rect.top);
  };

  const handleContextMenu = (e: MouseEvent) => e.preventDefault();

  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('wheel', handleWheel, { passive: false });
  canvas.addEventListener('contextmenu', handleContextMenu);

  // Return dispose function
  return () => {
    detachDocListeners();
    canvas.removeEventListener('mousemove', handleMouseMove);
    canvas.removeEventListener('mousedown', handleMouseDown);
    canvas.removeEventListener('wheel', handleWheel);
    canvas.removeEventListener('contextmenu', handleContextMenu);
  };
}
