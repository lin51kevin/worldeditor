/**
 * Viewport keyboard shortcuts — Escape (deselect/cancel) and Delete.
 *
 * Extracted from Viewport.tsx to keep the component focused on rendering
 * and mouse interaction.
 */
import { useEffect } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { isDrawMode, useViewportStore } from '../stores/viewportStore';

/**
 * Registers global keydown handlers for viewport-level shortcuts:
 *   - **Escape**: cancel pending template, exit draw/move/rotate mode,
 *     clear measurement points, deselect
 *   - **Delete**: delete selected road/junction/signal/object
 */
export function useViewportKeyboard(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const viewState = useViewportStore.getState();
      const inDrawMode = isDrawMode(viewState.editMode);
      const target = event.target;
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (!event.ctrlKey && !event.altKey && !event.metaKey && !isTypingTarget) {
        const editorState = useProjectStore.getState();
        if (editorState.selectedRoadId && (event.key === '1' || event.key === '2' || event.key === '3')) {
          if (inDrawMode) {
            viewState.clearSplineKnots();
          }
          if (viewState.editMode !== 'default') {
            viewState.setEditMode('default');
          }

          const nextSelectionMode = event.key === '1' ? 'road' : event.key === '2' ? 'laneSection' : 'lane';
          if (nextSelectionMode === 'road') {
            editorState.clearLaneSelection();
          } else if (nextSelectionMode === 'laneSection' && editorState.selectedLaneSectionIndex !== null) {
            editorState.setSelectedLaneSection(editorState.selectedRoadId, editorState.selectedLaneSectionIndex);
          }

          viewState.setSelectionMode(nextSelectionMode);
          event.preventDefault();
          return;
        }
      }

      if (event.key === 'Escape') {
        // Pending click-to-place mode takes priority — cancel it first
        if (viewState.pendingTemplateId) {
          viewState.clearPendingTemplate();
          return;
        }
        // Cancel polygon drawing in progress
        if (viewState.objectDrawTemplateId) {
          viewState.clearObjectDraw();
          return;
        }
        if (viewState.pendingObjectTemplateId) {
          viewState.clearPendingObjectTemplate();
          return;
        }
        if (viewState.editMode === 'placeSignal' || viewState.editMode === 'placeObject') {
          viewState.setEditMode('default');
          return;
        }
        // Clear measurement points when in measure mode
        if (viewState.measureMode !== 'none') {
          viewState.clearMeasurePoints();
          return;
        }
        if (viewState.geometryEditRoadId || inDrawMode) {
          return;
        }
        if (viewState.editMode === 'move-road' || viewState.editMode === 'rotate-road' || viewState.editMode === 'editLaneLine') {
          viewState.setEditMode('default');
          useProjectStore.getState().selectRoad(null);
          return;
        }
        const editorState = useProjectStore.getState();
        if (
          editorState.selectedRoadId ||
          editorState.selectedJunctionId ||
          editorState.selectedRoadIds.length > 0 ||
          editorState.selectedJunctionIds.length > 0
        ) {
          editorState.selectRoad(null);
        }
        return;
      }

      // Backspace: undo last polygon vertex
      if (event.key === 'Backspace' && viewState.objectDrawTemplateId) {
        if (viewState.objectDrawVertices.length > 0) {
          viewState.popObjectDrawVertex();
        } else {
          viewState.clearObjectDraw();
        }
        return;
      }

      if (
        event.key === 'Delete' &&
        !viewState.geometryEditRoadId &&
        !inDrawMode &&
        viewState.editMode !== 'editLaneLine' &&
        !viewState.pendingTemplateId &&
        !viewState.pendingObjectTemplateId &&
        viewState.editMode !== 'placeSignal' &&
        viewState.editMode !== 'placeObject'
      ) {
        useProjectStore.getState().deleteSelected();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
