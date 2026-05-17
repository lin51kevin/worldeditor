import type { Project } from '../../services/platform';
import type { EditorState, SliceCreator } from './types';
import { MAX_UNDO, pushUndo } from './types';

export interface UndoRedoSlice {
  undoStack: Project[];
  redoStack: Project[];

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  executePluginCommand: (
    description: string,
    executeFn: (project: Project) => Project,
  ) => void;
}

export const createUndoRedoSlice: SliceCreator<UndoRedoSlice> = (set, get) => ({
  undoStack: [],
  redoStack: [],

  undo: () =>
    set((state) => {
      if (state.undoStack.length === 0) return state as Partial<EditorState>;
      const prev = state.undoStack[state.undoStack.length - 1];
      return {
        project: prev,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, state.project].slice(-MAX_UNDO),
        isDirty: true,
      };
    }),

  redo: () =>
    set((state) => {
      if (state.redoStack.length === 0) return state as Partial<EditorState>;
      const next = state.redoStack[state.redoStack.length - 1];
      return {
        project: next,
        undoStack: [...state.undoStack, state.project].slice(-MAX_UNDO),
        redoStack: state.redoStack.slice(0, -1),
        isDirty: true,
      };
    }),

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  executePluginCommand: (_description, executeFn) =>
    set((state) => {
      const newProject = executeFn(state.project);
      return {
        ...pushUndo(state),
        project: newProject,
        isDirty: true,
      };
    }),
});
