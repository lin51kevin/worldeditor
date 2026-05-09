import { create } from 'zustand';
import { makeLaneKey } from '../utils/sceneGraph';
import type { LaneSide } from '../utils/sceneGraph';

type ViewDimension = '3d' | '2d';

const STORAGE_KEY = 'we-editor-view';

interface PanelLayout {
  leftWidth: number;
  rightWidth: number;
  outputHeight: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  outputCollapsed: boolean;
}

const DEFAULT_LAYOUT: PanelLayout = {
  leftWidth: 260,
  rightWidth: 300,
  outputHeight: 150,
  leftCollapsed: false,
  rightCollapsed: false,
  outputCollapsed: true,
};

type ColorMode = 'single' | 'byRoad' | 'byLaneType';
type DisplayBooleanKey =
  | 'showRoadMesh'
  | 'showLaneLines'
  | 'showRoadMarks'
  | 'showReferenceLine'
  | 'showSignals'
  | 'showObjects';

interface DisplaySettings {
  showRoadMesh: boolean;
  showLaneLines: boolean;
  showRoadMarks: boolean;
  showReferenceLine: boolean;
  showSignals: boolean;
  showObjects: boolean;
  colorMode: ColorMode;
  hiddenRoadIds: string[];
  hiddenJunctionIds: string[];
  hiddenLaneSectionKeys: string[];
  hiddenLaneKeys: string[];
}

export const DEFAULT_DISPLAY: DisplaySettings = {
  showRoadMesh: true,
  showLaneLines: true,
  showRoadMarks: true,
  showReferenceLine: false,
  showSignals: true,
  showObjects: true,
  colorMode: 'byLaneType',
  hiddenRoadIds: [],
  hiddenJunctionIds: [],
  hiddenLaneSectionKeys: [],
  hiddenLaneKeys: [],
};

interface EditorViewState {
  // View dimension
  dimension: ViewDimension;

  // Visibility toggles
  showGrid: boolean;
  showAxis: boolean;

  // Edit mode
  editMode: 'select' | 'road' | 'lane' | 'junction';

  // View mode (sketch/wire/solid)
  viewMode: 'sketch' | 'wire' | 'solid';

  // Display settings (layer visibility + color mode)
  display: DisplaySettings;

  // Panel layout
  layout: PanelLayout;

  // Actions
  setDimension: (d: ViewDimension) => void;
  toggleGrid: () => void;
  toggleAxis: () => void;
  setEditMode: (m: 'select' | 'road' | 'lane' | 'junction') => void;
  setViewMode: (m: 'sketch' | 'wire' | 'solid') => void;

  // Display settings actions
  toggleDisplaySetting: (key: DisplayBooleanKey) => void;
  setColorMode: (mode: ColorMode) => void;
  toggleRoadVisibility: (roadId: string) => void;
  toggleJunctionVisibility: (junctionId: string) => void;
  toggleLaneSectionVisibility: (sectionKey: string) => void;
  toggleLaneVisibility: (roadId: string, sectionIndex: number, side: LaneSide, laneId: number) => void;

  // Panel layout actions
  setLeftWidth: (width: number) => void;
  setRightWidth: (width: number) => void;
  setOutputHeight: (height: number) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleOutputPanel: () => void;
  initLayout: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function saveLayout(layout: PanelLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Ignore storage errors
  }
}

function loadLayout(): PanelLayout {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<PanelLayout>;
      return { ...DEFAULT_LAYOUT, ...parsed };
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_LAYOUT;
}

const DISPLAY_STORAGE_KEY = 'we-display-settings';

function saveDisplay(display: DisplaySettings): void {
  try {
    localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(display));
  } catch {
    // Ignore storage errors
  }
}

