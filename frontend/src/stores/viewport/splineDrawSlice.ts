import type { StateCreator } from 'zustand';
import type { EditorViewState } from '../viewportStore';
import type {
  SignalPlacementDraft,
  ObjectPlacementDraft,
  TangentCoupling,
  DraggingKnot,
} from './types';

export interface SplineDrawSlice {
  splineTemplateId: string;
  pendingTemplateId: string | null;
  pendingObjectTemplateId: string | null;
  signalPlacementDraft: SignalPlacementDraft;
  objectPlacementDraft: ObjectPlacementDraft;
  contextMenuWorldPos: { x: number; y: number } | null;
  splineKnots: Array<[number, number, number]>;
  splineTangentOverrides: Record<number, [number, number, number]>;
  splineTangentInOverrides: Record<number, [number, number, number]>;
  tangentCoupling: TangentCoupling;
  draggingKnot: DraggingKnot | null;
  cursorPreviewPos: [number, number, number] | null;
  /** Polygon-draw state for area-type road objects */
  objectDrawVertices: Array<[number, number, number]>;
  objectDrawRoadId: string | null;
  objectDrawTemplateId: string | null;
  setSplineTemplateId: (templateId: string) => void;
  setPendingTemplate: (id: string | null) => void;
  clearPendingTemplate: () => void;
  setPendingObjectTemplate: (id: string | null) => void;
  clearPendingObjectTemplate: () => void;
  setSignalPlacementDraft: (draft: SignalPlacementDraft) => void;
  setObjectPlacementDraft: (draft: ObjectPlacementDraft) => void;
  setContextMenuWorldPos: (pos: { x: number; y: number } | null) => void;
  setSplineKnots: (knots: Array<[number, number, number]>) => void;
  appendSplineKnot: (knot: [number, number, number]) => void;
  popSplineKnot: () => void;
  clearSplineKnots: () => void;
  setDraggingKnot: (info: DraggingKnot | null) => void;
  setCursorPreviewPos: (pos: [number, number, number] | null) => void;
  setSplineTangentOverride: (index: number, tangent: [number, number, number]) => void;
  setSplineTangentInOverride: (index: number, tangent: [number, number, number]) => void;
  setSplineTangentOverrides: (overrides: Record<number, [number, number, number]>) => void;
  setSplineTangentInOverrides: (overrides: Record<number, [number, number, number]>) => void;
  clearSplineTangentOverrides: () => void;
  setTangentCoupling: (coupling: TangentCoupling) => void;
  appendObjectDrawVertex: (vertex: [number, number, number]) => void;
  popObjectDrawVertex: () => void;
  clearObjectDraw: () => void;
  setObjectDrawRoadId: (id: string | null) => void;
  setObjectDrawTemplateId: (id: string | null) => void;
  /** @deprecated Use appendSplineKnot instead */
  appendDrawPoint: (point: [number, number, number]) => void;
  /** @deprecated Use clearSplineKnots instead */
  clearDrawPoints: () => void;
}

export const createSplineDrawSlice: StateCreator<EditorViewState, [], [], SplineDrawSlice> = (set) => ({
  splineTemplateId: 'tpl:road:single',
  pendingTemplateId: null,
  pendingObjectTemplateId: null,
  signalPlacementDraft: { type: 'traffic_light', value: '', orientation: '+' },
  objectPlacementDraft: { objectType: 'TrafficCone' },
  contextMenuWorldPos: null,
  splineKnots: [],
  splineTangentOverrides: {},
  splineTangentInOverrides: {},
  tangentCoupling: 'mirror',
  draggingKnot: null,
  cursorPreviewPos: null,
  objectDrawVertices: [],
  objectDrawRoadId: null,
  objectDrawTemplateId: null,

  setSplineTemplateId: (splineTemplateId) => set({ splineTemplateId }),
  setPendingTemplate: (pendingTemplateId) => set({ pendingTemplateId }),
  clearPendingTemplate: () => set({ pendingTemplateId: null }),
  setPendingObjectTemplate: (pendingObjectTemplateId) => set({ pendingObjectTemplateId }),
  clearPendingObjectTemplate: () => set({ pendingObjectTemplateId: null }),
  setSignalPlacementDraft: (signalPlacementDraft) => set({ signalPlacementDraft }),
  setObjectPlacementDraft: (objectPlacementDraft) => set({ objectPlacementDraft }),
  setContextMenuWorldPos: (contextMenuWorldPos) => set({ contextMenuWorldPos }),
  setSplineKnots: (splineKnots) => set({ splineKnots }),
  appendSplineKnot: (knot) => set((state) => ({ splineKnots: [...state.splineKnots, knot] })),
  popSplineKnot: () => set((state) => ({ splineKnots: state.splineKnots.slice(0, -1) })),
  clearSplineKnots: () => set({ splineKnots: [], splineTangentOverrides: {}, splineTangentInOverrides: {}, tangentCoupling: 'mirror', draggingKnot: null, cursorPreviewPos: null, drawSnapResult: null, snappedEndpoints: [] }),
  setDraggingKnot: (draggingKnot) => set({ draggingKnot }),
  setCursorPreviewPos: (cursorPreviewPos) => set({ cursorPreviewPos }),
  setSplineTangentOverride: (index, tangent) =>
    set((state) => ({ splineTangentOverrides: { ...state.splineTangentOverrides, [index]: tangent } })),
  setSplineTangentInOverride: (index, tangent) =>
    set((state) => ({ splineTangentInOverrides: { ...state.splineTangentInOverrides, [index]: tangent } })),
  setSplineTangentOverrides: (overrides) => set({ splineTangentOverrides: overrides }),
  setSplineTangentInOverrides: (overrides) => set({ splineTangentInOverrides: overrides }),
  clearSplineTangentOverrides: () => set({ splineTangentOverrides: {}, splineTangentInOverrides: {} }),
  setTangentCoupling: (tangentCoupling) => set({ tangentCoupling }),

  appendObjectDrawVertex: (vertex) => set((state) => ({ objectDrawVertices: [...state.objectDrawVertices, vertex] })),
  popObjectDrawVertex: () => set((state) => ({ objectDrawVertices: state.objectDrawVertices.slice(0, -1) })),
  clearObjectDraw: () => set({ objectDrawVertices: [], objectDrawRoadId: null, objectDrawTemplateId: null }),
  setObjectDrawRoadId: (objectDrawRoadId) => set({ objectDrawRoadId }),
  setObjectDrawTemplateId: (objectDrawTemplateId) => set({ objectDrawTemplateId }),

  appendDrawPoint: (point) => set((state) => ({ splineKnots: [...state.splineKnots, point] })),
  clearDrawPoints: () => set({ splineKnots: [], splineTangentOverrides: {}, splineTangentInOverrides: {}, draggingKnot: null }),
});
