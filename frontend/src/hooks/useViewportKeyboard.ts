/**
 * Viewport keyboard shortcuts — Escape (deselect/cancel) and Delete.
 *
 * Extracted from Viewport.tsx to keep the component focused on rendering
 * and mouse interaction.
 */
import { useEffect } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { useViewportStore } from '../stores/viewportStore';

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
      const isDrawMode = viewState.editMode === 'spline';

      if (event.key === 'Escape') {
        // Pending click-to-place mode takes priority — cancel it first
        if (viewState.pendingTemplateId) {
          viewState.clearPendingTemplate();
          return;
        }
        if (viewState.pendingObjectTemplateId) {
          viewState.clearPendingObjectTemplate();
          return;
        }
        // Clear measurement points when in measure mode
        if (viewState.measureMode !== 'none') {
          viewState.clearMeasurePoints();
          return;
        }
        if (viewState.geometryEditRoadId || isDrawMode) {
          return;
        }
        if (viewState.editMode === 'move-road' || viewState.editMode === 'rotate-road') {
          viewState.setEditMode('default');
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

      if (
        event.key === 'Delete' &&
        !viewState.geometryEditRoadId &&
        !isDrawMode &&
        !viewState.pendingTemplateId &&
        !viewState.pendingObjectTemplateId
      ) {
        useProjectStore.getState().deleteSelected();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
