import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { getPlatformService } from '../services';
import type { Project } from '../services/platform';
import { useProjectStore } from '../stores/projectStore';
import { useViewportStore } from '../stores/viewportStore';
import { tintVertices } from '../utils/sceneGraph';
import type { ViewportRenderer } from '../viewport/renderer';
import {
  HOVER_HIGHLIGHT_COLOR,
  HOVER_HIGHLIGHT_Z_LIFT,
  liftMeshZ,
} from '../components/viewportUtils';

interface UseViewportHoverPickParams {
  rendererRef: RefObject<ViewportRenderer | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  getVisibleProject: () => Project | null;
}

interface UseViewportHoverPickReturn {
  executeHoverPick: () => Promise<void>;
  clearHoverPick: () => void;
  hoveredRoadRef: MutableRefObject<string | null>;
  hoveredJunctionRef: MutableRefObject<string | null>;
  hoveredSignalRef: MutableRefObject<{ roadId: string; signalId: string } | null>;
  hoveredObjectRef: MutableRefObject<{ roadId: string; objectId: string } | null>;
  lastHoverMeshIdRef: MutableRefObject<string | null>;
  pickInFlightRef: MutableRefObject<boolean>;
  pendingPickRafRef: MutableRefObject<number>;
  pendingPickPosRef: MutableRefObject<{ x: number; y: number } | null>;
}

export function useViewportHoverPick({
  rendererRef,
  canvasRef,
  getVisibleProject,
}: UseViewportHoverPickParams): UseViewportHoverPickReturn {
  const showHoverHighlight = useViewportStore((s) => s.showHoverHighlight);
  const hoveredRoadRef = useRef<string | null>(null);
  const hoveredJunctionRef = useRef<string | null>(null);
  const hoveredSignalRef = useRef<{ roadId: string; signalId: string } | null>(null);
  const hoveredObjectRef = useRef<{ roadId: string; objectId: string } | null>(null);
  const lastHoverMeshIdRef = useRef<string | null>(null);
  const pickInFlightRef = useRef(false);
  const pendingPickRafRef = useRef(0);
  const pendingPickPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (showHoverHighlight) {
      lastHoverMeshIdRef.current = null;
      return;
    }

    rendererRef.current?.clearHover();
    lastHoverMeshIdRef.current = null;
  }, [rendererRef, showHoverHighlight]);

  useEffect(() => () => {
    if (pendingPickRafRef.current) {
      cancelAnimationFrame(pendingPickRafRef.current);
      pendingPickRafRef.current = 0;
    }
  }, []);

  const clearHoverPick = useCallback(() => {
    hoveredRoadRef.current = null;
    hoveredJunctionRef.current = null;
    hoveredSignalRef.current = null;
    hoveredObjectRef.current = null;
    pendingPickPosRef.current = null;
    if (pendingPickRafRef.current) {
      cancelAnimationFrame(pendingPickRafRef.current);
      pendingPickRafRef.current = 0;
    }
    rendererRef.current?.clearHover();
    lastHoverMeshIdRef.current = null;
  }, [rendererRef]);

  const executeHoverPick = useCallback(async () => {
    const position = pendingPickPosRef.current;
    if (!position) return;
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    pickInFlightRef.current = true;
    try {
      const service = await getPlatformService();
      const {
        project: currentProject,
        selectedRoadId,
      } = useProjectStore.getState();
      const visibleProject = getVisibleProject();
      if (!visibleProject) return;

      const newHoveredRoad = await service.pickRoadAtPointCached(position.x, position.y, 2.5);
      if (newHoveredRoad !== hoveredRoadRef.current || hoveredJunctionRef.current !== null) {
        hoveredRoadRef.current = newHoveredRoad;
        hoveredJunctionRef.current = null;
        hoveredSignalRef.current = null;
        hoveredObjectRef.current = null;

        if (newHoveredRoad) {
          if (newHoveredRoad !== selectedRoadId) {
            if (showHoverHighlight && newHoveredRoad !== lastHoverMeshIdRef.current) {
              const road = currentProject.roads.find((item) => item.id === newHoveredRoad);
              if (road) {
                const singleRoadProject = { ...currentProject, roads: [road], junctions: [] };
                const hoverVertices = tintVertices(
                  await service.generateRoadVertices(singleRoadProject, 2.0),
                  HOVER_HIGHLIGHT_COLOR,
                );
                renderer.uploadHoverVertices(liftMeshZ(hoverVertices, HOVER_HIGHLIGHT_Z_LIFT));
                lastHoverMeshIdRef.current = newHoveredRoad;
              }
            } else if (!showHoverHighlight) {
              renderer.clearHover();
              lastHoverMeshIdRef.current = null;
            }
          } else {
            renderer.clearHover();
            lastHoverMeshIdRef.current = null;
          }

          if (!renderer.pointerDragging) {
            canvas.style.cursor = 'pointer';
          }
          return;
        }

        renderer.clearHover();
        lastHoverMeshIdRef.current = null;

        const newHoveredJunction = await service.pickJunctionAtPointCached(position.x, position.y, 3.0);
        hoveredJunctionRef.current = newHoveredJunction;
        if (newHoveredJunction) {
          if (showHoverHighlight) {
            const hoverVertices = await service.generateSingleJunctionVertices(
              currentProject,
              newHoveredJunction,
              HOVER_HIGHLIGHT_COLOR,
            );
            renderer.uploadHoverVertices(liftMeshZ(hoverVertices, HOVER_HIGHLIGHT_Z_LIFT));
          }
          if (!renderer.pointerDragging) {
            canvas.style.cursor = 'pointer';
          }
          return;
        }

        const signalHit = await service.pickSignalAtPointCached(position.x, position.y, 4.0);
        if (signalHit !== null) {
          hoveredSignalRef.current = signalHit;
          if (!renderer.pointerDragging) {
            canvas.style.cursor = 'pointer';
          }
          return;
        }

        hoveredSignalRef.current = null;
        const objectHit = await service.pickObjectAtPointCached(position.x, position.y, 4.0);
        if (objectHit !== null) {
          hoveredObjectRef.current = objectHit;
          if (!renderer.pointerDragging) {
            canvas.style.cursor = 'pointer';
          }
          return;
        }

        hoveredObjectRef.current = null;
        if (!renderer.pointerDragging) {
          canvas.style.cursor = '';
        }
      }
    } catch {
      // Ignore hover detection errors.
    } finally {
      pickInFlightRef.current = false;
    }
  }, [canvasRef, getVisibleProject, rendererRef, showHoverHighlight]);

  return {
    executeHoverPick,
    clearHoverPick,
    hoveredRoadRef,
    hoveredJunctionRef,
    hoveredSignalRef,
    hoveredObjectRef,
    lastHoverMeshIdRef,
    pickInFlightRef,
    pendingPickRafRef,
    pendingPickPosRef,
  };
}
