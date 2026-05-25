import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { getPlatformService } from '../services';
import type { Project, RoadObjectItem, RoadSignal } from '../services/platform';
import { useProjectStore } from '../stores/projectStore';
import {
  isDrawMode,
  useViewportStore,
  type ObjectPlacementDraft,
  type SignalPlacementDraft,
} from '../stores/viewportStore';
import type { ViewportRenderer } from '../viewport/renderer';
import { genId } from '../plugins/editing/templates/engine';

export interface SignalPaletteOption {
  type: string;
  labelKey: string;
  icon: string;
  defaultValue?: string;
  defaultOrientation?: SignalPlacementDraft['orientation'];
}

export interface ObjectPlacementOption {
  objectType: string;
  labelKey: string;
  icon: string;
}

export const COMMON_SIGNAL_TYPES: SignalPaletteOption[] = [
  { type: 'traffic_light', labelKey: 'templatePanel.signals.trafficLight', icon: '🚦' },
  { type: 'stop_sign', labelKey: 'templatePanel.signals.stopSign', icon: '🛑' },
  { type: 'speed_limit', labelKey: 'signalPalette.speedLimit', icon: '🚧', defaultValue: '50' },
  { type: 'yield', labelKey: 'templatePanel.signals.giveWay', icon: '⚠️' },
  { type: 'pedestrian_crossing', labelKey: 'signalPalette.pedestrianCrossing', icon: '🚸' },
];

export const DEFAULT_OBJECT_PLACEMENT: ObjectPlacementOption = {
  objectType: 'TrafficCone',
  labelKey: 'templatePanel.objects.trafficCone',
  icon: '🔸',
};

interface PreviewState {
  kind: 'signal' | 'object';
  roadId: string;
  signal?: RoadSignal;
  object?: RoadObjectItem;
}

