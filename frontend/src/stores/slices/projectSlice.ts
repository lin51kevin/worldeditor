import type { Project } from '../../services/platform';
import type { EditorState, SliceCreator } from './types';
import { initialProject } from './types';

export interface ProjectSlice {
  project: Project;
  savedProject: Project | null;
  isDirty: boolean;
  projectLoadVersion: number;
  cursorWorldPos: { x: number; y: number };
  gridSpacing: number;
  viewportMpp: number;

  setProject: (project: Project) => void;
  markDirty: () => void;
  markClean: () => void;
  reset: () => void;
  resetToSaved: () => void;
  setCursorWorldPos: (pos: { x: number; y: number }) => void;
  setViewportInfo: (info: { gridSpacing: number; mpp: number }) => void;
}

export const createProjectSlice: SliceCreator<ProjectSlice> = (set) => ({
  project: initialProject,
  savedProject: null,
  isDirty: false,
  projectLoadVersion: 0,
  cursorWorldPos: { x: 0, y: 0 },
  gridSpacing: 10.0,
  viewportMpp: 0.1,

  setProject: (project) => set((s) => ({
    project,
    savedProject: project,
    isDirty: false,
    undoStack: [],
    redoStack: [],
    projectLoadVersion: s.projectLoadVersion + 1,
  })),

  setCursorWorldPos: (pos) => set((s) => {
    if (s.cursorWorldPos.x === pos.x && s.cursorWorldPos.y === pos.y) return s as Partial<EditorState>;
    return { cursorWorldPos: pos };
  }),

  setViewportInfo: ({ gridSpacing, mpp }) => set((s) => {
    if (s.gridSpacing === gridSpacing && s.viewportMpp === mpp) return s as Partial<EditorState>;
    return { gridSpacing, viewportMpp: mpp };
  }),

  markDirty: () => set({ isDirty: true }),
  markClean: () => set((s) => ({ isDirty: false, savedProject: s.project })),

  resetToSaved: () => set((s) => s.savedProject
    ? {
        project: s.savedProject,
        isDirty: false,
        undoStack: [],
        redoStack: [],
        selectedRoadId: null,
        selectedJunctionId: null,
        selectedObjectType: null,
        selectedSceneNode: null,
        selectedRoadIds: [],
        selectedJunctionIds: [],
      }
    : s as Partial<EditorState>),

  reset: () => set((s) => ({
    project: initialProject,
    isDirty: false,
    selectedRoadId: null,
    selectedJunctionId: null,
    selectedObjectType: null,
    selectedSceneNode: null,
    selectedRoadIds: [],
    selectedJunctionIds: [],
    clipboardRoadId: null,
    undoStack: [],
    redoStack: [],
    cursorWorldPos: { x: 0, y: 0 },
    gridSpacing: 10.0,
    viewportMpp: 0.1,
    projectLoadVersion: s.projectLoadVersion + 1,
  })),
});
