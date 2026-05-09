import { create } from 'zustand';
import type { Project, Road, Junction, LaneWidth } from '../services/platform';
import type { LaneSide, SceneNodeSelection } from '../utils/sceneGraph';

interface EditorState {
  // Project state
  project: Project;
  isDirty: boolean;
  selectedRoadId: string | null;
  selectedJunctionId: string | null;
  selectedObjectType: 'road' | 'junction' | null;
  selectedSceneNode: SceneNodeSelection | null;

  // Cursor position (world coordinates)
  cursorWorldPos: { x: number; y: number };

  // Viewport scale info, updated by renderer on data load / camera change
  gridSpacing: number;   // world units per grid cell (auto-derived from data extent)
  viewportMpp: number;   // meters per screen pixel (camera-dependent)

  // Undo/Redo stacks
  undoStack: Project[];
  redoStack: Project[];

  // Actions
  setProject: (project: Project) => void;
  selectRoad: (id: string | null) => void;
  selectJunction: (id: string | null) => void;
  selectLaneSection: (roadId: string, sectionIndex: number) => void;
  selectLane: (roadId: string, sectionIndex: number, side: LaneSide, laneId: number) => void;
  addRoad: (road: Road) => void;
  removeRoad: (id: string) => void;
  updateRoad: (id: string, updates: Partial<Pick<Road, 'name' | 'length' | 'junction_id'>>) => void;
  updateJunction: (id: string, updates: Partial<Pick<Junction, 'name'>>) => void;
  addSignal: (signal: SignalItem) => void;
  removeSignal: (id: string) => void;
  updateSignal: (id: string, updates: Partial<SignalItem>) => void;
  addObject: (obj: ObjectItem) => void;
  removeObject: (id: string) => void;
  updateObject: (id: string, updates: Partial<ObjectItem>) => void;
  updateLaneType: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, laneType: string) => void;
  updateLaneWidth: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, width: LaneWidth) => void;
  setCursorWorldPos: (pos: { x: number; y: number }) => void;
  setViewportInfo: (info: { gridSpacing: number; mpp: number }) => void;
  markDirty: () => void;
  markClean: () => void;
  reset: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

// Signal and Object types for store
export interface SignalItem {
  id: string;
  roadId: string;
  sPosition: number;
  laneId: number;
  type: string;
  validity: string;
}

export interface ObjectItem {
  id: string;
  roadId: string;
  sPosition: number;
  laneId: number;
  type: string;
  validity: string;
}

const MAX_UNDO = 50;

const initialProject: Project = {
  name: 'Untitled',
  header: {
    rev_major: 1,
    rev_minor: 6,
    name: '',
    date: '',
    north: 0,
    south: 0,
    east: 0,
    west: 0,
    geo_reference: null,
  },
  roads: [],
  junctions: [],
};