function loadDisplay(): DisplaySettings {
  try {
    const saved = localStorage.getItem(DISPLAY_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<DisplaySettings>;
      return { ...DEFAULT_DISPLAY, ...parsed };
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_DISPLAY;
}

export const useEditorViewStore = create<EditorViewState>((set) => ({
  dimension: '3d',
  showGrid: true,
  showAxis: true,
  editMode: 'select',
  viewMode: 'solid',
  display: loadDisplay(),
  layout: DEFAULT_LAYOUT,

  setDimension: (dimension) => set({ dimension }),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  toggleAxis: () => set((state) => ({ showAxis: !state.showAxis })),
  setEditMode: (editMode) => set({ editMode }),
  setViewMode: (viewMode) => set({ viewMode }),

  toggleDisplaySetting: (key) =>
    set((state) => {
      const display = { ...state.display, [key]: !state.display[key] };
      saveDisplay(display);
      return { display };
    }),

  setColorMode: (mode) =>
    set((state) => {
      const display = { ...state.display, colorMode: mode };
      saveDisplay(display);
      return { display };
    }),

  toggleRoadVisibility: (roadId) =>
    set((state) => {
      const hiddenRoadIds = state.display.hiddenRoadIds.includes(roadId)
        ? state.display.hiddenRoadIds.filter((id) => id !== roadId)
        : [...state.display.hiddenRoadIds, roadId];
      const display = { ...state.display, hiddenRoadIds };
      saveDisplay(display);
      return { display };
    }),

  toggleJunctionVisibility: (junctionId) =>
    set((state) => {
      const hiddenJunctionIds = state.display.hiddenJunctionIds.includes(junctionId)
        ? state.display.hiddenJunctionIds.filter((id) => id !== junctionId)
        : [...state.display.hiddenJunctionIds, junctionId];
      const display = { ...state.display, hiddenJunctionIds };
      saveDisplay(display);
      return { display };
    }),

  toggleLaneSectionVisibility: (sectionKey) =>
    set((state) => {
      const hiddenLaneSectionKeys = state.display.hiddenLaneSectionKeys.includes(sectionKey)
        ? state.display.hiddenLaneSectionKeys.filter((key) => key !== sectionKey)
        : [...state.display.hiddenLaneSectionKeys, sectionKey];
      const display = { ...state.display, hiddenLaneSectionKeys };
      saveDisplay(display);
      return { display };
    }),

  toggleLaneVisibility: (roadId, sectionIndex, side, laneId) =>
    set((state) => {
      const laneKey = makeLaneKey(roadId, sectionIndex, side, laneId);
      const hiddenLaneKeys = state.display.hiddenLaneKeys.includes(laneKey)
        ? state.display.hiddenLaneKeys.filter((key) => key !== laneKey)
        : [...state.display.hiddenLaneKeys, laneKey];
      const display = { ...state.display, hiddenLaneKeys };
      saveDisplay(display);
      return { display };
    }),

  setLeftWidth: (width) =>
    set((state) => {
      const clamped = clamp(width, 180, 400);
      const layout = { ...state.layout, leftWidth: clamped };
      saveLayout(layout);
      return { layout };
    }),

  setRightWidth: (width) =>
    set((state) => {
      const clamped = clamp(width, 220, 450);
      const layout = { ...state.layout, rightWidth: clamped };
      saveLayout(layout);
      return { layout };
    }),

  setOutputHeight: (height) =>
    set((state) => {
      const clamped = clamp(height, 80, 300);
      const layout = { ...state.layout, outputHeight: clamped };
      saveLayout(layout);
      return { layout };
    }),

  toggleLeftPanel: () =>
    set((state) => {
      const layout = { ...state.layout, leftCollapsed: !state.layout.leftCollapsed };
      saveLayout(layout);
      return { layout };
    }),

  toggleRightPanel: () =>
    set((state) => {
      const layout = { ...state.layout, rightCollapsed: !state.layout.rightCollapsed };
      saveLayout(layout);
      return { layout };
    }),

  toggleOutputPanel: () =>
    set((state) => {
      const layout = { ...state.layout, outputCollapsed: !state.layout.outputCollapsed };
      saveLayout(layout);
      return { layout };
    }),

  initLayout: () => set({ layout: loadLayout() }),
}));
