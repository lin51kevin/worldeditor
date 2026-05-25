import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent, type MutableRefObject, type RefObject } from 'react';
import { ViewportRenderer } from '../viewport/renderer';
import { emitCursorMove } from '../viewport/cursorEvents';
import { isDrawMode as isAnyDrawMode, useViewportStore } from '../stores/viewportStore';
import { useProjectStore } from '../stores/projectStore';
import { getPlatformService } from '../services';
import { buildRenderableProject } from '../utils/sceneGraph';
import { buildRoadFromGeometries } from '../utils/geometryBuilder';
import { mergeFloat32Arrays, nextSplineRoadId } from '../components/viewportUtils';
import { loadCatalog, buildLaneSection } from '../plugins/editing/templates';
import { computeSpiralGeometry, curvatureFromOffset, sampleSpiralPoints, signedPerpendicularOffset } from '../utils/spiralMath';

type ViewportStatus = 'loading' | 'ready' | 'unsupported';
type WorldPosition = { x: number; y: number };

interface UseSpiralDrawModeOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: RefObject<ViewportRenderer | null>;
  pendingCursorRef: MutableRefObject<WorldPosition | null>;
  status: ViewportStatus;
  onPreviewEnd?: () => void;
}

const PREVIEW_COLOR: readonly [number, number, number, number] = [0.20, 0.82, 1.0, 0.95];
const PREVIEW_LINE_WIDTH_PX = 1.4;
const PREVIEW_Z_OFFSET = 0.18;

function isSpiralDrawMode(mode: string): mode is 'drawSpiral' {
  return mode === 'drawSpiral';
}

function emitSegment(
  verts: number[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
  z: number,
  halfWidth: number,
  color: readonly [number, number, number, number],
): void {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length < 1e-8) {
    return;
  }
  const px = (-dy / length) * halfWidth;
  const py = (dx / length) * halfWidth;
  const [r, g, b, a] = color;
  verts.push(
    ax - px, ay - py, z, r, g, b, a,
    ax + px, ay + py, z, r, g, b, a,
    bx + px, by + py, z, r, g, b, a,
    ax - px, ay - py, z, r, g, b, a,
    bx + px, by + py, z, r, g, b, a,
    bx - px, by - py, z, r, g, b, a,
  );
}

function buildPolylineVertices(
  points: Array<[number, number]>,
  metersPerPixel: number,
  color: readonly [number, number, number, number],
): Float32Array {
  const verts: number[] = [];
  const halfWidth = Math.max(0.5, PREVIEW_LINE_WIDTH_PX * metersPerPixel);
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1]!;
    const curr = points[index]!;
    emitSegment(verts, prev[0], prev[1], curr[0], curr[1], PREVIEW_Z_OFFSET, halfWidth, color);
  }
  return new Float32Array(verts);
}

function resolvePreviewPoints(
  knots: Array<[number, number, number]>,
  cursorPreviewPos: [number, number, number] | null,
): Array<[number, number]> | null {
  if (knots.length === 0) {
    return null;
  }
  if (knots.length === 1) {
    if (!cursorPreviewPos) {
      return null;
    }
    return [
      [knots[0]![0], knots[0]![1]],
      [cursorPreviewPos[0], cursorPreviewPos[1]],
    ];
  }

  const start = { x: knots[0]![0], y: knots[0]![1] };
  const end = { x: knots[1]![0], y: knots[1]![1] };
  const curvaturePoint = cursorPreviewPos
    ? { x: cursorPreviewPos[0], y: cursorPreviewPos[1] }
    : end;
  const chordLength = Math.hypot(end.x - start.x, end.y - start.y);
  const curvEnd = curvatureFromOffset(chordLength, signedPerpendicularOffset(start, end, curvaturePoint));
  const geometry = computeSpiralGeometry(start, end, 0, curvEnd);
  if (typeof geometry.geo_type === 'string' || !('Spiral' in geometry.geo_type)) {
    return [
      [start.x, start.y],
      [end.x, end.y],
    ];
  }

  const sampleCount = Math.max(32, Math.ceil(geometry.length * 2));
  return sampleSpiralPoints(
    geometry.x,
    geometry.y,
    geometry.hdg,
    geometry.length,
    0,
    curvEnd,
    sampleCount,
  );
}

