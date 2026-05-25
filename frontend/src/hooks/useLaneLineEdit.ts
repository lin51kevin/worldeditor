import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { getPlatformService } from '../services';
import type { Lane, LaneBoundaryPoint, LaneSection, LaneWidth, Project, Road } from '../services/platform';
import { useProjectStore } from '../stores/projectStore';
import { useViewportStore } from '../stores/viewportStore';
import { refitLaneWidth } from '../utils/polyFit';
import type { SceneNodeSelection } from '../utils/sceneGraph';
import type { ViewportRenderer } from '../viewport/renderer';

const SAMPLE_STEP_METERS = 5;
const CONTROL_HIT_RADIUS_PX = 10;
const CONTROL_RADIUS_PX = 5;
const MIN_LANE_WIDTH = 0.1;
const WIDTH_EPSILON = 1e-4;

interface LaneSelectionContext {
  road: Road;
  roadId: string;
  section: LaneSection;
  sectionIndex: number;
  lane: Lane;
  laneId: number;
  side: 'left' | 'right';
  sectionStart: number;
  sectionEnd: number;
  sectionLength: number;
}

interface Vector2 {
  x: number;
  y: number;
}

interface LaneLineBoundaryState {
  context: LaneSelectionContext;
  basePoints: LaneBoundaryPoint[];
  displayPoints: LaneBoundaryPoint[];
  baseWidths: number[];
  normals: Vector2[];
  previewWidth: LaneWidth | null;
}

interface LaneLineDragState {
  activeIndex: number;
  startWorld: { x: number; y: number };
  previewWidths: number[];
}

interface PickedLaneResult {
  roadId: string;
  sectionIndex: number;
  laneId: number;
}

function getLaneSelectionContext(project: Project, selectedSceneNode: SceneNodeSelection | null): LaneSelectionContext | null {
  if (!selectedSceneNode || selectedSceneNode.type !== 'lane') {
    return null;
  }

  const road = project.roads.find((candidate) => candidate.id === selectedSceneNode.roadId);
  if (!road) {
    return null;
  }

  const section = road.lane_sections[selectedSceneNode.sectionIndex];
  if (!section) {
    return null;
  }

  const lane = section[selectedSceneNode.side].find((candidate) => candidate.id === selectedSceneNode.laneId);
  if (!lane) {
    return null;
  }

  const sectionStart = section.s;
  const sectionEnd = road.lane_sections[selectedSceneNode.sectionIndex + 1]?.s ?? road.length;
  return {
    road,
    roadId: road.id,
    section,
    sectionIndex: selectedSceneNode.sectionIndex,
    lane,
    laneId: lane.id,
    side: selectedSceneNode.side,
    sectionStart,
    sectionEnd,
    sectionLength: Math.max(0.1, sectionEnd - sectionStart),
  };
}

function defaultLaneWidth(lane: Lane): LaneWidth {
  return lane.width[0] ?? { s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 };
}

function evaluateLaneWidthAtDs(widths: LaneWidth[], ds: number): number {
  const fallback: LaneWidth = widths[0] ?? { s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 };
  const active = [...widths]
    .sort((left, right) => left.s_offset - right.s_offset)
    .filter((entry) => entry.s_offset <= ds + 1e-9)
    .pop() ?? fallback;
  const localDs = Math.max(0, ds - active.s_offset);
  return active.a + active.b * localDs + active.c * localDs * localDs + active.d * localDs * localDs * localDs;
}

function computeSampleWidths(context: LaneSelectionContext, points: LaneBoundaryPoint[]): number[] {
  return points.map((point) => Math.max(MIN_LANE_WIDTH, evaluateLaneWidthAtDs(context.lane.width, point.s - context.sectionStart)));
}

function computePointNormals(points: LaneBoundaryPoint[]): Vector2[] {
  if (points.length === 0) {
    return [];
  }

  return points.map((point, index) => {
    const prev = points[Math.max(0, index - 1)] ?? point;
    const next = points[Math.min(points.length - 1, index + 1)] ?? point;
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: -dy / length, y: dx / length };
  });
}

