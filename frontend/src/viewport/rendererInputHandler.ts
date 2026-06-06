/**
 * Renderer camera mouse controls — handles orbit/pan/zoom + fly mode.
 *
 * Separate from mouseControls.ts which handles tangent handle editing.
 * This module manages canvas-level camera interactions for the viewport renderer.
 */

import type { CameraController } from './cameraController';
import type { MarkerRenderer } from './markerRenderer';
import type { FlyKeyboardController } from './flyControls';
import type { RenderLoop } from './renderLoop';
import type { ControlPointRef } from './tangentHandleController';
import { isDrawMode, useViewportStore } from '../stores/viewportStore';

export interface RendererInputDeps {
  cameraController: CameraController;
  markerRenderer: MarkerRenderer;
  flyKeyboard: FlyKeyboardController;
  getRenderLoop: () => RenderLoop | null;
  pickControlPointAtScreen: (sx: number, sy: number) => ControlPointRef | null;
  refreshSplineMarkers: (hovered?: ControlPointRef | null, selected?: ControlPointRef | null) => void;
  onControlPointHovered: () => ((ref: ControlPointRef | null) => void) | null;
  markSceneDirty: () => void;
}

/**
 * Attach camera mouse controls to the canvas.
 * Returns a dispose function that removes all listeners.
 */
export function setupRendererInput(
  canvas: HTMLCanvasElement,
  deps: RendererInputDeps,
): () => void {
  let onDocMove: ((e: MouseEvent) => void) | null = null;
  let onDocUp: (() => void) | null = null;

  const detachDocListeners = () => {
    if (onDocMove) { document.removeEventListener('mousemove', onDocMove); onDocMove = null; }
    if (onDocUp) { document.removeEventListener('mouseup', onDocUp); onDocUp = null; }
  };

  const exitFlyModeCleanup = () => {
    deps.flyKeyboard.detach();
    useViewportStore.getState().setFlyMode(false);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (deps.cameraController.pointerDragging) return;
    if (deps.markerRenderer.knotCount === 0) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const hit = deps.pickControlPointAtScreen(sx, sy);
    if (hit?.index !== deps.markerRenderer.hovered?.index || hit?.type !== deps.markerRenderer.hovered?.type) {
      deps.onControlPointHovered()?.(hit);
      deps.refreshSplineMarkers(hit, undefined);
    }
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (e.button === 0 && deps.markerRenderer.knotCount >= 2) {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const hit = deps.pickControlPointAtScreen(sx, sy);
      if (hit) return;
    }

    if (e.button === 2 && isDrawMode(useViewportStore.getState().editMode)) return;

    if (!deps.cameraController.beginPointerDrag(e.button, e)) return;

    if (deps.cameraController.isFlyMode) {
      canvas.style.cursor = 'crosshair';
      deps.flyKeyboard.attach(() => deps.getRenderLoop()?.wakeUp());
      useViewportStore.getState().setFlyMode(true);
      deps.getRenderLoop()?.wakeUp();
    } else {
      canvas.style.cursor = 'grabbing';
    }

    detachDocListeners();

    onDocMove = (me: MouseEvent) => {
      if (!deps.cameraController.updatePointerDrag(canvas, me)) {
        canvas.style.cursor = '';
        detachDocListeners();
      }
    };

    onDocUp = () => {
      canvas.style.cursor = '';
      if (deps.cameraController.isFlyMode) {
        exitFlyModeCleanup();
      }
      deps.cameraController.endPointerDrag();
      detachDocListeners();
    };

    document.addEventListener('mousemove', onDocMove);
    document.addEventListener('mouseup', onDocUp);
  };

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    deps.cameraController.handleWheel(e.deltaY);
  };

  const handleContextMenu = (e: MouseEvent) => e.preventDefault();

  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('wheel', handleWheel, { passive: false });
  canvas.addEventListener('contextmenu', handleContextMenu);

  return () => {
    detachDocListeners();
    canvas.removeEventListener('mousemove', handleMouseMove);
    canvas.removeEventListener('mousedown', handleMouseDown);
    canvas.removeEventListener('wheel', handleWheel);
    canvas.removeEventListener('contextmenu', handleContextMenu);
  };
}