export function useSpiralDrawMode({
  canvasRef,
  rendererRef,
  pendingCursorRef,
  status,
  onPreviewEnd,
}: UseSpiralDrawModeOptions) {
  const editMode = useViewportStore((state) => state.editMode);
  const pendingTemplateId = useViewportStore((state) => state.pendingTemplateId);
  const geometryEditSpline = useViewportStore((state) => state.geometryEditSpline);
  const splineKnots = useViewportStore((state) => state.splineKnots);
  const cursorPreviewPos = useViewportStore((state) => state.cursorPreviewPos);
  const project = useProjectStore((state) => state.project);
  const display = useViewportStore((state) => state.display);
  const viewMode = useViewportStore((state) => state.viewMode);
  const previewWasVisibleRef = useRef(false);

  const syncCursor = useCallback((worldPos: WorldPosition) => {
    emitCursorMove(worldPos.x, worldPos.y);
    pendingCursorRef.current = worldPos;
  }, [pendingCursorRef]);

  const clearSpiralDrawHover = useCallback(() => {
    const viewState = useViewportStore.getState();
    viewState.setCursorPreviewPos(null);
    viewState.clearDrawSnap();
  }, []);

  const finalizeSpiralCreation = useCallback((curvaturePoint?: WorldPosition) => {
    const viewState = useViewportStore.getState();
    if (!isSpiralDrawMode(viewState.editMode) || viewState.splineKnots.length < 2) {
      return;
    }

    const [startKnot, endKnot] = viewState.splineKnots;
    if (!startKnot || !endKnot) {
      return;
    }

    const start = { x: startKnot[0], y: startKnot[1] };
    const end = { x: endKnot[0], y: endKnot[1] };
    const curvatureRef = curvaturePoint ?? (viewState.cursorPreviewPos
      ? { x: viewState.cursorPreviewPos[0], y: viewState.cursorPreviewPos[1] }
      : end);
    const chordLength = Math.hypot(end.x - start.x, end.y - start.y);
    if (chordLength < 1e-3) {
      viewState.clearSplineKnots();
      return;
    }

    const curvEnd = curvatureFromOffset(chordLength, signedPerpendicularOffset(start, end, curvatureRef));
    const geometry = computeSpiralGeometry(start, end, 0, curvEnd);

    const editorState = useProjectStore.getState();
    const roadId = nextSplineRoadId(editorState.project.roads.map((road) => road.id));
    const road = buildRoadFromGeometries(roadId, [geometry]);
    const catalog = loadCatalog();
    const templateId = viewState.splineTemplateId || 'tpl:road:single';
    const template = catalog.roads.find((item) => item.id === templateId) ?? catalog.roads.find((item) => item.id === 'tpl:road:single');
    if (template) {
      road.lane_sections = [buildLaneSection(template.left, template.right)];
    }

    const snappedEndpoints = viewState.snappedEndpoints.filter(Boolean) as Array<{ knotIndex: number; roadId: string; contactPoint: string }>;
    const firstSnap = snappedEndpoints.find((entry) => entry.knotIndex === 0);
    const lastSnap = snappedEndpoints.find((entry) => entry.knotIndex === 1);
    if (firstSnap || lastSnap) {
      road.link = {
        predecessor: firstSnap
          ? {
              element_id: firstSnap.roadId,
              element_type: 'Road',
              contact_point: firstSnap.contactPoint as 'Start' | 'End',
            }
          : null,
        successor: lastSnap
          ? {
              element_id: lastSnap.roadId,
              element_type: 'Road',
              contact_point: lastSnap.contactPoint as 'Start' | 'End',
            }
          : null,
      };
    }

    editorState.addRoad(road);
    editorState.selectRoad(roadId);
    viewState.clearSplineKnots();
  }, []);

  useEffect(() => {
    if (!isAnyDrawMode(editMode)) {
      useViewportStore.getState().clearSplineKnots();
    }
  }, [editMode]);

  useEffect(() => {
    if (isAnyDrawMode(editMode) || geometryEditSpline) {
      return;
    }
    clearSpiralDrawHover();
  }, [clearSpiralDrawHover, editMode, geometryEditSpline]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || geometryEditSpline) {
      return;
    }
    if (pendingTemplateId || isAnyDrawMode(editMode)) {
      canvas.style.cursor = 'crosshair';
      return;
    }
    if (editMode === 'default') {
      canvas.style.cursor = 'default';
    }
  }, [canvasRef, editMode, geometryEditSpline, pendingTemplateId]);

  useEffect(() => {
    const previewPoints = isSpiralDrawMode(editMode) ? resolvePreviewPoints(splineKnots, cursorPreviewPos) : null;
    const previewVisible = !!previewPoints && previewPoints.length >= 2;
    const wasVisible = previewWasVisibleRef.current;
    previewWasVisibleRef.current = previewVisible;
    if (wasVisible && !previewVisible) {
      onPreviewEnd?.();
    }
  }, [cursorPreviewPos, editMode, onPreviewEnd, splineKnots]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const previewPoints = isSpiralDrawMode(editMode) ? resolvePreviewPoints(splineKnots, cursorPreviewPos) : null;
    if (!renderer || status !== 'ready' || !previewPoints || previewPoints.length < 2) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const service = await getPlatformService();
        const visibleProject = buildRenderableProject(project, display);
        const empty = new Float32Array(0);
        const [existingLaneVerts, existingCenterVerts, existingMarkVerts] = await Promise.all([
          visibleProject && viewMode !== 'solid'
            ? service.generateLaneBoundaryVertices(visibleProject, 2.0).catch(() => empty)
            : empty,
          visibleProject && (display.showReferenceLine || viewMode !== 'solid')
            ? service.generateCenterLineVertices(visibleProject, 2.0).catch(() => empty)
            : empty,
          visibleProject && (viewMode === 'wire' || display.showLaneLines)
            ? service.generateLaneLineVertices(visibleProject, 2.0).catch(() => empty)
            : empty,
        ]);
        if (cancelled) {
          return;
        }

        const previewVerts = buildPolylineVertices(previewPoints, renderer.getMetersPerPixel(), PREVIEW_COLOR);
        const combined = mergeFloat32Arrays(
          mergeFloat32Arrays(
            mergeFloat32Arrays(existingLaneVerts, existingMarkVerts),
            existingCenterVerts,
          ),
          previewVerts,
        );
        renderer.uploadLaneLineVertices(combined);
      } catch {
        // Ignore preview failures.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cursorPreviewPos, display, editMode, project, rendererRef, splineKnots, status, viewMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const viewState = useViewportStore.getState();
      if (!isSpiralDrawMode(viewState.editMode)) {
        return;
      }

      if (event.key === 'Escape') {
        viewState.clearSplineKnots();
        return;
      }

      if (event.key === 'Backspace') {
        if (viewState.splineKnots.length > 0) {
          viewState.popSplineKnot();
          if (viewState.splineKnots.length <= 2) {
            viewState.clearDrawSnap();
          }
        }
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        finalizeSpiralCreation();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [finalizeSpiralCreation]);

  const queryDrawModeSnap = useCallback(async (x: number, y: number) => {
    try {
      const service = await getPlatformService();
      const { project: currentProject } = useProjectStore.getState();
      const snapResult = await service.snapPoint(currentProject, x, y, {
        grid_enabled: false,
        grid_size: 1.0,
        endpoint_enabled: true,
        endpoint_threshold: useViewportStore.getState().snapThreshold,
        snap_to_lane_endpoints: false,
        midpoint_enabled: false,
        perpendicular_enabled: false,
      });
      if (snapResult.snapped && snapResult.snap_type === 'Endpoint') {
        useViewportStore.getState().setDrawSnapResult({
          x: snapResult.x,
          y: snapResult.y,
          snapped: true,
          snapType: snapResult.snap_type,
          targetId: snapResult.target_id,
          contactPoint: snapResult.contact_point,
        });
      } else {
        useViewportStore.getState().setDrawSnapResult(null);
      }
    } catch {
      useViewportStore.getState().setDrawSnapResult(null);
    }
  }, []);

  const handleSpiralDrawMouseMove = useCallback((worldPos: WorldPosition, canvas: HTMLCanvasElement): boolean => {
    const viewState = useViewportStore.getState();
    if (!isSpiralDrawMode(viewState.editMode) || viewState.geometryEditSpline) {
      return false;
    }

    syncCursor(worldPos);
    if (viewState.splineKnots.length < 2 && viewState.snapEnabled) {
      void queryDrawModeSnap(worldPos.x, worldPos.y);
    } else {
      viewState.setDrawSnapResult(null);
    }

    if (viewState.splineKnots.length === 0) {
      viewState.setCursorPreviewPos(null);
      canvas.style.cursor = 'crosshair';
      return false;
    }

    viewState.setCursorPreviewPos([worldPos.x, worldPos.y, 0]);
    canvas.style.cursor = 'crosshair';
    return false;
  }, [queryDrawModeSnap, syncCursor]);

  const handleSpiralDrawMouseDown = useCallback((): boolean => false, []);

  const handleSpiralDrawClick = useCallback((_event: ReactMouseEvent, worldPos: WorldPosition): boolean => {
    const viewState = useViewportStore.getState();
    if (viewState.geometryEditRoadId || !isSpiralDrawMode(viewState.editMode)) {
      return false;
    }

    if (viewState.splineKnots.length >= 2) {
      finalizeSpiralCreation(worldPos);
      return true;
    }

    const snap = viewState.drawSnapResult;
    const useSnap = snap?.snapped && snap.snapType === 'Endpoint' && snap.targetId && snap.contactPoint;
    const point: [number, number, number] = [
      useSnap ? snap.x : worldPos.x,
      useSnap ? snap.y : worldPos.y,
      0,
    ];
    const knotIndex = viewState.splineKnots.length;
    viewState.setSplineKnots([...viewState.splineKnots, point]);
    if (useSnap) {
      viewState.addSnappedEndpoint({
        knotIndex,
        roadId: snap.targetId!,
        contactPoint: snap.contactPoint!,
      });
    }
    if (knotIndex >= 1) {
      viewState.clearDrawSnap();
      viewState.setCursorPreviewPos(point);
    }
    return true;
  }, [finalizeSpiralCreation]);

  const handleSpiralDrawMouseUp = useCallback((): boolean => false, []);

  const handleSpiralDrawRightClick = useCallback((): boolean => {
    const viewState = useViewportStore.getState();
    if (!isSpiralDrawMode(viewState.editMode)) {
      return false;
    }
    if (viewState.splineKnots.length >= 2) {
      finalizeSpiralCreation();
    } else {
      viewState.clearSplineKnots();
    }
    return true;
  }, [finalizeSpiralCreation]);

  return {
    clearSpiralDrawHover,
    handleSpiralDrawMouseMove,
    handleSpiralDrawMouseDown,
    handleSpiralDrawClick,
    handleSpiralDrawMouseUp,
    handleSpiralDrawRightClick,
  };
}