function softSelectionWeight(distance: number, radius: number): number {
  if (radius <= 0) {
    return distance <= WIDTH_EPSILON ? 1 : 0;
  }

  const clamped = Math.min(1, Math.max(0, distance / radius));
  const smoothstep = clamped * clamped * (3 - 2 * clamped);
  return 1 - smoothstep;
}

function buildPreviewPoints(
  basePoints: LaneBoundaryPoint[],
  normals: Vector2[],
  baseWidths: number[],
  previewWidths: number[],
  side: 'left' | 'right',
): LaneBoundaryPoint[] {
  return basePoints.map((point, index) => {
    const normal = normals[index] ?? { x: 0, y: 1 };
    const widthDelta = (previewWidths[index] ?? 0) - (baseWidths[index] ?? 0);
    const deltaT = side === 'left' ? widthDelta : -widthDelta;
    return {
      ...point,
      x: point.x + normal.x * deltaT,
      y: point.y + normal.y * deltaT,
      t: point.t + deltaT,
    };
  });
}

function isWidthChanged(left: LaneWidth, right: LaneWidth): boolean {
  return Math.abs(left.a - right.a) > WIDTH_EPSILON
    || Math.abs(left.b - right.b) > WIDTH_EPSILON
    || Math.abs(left.c - right.c) > WIDTH_EPSILON
    || Math.abs(left.d - right.d) > WIDTH_EPSILON;
}

function computeLaneOuterOffset(section: LaneSection, laneId: number, ds: number): number {
  if (laneId > 0) {
    let offset = 0;
    for (let currentId = 1; currentId <= laneId; currentId += 1) {
      const lane = section.left.find((candidate) => candidate.id === currentId);
      if (lane) {
        offset += evaluateLaneWidthAtDs(lane.width, ds);
      }
    }
    return offset;
  }

  let offset = 0;
  for (let currentId = -1; currentId >= laneId; currentId -= 1) {
    const lane = section.right.find((candidate) => candidate.id === currentId);
    if (lane) {
      offset -= evaluateLaneWidthAtDs(lane.width, ds);
    }
  }
  return offset;
}

function createPreviewWidth(context: LaneSelectionContext, sPositions: number[], widths: number[]): LaneWidth {
  const fitted = refitLaneWidth(sPositions, widths, context.sectionStart, context.sectionLength);
  return {
    s_offset: 0,
    a: fitted.a,
    b: fitted.b,
    c: fitted.c,
    d: fitted.d,
  };
}

