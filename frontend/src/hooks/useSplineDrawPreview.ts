import { useEffect, useRef, type RefObject } from 'react';
import { useViewportStore } from '../stores/viewportStore';
import { getPlatformService } from '../services';
import { buildEditableSpline } from '../components/viewportUtils';
import { resolveWasmTemplateId } from './useSplineOperations';
import { loadCatalog, buildLaneSection } from '../plugins/editing/templates/index';
import type { ViewportRenderer } from '../viewport/renderer';
import type { Project } from '../services/platform';

type ViewportStatus = 'loading' | 'ready' | 'unsupported';

const EMPTY_PROJECT: Project = {
  name: '',
  header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
  roads: [],
  junctions: [],
  signals: [],
  objects: [],
};

function isDrawMode(mode: string): mode is 'spline' {
  return mode === 'spline';
}

/** Merge two Float32Arrays into one. */
function mergeFloat32Arrays(a: Float32Array, b: Float32Array): Float32Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Generates a live lane-line preview while the user is placing knots in draw
 * mode. Only lane boundary lines and the center reference line are uploaded —
 * no filled road mesh is shown. This matches the line-based style of the C#
 * WorldEditor and WorldEditorOnline.
 *
 * When the preview should be cleared (knots dropped below the threshold,
 * draw mode exited), `onPreviewEnd` is called so the caller can re-upload
 * the actual project vertices.
 */
export function useSplineDrawPreview({
  rendererRef,
  status,
  onPreviewEnd,
  getCachedLineVertices,
}: {
  rendererRef: RefObject<ViewportRenderer | null>;
  status: ViewportStatus;
  /** Called when the preview has been removed and the real scene should be restored. */
  onPreviewEnd: () => void;
  /** Returns the cached line vertices for existing roads (from useViewportMeshes). */
  getCachedLineVertices: () => Float32Array;
}) {
  const editMode = useViewportStore((s) => s.editMode);
  const splineKnots = useViewportStore((s) => s.splineKnots);
  const splineTemplateId = useViewportStore((s) => s.splineTemplateId);
  const cursorPreviewPos = useViewportStore((s) => s.cursorPreviewPos);

  // Generate and upload preview lane lines whenever draw-mode knots or cursor position changes.
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

        const splineMode = editMode === 'spline' ? 'parampoly3' : 'classify';
        const spline = buildEditableSpline(previewKnots);
        const wasmId = resolveWasmTemplateId(splineTemplateId);

        const previewProject = await service.createRoadFromSpline(
          { ...EMPTY_PROJECT },
          PREVIEW_ROAD_ID,
          spline,
          wasmId,
          splineMode,
        );
        if (cancelled) return;

        const previewRoad = previewProject.roads.find((r) => r.id === PREVIEW_ROAD_ID);
        if (!previewRoad) return;

        // Override lane sections from the TS catalog so the preview reflects
        // the correct lane count (the Rust WASM templates differ from the catalog).
        const catalog = loadCatalog();
        const tplConfig = catalog.roads.find((t) => t.id === splineTemplateId);
        const previewRoadWithLanes = tplConfig
          ? { ...previewRoad, lane_sections: [buildLaneSection(tplConfig.left, tplConfig.right)] }
          : previewRoad;

        const singleRoadProject = { ...previewProject, roads: [previewRoadWithLanes] };

        // Generate ONLY the preview road's line vertices.
        // Reuse the cached existing-road lines to avoid regeneration artifacts.
        const empty = new Float32Array(0);

        const [previewLaneVerts, previewCenterVerts] = await Promise.all([
          service.generateLaneBoundaryVertices(singleRoadProject, 2.0).catch(() => empty),
          service.generateCenterLineVertices(singleRoadProject, 2.0).catch(() => empty),
        ]);
        if (cancelled) return;

        // Merge cached existing road lines with preview road lines.
        const existingLineVerts = getCachedLineVertices();
        const combined = mergeFloat32Arrays(
          existingLineVerts,
          mergeFloat32Arrays(previewLaneVerts, previewCenterVerts),
        );
        renderer.uploadLaneLineVertices(combined);
      } catch {
        // Ignore preview errors — user experience degrades gracefully to no preview
      }
    })();

    return () => { cancelled = true; };
  }, [editMode, splineKnots, cursorPreviewPos, splineTemplateId, rendererRef, status, getCachedLineVertices]);

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
