import { useRef, type MutableRefObject, type RefObject } from 'react';
import { ViewportRenderer } from '../viewport/renderer';
import { emitCursorMove } from '../viewport/cursorEvents';
import { useProjectStore } from '../stores/projectStore';
import { useViewportStore } from '../stores/viewportStore';
import { getPlatformService } from '../services';
import type { Project } from '../services/platform';
import type { MoveRotateDragState, MoveRotateElementDragState } from '../components/viewportUtils';
import { MAX_UNDO } from '../stores/slices/types';

/**
 * Handles move-road / rotate-road drag interaction.
 * Context-aware: when a signal or road object is selected, operates on that
 * element (modifying s/t/hdg) rather than the entire road.
 */
export function useMoveRotateMode(
  rendererRef: RefObject<ViewportRenderer | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  isPreviewingRoadRef: MutableRefObject<boolean>,
  pendingCursorRef: MutableRefObject<{ x: number; y: number } | null>,
) {
  const moveRotateDragRef = useRef<MoveRotateDragState | null>(null);
  const elementDragRef = useRef<MoveRotateElementDragState | null>(null);

  /** Start move/rotate drag. Returns true if started. */
  const startMoveRotateDrag = (
    e: React.MouseEvent,
    renderer: ViewportRenderer,
    canvas: HTMLCanvasElement,
  ): boolean => {
    const viewState = useViewportStore.getState();
    if (viewState.editMode !== 'move-road' && viewState.editMode !== 'rotate-road') return false;

    const rect = canvas.getBoundingClientRect();
    const screenX = (e.clientX - rect.left) * devicePixelRatio;
    const screenY = (e.clientY - rect.top) * devicePixelRatio;
    const worldPos = renderer.unprojectToGround(screenX, screenY);
    if (!worldPos) return false;

    const store = useProjectStore.getState();
    const { selectedSceneNode } = store;

    // Check if a signal or object is selected — operate on element instead of road
    if (selectedSceneNode?.type === 'signal' || selectedSceneNode?.type === 'object') {
      void startElementDrag(viewState.editMode, selectedSceneNode, worldPos, renderer, canvas);
      return true;
    }

    // Fallback: operate on the road
    const selRoadId = store.selectedRoadId;
    const road = selRoadId ? store.project.roads.find((r) => r.id === selRoadId) : null;
    if (!road || road.plan_view.length === 0) return false;

    const cx = road.plan_view.reduce((sum, g) => sum + g.x, 0) / road.plan_view.length;
    const cy = road.plan_view.reduce((sum, g) => sum + g.y, 0) / road.plan_view.length;
    moveRotateDragRef.current = {
      mode: viewState.editMode,
      roadId: selRoadId!,
      startWorldX: worldPos.x,
      startWorldY: worldPos.y,
      centroidX: cx,
      centroidY: cy,
      currentDx: 0,
      currentDy: 0,
      currentAngle: 0,
    };
    renderer.lockCamera();
    canvas.style.cursor = viewState.editMode === 'move-road' ? 'move' : 'crosshair';
    return true;
  };

  /** Start element-level (signal/object) drag. */
  const startElementDrag = async (
    mode: 'move-road' | 'rotate-road',
    node: { type: 'signal'; roadId: string; signalId: string } | { type: 'object'; roadId: string; objectId: string },
    worldPos: { x: number; y: number },
    renderer: ViewportRenderer,
    canvas: HTMLCanvasElement,
  ) => {
    const store = useProjectStore.getState();
    const road = store.project.roads.find((r) => r.id === node.roadId);
    if (!road) return;

    const service = await getPlatformService();
    let elementWorldPos: { x: number; y: number } | null = null;
    let initialS = 0;
    let initialT = 0;
    let initialHdg = 0;
    let elementId = '';

    if (node.type === 'signal') {
      elementId = node.signalId;
      const signal = road.signals?.find((s) => s.id === node.signalId);
      if (!signal) return;
      initialS = signal.s;
      initialT = signal.t;
      initialHdg = signal.h_offset;
      elementWorldPos = await service.getSignalWorldPosCached(node.roadId, node.signalId);
    } else {
      elementId = node.objectId;
      const obj = road.objects?.find((o) => o.id === node.objectId);
      if (!obj) return;
      initialS = obj.position.x;
      initialT = obj.position.y;
      initialHdg = obj.hdg;
      elementWorldPos = await service.getObjectWorldPosCached(node.roadId, node.objectId);
    }

    if (!elementWorldPos) return;

    const snap = await service.snapPointOnRoad(road, elementWorldPos.x, elementWorldPos.y);

    elementDragRef.current = {
      mode,
      elementType: node.type,
      roadId: node.roadId,
      elementId,
      startWorldX: worldPos.x,
      startWorldY: worldPos.y,
      elementWorldX: elementWorldPos.x,
      elementWorldY: elementWorldPos.y,
      roadHeading: snap.hdg,
      initialS,
      initialT,
      initialHdg,
      currentS: initialS,
      currentT: initialT,
      currentHdg: initialHdg,
    };
    renderer.lockCamera();
    canvas.style.cursor = mode === 'move-road' ? 'move' : 'crosshair';
  };

  /** Update move/rotate preview during mouse move. Returns true if handled. */
  const updateMoveRotateDrag = (worldPos: { x: number; y: number }): boolean => {
    // Element drag takes priority
    if (elementDragRef.current) {
      updateElementDrag(worldPos);
      return true;
    }

    const moveRotateDrag = moveRotateDragRef.current;
    if (!moveRotateDrag) return false;

    const { mode, roadId, startWorldX, startWorldY, centroidX, centroidY } = moveRotateDrag;
    const { project: currentProject } = useProjectStore.getState();
    const road = currentProject.roads.find((r) => r.id === roadId);
    if (road) {
      let previewRoad: typeof road;
      if (mode === 'move-road') {
        const dx = worldPos.x - startWorldX;
        const dy = worldPos.y - startWorldY;
        moveRotateDrag.currentDx = dx;
        moveRotateDrag.currentDy = dy;
        previewRoad = {
          ...road,
          plan_view: road.plan_view.map((g) => ({ ...g, x: g.x + dx, y: g.y + dy })),
        };
      } else {
        const startAngle = Math.atan2(startWorldY - centroidY, startWorldX - centroidX);
        const currentAngle = Math.atan2(worldPos.y - centroidY, worldPos.x - centroidX);
        const angleDelta = currentAngle - startAngle;
        moveRotateDrag.currentAngle = angleDelta;
        const cosA = Math.cos(angleDelta);
        const sinA = Math.sin(angleDelta);
        previewRoad = {
          ...road,
          plan_view: road.plan_view.map((g) => {
            const rx = g.x - centroidX;
            const ry = g.y - centroidY;
            return {
              ...g,
              x: centroidX + rx * cosA - ry * sinA,
              y: centroidY + rx * sinA + ry * cosA,
              hdg: g.hdg + angleDelta,
            };
          }),
        };
      }

      if (!isPreviewingRoadRef.current) {
        isPreviewingRoadRef.current = true;
        const liveRenderer = rendererRef.current;
        if (liveRenderer) {
          void (async () => {
            try {
              const service = await getPlatformService();
              const verts = await service.generateSingleRoadVertices(
                previewRoad, 2.0, [0.95, 0.60, 0.10, 0.85],
              );
              rendererRef.current?.uploadHighlightVertices(verts);
            } catch { /* ignore preview errors */ }
            finally { isPreviewingRoadRef.current = false; }
          })();
        }
      }
    }
    emitCursorMove(worldPos.x, worldPos.y);
    pendingCursorRef.current = worldPos;
    return true;
  };

  /** Update element-level drag (signal/object move or rotate). */
  const updateElementDrag = (worldPos: { x: number; y: number }) => {
    const drag = elementDragRef.current;
    if (!drag) return;

    if (drag.mode === 'move-road') {
      // Project world delta onto road-local (s, t) using road heading
      const dx = worldPos.x - drag.startWorldX;
      const dy = worldPos.y - drag.startWorldY;
      const cosH = Math.cos(drag.roadHeading);
      const sinH = Math.sin(drag.roadHeading);
      const ds = dx * cosH + dy * sinH;
      const dt = -dx * sinH + dy * cosH;
      drag.currentS = drag.initialS + ds;
      drag.currentT = drag.initialT + dt;
    } else {
      // Rotate: compute angle delta around element world position
      const startAngle = Math.atan2(
        drag.startWorldY - drag.elementWorldY,
        drag.startWorldX - drag.elementWorldX,
      );
      const currentAngle = Math.atan2(
        worldPos.y - drag.elementWorldY,
        worldPos.x - drag.elementWorldX,
      );
      const angleDelta = currentAngle - startAngle;
      drag.currentHdg = drag.initialHdg + angleDelta;
    }

    // Upload preview highlight
    if (!isPreviewingRoadRef.current) {
      isPreviewingRoadRef.current = true;
      void (async () => {
        try {
          const service = await getPlatformService();
          const store = useProjectStore.getState();
          const highlightColor: [number, number, number, number] = [0.95, 0.60, 0.10, 0.85];

          if (drag.elementType === 'signal') {
            // Temporarily update signal in project for preview generation
            const previewProject = applySignalPreview(store.project, drag);
            const verts = await service.generateSingleSignalVertices(
              previewProject, drag.roadId, drag.elementId, highlightColor,
            );
            rendererRef.current?.uploadHighlightVertices(verts);
          } else {
            const previewProject = applyObjectPreview(store.project, drag);
            const verts = await service.generateSingleObjectVertices(
              previewProject, drag.roadId, drag.elementId, highlightColor,
            );
            rendererRef.current?.uploadHighlightVertices(verts);
          }
        } catch { /* ignore preview errors */ }
        finally { isPreviewingRoadRef.current = false; }
      })();
    }

    emitCursorMove(worldPos.x, worldPos.y);
    pendingCursorRef.current = worldPos;
  };

  /** Commit move/rotate to store on mouse up. Returns true if handled. */
  const commitMoveRotateDrag = (): boolean => {
    // Element drag commit
    if (elementDragRef.current) {
      commitElementDrag();
      return true;
    }

    const moveRotateDrag = moveRotateDragRef.current;
    if (!moveRotateDrag) return false;

    moveRotateDragRef.current = null;
    const renderer = rendererRef.current;
    if (renderer) {
      renderer.unlockCamera();
      renderer.clearHighlight();
    }
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = '';
    const { mode, roadId, currentDx, currentDy, currentAngle, centroidX, centroidY } = moveRotateDrag;
    const store = useProjectStore.getState();
    if (mode === 'move-road' && (currentDx !== 0 || currentDy !== 0)) {
      store.moveRoad(roadId, currentDx, currentDy);
    } else if (mode === 'rotate-road' && currentAngle !== 0) {
      store.rotateRoad(roadId, currentAngle, centroidX, centroidY);
    }
    return true;
  };

  /** Commit element-level changes. */
  const commitElementDrag = () => {
    const drag = elementDragRef.current;
    if (!drag) return;

    elementDragRef.current = null;
    const renderer = rendererRef.current;
    if (renderer) {
      renderer.unlockCamera();
      renderer.clearHighlight();
    }
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = '';

    const store = useProjectStore.getState();

    if (drag.mode === 'move-road') {
      // Move: update s/t
      const sChanged = drag.currentS !== drag.initialS;
      const tChanged = drag.currentT !== drag.initialT;
      if (!sChanged && !tChanged) return;

      if (drag.elementType === 'signal') {
        store.updateSignal(drag.elementId, { s: drag.currentS, t: drag.currentT });
      } else {
        // Update road-level object position (position.x=s, position.y=t)
        moveRoadObject(store, drag.roadId, drag.elementId, drag.currentS, drag.currentT);
      }
    } else {
      // Rotate: update heading
      if (drag.currentHdg === drag.initialHdg) return;

      if (drag.elementType === 'signal') {
        store.updateSignal(drag.elementId, { h_offset: drag.currentHdg });
      } else {
        rotateRoadObject(store, drag.roadId, drag.elementId, drag.currentHdg);
      }
    }
  };

  return {
    moveRotateDragRef,
    elementDragRef,
    startMoveRotateDrag,
    updateMoveRotateDrag,
    commitMoveRotateDrag,
  };
}

