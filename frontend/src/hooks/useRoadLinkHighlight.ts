/**
 * useRoadLinkHighlight — generates and uploads predecessor/successor highlight
 * meshes when the user toggles link display (T key).
 *
 * Context-sensitive:
 * - Road selected → highlight predecessor/successor roads
 * - LaneSection selected → highlight adjacent lane sections (same road + cross-road)
 * - Lane selected → highlight linked lanes via lane.link (same road + cross-road)
 *
 * Predecessor elements are highlighted in blue; successor elements in green.
 */
import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { ViewportRenderer } from '../viewport/renderer';
import { useProjectStore } from '../stores/projectStore';
import { useViewportStore } from '../stores/viewportStore';
import { getPlatformService } from '../services';
import { buildHighlightProject, tintVertices } from '../utils/sceneGraph';
import type { SceneNodeSelection } from '../utils/sceneGraph';
import { resolveConnectivity } from '../utils/connectivity';
import type { PlatformService, Project } from '../services/platform';
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

/**
 * Generate tinted + Z-lifted highlight vertices for a list of scene node
 * selections. Returns a merged Float32Array (empty if nothing to render).
 */
async function generateHighlightForNodes(
  service: PlatformService,
  project: Project,
  nodes: SceneNodeSelection[],
  color: [number, number, number, number],
): Promise<Float32Array> {
  const parts: Float32Array[] = [];

  for (const node of nodes) {
    const hlProject = buildHighlightProject(project, node);
    if (!hlProject) continue;

    const verts = await service.generateRoadVertices(hlProject, 2.0);
    if (verts.length > 0) {
      parts.push(liftMeshZ(tintVertices(verts, color), LINK_HIGHLIGHT_Z_LIFT));
    }
  }

  if (parts.length === 0) return new Float32Array();
  return parts.reduce((acc, p) => mergeFloat32Arrays(acc, p), new Float32Array());
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

    // Only show when toggle is active and a supported selection type is active
    const supportedTypes = new Set(['road', 'laneSection', 'lane']);
    if (!showRoadLinks || !selectedSceneNode || !supportedTypes.has(selectedSceneNode.type)) {
      renderer.clearLinkHighlight();
      return;
    }

    const { predecessors, successors } = resolveConnectivity(project, selectedSceneNode);

    if (predecessors.length === 0 && successors.length === 0) {
      renderer.clearLinkHighlight();
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const service = await getPlatformService();
        if (cancelled) return;

        const [predVerts, succVerts] = await Promise.all([
          generateHighlightForNodes(service, project, predecessors, PREDECESSOR_HIGHLIGHT_COLOR),
          generateHighlightForNodes(service, project, successors, SUCCESSOR_HIGHLIGHT_COLOR),
        ]);

        if (cancelled) return;

        const combined = mergeFloat32Arrays(predVerts, succVerts);
        if (combined.length === 0) {
          renderer.clearLinkHighlight();
        } else {
          renderer.uploadLinkHighlightVertices(combined);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[Viewport] Failed to generate link highlight:', err);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [project, selectedSceneNode, showRoadLinks, status]);
}
