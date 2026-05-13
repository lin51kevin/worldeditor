import { useState, useCallback, type RefObject } from 'react';
import { ViewportRenderer } from '../viewport/renderer';
import { emitViewportEvent } from '../viewport/viewportEvents';
import { useEditorStore } from '../stores/editorStore';
import { usePluginContribStore } from '../stores/pluginContribStore';

/**
 * Handles template panel drag-drop into the viewport to create elements.
 */
export function useViewportDrop(
  rendererRef: RefObject<ViewportRenderer | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
) {
  const [isDragOver, setIsDragOver] = useState(false);

  const hasTemplateDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes('application/we-template-id');

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (hasTemplateDrag(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (hasTemplateDrag(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const templateId = e.dataTransfer.getData('application/we-template-id');
    if (!templateId) return;

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
      const { selectedRoadId, selectedJunctionId } = useEditorStore.getState();
      if (selectedRoadId) {
        emitViewportEvent({ type: 'pan-to-road', roadId: selectedRoadId });
      } else if (selectedJunctionId) {
        emitViewportEvent({ type: 'pan-to-junction', junctionId: selectedJunctionId });
      }
    }
  }, [canvasRef, rendererRef]);

  return { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