/** Build a project copy with the signal's preview position applied. */
function applySignalPreview(
  project: Project,
  drag: MoveRotateElementDragState,
): Project {
  return {
    ...project,
    roads: project.roads.map((road) => {
      if (road.id !== drag.roadId) return road;
      return {
        ...road,
        signals: (road.signals ?? []).map((s) => {
          if (s.id !== drag.elementId) return s;
          if (drag.mode === 'move-road') {
            return { ...s, s: drag.currentS, t: drag.currentT };
          }
          return { ...s, h_offset: drag.currentHdg };
        }),
      };
    }),
  };
}

/** Build a project copy with the object's preview position applied. */
function applyObjectPreview(
  project: Project,
  drag: MoveRotateElementDragState,
): Project {
  return {
    ...project,
    roads: project.roads.map((road) => {
      if (road.id !== drag.roadId) return road;
      return {
        ...road,
        objects: (road.objects ?? []).map((o) => {
          if (o.id !== drag.elementId) return o;
          if (drag.mode === 'move-road') {
            return { ...o, position: { ...o.position, x: drag.currentS, y: drag.currentT } };
          }
          return { ...o, hdg: drag.currentHdg };
        }),
      };
    }),
  };
}

/** Directly update a road object's position on the road. */
function moveRoadObject(
  _store: ReturnType<typeof useProjectStore.getState>,
  roadId: string,
  objectId: string,
  newS: number,
  newT: number,
) {
  useProjectStore.setState((state) => {
    const road = state.project.roads.find((r) => r.id === roadId);
    if (!road) return state;
    const obj = road.objects?.find((o) => o.id === objectId);
    if (!obj) return state;

    return {
      undoStack: [...state.undoStack, state.project].slice(-MAX_UNDO),
      redoStack: [],
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          return {
            ...r,
            objects: (r.objects ?? []).map((o) =>
              o.id === objectId
                ? { ...o, position: { ...o.position, x: newS, y: newT } }
                : o,
            ),
          };
        }),
      },
      isDirty: true,
    };
  });
}

/** Directly update a road object's heading on the road. */
function rotateRoadObject(
  _store: ReturnType<typeof useProjectStore.getState>,
  roadId: string,
  objectId: string,
  newHdg: number,
) {
  useProjectStore.setState((state) => {
    const road = state.project.roads.find((r) => r.id === roadId);
    if (!road) return state;
    const obj = road.objects?.find((o) => o.id === objectId);
    if (!obj) return state;

    return {
      undoStack: [...state.undoStack, state.project].slice(-MAX_UNDO),
      redoStack: [],
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          return {
            ...r,
            objects: (r.objects ?? []).map((o) =>
              o.id === objectId ? { ...o, hdg: newHdg } : o,
            ),
          };
        }),
      },
      isDirty: true,
    };
  });
}
