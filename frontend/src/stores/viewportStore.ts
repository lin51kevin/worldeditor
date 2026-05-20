import { create } from 'zustand';
import { makeLaneKey, makeSignalKey, makeObjectKey } from '../utils/sceneGraph';
import type { LaneSide } from '../utils/sceneGraph';
import type { SnapType, DistanceMeasurement, AngleMeasurement, AreaMeasurement, EditableSpline } from '../services/platform';
import { STORAGE_KEYS } from '../constants/storage';

export type MeasureMode = 'none' | 'distance' | 'angle' | 'area';

/** Controls whether in/out tangent handles are mirrored or independent. */
export type TangentCoupling = 'mirror' | 'broken';

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

/** Selection-based interaction modes. */
export type SelectMode = 'default' | 'road' | 'lane' | 'lanesection';
/** Geometry manipulation modes (transform existing roads). */
export type EditMode = 'move-road' | 'rotate-road' | 'adjust-edge' | 'road-markings';
/** Road drawing / creation modes. */
export type DrawMode = 'spline';
/** Union of all active-mode categories. */
export type ActiveMode = SelectMode | EditMode | DrawMode;

const STORAGE_KEY = STORAGE_KEYS.EDITOR_VIEW;

interface PanelLayout {
  leftWidth: number;
  rightWidth: number;
  outputHeight: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  outputCollapsed: boolean;
  templatePanelCollapsed: boolean;
}

const DEFAULT_LAYOUT: PanelLayout = {
  leftWidth: 260,
  rightWidth: 300,
  outputHeight: 150,
  leftCollapsed: false,
  rightCollapsed: false,
  outputCollapsed: true,
  templatePanelCollapsed: false,
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
  hiddenSignalKeys: string[];
  hiddenObjectKeys: string[];
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
  hiddenSignalKeys: [],
  hiddenObjectKeys: [],
};

interface EditorViewState {
  // View dimension
  dimension: ViewDimension;

  // Visibility toggles
  showGrid: boolean;
  showAxis: boolean;
  showHoverHighlight: boolean;

  // Edit mode
  editMode: ActiveMode;

  // Spline drawing
  splineTemplateId: string;
  /**
   * When non-null, the viewport is in "click-to-place" mode for this template.
   * A single left-click in the viewport will instantiate the template at that
   * world position and then clear this field.
   */
  pendingTemplateId: string | null;
  /**
   * When non-null, the viewport is in "click-to-place" mode for a road object
   * or sign template. A click picks the nearest road and places the object
   * at the corresponding s/t coordinates on that road.
   */
  pendingObjectTemplateId: string | null;
  splineKnots: Array<[number, number, number]>;
  splineTangentOverrides: Record<number, [number, number, number]>;
  /** Independent in-tangent overrides (broken tangent mode only). */
  splineTangentInOverrides: Record<number, [number, number, number]>;
  /** Whether in/out tangent handles are mirrored or independent. */
  tangentCoupling: TangentCoupling;

  // Spline knot dragging
  draggingKnot: { index: number; type: 'knot' | 'in' | 'out' } | null;

  // Cursor preview position while drawing (mouse pos as a temporary last knot)
  cursorPreviewPos: [number, number, number] | null;

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

  // Draw-mode endpoint snap (real-time snap feedback while drawing)
  drawSnapResult: { x: number; y: number; snapped: boolean; snapType: SnapType; targetId: string | null; contactPoint: string | null } | null;
  /** Snapped endpoints for each knot index (null entries = no snap at that knot). */
  snappedEndpoints: Array<{ knotIndex: number; roadId: string; contactPoint: string } | null>;

  // Measurement
  measureMode: MeasureMode;
  measurePoints: MeasurePoint[];
  lastMeasurement: MeasurementResult | null;

  // Geometry editing (editing existing road's plan_view via spline)
  geometryEditRoadId: string | null;
  geometryEditSpline: EditableSpline | null;

  // Geometry drawing (draw-line / draw-arc / draw-spiral)
  // NOTE: line/arc/spiral modes now reuse splineKnots for control points.

  // Soft selection radius for knot editing
  softSelectionRadius: number;

