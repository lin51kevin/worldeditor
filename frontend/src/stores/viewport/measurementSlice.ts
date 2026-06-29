import type { StateCreator } from 'zustand';
import type { EditorViewState } from '../viewportStore';
import type { MeasureMode, MeasurePoint, MeasurementResult } from './types';

export interface MeasurementSlice {
  measureMode: MeasureMode;
  measurePoints: MeasurePoint[];
  lastMeasurement: MeasurementResult | null;
  setMeasureMode: (mode: MeasureMode) => void;
  addMeasurePoint: (point: MeasurePoint) => void;
  clearMeasurePoints: () => void;
  setMeasurementResult: (result: MeasurementResult | null) => void;
}

export const createMeasurementSlice: StateCreator<EditorViewState, [], [], MeasurementSlice> = (set) => ({
  measureMode: 'none',
  measurePoints: [],
  lastMeasurement: null,

  setMeasureMode: (measureMode) => set({ measureMode, measurePoints: [], lastMeasurement: null }),
  addMeasurePoint: (point) => set((state) => ({ measurePoints: [...state.measurePoints, point] })),
  clearMeasurePoints: () => set({ measurePoints: [], lastMeasurement: null }),
  setMeasurementResult: (lastMeasurement) => set({ lastMeasurement }),
});
