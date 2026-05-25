/**
 * useRoadLinkHighlight — generates and uploads road link (predecessor/successor)
 * highlight meshes when the user toggles link display (T key) with a road selected.
 *
 * Predecessor roads are highlighted in blue; successor roads in green.
 */
import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { ViewportRenderer } from '../viewport/renderer';
import { useProjectStore } from '../stores/projectStore';
import { useViewportStore } from '../stores/viewportStore';
import { getPlatformService } from '../services';
import { tintVertices } from '../utils/sceneGraph';
import {
  mergeFloat32Arrays,
  liftMeshZ,
  PREDECESSOR_HIGHLIGHT_COLOR,
  SUCCESSOR_HIGHLIGHT_COLOR,
  LINK_HIGHLIGHT_Z_LIFT,
} from '../components/viewportUtils';

interface UseRoadLinkHighlightParams {
  rendererRef: MutableRefObject<ViewportRenderer | null>;
  status: 'loading' | 'ready' | 'unsupported';
}

export function useRoadLinkHighlight({
  rendererRef,
  status,
}: UseRoadLinkHighlightParams): void {
  const project = useProjectStore((s) => s.project);
  const selectedSceneNode = useProjectStore((s) => s.selectedSceneNode);
  const showRoadLinks = useViewportStore((s) => s.showRoadLinks);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready') return;

    // Only show when toggle is active and a road is selected
    if (!showRoadLinks || !selectedSceneNode || selectedSceneNode.type !== 'road') {
      renderer.clearLinkHighlight();
      return;
    }

    const selectedRoadId = selectedSceneNode.roadId;
    const selectedRoad = project.roads.find((r) => r.id === selectedRoadId);
    if (!selectedRoad || !selectedRoad.link) {
      renderer.clearLinkHighlight();
      return;
    }

    const { predecessor, successor } = selectedRoad.link;

    // Collect road IDs to highlight (skip junction-type links for v1)
    const predecessorRoadIds: string[] = [];
    const successorRoadIds: string[] = [];

    if (predecessor && predecessor.element_type === 'Road') {
      predecessorRoadIds.push(predecessor.element_id);
    }
    if (successor && successor.element_type === 'Road') {
      successorRoadIds.push(successor.element_id);
    }

    if (predecessorRoadIds.length === 0 && successorRoadIds.length === 0) {
      renderer.clearLinkHighlight();
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const service = await getPlatformService();
        if (cancelled) return;

        const parts: Float32Array[] = [];

        // Generate predecessor highlight (blue)
        if (predecessorRoadIds.length > 0) {
          const predRoads = project.roads.filter((r) => predecessorRoadIds.includes(r.id));
          if (predRoads.length > 0) {
            const predProject = { ...project, roads: predRoads };
            const verts = await service.generateRoadVertices(predProject, 2.0);
            if (!cancelled && verts.length > 0) {
              parts.push(liftMeshZ(tintVertices(verts, PREDECESSOR_HIGHLIGHT_COLOR), LINK_HIGHLIGHT_Z_LIFT));
            }
          }
        }

        // Generate successor highlight (green)
        if (successorRoadIds.length > 0) {
          const succRoads = project.roads.filter((r) => successorRoadIds.includes(r.id));
          if (succRoads.length > 0) {
            const succProject = { ...project, roads: succRoads };
            const verts = await service.generateRoadVertices(succProject, 2.0);
            if (!cancelled && verts.length > 0) {
              parts.push(liftMeshZ(tintVertices(verts, SUCCESSOR_HIGHLIGHT_COLOR), LINK_HIGHLIGHT_Z_LIFT));
            }
          }
        }

        if (cancelled) return;

        if (parts.length === 0) {
          renderer.clearLinkHighlight();
          return;
        }

        const combined = parts.reduce((acc, p) => mergeFloat32Arrays(acc, p), new Float32Array());
        renderer.uploadLinkHighlightVertices(combined);
      } catch (err) {
        if (!cancelled) {
          console.error('[Viewport] Failed to generate road link highlight:', err);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [project, selectedSceneNode, showRoadLinks, status]);
}
