import { useEffect, useRef, type RefObject } from 'react';
import { useEditorViewStore } from '../stores/editorViewStore';
import { getPlatformService } from '../services';
import {
  buildMultiLineGeometries,
  buildMultiArcGeometries,
  buildMultiSpiralGeometries,
  buildRoadFromGeometries,
} from '../utils/geometryBuilder';
import { buildEditableSpline } from '../components/viewportUtils';
import { resolveWasmTemplateId } from './useSplineOperations';
import type { ViewportRenderer } from '../viewport/renderer';

type ViewportStatus = 'loading' | 'ready' | 'unsupported';

function isDrawMode(mode: string): mode is 'spline' | 'line' | 'arc' | 'spiral' {
  return mode === 'spline' || mode === 'line' || mode === 'arc' || mode === 'spiral';
}

/** Semi-transparent blue tint used for the draw-mode road preview. */
const PREVIEW_TINT: [number, number, number, number] = [0.45, 0.65, 1.0, 0.78];

/**
 * Generates a live road-mesh preview while the user is placing knots in
 * draw mode. Uploads the result directly to the renderer so the user sees
 * the road (with correct lane sections) grow as they click.
 *
 * When the preview should be cleared (knots dropped below the threshold,
 * draw mode exited), `onPreviewEnd` is called so the caller can re-upload
 * the actual project vertices.
 */
export function useSplineDrawPreview({
  rendererRef,
  status,
  onPreviewEnd,
}: {
  rendererRef: RefObject<ViewportRenderer | null>;
  status: ViewportStatus;
  /** Called when the preview has been removed and the real scene should be restored. */
  onPreviewEnd: () => void;
}) {
  const editMode = useEditorViewStore((s) => s.editMode);
  const splineKnots = useEditorViewStore((s) => s.splineKnots);
  const splineTemplateId = useEditorViewStore((s) => s.splineTemplateId);

  // Generate and upload a preview road mesh whenever draw-mode knots change.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready' || !isDrawMode(editMode)) return;

    // Need at least 2 knots for a road segment
    if (splineKnots.length < 2) return;

    let cancelled = false;

    void (async () => {
      try {
        const service = await getPlatformService();
        const PREVIEW_ROAD_ID = '__draw_preview__';

        if (editMode === 'spline') {
          const spline = buildEditableSpline(splineKnots);
          const wasmId = resolveWasmTemplateId(splineTemplateId);

          // Use an empty project so the preview road ID doesn't conflict
          const previewProject = await service.createRoadFromSpline(
            { name: '', header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null }, roads: [], junctions: [], signals: [], objects: [] },
            PREVIEW_ROAD_ID,
            spline,
            wasmId,
          );
          if (cancelled) return;

          const previewRoad = previewProject.roads.find((r) => r.id === PREVIEW_ROAD_ID);
          if (!previewRoad) return;

          const roadVerts = await service.generateSingleRoadVertices(previewRoad, 2.0, PREVIEW_TINT);
          if (cancelled) return;

          const laneLineVerts = await service.generateLaneLineVertices(
            { ...previewProject, roads: [previewRoad] },
            2.0,
          );
          if (cancelled) return;

          renderer.uploadRoadVertices(roadVerts);
          renderer.uploadLaneLineVertices(laneLineVerts);
        } else {
          // line / arc / spiral modes: no lane section template, show flat road outline
          let geometries;
          if (editMode === 'line') {
            geometries = buildMultiLineGeometries(splineKnots);
          } else if (editMode === 'arc') {
            geometries = buildMultiArcGeometries(splineKnots);
          } else {
            geometries = buildMultiSpiralGeometries(splineKnots);
          }
          if (geometries.length === 0) return;

          const previewRoad = buildRoadFromGeometries(PREVIEW_ROAD_ID, geometries);
          const roadVerts = await service.generateSingleRoadVertices(previewRoad, 2.0, PREVIEW_TINT);
          if (cancelled) return;
          renderer.uploadRoadVertices(roadVerts);
        }
      } catch {
        // Ignore preview errors — user experience degrades gracefully to no preview
      }
    })();

    return () => { cancelled = true; };
  }, [editMode, splineKnots, splineTemplateId, rendererRef, status]);

  // Restore real project vertices when the preview is discarded (knots cleared,
  // e.g., after Escape or finalization).
  const prevKnotsLenRef = useRef(splineKnots.length);
  useEffect(() => {
    const prev = prevKnotsLenRef.current;
    prevKnotsLenRef.current = splineKnots.length;
    // A preview was showing (≥2 knots) and now the knots are gone
    if (prev >= 2 && splineKnots.length < 2) {
      onPreviewEnd();
    }
  }, [splineKnots.length, onPreviewEnd]);
}
