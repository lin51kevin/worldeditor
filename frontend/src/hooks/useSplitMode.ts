import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import i18next from 'i18next';
import { emitCursorMove } from '../viewport/cursorEvents';
import type { ViewportRenderer } from '../viewport/renderer';
import { useProjectStore } from '../stores/projectStore';
import { useViewportStore } from '../stores/viewportStore';
import { evalRoadAtS, findClosestSOnRoad, splitRoadAt } from '../utils/roadEdit';
import { showAlert } from '../utils/dialog';

const MIN_SPLIT_MARGIN = 0.05;

interface SplitPreview {
  s: number;
  x: number;
  y: number;
  hdg: number;
}

interface UseSplitModeOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: RefObject<ViewportRenderer | null>;
  pendingCursorRef: MutableRefObject<{ x: number; y: number } | null>;
  splitIndicatorDomRef: MutableRefObject<HTMLDivElement | null>;
}

function t(key: string, fallback: string): string {
  return i18next.t(key, fallback);
}

export function useSplitMode({
  canvasRef,
  rendererRef,
  pendingCursorRef,
  splitIndicatorDomRef,
}: UseSplitModeOptions) {
  const editMode = useViewportStore((state) => state.editMode);
  const selectedRoadId = useProjectStore((state) => state.selectedRoadId);
  const previewRef = useRef<SplitPreview | null>(null);

  const clearSplitPreview = useCallback(() => {
    previewRef.current = null;
    const indicator = splitIndicatorDomRef.current;
    if (indicator) {
      indicator.style.display = 'none';
    }
  }, [splitIndicatorDomRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    if (editMode === 'split' && selectedRoadId) {
      canvas.style.cursor = 'crosshair';
      return;
    }

    clearSplitPreview();
    if (canvas.style.cursor === 'crosshair') {
      canvas.style.cursor = '';
    }
  }, [canvasRef, clearSplitPreview, editMode, selectedRoadId]);

  const handleSplitModeMouseMove = useCallback((worldPos: { x: number; y: number }): boolean => {
    const { editMode: currentMode } = useViewportStore.getState();
    const { selectedRoadId: roadId, project } = useProjectStore.getState();
    if (currentMode !== 'split' || !roadId) {
      clearSplitPreview();
      return false;
    }

    const road = project.roads.find((item) => item.id === roadId);
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!road || !renderer || !canvas) {
      clearSplitPreview();
      return false;
    }

    const splitS = findClosestSOnRoad(road, worldPos);
    const splitPose = evalRoadAtS(road, splitS);
    previewRef.current = { s: splitS, ...splitPose };

    const screenPos = renderer.projectWorldToScreen(splitPose.x, splitPose.y);
    const indicator = splitIndicatorDomRef.current;
    if (indicator && screenPos) {
      indicator.style.left = `${screenPos.x}px`;
      indicator.style.top = `${screenPos.y}px`;
      indicator.style.transform = `translate(-50%, -50%) rotate(${(splitPose.hdg * 180) / Math.PI + 90}deg)`;
      indicator.style.display = 'block';
    } else if (indicator) {
      indicator.style.display = 'none';
    }

    canvas.style.cursor = 'crosshair';
    emitCursorMove(worldPos.x, worldPos.y);
    pendingCursorRef.current = worldPos;
    return true;
  }, [canvasRef, clearSplitPreview, pendingCursorRef, rendererRef, splitIndicatorDomRef]);

  const handleSplitModeClick = useCallback(async (worldPos: { x: number; y: number }): Promise<boolean> => {
    const viewportState = useViewportStore.getState();
    const projectState = useProjectStore.getState();
    if (viewportState.editMode !== 'split' || !projectState.selectedRoadId) {
      return false;
    }

    const road = projectState.project.roads.find((item) => item.id === projectState.selectedRoadId);
    if (!road) {
      clearSplitPreview();
      return true;
    }

    const splitS = previewRef.current?.s ?? findClosestSOnRoad(road, worldPos);
    if (splitS <= MIN_SPLIT_MARGIN || splitS >= road.length - MIN_SPLIT_MARGIN) {
      await showAlert(
        t('advancedEditing.splitPointTooClose', 'Choose a split point away from the road ends.'),
      );
      return true;
    }

    try {
      const { road1, road2, junction } = splitRoadAt(road, splitS);
      projectState.executePluginCommand(
        t('advancedEditing.splitRoadAtPoint', 'Split Road at Point'),
        (project) => ({
          ...project,
          roads: project.roads.filter((item) => item.id !== road.id).concat([road1, road2]),
          junctions: [...project.junctions, junction],
        }),
      );
      useProjectStore.getState().selectRoad(road1.id);
      useViewportStore.getState().setEditMode('default');
      clearSplitPreview();
    } catch (error) {
      await showAlert(
        t('advancedEditing.splitPointFailed', 'Failed to split road: ') +
          String(error instanceof Error ? error.message : error),
      );
    }

    return true;
  }, [clearSplitPreview]);

  return {
    clearSplitPreview,
    handleSplitModeMouseMove,
    handleSplitModeClick,
  };
}
