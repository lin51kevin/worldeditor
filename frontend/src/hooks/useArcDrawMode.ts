import { useCallback, useEffect, type MutableRefObject, type RefObject } from 'react';
import { ViewportRenderer } from '../viewport/renderer';
import { emitCursorMove } from '../viewport/cursorEvents';
import { isDrawMode as isAnyDrawMode, useViewportStore } from '../stores/viewportStore';
import { useProjectStore } from '../stores/projectStore';
import { nextSplineRoadId } from '../components/viewportUtils';
import { buildLaneSection, loadCatalog } from '../plugins/editing/templates/index';
import type { Geometry, Road } from '../services/platform';
import {
  buildArcGeometryFromThreePoints,
  buildLineGeometryFromPoints,
  computeArcFromThreePoints,
  sampleArcPoints,
  type ArcPoint,
} from '../utils/arcMath';

type ViewportStatus = 'loading' | 'ready' | 'unsupported';
type WorldPosition = { x: number; y: number };

interface UseArcDrawModeOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: RefObject<ViewportRenderer | null>;
  pendingCursorRef: MutableRefObject<WorldPosition | null>;
  status: ViewportStatus;
}

const EMPTY_VERTEX_DATA = new Float32Array(0);
const PREVIEW_Z = 0.16;
const PREVIEW_COLOR: [number, number, number, number] = [0.20, 0.80, 1.0, 0.95];
const PREVIEW_SAMPLES = 32;

function isArcDrawMode(mode: string): mode is 'drawArc' {
  return mode === 'drawArc';
}

function emitSegment(
  vertices: number[],
  start: ArcPoint,
  end: ArcPoint,
  halfWidth: number,
  color: [number, number, number, number],
): void {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-8) {
    return;
  }

  const px = (-dy / length) * halfWidth;
  const py = (dx / length) * halfWidth;
  vertices.push(
    start.x - px, start.y - py, PREVIEW_Z, ...color,
    start.x + px, start.y + py, PREVIEW_Z, ...color,
    end.x + px, end.y + py, PREVIEW_Z, ...color,
    start.x - px, start.y - py, PREVIEW_Z, ...color,
    end.x + px, end.y + py, PREVIEW_Z, ...color,
    end.x - px, end.y - py, PREVIEW_Z, ...color,
  );
}

function buildPolylineVertexData(points: ArcPoint[], metersPerPixel: number): Float32Array {
  if (points.length < 2) {
    return EMPTY_VERTEX_DATA;
  }

  const vertices: number[] = [];
  const halfWidth = Math.max(0.75 * metersPerPixel, 0.01);
  for (let index = 0; index < points.length - 1; index += 1) {
    emitSegment(vertices, points[index]!, points[index + 1]!, halfWidth, PREVIEW_COLOR);
  }
  return vertices.length > 0 ? new Float32Array(vertices) : EMPTY_VERTEX_DATA;
}

function resolveLaneSection(templateId: string) {
  const catalog = loadCatalog();
  const template = catalog.roads.find((item) => item.id === templateId) ?? catalog.roads.find((item) => item.id === 'tpl:road:single');
  return template ? buildLaneSection(template.left, template.right) : buildLaneSection([], []);
}

function buildRoadFromGeometry(
  roadId: string,
  geometry: Geometry,
  templateId: string,
  splineEditData: [number, number, number][],
): Road {
  return {
    id: roadId,
    name: '',
    length: geometry.length,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [geometry],
    elevation_profile: [],
    lane_offsets: [],
    lateral_profile: { superelevations: [], crossfalls: [] },
    bridges: [],
    tunnels: [],
    signals: [],
    objects: [],
    lane_sections: [resolveLaneSection(templateId)],
    spline_edit_data: splineEditData,
  };
}

