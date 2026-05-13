import { create } from 'zustand';
import type { RoadSignal, RoadObject } from '../services/platform';
import type { EditorState } from './slices/types';
import { createProjectSlice } from './slices/projectSlice';
import { createSelectionSlice } from './slices/selectionSlice';
import { createUndoRedoSlice } from './slices/undoRedoSlice';
import { createRoadSlice } from './slices/roadSlice';
import { createLaneSlice } from './slices/laneSlice';

// Re-export types for consumers
export type { RoadSignal, RoadObject };

export const useEditorStore = create<EditorState>((set, get) => ({
  ...createProjectSlice(set, get),
  ...createSelectionSlice(set, get),
  ...createUndoRedoSlice(set, get),
  ...createRoadSlice(set, get),
  ...createLaneSlice(set, get),
}));