  // Actions
  setDimension: (d: ViewDimension) => void;
  toggleGrid: () => void;
  toggleAxis: () => void;
  toggleHoverHighlight: () => void;
  setEditMode: (m: ActiveMode) => void;
  setSplineTemplateId: (templateId: string) => void;
  setPendingTemplate: (id: string | null) => void;
  clearPendingTemplate: () => void;
  setPendingObjectTemplate: (id: string | null) => void;
  clearPendingObjectTemplate: () => void;
  setSplineKnots: (knots: Array<[number, number, number]>) => void;
  appendSplineKnot: (knot: [number, number, number]) => void;
  popSplineKnot: () => void;
  clearSplineKnots: () => void;
  setDraggingKnot: (info: { index: number; type: 'knot' | 'in' | 'out' } | null) => void;
  setCursorPreviewPos: (pos: [number, number, number] | null) => void;
  setSplineTangentOverride: (index: number, tangent: [number, number, number]) => void;
  setSplineTangentInOverride: (index: number, tangent: [number, number, number]) => void;
  setSplineTangentOverrides: (overrides: Record<number, [number, number, number]>) => void;
  setSplineTangentInOverrides: (overrides: Record<number, [number, number, number]>) => void;
  clearSplineTangentOverrides: () => void;
  setTangentCoupling: (coupling: TangentCoupling) => void;
  setViewMode: (m: 'sketch' | 'wire' | 'solid') => void;

  // Snapping actions
  toggleSnap: () => void;
  setSnapMode: (mode: SnapType) => void;
  setSnapThreshold: (threshold: number) => void;
  setGridSnapSize: (size: number) => void;

  // Draw-mode endpoint snap actions
  setDrawSnapResult: (result: { x: number; y: number; snapped: boolean; snapType: SnapType; targetId: string | null; contactPoint: string | null } | null) => void;
  addSnappedEndpoint: (entry: { knotIndex: number; roadId: string; contactPoint: string }) => void;
  clearDrawSnap: () => void;

  // Measurement actions
  setMeasureMode: (mode: MeasureMode) => void;
  addMeasurePoint: (point: MeasurePoint) => void;
  clearMeasurePoints: () => void;
  setMeasurementResult: (result: MeasurementResult | null) => void;
  resetDisplay: () => void;

  // Geometry editing actions
  enterGeometryEdit: (roadId: string, spline: EditableSpline) => void;
  exitGeometryEdit: () => void;
  setGeometryEditSpline: (spline: EditableSpline) => void;
  setSoftSelectionRadius: (radius: number) => void;

  // Geometry drawing actions (deprecated — line/arc/spiral now use splineKnots/appendSplineKnot/clearSplineKnots)
  /** @deprecated Use appendSplineKnot instead */
  appendDrawPoint: (point: [number, number, number]) => void;
  /** @deprecated Use clearSplineKnots instead */
  clearDrawPoints: () => void;

  // Display settings actions
  toggleDisplaySetting: (key: DisplayBooleanKey) => void;
  setColorMode: (mode: ColorMode) => void;
  toggleRoadVisibility: (roadId: string) => void;
  toggleJunctionVisibility: (junctionId: string) => void;
  toggleLaneSectionVisibility: (sectionKey: string) => void;
  toggleLaneVisibility: (roadId: string, sectionIndex: number, side: LaneSide, laneId: number) => void;
  toggleSignalVisibility: (roadId: string, signalId: string) => void;
  toggleObjectVisibility: (roadId: string, objectId: string) => void;

  // Panel layout actions
  setLeftWidth: (width: number) => void;
  setRightWidth: (width: number) => void;
  setOutputHeight: (height: number) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleOutputPanel: () => void;
  toggleTemplatePanel: () => void;
  initLayout: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function saveLayout(layout: PanelLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch (e) {
    console.warn('[ViewportStore] Failed to save layout:', e);
  }
}

function loadLayout(): PanelLayout {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<PanelLayout>;
      return { ...DEFAULT_LAYOUT, ...parsed };
    }
  } catch (e) {
    console.warn('[ViewportStore] Failed to load layout, using defaults:', e);
  }
  return DEFAULT_LAYOUT;
}

