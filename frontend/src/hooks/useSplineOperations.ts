import { useCallback } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { useViewportStore } from '../stores/viewportStore';
import { getPlatformService } from '../services';
import { buildEditableSpline, nextSplineRoadId } from '../components/viewportUtils';
import { loadCatalog, buildLaneSection } from '../plugins/editing/templates/index';

/**
 * Maps a template item ID (as stored in the panel) to the WASM template ID
 * accepted by `createRoadFromSpline`. Falls back to the input unchanged.
 */
const WASM_TEMPLATE_ID_MAP: Record<string, string> = {
  'tpl:road:single':  'single',
  'tpl:road:dual2':   'dual2',
  'tpl:road:dual4':   'dual4',
  'tpl:road:dual6':   'dual6',
  'tpl:road:highway': 'dual6',
  'tpl:road:ramp':    'single',
  'tpl:road:urban':   'dual4',
};

export function resolveWasmTemplateId(templateId: string): string {
  return WASM_TEMPLATE_ID_MAP[templateId] ?? templateId;
}

/**
 * Encapsulates spline/geometry creation and geometry-edit mode callbacks.
 */
export function useSplineOperations() {
  const finalizeSplineCreation = useCallback(async (
    overrideKnots?: Array<[number, number, number]>,
    splineMode: 'classify' | 'parampoly3' = 'parampoly3',
  ) => {
    const viewState = useViewportStore.getState();
    const knots = overrideKnots ?? viewState.splineKnots;
    if (knots.length < 2) {
      console.warn('[Viewport] Need at least 2 spline knots to create a road.');
      return;
    }

    try {
      const service = await getPlatformService();
      const editorState = useProjectStore.getState();
      const roadId = nextSplineRoadId(editorState.project.roads.map((road) => road.id));
      const spline = buildEditableSpline(knots);
      const wasmTemplateId = resolveWasmTemplateId(viewState.splineTemplateId);
      const nextProject = await service.createRoadFromSpline(
        editorState.project,
        roadId,
        spline,
        wasmTemplateId,
        splineMode,
      );
      const newRoad = nextProject.roads.find((r) => r.id === roadId);
      if (newRoad) {
        // Override lane sections from the TS catalog. The Rust WASM templates
        // have different lane counts; the TS catalog is the single source of truth.
        const catalog = loadCatalog();
        const tplConfig = catalog.roads.find((t) => t.id === viewState.splineTemplateId);
        if (tplConfig) {
          newRoad.lane_sections = [buildLaneSection(tplConfig.left, tplConfig.right)];
        }
        // Apply road links from snapped endpoints
        const snappedEndpoints = viewState.snappedEndpoints.filter(Boolean) as Array<{ knotIndex: number; roadId: string; contactPoint: string }>;
        if (snappedEndpoints.length > 0) {
          const firstSnap = snappedEndpoints.find((s) => s.knotIndex === 0);
          const lastKnotIndex = knots.length - 1;
          const lastSnap = snappedEndpoints.find((s) => s.knotIndex === lastKnotIndex);

          const link = { ...(newRoad.link ?? { predecessor: null, successor: null }) };
          if (firstSnap) {
            link.predecessor = {
              element_id: firstSnap.roadId,
              element_type: 'Road',
              contact_point: firstSnap.contactPoint as 'Start' | 'End',
            };
          }
          if (lastSnap) {
            link.successor = {
              element_id: lastSnap.roadId,
              element_type: 'Road',
              contact_point: lastSnap.contactPoint as 'Start' | 'End',
            };
          }
          newRoad.link = link;
        }
        editorState.addRoad(newRoad);
      }
      editorState.selectRoad(roadId);
      viewState.clearSplineKnots();
    } catch (err) {
      console.error('[Viewport] Failed to create road from spline:', err);
      // Clear knots so the user isn't stuck in draw mode on error
      useViewportStore.getState().clearSplineKnots();
    }
  }, []);

  const enterGeometryEditMode = useCallback(async (roadId: string) => {
    const editorState = useProjectStore.getState();
    const road = editorState.project.roads.find((r) => r.id === roadId);
    if (!road || road.plan_view.length === 0) return;
    try {
      const service = await getPlatformService();
      const spline = await service.roadToSpline(road, 2.0);
      useViewportStore.getState().enterGeometryEdit(roadId, spline);
    } catch (err) {
      console.error('[Viewport] Failed to enter geometry edit:', err);
    }
  }, []);

  const finalizeGeometryEdit = useCallback(async () => {
    const viewState = useViewportStore.getState();
    const { geometryEditRoadId: roadId, geometryEditSpline: spline } = viewState;
    if (!roadId || !spline) return;
    try {
      const service = await getPlatformService();
      const geometries = await service.splineToGeometries(spline);
      const totalLength = geometries.reduce((sum, g) => sum + g.length, 0);
      useProjectStore.getState().updateRoadGeometry(roadId, geometries, totalLength);
      viewState.exitGeometryEdit();
    } catch (err) {
      console.error('[Viewport] Failed to finalize geometry edit:', err);
    }
  }, []);

  return {
    finalizeSplineCreation,
    enterGeometryEditMode,
    finalizeGeometryEdit,
  };
}
