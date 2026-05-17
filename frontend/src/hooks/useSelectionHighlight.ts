/**
 * useSelectionHighlight — generates and uploads selection highlight mesh
 * whenever the scene selection (road, junction, signal, object) changes.
 *
 * Extracted from Viewport.tsx for single-responsibility.
 */
import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { ViewportRenderer } from '../viewport/renderer';
import { useProjectStore } from '../stores/projectStore';
import { useViewportStore } from '../stores/viewportStore';
import { getPlatformService } from '../services';
import {
  buildHighlightProject,
  isSceneSelectionVisible,
  tintVertices,
} from '../utils/sceneGraph';
import { mergeFloat32Arrays } from '../components/viewportUtils';

interface UseSelectionHighlightParams {
  rendererRef: MutableRefObject<ViewportRenderer | null>;
  status: 'loading' | 'ready' | 'unsupported';
}

export function useSelectionHighlight({
  rendererRef,
  status,
}: UseSelectionHighlightParams): void {
  const project = useProjectStore((s) => s.project);
  const selectedJunctionId = useProjectStore((s) => s.selectedJunctionId);
  const selectedSceneNode = useProjectStore((s) => s.selectedSceneNode);
  const selectedRoadIds = useProjectStore((s) => s.selectedRoadIds);
  const selectedJunctionIds = useProjectStore((s) => s.selectedJunctionIds);
  const { display } = useViewportStore();

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready') return;

    let cancelled = false;

    (async () => {
      try {
        const service = await getPlatformService();
        if (cancelled) return;

        // Multi-select highlight (rubber-band box selection)
        if (selectedRoadIds.length > 0 || selectedJunctionIds.length > 0) {
          const parts: Float32Array[] = [];
          if (selectedRoadIds.length > 0) {
            const multiProject = { ...project, roads: project.roads.filter((r) => selectedRoadIds.includes(r.id)) };
            const verts = await service.generateRoadVertices(multiProject, 2.0);
            parts.push(tintVertices(verts, [0.95, 0.18, 0.18, 0.82]));
          }
          for (const jId of selectedJunctionIds) {
            const jVerts = await service.generateSingleJunctionVertices(project, jId, [0.7, 0.4, 1.0, 0.65]);
            parts.push(jVerts);
          }
          const combined = parts.reduce((acc, p) => mergeFloat32Arrays(acc, p), new Float32Array());
          renderer.uploadHighlightVertices(combined);
          return;
        }

        if (!isSceneSelectionVisible(selectedSceneNode, display)) {
          renderer.clearHighlight();
          return;
        }

        if (selectedSceneNode && selectedSceneNode.type !== 'junction') {
          if (selectedSceneNode.type === 'signal') {
            const verts = await service.generateSingleSignalVertices(
              project, selectedSceneNode.roadId, selectedSceneNode.signalId,
              [0.2, 0.9, 0.9, 1.0],
            );
            if (verts.length > 0) renderer.uploadHighlightVertices(verts);
            else renderer.clearHighlight();
            return;
          }
          if (selectedSceneNode.type === 'object') {
            const verts = await service.generateSingleObjectVertices(
              project, selectedSceneNode.roadId, selectedSceneNode.objectId,
              [0.2, 0.9, 0.9, 1.0],
            );
            if (verts.length > 0) renderer.uploadHighlightVertices(verts);
            else renderer.clearHighlight();
            return;
          }
          const highlightProject = buildHighlightProject(project, selectedSceneNode);
          if (!highlightProject) {
            renderer.clearHighlight();
            return;
          }
          const highlightVerts = await service.generateRoadVertices(highlightProject, 2.0);
          renderer.uploadHighlightVertices(
            tintVertices(
              highlightVerts,
              selectedSceneNode.type === 'road'
                ? [0.95, 0.18, 0.18, 0.82]
                : [0.92, 0.3, 0.3, 0.72],
            ),
          );
          return;
        }

        if (selectedJunctionId) {
          const highlightVerts = await service.generateSingleJunctionVertices(
            project, selectedJunctionId, [0.7, 0.4, 1.0, 0.65],
          );
          renderer.uploadHighlightVertices(highlightVerts);
          return;
        }
        renderer.clearHighlight();
      } catch (err) {
        if (!cancelled) console.error('[Viewport] Failed to generate highlight mesh:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [display, project, selectedJunctionId, selectedJunctionIds, selectedRoadIds, selectedSceneNode, status]);
}