const DISPLAY_STORAGE_KEY = STORAGE_KEYS.DISPLAY_SETTINGS;

let displayPersistTimer: ReturnType<typeof setTimeout> | null = null;

function saveDisplay(display: DisplaySettings): void {
  if (displayPersistTimer) clearTimeout(displayPersistTimer);
  displayPersistTimer = setTimeout(() => {
    try {
      localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(display));
    } catch (e) {
      console.warn('[ViewportStore] Failed to save display settings:', e);
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
  } catch (e) {
    console.warn('[ViewportStore] Failed to load display settings, using defaults:', e);
  }
  return DEFAULT_DISPLAY;
}

// User preferences persistence (editMode, snap settings, grid/axis visibility)
interface UserPreferences {
  showGrid?: boolean;
  showAxis?: boolean;
  snapEnabled?: boolean;
  snapMode?: SnapType;
  snapThreshold?: number;
  gridSnapSize?: number;
  dimension?: ViewDimension;
  viewMode?: 'sketch' | 'wire' | 'solid';
}

const PREFS_STORAGE_KEY = STORAGE_KEYS.USER_PREFERENCES;

let prefsPersistTimer: ReturnType<typeof setTimeout> | null = null;

function savePrefs(prefs: UserPreferences): void {
  if (prefsPersistTimer) clearTimeout(prefsPersistTimer);
  prefsPersistTimer = setTimeout(() => {
    try {
      const existing = loadPrefs();
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ ...existing, ...prefs }));
    } catch (e) {
      console.warn('[ViewportStore] Failed to save user preferences:', e);
    }
  }, 100);
}

function loadPrefs(): UserPreferences {
  try {
    const saved = localStorage.getItem(PREFS_STORAGE_KEY);
    if (saved) return JSON.parse(saved) as UserPreferences;
  } catch (e) {
    console.warn('[ViewportStore] Failed to load user preferences:', e);
  }
  return {};
}

const storedPrefs = loadPrefs();

