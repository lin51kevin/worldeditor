import { create } from 'zustand';

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

  // Panel layout
  layout: PanelLayout;

  // Actions
  setDimension: (d: ViewDimension) => void;
  toggleGrid: () => void;
  toggleAxis: () => void;
  setEditMode: (m: 'select' | 'road' | 'lane' | 'junction') => void;
  setViewMode: (m: 'sketch' | 'wire' | 'solid') => void;

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

export const useEditorViewStore = create<EditorViewState>((set) => ({
  dimension: '3d',
  showGrid: true,
  showAxis: true,
  editMode: 'select',
  viewMode: 'solid',
  layout: DEFAULT_LAYOUT,

  setDimension: (dimension) => set({ dimension }),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  toggleAxis: () => set((state) => ({ showAxis: !state.showAxis })),
  setEditMode: (editMode) => set({ editMode }),
  setViewMode: (viewMode) => set({ viewMode }),

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