/** Push current project onto undo stack, clear redo. */
function pushUndo(state: EditorState): Partial<EditorState> {
  const undoStack = [...state.undoStack, state.project].slice(-MAX_UNDO);
  return { undoStack, redoStack: [] };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  project: initialProject,
  isDirty: false,
  selectedRoadId: null,
  selectedJunctionId: null,
  selectedObjectType: null,
  selectedSceneNode: null,
  cursorWorldPos: { x: 0, y: 0 },
  gridSpacing: 10.0,
  viewportMpp: 0.1,
  undoStack: [],
  redoStack: [],

  setProject: (project) => set({ project, isDirty: false, undoStack: [], redoStack: [] }),

  selectRoad: (id) =>
    set({
      selectedRoadId: id,
      selectedJunctionId: null,
      selectedObjectType: id ? 'road' : null,
      selectedSceneNode: id ? { type: 'road', roadId: id } : null,
    }),

  selectJunction: (id) =>
    set({
      selectedJunctionId: id,
      selectedRoadId: null,
      selectedObjectType: id ? 'junction' : null,
      selectedSceneNode: id ? { type: 'junction', junctionId: id } : null,
    }),

  selectLaneSection: (roadId, sectionIndex) =>
    set({
      selectedRoadId: roadId,
      selectedJunctionId: null,
      selectedObjectType: 'road',
      selectedSceneNode: { type: 'laneSection', roadId, sectionIndex },
    }),

  selectLane: (roadId, sectionIndex, side, laneId) =>
    set({
      selectedRoadId: roadId,
      selectedJunctionId: null,
      selectedObjectType: 'road',
      selectedSceneNode: { type: 'lane', roadId, sectionIndex, side, laneId },
    }),

  addRoad: (road) =>
    set((state) => ({
      ...pushUndo(state),
      project: { ...state.project, roads: [...state.project.roads, road] },
      isDirty: true,
    })),

  removeRoad: (id) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.filter((r) => r.id !== id),
      },
      isDirty: true,
      selectedRoadId: state.selectedRoadId === id ? null : state.selectedRoadId,
      selectedSceneNode: state.selectedSceneNode && 'roadId' in state.selectedSceneNode && state.selectedSceneNode.roadId === id
        ? null
        : state.selectedSceneNode,
    })),

  updateRoad: (id, updates) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) =>
          r.id === id ? { ...r, ...updates } : r,
        ),
      },
      isDirty: true,
    })),

  updateJunction: (id, updates) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        junctions: state.project.junctions.map((j) =>
          j.id === id ? { ...j, ...updates } : j,
        ),
      },
      isDirty: true,
    })),

  addSignal: (signal) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        signals: [...((state.project as any).signals || []), signal],
      },
      isDirty: true,
    })),

  removeSignal: (id) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        signals: ((state.project as any).signals || []).filter((s: SignalItem) => s.id !== id),
      },
      isDirty: true,
    })),

  updateSignal: (id, updates) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        signals: ((state.project as any).signals || []).map((s: SignalItem) =>
          s.id === id ? { ...s, ...updates } : s,
        ),
      },
      isDirty: true,
    })),

  addObject: (obj) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        objects: [...((state.project as any).objects || []), obj],
      },
      isDirty: true,
    })),

  removeObject: (id) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        objects: ((state.project as any).objects || []).filter((o: ObjectItem) => o.id !== id),
      },
      isDirty: true,
    })),

  updateObject: (id, updates) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        objects: ((state.project as any).objects || []).map((o: ObjectItem) =>
          o.id === id ? { ...o, ...updates } : o,
        ),
      },
      isDirty: true,
    })),

  updateLaneType: (roadId, sectionIndex, side, laneId, laneType) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          const sections = [...r.lane_sections];
          const section = sections[sectionIndex];
          if (!section) return r;
          const lanes = section[side].map((l: any) =>
            l.id === laneId ? { ...l, lane_type: laneType } : l,
          );
          sections[sectionIndex] = { ...section, [side]: lanes };
          return { ...r, lane_sections: sections };
        }),
      },
      isDirty: true,
    })),

  updateLaneWidth: (roadId, sectionIndex, side, laneId, width) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          const sections = [...r.lane_sections];
          const section = sections[sectionIndex];
          if (!section) return r;
          const lanes = section[side].map((l: any) =>
            l.id === laneId ? { ...l, width: [width] } : l,
          );
          sections[sectionIndex] = { ...section, [side]: lanes };
          return { ...r, lane_sections: sections };
        }),
      },
      isDirty: true,
    })),

  setCursorWorldPos: (pos) => set({ cursorWorldPos: pos }),
  setViewportInfo: ({ gridSpacing, mpp }) => set({ gridSpacing, viewportMpp: mpp }),

  markDirty: () => set({ isDirty: true }),
  markClean: () => set({ isDirty: false }),
  reset: () => set({ project: initialProject, isDirty: false, selectedRoadId: null, selectedJunctionId: null, selectedObjectType: null, selectedSceneNode: null, undoStack: [], redoStack: [], cursorWorldPos: { x: 0, y: 0 }, gridSpacing: 10.0, viewportMpp: 0.1 }),

  undo: () =>
    set((state) => {
      if (state.undoStack.length === 0) return state;
      const prev = state.undoStack[state.undoStack.length - 1];
      return {
        project: prev,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, state.project],
        isDirty: true,
      };
    }),

  redo: () =>
    set((state) => {
      if (state.redoStack.length === 0) return state;
      const next = state.redoStack[state.redoStack.length - 1];
      return {
        project: next,
        undoStack: [...state.undoStack, state.project],
        redoStack: state.redoStack.slice(0, -1),
        isDirty: true,
      };
    }),

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,
}));
