import type { StateCreator } from 'zustand';
import type { EditorViewState } from '../viewportStore';
import type { ViewDimension, ActiveMode, SelectionMode, ViewMode, EditableSpline } from './types';
import { savePrefs, loadPrefs } from './persistence';

export interface ModeViewSlice {
  dimension: ViewDimension;
  showGrid: boolean;
  showAxis: boolean;
  showHoverHighlight: boolean;
  showRoadLinks: boolean;
  editMode: ActiveMode;
  selectionMode: SelectionMode;
  viewMode: ViewMode;
  geometryEditRoadId: string | null;
  geometryEditSpline: EditableSpline | null;
  isFlyMode: boolean;
  softSelectionRadius: number;
  setDimension: (d: ViewDimension) => void;
  toggleGrid: () => void;
  toggleAxis: () => void;
  toggleHoverHighlight: () => void;
  toggleRoadLinks: () => void;
  setEditMode: (m: ActiveMode) => void;
  setSelectionMode: (mode: SelectionMode) => void;
  setViewMode: (m: ViewMode) => void;
  setFlyMode: (active: boolean) => void;
  setSoftSelectionRadius: (radius: number) => void;
  enterGeometryEdit: (roadId: string, spline: EditableSpline) => void;
  exitGeometryEdit: () => void;
  setGeometryEditSpline: (spline: EditableSpline) => void;
  resetDisplay: () => void;
}

export const createModeViewSlice: StateCreator<EditorViewState, [], [], ModeViewSlice> = (set) => {
  const prefs = loadPrefs();
  return {
    dimension: prefs.dimension ?? '2d',
    showGrid: prefs.showGrid ?? true,
    showAxis: prefs.showAxis ?? true,
    showHoverHighlight: false,
    showRoadLinks: false,
    editMode: 'default',
    selectionMode: prefs.selectionMode ?? 'road',
    viewMode: prefs.viewMode ?? 'solid',
    geometryEditRoadId: null,
    geometryEditSpline: null,
    isFlyMode: false,
    softSelectionRadius: 50.0,

    setDimension: (dimension) => { set({ dimension }); savePrefs({ dimension }); },
    toggleGrid: () => set((state) => { const showGrid = !state.showGrid; savePrefs({ showGrid }); return { showGrid }; }),
    toggleAxis: () => set((state) => { const showAxis = !state.showAxis; savePrefs({ showAxis }); return { showAxis }; }),
    toggleHoverHighlight: () => set((state) => ({ showHoverHighlight: !state.showHoverHighlight })),
    toggleRoadLinks: () => set((state) => ({ showRoadLinks: !state.showRoadLinks })),
    setEditMode: (editMode) => set({ editMode }),
    setSelectionMode: (selectionMode) => { set({ selectionMode }); savePrefs({ selectionMode }); },
    setViewMode: (viewMode) => { set({ viewMode }); savePrefs({ viewMode }); },
    setFlyMode: (isFlyMode) => set({ isFlyMode }),
    setSoftSelectionRadius: (softSelectionRadius) => set({ softSelectionRadius: Math.max(0.1, softSelectionRadius) }),

    enterGeometryEdit: (roadId, spline) => set({
      geometryEditRoadId: roadId,
      geometryEditSpline: spline,
      draggingKnot: null,
      editMode: 'default',
    }),
    exitGeometryEdit: () => set({
      geometryEditRoadId: null,
      geometryEditSpline: null,
      draggingKnot: null,
    }),
    setGeometryEditSpline: (spline) => set({ geometryEditSpline: spline }),

    resetDisplay: () => {
      set((state) => ({
        dimension: '2d',
        display: {
          ...state.display,
          hiddenRoadIds: [],
          hiddenJunctionIds: [],
          hiddenLaneSectionKeys: [],
          hiddenLaneKeys: [],
          hiddenSignalKeys: [],
          hiddenObjectKeys: [],
        },
      }));
      window.dispatchEvent(new CustomEvent('viewport:resetCamera'));
    },
  };
};
