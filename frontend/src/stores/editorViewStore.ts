import { create } from 'zustand';
import { makeLaneKey } from '../utils/sceneGraph';
import type { LaneSide } from '../utils/sceneGraph';
import type { SnapType, DistanceMeasurement, AngleMeasurement, AreaMeasurement, EditableSpline } from '../services/platform';

export type MeasureMode = 'none' | 'distance' | 'angle' | 'area';

export interface MeasurePoint {
  x: number;
  y: number;
  z: number;
}

export type MeasurementResult =
  | { type: 'distance'; value: DistanceMeasurement }
  | { type: 'angle'; value: AngleMeasurement }
  | { type: 'area'; value: AreaMeasurement };

type ViewDimension = '3d' | '2d';
type EditMode = 'select' | 'road' | 'lane' | 'junction' | 'spline' | 'move-road' | 'rotate-road' | 'adjust-edge' | 'road-markings';

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
  editMode: EditMode;

  // Spline drawing
  splineTemplateId: string;
  splineKnots: Array<[number, number, number]>;
  splineTangentOverrides: Record<number, [number, number, number]>;

  // Spline knot dragging
  draggingKnot: { index: number; type: 'knot' | 'in' | 'out' } | null;

  // View mode (sketch/wire/solid)
  viewMode: 'sketch' | 'wire' | 'solid';

  // Display settings (layer visibility + color mode)
  display: DisplaySettings;

  // Panel layout
  layout: PanelLayout;

  // Snapping
  snapEnabled: boolean;
  snapMode: SnapType;
  snapThreshold: number;
  gridSnapSize: number;

  // Measurement
  measureMode: MeasureMode;
  measurePoints: MeasurePoint[];
  lastMeasurement: MeasurementResult | null;

  // Geometry editing (editing existing road's plan_view via spline)
  geometryEditRoadId: string | null;
  geometryEditSpline: EditableSpline | null;

  // Soft selection radius for knot editing
  softSelectionRadius: number;

  // Actions
  setDimension: (d: ViewDimension) => void;
  toggleGrid: () => void;
  toggleAxis: () => void;
  setEditMode: (m: EditMode) => void;
  setSplineTemplateId: (templateId: string) => void;
  setSplineKnots: (knots: Array<[number, number, number]>) => void;
  appendSplineKnot: (knot: [number, number, number]) => void;
  popSplineKnot: () => void;
  clearSplineKnots: () => void;
  setDraggingKnot: (info: { index: number; type: 'knot' | 'in' | 'out' } | null) => void;
  setSplineTangentOverride: (index: number, tangent: [number, number, number]) => void;
  clearSplineTangentOverrides: () => void;
  setViewMode: (m: 'sketch' | 'wire' | 'solid') => void;

  // Snapping actions
  toggleSnap: () => void;
  setSnapMode: (mode: SnapType) => void;
  setSnapThreshold: (threshold: number) => void;
  setGridSnapSize: (size: number) => void;

  // Measurement actions
  setMeasureMode: (mode: MeasureMode) => void;
  addMeasurePoint: (point: MeasurePoint) => void;
  clearMeasurePoints: () => void;
  setMeasurementResult: (result: MeasurementResult | null) => void;

  // Geometry editing actions
  enterGeometryEdit: (roadId: string, spline: EditableSpline) => void;
  exitGeometryEdit: () => void;
  setGeometryEditSpline: (spline: EditableSpline) => void;
  setSoftSelectionRadius: (radius: number) => void;

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

let displayPersistTimer: ReturnType<typeof setTimeout> | null = null;

function saveDisplay(display: DisplaySettings): void {
  if (displayPersistTimer) clearTimeout(displayPersistTimer);
  displayPersistTimer = setTimeout(() => {
    try {
      localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(display));
    } catch {
      // Ignore storage errors
    }
  }, 100);
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
  dimension: '2d',
  showGrid: true,
  showAxis: true,
  editMode: 'select',
  splineTemplateId: 'single',
  splineKnots: [],
  splineTangentOverrides: {},
  draggingKnot: null,
  viewMode: 'solid',
  display: loadDisplay(),
  layout: DEFAULT_LAYOUT,
  snapEnabled: false,
  snapMode: 'Grid' as SnapType,
  snapThreshold: 5.0,
  gridSnapSize: 1.0,
  measureMode: 'none' as MeasureMode,
  measurePoints: [],
  lastMeasurement: null,
  geometryEditRoadId: null,
  geometryEditSpline: null,
  softSelectionRadius: 50.0,

  setDimension: (dimension) => set({ dimension }),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  toggleAxis: () => set((state) => ({ showAxis: !state.showAxis })),
  setEditMode: (editMode) => set({ editMode }),
  setSplineTemplateId: (splineTemplateId) => set({ splineTemplateId }),
  setSplineKnots: (splineKnots) => set({ splineKnots }),
  appendSplineKnot: (knot) =>
    set((state) => ({ splineKnots: [...state.splineKnots, knot] })),
  popSplineKnot: () =>
    set((state) => ({ splineKnots: state.splineKnots.slice(0, -1) })),
  clearSplineKnots: () => set({ splineKnots: [], splineTangentOverrides: {}, draggingKnot: null }),
  setDraggingKnot: (draggingKnot) => set({ draggingKnot }),
  setSplineTangentOverride: (index, tangent) =>
    set((state) => ({ splineTangentOverrides: { ...state.splineTangentOverrides, [index]: tangent } })),
  clearSplineTangentOverrides: () => set({ splineTangentOverrides: {} }),
  setViewMode: (viewMode) => set({ viewMode }),

  // Snapping actions
  toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
  setSnapMode: (snapMode) => set({ snapMode }),
  setSnapThreshold: (snapThreshold) => set({ snapThreshold: Math.max(0.1, snapThreshold) }),
  setGridSnapSize: (gridSnapSize) => set({ gridSnapSize: Math.max(0.01, gridSnapSize) }),

  // Measurement actions
  setMeasureMode: (measureMode) => set({ measureMode, measurePoints: [], lastMeasurement: null }),
  addMeasurePoint: (point) =>
    set((state) => ({ measurePoints: [...state.measurePoints, point] })),
  clearMeasurePoints: () => set({ measurePoints: [], lastMeasurement: null }),
  setMeasurementResult: (lastMeasurement) => set({ lastMeasurement }),

  // Geometry editing actions
  enterGeometryEdit: (roadId, spline) => set({
    geometryEditRoadId: roadId,
    geometryEditSpline: spline,
    draggingKnot: null,
  }),
  exitGeometryEdit: () => set({
    geometryEditRoadId: null,
    geometryEditSpline: null,
    draggingKnot: null,
  }),
  setGeometryEditSpline: (spline) => set({ geometryEditSpline: spline }),
  setSoftSelectionRadius: (softSelectionRadius) =>
    set({ softSelectionRadius: Math.max(0.1, softSelectionRadius) }),

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