export function useArcDrawMode({
  canvasRef,
  rendererRef,
  pendingCursorRef,
  status,
}: UseArcDrawModeOptions) {
  const editMode = useViewportStore((state) => state.editMode);
  const pendingTemplateId = useViewportStore((state) => state.pendingTemplateId);
  const geometryEditSpline = useViewportStore((state) => state.geometryEditSpline);
  const splineKnots = useViewportStore((state) => state.splineKnots);
  const cursorPreviewPos = useViewportStore((state) => state.cursorPreviewPos);

  const clearArcPreview = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) {
      return;
    }
    renderer.setCurveFromVertexData(EMPTY_VERTEX_DATA);
    renderer.setSplinePreviewKnots([], undefined, true);
  }, [rendererRef]);

  const syncCursor = useCallback((worldPos: WorldPosition) => {
    emitCursorMove(worldPos.x, worldPos.y);
    pendingCursorRef.current = worldPos;
  }, [pendingCursorRef]);

  const finalizeArcCreation = useCallback((start: ArcPoint, end: ArcPoint, through: ArcPoint) => {
    const arcGeometry = buildArcGeometryFromThreePoints(start, end, through);
    const geometry = arcGeometry ?? buildLineGeometryFromPoints(start, end);
    if (!geometry) {
      return;
    }

    const editorState = useProjectStore.getState();
    const roadId = nextSplineRoadId(editorState.project.roads.map((road) => road.id));
    const road = buildRoadFromGeometry(
      roadId,
      geometry,
      useViewportStore.getState().splineTemplateId,
      [
        [start.x, start.y, 0],
        [through.x, through.y, 0],
        [end.x, end.y, 0],
      ],
    );

    editorState.addRoad(road);
    editorState.selectRoad(roadId);
    useViewportStore.getState().clearSplineKnots();
  }, []);

  useEffect(() => {
    if (!isAnyDrawMode(editMode)) {
      useViewportStore.getState().clearSplineKnots();
    }
  }, [editMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || geometryEditSpline) {
      return;
    }

    if (pendingTemplateId || isAnyDrawMode(editMode)) {
      canvas.style.cursor = 'crosshair';
      return;
    }

    if (editMode === null || editMode === 'default') {
      canvas.style.cursor = 'default';
    }
  }, [canvasRef, editMode, geometryEditSpline, pendingTemplateId]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready') {
      return;
    }

    if (geometryEditSpline) {
      clearArcPreview();
      return;
    }

    if (!isArcDrawMode(editMode)) {
      if (!isAnyDrawMode(editMode)) {
        clearArcPreview();
      }
      return;
    }

    renderer.setSplinePreviewKnots(splineKnots, undefined, true);

    if (splineKnots.length < 2) {
      renderer.setCurveFromVertexData(EMPTY_VERTEX_DATA);
      return;
    }

    const start = { x: splineKnots[0]![0], y: splineKnots[0]![1] };
    const end = { x: splineKnots[1]![0], y: splineKnots[1]![1] };

    let previewPoints: ArcPoint[] = [start, end];
    if (cursorPreviewPos) {
      const through = { x: cursorPreviewPos[0], y: cursorPreviewPos[1] };
      const arc = computeArcFromThreePoints(start, end, through);
      previewPoints = arc
        ? sampleArcPoints(arc.center, arc.radius, arc.startAngle, arc.sweepAngle, PREVIEW_SAMPLES)
        : [start, end];
    }

    renderer.setCurveFromVertexData(buildPolylineVertexData(previewPoints, renderer.getMetersPerPixel()));
  }, [clearArcPreview, cursorPreviewPos, editMode, geometryEditSpline, rendererRef, splineKnots, status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const viewState = useViewportStore.getState();
      if (!isArcDrawMode(viewState.editMode)) {
        return;
      }

      if (event.key === 'Escape') {
        viewState.clearSplineKnots();
        return;
      }

      if (event.key === 'Backspace') {
        viewState.popSplineKnot();
        return;
      }

      if (event.key === 'Enter') {
        const start = viewState.splineKnots[0];
        const end = viewState.splineKnots[1];
        const through = viewState.cursorPreviewPos;
        if (start && end && through) {
          event.preventDefault();
          finalizeArcCreation(
            { x: start[0], y: start[1] },
            { x: end[0], y: end[1] },
            { x: through[0], y: through[1] },
          );
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [finalizeArcCreation]);

  const clearArcDrawHover = useCallback(() => {
    const viewState = useViewportStore.getState();
    if (isArcDrawMode(viewState.editMode)) {
      viewState.setCursorPreviewPos(null);
      return;
    }

    if (!isAnyDrawMode(viewState.editMode)) {
      clearArcPreview();
    }
  }, [clearArcPreview]);

  const handleArcDrawMouseMove = useCallback((worldPos: WorldPosition, canvas: HTMLCanvasElement): boolean => {
    const viewState = useViewportStore.getState();
    if (viewState.geometryEditSpline || !isArcDrawMode(viewState.editMode)) {
      return false;
    }

    syncCursor(worldPos);
    if (viewState.splineKnots.length >= 2) {
      viewState.setCursorPreviewPos([worldPos.x, worldPos.y, 0]);
    } else {
      viewState.setCursorPreviewPos(null);
    }
    canvas.style.cursor = 'crosshair';
    return false;
  }, [syncCursor]);

  const handleArcDrawMouseDown = useCallback((): boolean => false, []);
  const handleArcDrawMouseUp = useCallback((): boolean => false, []);

  const handleArcDrawClick = useCallback(async (_event: React.MouseEvent, worldPos: WorldPosition): Promise<boolean> => {
    const viewState = useViewportStore.getState();
    if (viewState.geometryEditRoadId || !isArcDrawMode(viewState.editMode)) {
      return false;
    }

    const point: [number, number, number] = [worldPos.x, worldPos.y, 0];
    if (viewState.splineKnots.length < 2) {
      viewState.appendSplineKnot(point);
      if (viewState.splineKnots.length === 1) {
        viewState.setCursorPreviewPos(null);
      }
      return true;
    }

    const [start, end] = viewState.splineKnots;
    finalizeArcCreation(
      { x: start![0], y: start![1] },
      { x: end![0], y: end![1] },
      { x: worldPos.x, y: worldPos.y },
    );
    return true;
  }, [finalizeArcCreation]);

  const handleArcDrawRightClick = useCallback((): boolean => {
    const viewState = useViewportStore.getState();
    if (!isArcDrawMode(viewState.editMode)) {
      return false;
    }

    viewState.clearSplineKnots();
    return true;
  }, []);

  return {
    clearArcDrawHover,
    handleArcDrawMouseMove,
    handleArcDrawMouseDown,
    handleArcDrawClick,
    handleArcDrawMouseUp,
    handleArcDrawRightClick,
  };
}
