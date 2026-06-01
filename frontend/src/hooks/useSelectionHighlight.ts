/**
 * useSelectionHighlight — generates and uploads selection highlight mesh
 * whenever the scene selection (road, junction, signal, object) changes.
 *
 * Extracted from Viewport.tsx for single-responsibility.
 */
import { useEffect, useRef } from 'react';
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
import { mergeFloat32Arrays, liftMeshZ, LINK_HIGHLIGHT_Z_LIFT } from '../components/viewportUtils';

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
  // Subscribe to individual display properties that affect selection visibility.
  // Avoid subscribing to the full `display` object since render-only toggles
  // (showLaneLines, showRoadMarks, colorMode, etc.) should NOT re-trigger
  // expensive highlight WASM calls.
  const hiddenRoadIds = useViewportStore((s) => s.display.hiddenRoadIds);
  const hiddenJunctionIds = useViewportStore((s) => s.display.hiddenJunctionIds);
  const hiddenSignalKeys = useViewportStore((s) => s.display.hiddenSignalKeys);
  const hiddenObjectKeys = useViewportStore((s) => s.display.hiddenObjectKeys);
  const hiddenLaneSectionKeys = useViewportStore((s) => s.display.hiddenLaneSectionKeys);
  const hiddenLaneKeys = useViewportStore((s) => s.display.hiddenLaneKeys);
  const showSignals = useViewportStore((s) => s.display.showSignals);
  const showObjects = useViewportStore((s) => s.display.showObjects);

  // Keep a ref to avoid stale closure issues
  const displayRef = useRef({ hiddenRoadIds, hiddenJunctionIds, hiddenSignalKeys, hiddenObjectKeys, hiddenLaneSectionKeys, hiddenLaneKeys, showSignals, showObjects });
  displayRef.current = { hiddenRoadIds, hiddenJunctionIds, hiddenSignalKeys, hiddenObjectKeys, hiddenLaneSectionKeys, hiddenLaneKeys, showSignals, showObjects };

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
            parts.push(liftMeshZ(tintVertices(verts, [0.95, 0.18, 0.18, 0.82]), LINK_HIGHLIGHT_Z_LIFT));
          }
          for (const jId of selectedJunctionIds) {
            const jVerts = await service.generateSingleJunctionVertices(project, jId, [0.7, 0.4, 1.0, 0.65]);
            parts.push(liftMeshZ(jVerts, LINK_HIGHLIGHT_Z_LIFT));
          }
          const combined = parts.reduce((acc, p) => mergeFloat32Arrays(acc, p), new Float32Array());
          renderer.uploadHighlightVertices(combined);
          return;
        }

        const visibility = displayRef.current;
        if (!isSceneSelectionVisible(selectedSceneNode, visibility)) {
          renderer.clearHighlight();
          return;
        }

        if (selectedSceneNode && selectedSceneNode.type !== 'junction') {
          if (selectedSceneNode.type === 'signal') {
            // Use cached version (reads from PROJECT_CACHE) when available
            const verts = service.generateSingleSignalVerticesCached
              ? await service.generateSingleSignalVerticesCached(
                  selectedSceneNode.roadId, selectedSceneNode.signalId,
                  [0.2, 0.9, 0.9, 1.0],
                ).catch(() =>
                  service.generateSingleSignalVertices(
                    project, selectedSceneNode.roadId, selectedSceneNode.signalId,
                    [0.2, 0.9, 0.9, 1.0],
                  ),
                )
              : await service.generateSingleSignalVertices(
                  project, selectedSceneNode.roadId, selectedSceneNode.signalId,
                  [0.2, 0.9, 0.9, 1.0],
                );
            if (verts.length > 0) renderer.uploadHighlightVertices(liftMeshZ(verts, LINK_HIGHLIGHT_Z_LIFT));
            else renderer.clearHighlight();
            return;
          }
          if (selectedSceneNode.type === 'object') {
            // Use cached version (reads from PROJECT_CACHE) when available
            const verts = service.generateSingleObjectVerticesCached
              ? await service.generateSingleObjectVerticesCached(
                  selectedSceneNode.roadId, selectedSceneNode.objectId,
                  [0.2, 0.9, 0.9, 1.0],
                ).catch(() =>
                  service.generateSingleObjectVertices(
                    project, selectedSceneNode.roadId, selectedSceneNode.objectId,
                    [0.2, 0.9, 0.9, 1.0],
                  ),
                )
              : await service.generateSingleObjectVertices(
                  project, selectedSceneNode.roadId, selectedSceneNode.objectId,
                  [0.2, 0.9, 0.9, 1.0],
                );
            if (verts.length > 0) renderer.uploadHighlightVertices(liftMeshZ(verts, LINK_HIGHLIGHT_Z_LIFT));
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
            liftMeshZ(
              tintVertices(
                highlightVerts,
                selectedSceneNode.type === 'road'
                  ? [0.95, 0.18, 0.18, 0.82]
                  : [0.92, 0.3, 0.3, 0.72],
              ),
              LINK_HIGHLIGHT_Z_LIFT,
            ),
          );
          return;
        }

        if (selectedJunctionId) {
          const highlightVerts = await service.generateSingleJunctionVertices(
            project, selectedJunctionId, [0.7, 0.4, 1.0, 0.65],
          );
          renderer.uploadHighlightVertices(liftMeshZ(highlightVerts, LINK_HIGHLIGHT_Z_LIFT));
          return;
        }
        renderer.clearHighlight();
      } catch (err) {
        if (!cancelled) console.error('[Viewport] Failed to generate highlight mesh:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [project, selectedJunctionId, selectedJunctionIds, selectedRoadIds, selectedSceneNode, status,
    hiddenRoadIds, hiddenJunctionIds, hiddenSignalKeys, hiddenObjectKeys,
    hiddenLaneSectionKeys, hiddenLaneKeys, showSignals, showObjects]);
}