export function useLaneLineEdit({
  rendererRef,
  canvasRef,
  status,
}: {
  rendererRef: RefObject<ViewportRenderer | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  status: 'loading' | 'ready' | 'unsupported';
}) {
  const project = useProjectStore((state) => state.project);
  const selectedSceneNode = useProjectStore((state) => state.selectedSceneNode);
  const viewportMpp = useProjectStore((state) => state.viewportMpp);
  const editMode = useViewportStore((state) => state.editMode);
  const softSelectionRadius = useViewportStore((state) => state.softSelectionRadius);

  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const boundaryStateRef = useRef<LaneLineBoundaryState | null>(null);
  const dragStateRef = useRef<LaneLineDragState | null>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const screenPointsRef = useRef<Array<{ x: number; y: number } | null>>([]);

  const isActive = editMode === 'editLaneLine';

  const clearOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, overlay.width, overlay.height);
    }
    screenPointsRef.current = [];
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent || status !== 'ready') return;

    if (!overlayRef.current) {
      const overlay = document.createElement('canvas');
      overlay.style.position = 'absolute';
      overlay.style.inset = '0';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '2';
      overlayRef.current = overlay;
    }

    const overlay = overlayRef.current;
    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    if (overlay.parentElement !== parent) {
      parent.appendChild(overlay);
    }
  }, [canvasRef, status]);

  useEffect(() => {
    const overlay = overlayRef.current;
    const canvas = canvasRef.current;
    if (!overlay || !canvas) return;

    const resize = () => {
      overlay.width = canvas.clientWidth;
      overlay.height = canvas.clientHeight;
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef, status]);

  useEffect(() => {
    if (!isActive) {
      boundaryStateRef.current = null;
      dragStateRef.current = null;
      hoverIndexRef.current = null;
      clearOverlay();
      return;
    }

    const context = getLaneSelectionContext(project, selectedSceneNode);
    if (!context) {
      useViewportStore.getState().setEditMode('default');
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const service = await getPlatformService();
        const points = await service.sampleLaneBoundary(context.road, context.sectionStart, context.laneId, SAMPLE_STEP_METERS);
        if (cancelled) {
          return;
        }

        const basePoints = points;
        const baseWidths = computeSampleWidths(context, basePoints);
        const normals = computePointNormals(basePoints);
        boundaryStateRef.current = {
          context,
          basePoints,
          displayPoints: basePoints,
          baseWidths,
          normals,
          previewWidth: defaultLaneWidth(context.lane),
        };
        dragStateRef.current = null;
        hoverIndexRef.current = null;
      } catch (error) {
        if (!cancelled) {
          console.error('[LaneLineEdit] Failed to sample lane boundary:', error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clearOverlay, isActive, project, selectedSceneNode]);

  const drawOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!overlay || !renderer || !canvas) return;

    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, overlay.width, overlay.height);
    screenPointsRef.current = [];

    if (useViewportStore.getState().editMode !== 'editLaneLine') {
      return;
    }

    const boundaryState = boundaryStateRef.current;
    if (!boundaryState || boundaryState.displayPoints.length === 0) {
      return;
    }

    const dpr = canvas.width / Math.max(1, canvas.clientWidth);
    const toCssPoint = (point: LaneBoundaryPoint) => {
      const screen = renderer.projectWorldToScreen(point.x, point.y);
      return screen ? { x: screen.x / dpr, y: screen.y / dpr } : null;
    };

    const displayScreenPoints = boundaryState.displayPoints.map(toCssPoint);
    screenPointsRef.current = displayScreenPoints;
    const baseScreenPoints = boundaryState.basePoints.map(toCssPoint);
    const dragState = dragStateRef.current;
    const activeIndex = dragState?.activeIndex ?? hoverIndexRef.current;

    const drawPolyline = (points: Array<{ x: number; y: number } | null>, strokeStyle: string, lineWidth: number, dashed = false) => {
      ctx.save();
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (dashed) {
        ctx.setLineDash([8, 6]);
      }
      ctx.beginPath();
      let started = false;
      for (const point of points) {
        if (!point) continue;
        if (!started) {
          ctx.moveTo(point.x, point.y);
          started = true;
        } else {
          ctx.lineTo(point.x, point.y);
        }
      }
      if (started) {
        ctx.stroke();
      }
      ctx.restore();
    };

    if (dragState) {
      drawPolyline(baseScreenPoints, 'rgba(255, 255, 255, 0.24)', 2, true);
    }

    drawPolyline(displayScreenPoints, '#53d7ff', 3);
    drawPolyline(displayScreenPoints, 'rgba(83, 215, 255, 0.22)', 8);

    if (activeIndex !== null) {
      const activePoint = displayScreenPoints[activeIndex];
      if (activePoint) {
        const radiusPx = softSelectionRadius / Math.max(viewportMpp, 0.001);
        ctx.save();
        ctx.fillStyle = 'rgba(83, 215, 255, 0.14)';
        ctx.strokeStyle = 'rgba(83, 215, 255, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(activePoint.x, activePoint.y, radiusPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    const activeS = activeIndex !== null ? boundaryState.basePoints[activeIndex]?.s ?? null : null;
    for (let index = 0; index < displayScreenPoints.length; index += 1) {
      const point = displayScreenPoints[index];
      if (!point) continue;
      const distance = activeS === null ? Infinity : Math.abs((boundaryState.basePoints[index]?.s ?? activeS) - activeS);
      const influence = activeS === null ? 0 : softSelectionWeight(distance, softSelectionRadius);
      const isActivePoint = index === activeIndex;
      const isHoveredPoint = index === hoverIndexRef.current;

      ctx.save();
      ctx.fillStyle = isActivePoint
        ? '#ffb347'
        : isHoveredPoint
          ? '#ffffff'
          : influence > 0
            ? `rgba(83, 215, 255, ${0.45 + influence * 0.35})`
            : 'rgba(83, 215, 255, 0.82)';
      ctx.strokeStyle = 'rgba(12, 27, 37, 0.95)';
      ctx.lineWidth = isActivePoint ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.arc(point.x, point.y, isActivePoint ? CONTROL_RADIUS_PX + 1.5 : CONTROL_RADIUS_PX, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }, [canvasRef, rendererRef, softSelectionRadius, viewportMpp]);

  useEffect(() => {
    if (!isActive || status !== 'ready') {
      clearOverlay();
      return;
    }

    let frameId = 0;
    const tick = () => {
      drawOverlay();
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [clearOverlay, drawOverlay, isActive, status]);

  const findControlPointHit = useCallback((clientX: number, clientY: number, canvas: HTMLCanvasElement): number | null => {
    const rect = canvas.getBoundingClientRect();
    const pointerX = clientX - rect.left;
    const pointerY = clientY - rect.top;
    let bestIndex: number | null = null;
    let bestDistance = Infinity;

    for (let index = 0; index < screenPointsRef.current.length; index += 1) {
      const point = screenPointsRef.current[index];
      if (!point) continue;
      const dx = point.x - pointerX;
      const dy = point.y - pointerY;
      const distance = Math.hypot(dx, dy);
      if (distance <= CONTROL_HIT_RADIUS_PX && distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    return bestIndex;
  }, []);

  const handleLaneLineMouseDown = useCallback((event: ReactMouseEvent, canvas: HTMLCanvasElement, renderer: ViewportRenderer): boolean => {
    if (useViewportStore.getState().editMode !== 'editLaneLine') {
      return false;
    }

    const boundaryState = boundaryStateRef.current;
    if (!boundaryState) {
      return true;
    }

    const hitIndex = findControlPointHit(event.clientX, event.clientY, canvas);
    if (hitIndex === null) {
      hoverIndexRef.current = null;
      canvas.style.cursor = '';
      return true;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = (event.clientX - rect.left) * devicePixelRatio;
    const screenY = (event.clientY - rect.top) * devicePixelRatio;
    const worldPos = renderer.unprojectToGround(screenX, screenY);
    if (!worldPos) {
      return true;
    }

    dragStateRef.current = {
      activeIndex: hitIndex,
      startWorld: worldPos,
      previewWidths: [...boundaryState.baseWidths],
    };
    hoverIndexRef.current = hitIndex;
    renderer.lockCamera();
    canvas.style.cursor = 'grabbing';
    return true;
  }, [findControlPointHit]);

  const handleLaneLineMouseMove = useCallback((
    worldPos: { x: number; y: number },
    canvas: HTMLCanvasElement,
    event: ReactMouseEvent,
  ): boolean => {
    if (useViewportStore.getState().editMode !== 'editLaneLine') {
      return false;
    }

    const boundaryState = boundaryStateRef.current;
    if (!boundaryState) {
      canvas.style.cursor = '';
      return true;
    }

    const dragState = dragStateRef.current;
    if (!dragState) {
      const hoverIndex = findControlPointHit(event.clientX, event.clientY, canvas);
      hoverIndexRef.current = hoverIndex;
      canvas.style.cursor = hoverIndex !== null ? 'grab' : '';
      return true;
    }

    const activePoint = boundaryState.basePoints[dragState.activeIndex];
    const activeNormal = boundaryState.normals[dragState.activeIndex] ?? { x: 0, y: 1 };
    if (!activePoint) {
      return true;
    }

    const deltaX = worldPos.x - dragState.startWorld.x;
    const deltaY = worldPos.y - dragState.startWorld.y;
    const lateralDelta = deltaX * activeNormal.x + deltaY * activeNormal.y;
    const widthDelta = boundaryState.context.side === 'left' ? lateralDelta : -lateralDelta;

    const previewWidths = boundaryState.baseWidths.map((baseWidth, index) => {
      const station = boundaryState.basePoints[index]?.s ?? activePoint.s;
      const influence = softSelectionWeight(Math.abs(station - activePoint.s), softSelectionRadius);
      return Math.max(MIN_LANE_WIDTH, baseWidth + widthDelta * influence);
    });

    dragState.previewWidths = previewWidths;
    boundaryState.previewWidth = createPreviewWidth(
      boundaryState.context,
      boundaryState.basePoints.map((point) => point.s),
      previewWidths,
    );
    boundaryState.displayPoints = buildPreviewPoints(
      boundaryState.basePoints,
      boundaryState.normals,
      boundaryState.baseWidths,
      previewWidths,
      boundaryState.context.side,
    );
    canvas.style.cursor = 'grabbing';
    return true;
  }, [findControlPointHit, softSelectionRadius]);

  const handleLaneLineMouseUp = useCallback((): boolean => {
    if (useViewportStore.getState().editMode !== 'editLaneLine') {
      return false;
    }

    const dragState = dragStateRef.current;
    const boundaryState = boundaryStateRef.current;
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;

    if (renderer) {
      renderer.unlockCamera();
    }

    dragStateRef.current = null;

    if (!boundaryState || !dragState) {
      if (canvas) {
        canvas.style.cursor = hoverIndexRef.current !== null ? 'grab' : '';
      }
      return true;
    }

    const previewWidth = boundaryState.previewWidth ?? defaultLaneWidth(boundaryState.context.lane);
    const originalWidth = defaultLaneWidth(boundaryState.context.lane);
    boundaryState.displayPoints = boundaryState.basePoints;
    boundaryState.previewWidth = originalWidth;

    if (canvas) {
      canvas.style.cursor = hoverIndexRef.current !== null ? 'grab' : '';
    }

    if (isWidthChanged(previewWidth, originalWidth)) {
      useProjectStore.getState().updateLaneWidth(
        boundaryState.context.roadId,
        boundaryState.context.sectionIndex,
        boundaryState.context.side,
        boundaryState.context.laneId,
        previewWidth,
      );
    }

    return true;
  }, [canvasRef, rendererRef]);

  const clearLaneLineHover = useCallback(() => {
    hoverIndexRef.current = null;
    if (!dragStateRef.current) {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.cursor = '';
      }
    }
  }, [canvasRef]);

  const handleLaneLineDoubleClick = useCallback(async (
    laneResult: PickedLaneResult,
    worldPos: { x: number; y: number },
    detail: number,
  ): Promise<boolean> => {
    if (detail < 2) {
      return false;
    }

    const road = project.roads.find((candidate) => candidate.id === laneResult.roadId);
    if (!road) {
      return false;
    }

    const side = laneResult.laneId > 0 ? 'left' : 'right';
    const section = road.lane_sections[laneResult.sectionIndex];
    if (!section) {
      return false;
    }

    const lane = section[side].find((candidate) => candidate.id === laneResult.laneId);
    if (!lane) {
      return false;
    }

    try {
      const service = await getPlatformService();
      const snap = await service.snapPointOnRoad(road, worldPos.x, worldPos.y);
      const ds = Math.max(0, snap.s - section.s);
      const boundaryOffset = computeLaneOuterOffset(section, lane.id, ds);
      const pickThreshold = Math.max(0.75, viewportMpp * 12);
      if (Math.abs(snap.t - boundaryOffset) > pickThreshold) {
        return false;
      }

      useViewportStore.getState().setEditMode('editLaneLine');
      return true;
    } catch (error) {
      console.error('[LaneLineEdit] Failed to enter lane line mode from double click:', error);
      return false;
    }
  }, [project.roads, viewportMpp]);

  return {
    handleLaneLineMouseDown,
    handleLaneLineMouseMove,
    handleLaneLineMouseUp,
    handleLaneLineDoubleClick,
    clearLaneLineHover,
  };
}
