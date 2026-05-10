import { create } from 'zustand';
import type { Elevation, Geometry, Project, Road, RoadObject, Signal, Junction, LaneWidth } from '../services/platform';
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
  updateRoadGeometry: (id: string, planView: Geometry[], length: number) => void;
  updateJunction: (id: string, updates: Partial<Pick<Junction, 'name'>>) => void;
  addSignal: (signal: Signal) => void;
  removeSignal: (id: string) => void;
  updateSignal: (id: string, updates: Partial<Signal>) => void;
  addObject: (obj: RoadObject) => void;
  removeObject: (id: string) => void;
  updateObject: (id: string, updates: Partial<RoadObject>) => void;
  updateLaneType: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, laneType: string) => void;
  updateLaneWidth: (roadId: string, sectionIndex: number, side: 'left' | 'right', laneId: number, width: LaneWidth) => void;
  addElevationPoint: (roadId: string, s: number, height: number) => void;
  updateElevationPoint: (roadId: string, index: number, updates: Partial<Elevation>) => void;
  removeElevationPoint: (roadId: string, index: number) => void;
  smoothElevation: (roadId: string, iterations?: number) => void;
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
export type { Signal, RoadObject };

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

  updateRoadGeometry: (id, planView, length) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) =>
          r.id === id ? { ...r, plan_view: planView, length } : r,
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
        signals: [...(state.project.signals || []), signal],
      },
      isDirty: true,
    })),

  removeSignal: (id) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        signals: (state.project.signals || []).filter((s) => s.id !== id),
      },
      isDirty: true,
    })),

  updateSignal: (id, updates) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        signals: (state.project.signals || []).map((s) =>
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
        objects: [...(state.project.objects || []), obj],
      },
      isDirty: true,
    })),

  removeObject: (id) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        objects: (state.project.objects || []).filter((o) => o.id !== id),
      },
      isDirty: true,
    })),

  updateObject: (id, updates) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        objects: (state.project.objects || []).map((o) =>
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

  addElevationPoint: (roadId, s, height) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          const next = [
            ...r.elevation_profile,
            { s, a: height, b: 0, c: 0, d: 0 },
          ].sort((a, b) => a.s - b.s);
          return { ...r, elevation_profile: next };
        }),
      },
      isDirty: true,
    })),

  updateElevationPoint: (roadId, index, updates) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          if (index < 0 || index >= r.elevation_profile.length) return r;
          const elevation_profile = r.elevation_profile
            .map((p, i) => (i === index ? { ...p, ...updates } : p))
            .sort((a, b) => a.s - b.s);
          return { ...r, elevation_profile };
        }),
      },
      isDirty: true,
    })),

  removeElevationPoint: (roadId, index) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          if (index < 0 || index >= r.elevation_profile.length) return r;
          return {
            ...r,
            elevation_profile: r.elevation_profile.filter((_, i) => i !== index),
          };
        }),
      },
      isDirty: true,
    })),

  smoothElevation: (roadId, iterations = 1) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        roads: state.project.roads.map((r) => {
          if (r.id !== roadId) return r;
          if (r.elevation_profile.length < 3) return r;

          let next = [...r.elevation_profile];
          for (let iter = 0; iter < Math.max(1, iterations); iter += 1) {
            const prev = [...next];
            next = next.map((entry, i) => {
              if (i === 0 || i === prev.length - 1) {
                return entry;
              }
              const avgA = (prev[i - 1]!.a + prev[i]!.a + prev[i + 1]!.a) / 3;
              return { ...entry, a: avgA };
            });
          }

          return { ...r, elevation_profile: next };
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
