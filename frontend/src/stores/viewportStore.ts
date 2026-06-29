import { create } from 'zustand';
import { createLayoutSlice, type LayoutSlice } from './viewport/layoutSlice';
import { createDisplaySlice, type DisplaySlice } from './viewport/displaySlice';
import { createSnappingSlice, type SnappingSlice } from './viewport/snappingSlice';
import { createMeasurementSlice, type MeasurementSlice } from './viewport/measurementSlice';
import { createSplineDrawSlice, type SplineDrawSlice } from './viewport/splineDrawSlice';
import { createModeViewSlice, type ModeViewSlice } from './viewport/modeViewSlice';

// Re-export public types & constants so existing `viewportStore` imports keep working.
export { isDrawMode, DEFAULT_DISPLAY, DEFAULT_LAYOUT } from './viewport/types';
export type {
  MeasureMode,
  SelectionMode,
  SignalOrientation,
  SignalPlacementDraft,
  ObjectPlacementDraft,
  TangentCoupling,
  MeasurePoint,
  MeasurementResult,
  ViewDimension,
  ViewMode,
  SelectMode,
  EditMode,
  DrawMode,
  ActiveMode,
} from './viewport/types';

/** Combined viewport/editor view state composed from domain slices. */
export type EditorViewState =
  & ModeViewSlice
  & SplineDrawSlice
  & DisplaySlice
  & SnappingSlice
  & MeasurementSlice
  & LayoutSlice;

export const useViewportStore = create<EditorViewState>()((...a) => ({
  ...createModeViewSlice(...a),
  ...createSplineDrawSlice(...a),
  ...createDisplaySlice(...a),
  ...createSnappingSlice(...a),
  ...createMeasurementSlice(...a),
  ...createLayoutSlice(...a),
}));