export const useViewportStore = create<EditorViewState>((set) => ({
  dimension: storedPrefs.dimension ?? '2d',
  showGrid: storedPrefs.showGrid ?? true,
  showAxis: storedPrefs.showAxis ?? true,
  showHoverHighlight: false,
  editMode: 'default',
  splineTemplateId: 'tpl:road:single',
  pendingTemplateId: null,
  pendingObjectTemplateId: null,
  splineKnots: [],
  splineTangentOverrides: {},
  splineTangentInOverrides: {},
  tangentCoupling: 'mirror' as TangentCoupling,
  draggingKnot: null,
  cursorPreviewPos: null,
  viewMode: storedPrefs.viewMode ?? 'solid',
  display: loadDisplay(),
  layout: DEFAULT_LAYOUT,
  snapEnabled: storedPrefs.snapEnabled ?? false,
  snapMode: storedPrefs.snapMode ?? 'Grid' as SnapType,
  snapThreshold: storedPrefs.snapThreshold ?? 5.0,
  gridSnapSize: storedPrefs.gridSnapSize ?? 1.0,
  drawSnapResult: null,
  snappedEndpoints: [],
  measureMode: 'none' as MeasureMode,
  measurePoints: [],
  lastMeasurement: null,
  geometryEditRoadId: null,
  geometryEditSpline: null,
  softSelectionRadius: 50.0,

  setDimension: (dimension) => { set({ dimension }); savePrefs({ dimension }); },
  toggleGrid: () => set((state) => { const showGrid = !state.showGrid; savePrefs({ showGrid }); return { showGrid }; }),
  toggleAxis: () => set((state) => { const showAxis = !state.showAxis; savePrefs({ showAxis }); return { showAxis }; }),
  toggleHoverHighlight: () => set((state) => ({ showHoverHighlight: !state.showHoverHighlight })),
  setEditMode: (editMode) => set({ editMode }),
  setSplineTemplateId: (splineTemplateId) => set({ splineTemplateId }),
  setPendingTemplate: (pendingTemplateId) => set({ pendingTemplateId }),
  clearPendingTemplate: () => set({ pendingTemplateId: null }),
  setPendingObjectTemplate: (pendingObjectTemplateId) => set({ pendingObjectTemplateId }),
  clearPendingObjectTemplate: () => set({ pendingObjectTemplateId: null }),
  setSplineKnots: (splineKnots) => set({ splineKnots }),
  appendSplineKnot: (knot) =>
    set((state) => ({ splineKnots: [...state.splineKnots, knot] })),
  popSplineKnot: () =>
    set((state) => ({ splineKnots: state.splineKnots.slice(0, -1) })),
  clearSplineKnots: () => set({ splineKnots: [], splineTangentOverrides: {}, splineTangentInOverrides: {}, tangentCoupling: 'mirror' as TangentCoupling, draggingKnot: null, cursorPreviewPos: null, drawSnapResult: null, snappedEndpoints: [] }),
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
  setViewMode: (viewMode) => { set({ viewMode }); savePrefs({ viewMode }); },

  // Snapping actions
  toggleSnap: () => set((state) => { const snapEnabled = !state.snapEnabled; savePrefs({ snapEnabled }); return { snapEnabled }; }),
  setSnapMode: (snapMode) => { set({ snapMode }); savePrefs({ snapMode }); },
  setSnapThreshold: (snapThreshold) => { const val = Math.max(0.1, snapThreshold); set({ snapThreshold: val }); savePrefs({ snapThreshold: val }); },
  setGridSnapSize: (gridSnapSize) => { const val = Math.max(0.01, gridSnapSize); set({ gridSnapSize: val }); savePrefs({ gridSnapSize: val }); },

  // Draw-mode endpoint snap actions
  setDrawSnapResult: (drawSnapResult) => set({ drawSnapResult }),
  addSnappedEndpoint: (entry) => set((state) => ({
    snappedEndpoints: [...state.snappedEndpoints, entry],
  })),
  clearDrawSnap: () => set({ drawSnapResult: null, snappedEndpoints: [] }),

  // Measurement actions
  setMeasureMode: (measureMode) => set({ measureMode, measurePoints: [], lastMeasurement: null }),
  addMeasurePoint: (point) =>
    set((state) => ({ measurePoints: [...state.measurePoints, point] })),
  clearMeasurePoints: () => set({ measurePoints: [], lastMeasurement: null }),
  resetDisplay: () => set((state) => ({
    display: {
      ...state.display,
      hiddenRoadIds: [],
      hiddenJunctionIds: [],
      hiddenLaneSectionKeys: [],
      hiddenLaneKeys: [],
      hiddenSignalKeys: [],
      hiddenObjectKeys: [],
    }
  })),
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

  // Geometry drawing actions (deprecated — now delegates to splineKnots)
  appendDrawPoint: (point) =>
    set((state) => ({ splineKnots: [...state.splineKnots, point] })),
  clearDrawPoints: () => set({ splineKnots: [], splineTangentOverrides: {}, splineTangentInOverrides: {}, draggingKnot: null }),

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

  toggleSignalVisibility: (roadId, signalId) =>
    set((state) => {
      const key = makeSignalKey(roadId, signalId);
      const hiddenSignalKeys = (state.display.hiddenSignalKeys ?? []).includes(key)
        ? (state.display.hiddenSignalKeys ?? []).filter((k) => k !== key)
        : [...(state.display.hiddenSignalKeys ?? []), key];
      const display = { ...state.display, hiddenSignalKeys };
      saveDisplay(display);
      return { display };
    }),

  toggleObjectVisibility: (roadId, objectId) =>
    set((state) => {
      const key = makeObjectKey(roadId, objectId);
      const hiddenObjectKeys = (state.display.hiddenObjectKeys ?? []).includes(key)
        ? (state.display.hiddenObjectKeys ?? []).filter((k) => k !== key)
        : [...(state.display.hiddenObjectKeys ?? []), key];
      const display = { ...state.display, hiddenObjectKeys };
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

  toggleTemplatePanel: () =>
    set((state) => {
      const layout = { ...state.layout, templatePanelCollapsed: !state.layout.templatePanelCollapsed };
      saveLayout(layout);
      return { layout };
    }),

  initLayout: () => set({ layout: loadLayout() }),
}));
