import { useCallback } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useEditorViewStore } from '../stores/editorViewStore';
import { getPlatformService } from '../services';
import {
  buildMultiLineGeometries,
  buildMultiArcGeometries,
  buildMultiSpiralGeometries,
  buildRoadFromGeometries,
} from '../utils/geometryBuilder';
import { buildEditableSpline, nextSplineRoadId } from '../components/viewportUtils';

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
  const finalizeSplineCreation = useCallback(async (overrideKnots?: Array<[number, number, number]>) => {
    const viewState = useEditorViewStore.getState();
    const knots = overrideKnots ?? viewState.splineKnots;
    if (knots.length < 2) {
      console.warn('[Viewport] Need at least 2 spline knots to create a road.');
      return;
    }

    try {
      const service = await getPlatformService();
      const editorState = useEditorStore.getState();
      const roadId = nextSplineRoadId(editorState.project.roads.map((road) => road.id));
      const spline = buildEditableSpline(knots);
      const wasmTemplateId = resolveWasmTemplateId(viewState.splineTemplateId);
      const nextProject = await service.createRoadFromSpline(
        editorState.project,
        roadId,
        spline,
        wasmTemplateId,
      );
      const newRoad = nextProject.roads.find((r) => r.id === roadId);
      if (newRoad) {
        editorState.addRoad(newRoad);
      }
      editorState.selectRoad(roadId);
      viewState.clearSplineKnots();
    } catch (err) {
      console.error('[Viewport] Failed to create road from spline:', err);
      // Clear knots so the user isn't stuck in draw mode on error
      useEditorViewStore.getState().clearSplineKnots();
    }
  }, []);

  const finalizeDrawGeometry = useCallback(async (
    mode: 'line' | 'arc' | 'spiral',
    points: Array<[number, number, number]>,
  ) => {
    const editorState = useEditorStore.getState();
    const viewState = useEditorViewStore.getState();

    const minPoints = mode === 'arc' ? 3 : 2;
    if (points.length < minPoints) {
      console.warn(`[Viewport] ${mode} mode needs at least ${minPoints} points.`);
      return;
    }

    const roadId = nextSplineRoadId(editorState.project.roads.map((r) => r.id));

    let geometries;
    if (mode === 'line') {
      geometries = buildMultiLineGeometries(points);
    } else if (mode === 'arc') {
      geometries = buildMultiArcGeometries(points);
    } else {
      geometries = buildMultiSpiralGeometries(points);
    }

    if (geometries.length === 0) {
      console.warn(`[Viewport] ${mode} produced no geometry segments from ${points.length} points.`);
      return;
    }

    const road = buildRoadFromGeometries(roadId, geometries);
    editorState.addRoad(road);
    editorState.selectRoad(roadId);
    viewState.clearSplineKnots();
  }, []);

  const enterGeometryEditMode = useCallback(async (roadId: string) => {
    const editorState = useEditorStore.getState();
    const road = editorState.project.roads.find((r) => r.id === roadId);
    if (!road || road.plan_view.length === 0) return;
    try {
      const service = await getPlatformService();
      const spline = await service.roadToSpline(road, 2.0);
      useEditorViewStore.getState().enterGeometryEdit(roadId, spline);
    } catch (err) {
      console.error('[Viewport] Failed to enter geometry edit:', err);
    }
  }, []);

  const finalizeGeometryEdit = useCallback(async () => {
    const viewState = useEditorViewStore.getState();
    const { geometryEditRoadId: roadId, geometryEditSpline: spline } = viewState;
    if (!roadId || !spline) return;
    try {
      const service = await getPlatformService();
      const geometries = await service.splineToGeometries(spline);
      const totalLength = geometries.reduce((sum, g) => sum + g.length, 0);
      useEditorStore.getState().updateRoadGeometry(roadId, geometries, totalLength);
      viewState.exitGeometryEdit();
    } catch (err) {
      console.error('[Viewport] Failed to finalize geometry edit:', err);
    }
  }, []);

  return {
    finalizeSplineCreation,
    finalizeDrawGeometry,
    enterGeometryEditMode,
    finalizeGeometryEdit,
  };
}