interface SignalDragState {
  roadId: string;
  signalId: string;
  initialSignal: RoadSignal;
  previewSignal: RoadSignal;
  startWorldX: number;
  startWorldY: number;
  startHeading: number;
  axis: 's' | 't' | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildPreviewProject(project: Project, roadId: string, preview: PreviewState): Project {
  return {
    ...project,
    roads: project.roads.map((road) => {
      if (road.id !== roadId) {
        return road;
      }
      if (preview.kind === 'signal' && preview.signal) {
        return { ...road, signals: [...(road.signals ?? []), preview.signal] };
      }
      if (preview.kind === 'object' && preview.object) {
        return { ...road, objects: [...(road.objects ?? []), preview.object] };
      }
      return road;
    }),
  };
}

export function createRoadSignalFromPlacement(
  placement: SignalPlacementDraft,
  s: number,
  t: number,
  id = genId(),
): RoadSignal {
  return {
    id,
    name: '',
    s,
    t,
    z_offset: 0,
    h_offset: 0,
    width: 0.6,
    height: 1.8,
    signal_type: placement.type,
    signal_subtype: '',
    value: placement.value.trim() === '' ? null : placement.value.trim(),
    orientation: placement.orientation,
    is_dynamic: placement.type === 'traffic_light',
  };
}

export function createRoadObjectFromPlacement(
  placement: ObjectPlacementDraft,
  s: number,
  t: number,
  hdg: number,
  id = genId(),
): RoadObjectItem {
  return {
    id,
    object_type: placement.objectType,
    name: '',
    position: { x: s, y: t, z: 0.1, id: null },
    orientation: hdg,
    hdg,
    width: 0.4,
    height: 0.7,
    length: 0.4,
    corners: [],
    validity: null,
  };
}

function clearTransientModes(): void {
  const viewStore = useViewportStore.getState();
  if (isDrawMode(viewStore.editMode)) {
    viewStore.clearSplineKnots();
  }
  viewStore.clearPendingTemplate();
  viewStore.clearPendingObjectTemplate();
}

export function startSignalPlacement(nextDraft?: Partial<SignalPlacementDraft>): void {
  clearTransientModes();
  const viewStore = useViewportStore.getState();
  viewStore.setSignalPlacementDraft({
    ...viewStore.signalPlacementDraft,
    ...nextDraft,
  });
  viewStore.setEditMode('placeSignal');
}

export function startObjectPlacement(nextDraft?: Partial<ObjectPlacementDraft>): void {
  clearTransientModes();
  const viewStore = useViewportStore.getState();
  viewStore.setObjectPlacementDraft({
    ...viewStore.objectPlacementDraft,
    ...nextDraft,
  });
  viewStore.setEditMode('placeObject');
}

interface UseSignalPlacementParams {
  rendererRef: RefObject<ViewportRenderer | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  pendingCursorRef: MutableRefObject<{ x: number; y: number } | null>;
}

export function useSignalPlacement({
  rendererRef,
  canvasRef,
  pendingCursorRef,
}: UseSignalPlacementParams) {
  const previewRef = useRef<PreviewState | null>(null);
  const previewRequestIdRef = useRef(0);
  const signalDragRef = useRef<SignalDragState | null>(null);

  const clearPlacementPreview = useCallback(() => {
    previewRequestIdRef.current += 1;
    previewRef.current = null;
    rendererRef.current?.clearHover();
  }, [rendererRef]);

  const uploadPreview = useCallback(async (roadId: string, preview: PreviewState) => {
    const requestId = ++previewRequestIdRef.current;
    const renderer = rendererRef.current;
    if (!renderer) {
      return;
    }

    const service = await getPlatformService();
    const project = useProjectStore.getState().project;
    const previewProject = buildPreviewProject(project, roadId, preview);

    const vertices = preview.kind === 'signal' && preview.signal
      ? await service.generateSingleSignalVertices(
          previewProject,
          roadId,
          preview.signal.id,
          [0.2, 0.9, 0.9, 0.95],
        )
      : preview.object
        ? await service.generateSingleObjectVertices(
            previewProject,
            roadId,
            preview.object.id,
            [0.2, 0.9, 0.9, 0.95],
          )
        : new Float32Array();

    if (requestId !== previewRequestIdRef.current) {
      return;
    }

    previewRef.current = preview;
    if (vertices.length > 0) {
      renderer.uploadHoverVertices(vertices);
    } else {
      renderer.clearHover();
    }
  }, [rendererRef]);

  const updatePlacementPreview = useCallback(async (worldPos: { x: number; y: number }) => {
    const viewState = useViewportStore.getState();
    if (viewState.editMode !== 'placeSignal' && viewState.editMode !== 'placeObject') {
      clearPlacementPreview();
      return false;
    }

    const project = useProjectStore.getState().project;
    if (project.roads.length === 0) {
      clearPlacementPreview();
      return true;
    }

    try {
      const service = await getPlatformService();
      const roadId = await service.pickRoadAtPointCached(worldPos.x, worldPos.y, 10.0);
      if (!roadId) {
        clearPlacementPreview();
        return true;
      }

      const road = project.roads.find((candidate) => candidate.id === roadId);
      if (!road) {
        clearPlacementPreview();
        return true;
      }

      const snap = await service.snapPointOnRoad(road, worldPos.x, worldPos.y);
      const preview = viewState.editMode === 'placeSignal'
        ? {
            kind: 'signal' as const,
            roadId,
            signal: createRoadSignalFromPlacement(viewState.signalPlacementDraft, snap.s, snap.t, '__signal_preview__'),
          }
        : {
            kind: 'object' as const,
            roadId,
            object: createRoadObjectFromPlacement(viewState.objectPlacementDraft, snap.s, snap.t, snap.hdg, '__object_preview__'),
          };

      await uploadPreview(roadId, preview);
      pendingCursorRef.current = worldPos;
    } catch {
      clearPlacementPreview();
    }

    return true;
  }, [clearPlacementPreview, pendingCursorRef, uploadPreview]);

  const commitPlacement = useCallback(async (worldPos: { x: number; y: number }) => {
    const viewState = useViewportStore.getState();
    if (viewState.editMode !== 'placeSignal' && viewState.editMode !== 'placeObject') {
      return false;
    }

    try {
      const service = await getPlatformService();
      const project = useProjectStore.getState().project;
      const currentPreview = previewRef.current;
      let roadId = currentPreview?.roadId ?? '';
      let road = project.roads.find((candidate) => candidate.id === roadId) ?? null;

      if (!road) {
        roadId = (await service.pickRoadAtPointCached(worldPos.x, worldPos.y, 10.0)) ?? '';
        road = project.roads.find((candidate) => candidate.id === roadId) ?? null;
      }
      if (!road) {
        return true;
      }

      const snap = await service.snapPointOnRoad(road, worldPos.x, worldPos.y);
      const store = useProjectStore.getState();
      if (viewState.editMode === 'placeSignal') {
        const signal = createRoadSignalFromPlacement(viewState.signalPlacementDraft, snap.s, snap.t);
        store.addRoadSignalItem(road.id, signal);
        store.selectSignal(road.id, signal.id);
      } else {
        const obj = createRoadObjectFromPlacement(viewState.objectPlacementDraft, snap.s, snap.t, snap.hdg);
        store.addRoadObjectItem(road.id, obj);
        store.selectObject(road.id, obj.id);
      }
      viewState.setEditMode('default');
      clearPlacementPreview();
    } catch {
      clearPlacementPreview();
    }

    return true;
  }, [clearPlacementPreview]);

  const startSignalDrag = useCallback(async (
    e: React.MouseEvent,
    renderer: ViewportRenderer,
    canvas: HTMLCanvasElement,
  ) => {
    if (e.shiftKey) {
      return false;
    }

    const viewState = useViewportStore.getState();
    if (viewState.editMode !== 'default') {
      return false;
    }

    const selectedSceneNode = useProjectStore.getState().selectedSceneNode;
    if (selectedSceneNode?.type !== 'signal') {
      return false;
    }

    const rect = canvas.getBoundingClientRect();
    const worldPos = renderer.unprojectToGround(
      (e.clientX - rect.left) * devicePixelRatio,
      (e.clientY - rect.top) * devicePixelRatio,
    );
    if (!worldPos) {
      return false;
    }

    try {
      const service = await getPlatformService();
      const hit = await service.pickSignalAtPointCached(worldPos.x, worldPos.y, 4.0);
      if (!hit || hit.roadId !== selectedSceneNode.roadId || hit.signalId !== selectedSceneNode.signalId) {
        return false;
      }

      const project = useProjectStore.getState().project;
      const road = project.roads.find((candidate) => candidate.id === hit.roadId);
      const signal = road?.signals?.find((candidate) => candidate.id === hit.signalId);
      if (!road || !signal) {
        return false;
      }

      const signalWorldPos = await service.getSignalWorldPosCached(hit.roadId, hit.signalId);
      const headingSample = signalWorldPos
        ? await service.snapPointOnRoad(road, signalWorldPos.x, signalWorldPos.y)
        : await service.snapPointOnRoad(road, worldPos.x, worldPos.y);

      signalDragRef.current = {
        roadId: hit.roadId,
        signalId: hit.signalId,
        initialSignal: signal,
        previewSignal: signal,
        startWorldX: worldPos.x,
        startWorldY: worldPos.y,
        startHeading: headingSample.hdg,
        axis: null,
      };
      renderer.lockCamera();
      canvas.style.cursor = 'grabbing';
      return true;
    } catch {
      return false;
    }
  }, []);

  const updateSignalDrag = useCallback(async (worldPos: { x: number; y: number }) => {
    const drag = signalDragRef.current;
    if (!drag) {
      return false;
    }

    try {
      const project = useProjectStore.getState().project;
      const road = project.roads.find((candidate) => candidate.id === drag.roadId);
      if (!road) {
        return false;
      }

      const dx = worldPos.x - drag.startWorldX;
      const dy = worldPos.y - drag.startWorldY;
      const along = dx * Math.cos(drag.startHeading) + dy * Math.sin(drag.startHeading);
      const lateral = -dx * Math.sin(drag.startHeading) + dy * Math.cos(drag.startHeading);
      if (drag.axis === null && (Math.abs(along) > 0.05 || Math.abs(lateral) > 0.05)) {
        drag.axis = Math.abs(along) >= Math.abs(lateral) ? 's' : 't';
      }

      const service = await getPlatformService();
      const snap = await service.snapPointOnRoad(road, worldPos.x, worldPos.y);
      const previewSignal: RoadSignal = {
        ...drag.initialSignal,
        s: drag.axis === 't' ? drag.initialSignal.s : clamp(snap.s, 0, road.length),
        t: drag.axis === 's' ? drag.initialSignal.t : snap.t,
      };

      drag.previewSignal = previewSignal;
      await uploadPreview(road.id, { kind: 'signal', roadId: road.id, signal: previewSignal });
      pendingCursorRef.current = worldPos;
      return true;
    } catch {
      return false;
    }
  }, [pendingCursorRef, uploadPreview]);

  const commitSignalDrag = useCallback(() => {
    const drag = signalDragRef.current;
    if (!drag) {
      return false;
    }

    signalDragRef.current = null;
    rendererRef.current?.unlockCamera();
    if (canvasRef.current) {
      canvasRef.current.style.cursor = '';
    }
    clearPlacementPreview();

    if (
      drag.previewSignal.s !== drag.initialSignal.s ||
      drag.previewSignal.t !== drag.initialSignal.t
    ) {
      useProjectStore.getState().updateSignal(drag.signalId, {
        s: drag.previewSignal.s,
        t: drag.previewSignal.t,
      });
    }
    return true;
  }, [canvasRef, clearPlacementPreview, rendererRef]);

  useEffect(() => {
    const { editMode } = useViewportStore.getState();
    if (editMode !== 'placeSignal' && editMode !== 'placeObject' && !signalDragRef.current) {
      clearPlacementPreview();
    }
  });

  return {
    clearPlacementPreview,
    updatePlacementPreview,
    commitPlacement,
    startSignalDrag,
    updateSignalDrag,
    commitSignalDrag,
  };
}
