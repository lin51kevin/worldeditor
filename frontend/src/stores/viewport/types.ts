import type { LaneSide } from '../../utils/sceneGraph';
import type {
  SnapType,
  DistanceMeasurement,
  AngleMeasurement,
  AreaMeasurement,
  EditableSpline,
} from '../../services/platform';

export type MeasureMode = 'none' | 'distance' | 'angle' | 'area';
export type SelectionMode = 'road' | 'laneSection' | 'lane';
export type SignalOrientation = '+' | '-' | 'none';

export interface SignalPlacementDraft {
  type: string;
  value: string;
  orientation: SignalOrientation;
}

export interface ObjectPlacementDraft {
  objectType: string;
}

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

export type ViewDimension = '3d' | '2d';
export type ViewMode = 'sketch' | 'wire' | 'solid';

/** Selection-based interaction modes. */
export type SelectMode = 'default' | 'road' | 'lane' | 'lanesection';
/** Geometry manipulation modes (transform existing roads). */
export type EditMode = 'move-road' | 'rotate-road' | 'split' | 'adjust-edge' | 'road-markings' | 'editLaneLine' | 'placeSignal' | 'placeObject' | 'editJunction';
/** Road drawing / creation modes. */
export type DrawMode = 'spline' | 'drawArc' | 'drawSpiral';
/** Union of all active-mode categories. */
export type ActiveMode = SelectMode | EditMode | DrawMode;

export function isDrawMode(mode: string | null): mode is DrawMode {
  return mode === 'spline' || mode === 'drawArc' || mode === 'drawSpiral';
}

export interface PanelLayout {
  leftWidth: number;
  rightWidth: number;
  outputHeight: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  outputCollapsed: boolean;
  templatePanelCollapsed: boolean;
  /** Whether the floating road-drawing edit toolbar is hidden. */
  toolbarCollapsed: boolean;
}

export const DEFAULT_LAYOUT: PanelLayout = {
  leftWidth: 300,
  rightWidth: 300,
  outputHeight: 150,
  leftCollapsed: false,
  rightCollapsed: false,
  outputCollapsed: true,
  templatePanelCollapsed: false,
  toolbarCollapsed: false,
};

export type ColorMode = 'single' | 'byRoad' | 'byLaneType';
export type DisplayBooleanKey =
  | 'showRoadMesh'
  | 'showLaneLines'
  | 'showRoadMarks'
  | 'showReferenceLine'
  | 'showSignals'
  | 'showObjects';

export interface DisplaySettings {
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

export interface DrawSnapResult {
  x: number;
  y: number;
  snapped: boolean;
  snapType: SnapType;
  targetId: string | null;
  contactPoint: string | null;
}

export interface SnappedEndpoint {
  knotIndex: number;
  roadId: string;
  contactPoint: string;
}

export interface DraggingKnot {
  index: number;
  type: 'knot' | 'in' | 'out';
}

/** Re-export domain types used by the combined viewport state. */
export type { LaneSide, SnapType, EditableSpline };
