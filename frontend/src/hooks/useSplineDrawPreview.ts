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
  const cursorPreviewPos = useEditorViewStore((s) => s.cursorPreviewPos);

  // Generate and upload a preview road mesh whenever draw-mode knots or cursor position changes.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready' || !isDrawMode(editMode)) return;

    // Append the current cursor position as a temporary last knot for live preview.
    // This means preview starts as soon as the first knot is placed and the mouse moves.
    const previewKnots: Array<[number, number, number]> =
      splineKnots.length >= 1 && cursorPreviewPos
        ? [...splineKnots, cursorPreviewPos]
        : splineKnots;

    // Need at least 2 knots for a road segment
    if (previewKnots.length < 2) return;

    let cancelled = false;

    void (async () => {
      try {
        const service = await getPlatformService();
        const PREVIEW_ROAD_ID = '__draw_preview__';

        if (editMode === 'spline') {
          const spline = buildEditableSpline(previewKnots);
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
            geometries = buildMultiLineGeometries(previewKnots);
          } else if (editMode === 'arc') {
            geometries = buildMultiArcGeometries(previewKnots);
          } else {
            geometries = buildMultiSpiralGeometries(previewKnots);
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
  }, [editMode, splineKnots, cursorPreviewPos, splineTemplateId, rendererRef, status]);

  // Restore real project vertices when the preview is discarded (knots cleared,
  // e.g., after Escape or finalization).
  const prevPreviewLenRef = useRef(0);
  useEffect(() => {
    const previewLen =
      splineKnots.length >= 1 && cursorPreviewPos
        ? splineKnots.length + 1
        : splineKnots.length;
    const prev = prevPreviewLenRef.current;
    prevPreviewLenRef.current = previewLen;
    // A preview was showing (≥2) and now there's nothing left to preview
    if (prev >= 2 && previewLen < 2) {
      onPreviewEnd();
    }
  }, [splineKnots, cursorPreviewPos, onPreviewEnd]);
}
