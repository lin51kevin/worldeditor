import { useState, useCallback, type RefObject } from 'react';
import { ViewportRenderer } from '../viewport/renderer';
import { emitViewportEvent } from '../viewport/viewportEvents';
import { useProjectStore } from '../stores/projectStore';
import { usePluginContribStore } from '../stores/pluginContribStore';
import { useFileLoader } from './useFileLoader';

/** Accepted file extensions for drag-and-drop open. */
const ACCEPTED_EXTENSIONS = ['.xodr', '.xml'];

function isAcceptedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function hasFileDrag(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files');
}

/**
 * Handles template panel drag-drop into the viewport to create elements,
 * and file drag-drop to open OpenDRIVE maps.
 */
export function useViewportDrop(
  rendererRef: RefObject<ViewportRenderer | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const { loadFromDrop } = useFileLoader();

  const hasTemplateDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes('application/we-template-id');

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (hasTemplateDrag(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    } else if (hasFileDrag(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsFileDragOver(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (hasTemplateDrag(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    } else if (hasFileDrag(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
      setIsFileDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setIsFileDragOver(false);

    // Template drop
    const templateId = e.dataTransfer.getData('application/we-template-id');
    if (templateId) {
      const canvas = canvasRef.current;
      const renderer = rendererRef.current;
      if (!canvas || !renderer) return;

      const rect = canvas.getBoundingClientRect();
      const screenX = (e.clientX - rect.left) * devicePixelRatio;
      const screenY = (e.clientY - rect.top) * devicePixelRatio;
      const worldPos = renderer.unprojectToGround(screenX, screenY);
      if (!worldPos) return;

      const sections = usePluginContribStore.getState().templateSections;
      const item = sections.flatMap((s) => s.items).find((i) => i.id === templateId);
      if (item) {
        item.onApply({ x: worldPos.x, y: worldPos.y, hdg: 0 });
        const { selectedRoadId, selectedJunctionId } = useProjectStore.getState();
        if (selectedRoadId) {
          emitViewportEvent({ type: 'pan-to-road', roadId: selectedRoadId });
        } else if (selectedJunctionId) {
          emitViewportEvent({ type: 'pan-to-junction', junctionId: selectedJunctionId });
        }
      }
      return;
    }

    // File drop
    const files = Array.from(e.dataTransfer.files);
    const acceptedFile = files.find(isAcceptedFile);
    if (acceptedFile) {
      loadFromDrop(acceptedFile);
    }
  }, [canvasRef, rendererRef, loadFromDrop]);

  return { isDragOver, isFileDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
