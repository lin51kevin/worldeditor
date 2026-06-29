import type { StateCreator } from 'zustand';
import type { EditorViewState } from '../viewportStore';
import type { SnapType, DrawSnapResult, SnappedEndpoint } from './types';
import { savePrefs, loadPrefs } from './persistence';

export interface SnappingSlice {
  snapEnabled: boolean;
  snapMode: SnapType;
  snapThreshold: number;
  gridSnapSize: number;
  snapToEndpoints: boolean;
  snapToMidpoints: boolean;
  snapToPerpendicular: boolean;
  snapToGrid: boolean;
  snapToLaneEndpoints: boolean;
  drawSnapResult: DrawSnapResult | null;
  snappedEndpoints: Array<SnappedEndpoint | null>;
  toggleSnap: () => void;
  setSnapMode: (mode: SnapType) => void;
  setSnapThreshold: (threshold: number) => void;
  setGridSnapSize: (size: number) => void;
  setSnapToEndpoints: (enabled: boolean) => void;
  setSnapToMidpoints: (enabled: boolean) => void;
  setSnapToPerpendicular: (enabled: boolean) => void;
  setSnapToGrid: (enabled: boolean) => void;
  setSnapToLaneEndpoints: (enabled: boolean) => void;
  setDrawSnapResult: (result: DrawSnapResult | null) => void;
  addSnappedEndpoint: (entry: SnappedEndpoint) => void;
  clearDrawSnap: () => void;
}

export const createSnappingSlice: StateCreator<EditorViewState, [], [], SnappingSlice> = (set) => {
  const prefs = loadPrefs();
  return {
    snapEnabled: prefs.snapEnabled ?? false,
    snapMode: prefs.snapMode ?? ('Grid' as SnapType),
    snapThreshold: prefs.snapThreshold ?? 15.0,
    gridSnapSize: prefs.gridSnapSize ?? 1.0,
    snapToEndpoints: prefs.snapToEndpoints ?? true,
    snapToMidpoints: prefs.snapToMidpoints ?? true,
    snapToPerpendicular: prefs.snapToPerpendicular ?? true,
    snapToGrid: prefs.snapToGrid ?? true,
    snapToLaneEndpoints: prefs.snapToLaneEndpoints ?? false,
    drawSnapResult: null,
    snappedEndpoints: [],

    toggleSnap: () => set((state) => { const snapEnabled = !state.snapEnabled; savePrefs({ snapEnabled }); return { snapEnabled }; }),
    setSnapMode: (snapMode) => { set({ snapMode }); savePrefs({ snapMode }); },
    setSnapThreshold: (snapThreshold) => {
      const next = Number.isFinite(snapThreshold) ? snapThreshold : 15;
      const val = Math.min(50, Math.max(1, next));
      set({ snapThreshold: val });
      savePrefs({ snapThreshold: val });
    },
    setGridSnapSize: (gridSnapSize) => {
      const next = Number.isFinite(gridSnapSize) ? gridSnapSize : 1;
      const val = Math.min(100, Math.max(0.5, next));
      set({ gridSnapSize: val });
      savePrefs({ gridSnapSize: val });
    },
    setSnapToEndpoints: (snapToEndpoints) => { set({ snapToEndpoints }); savePrefs({ snapToEndpoints }); },
    setSnapToMidpoints: (snapToMidpoints) => { set({ snapToMidpoints }); savePrefs({ snapToMidpoints }); },
    setSnapToPerpendicular: (snapToPerpendicular) => { set({ snapToPerpendicular }); savePrefs({ snapToPerpendicular }); },
    setSnapToGrid: (snapToGrid) => { set({ snapToGrid }); savePrefs({ snapToGrid }); },
    setSnapToLaneEndpoints: (snapToLaneEndpoints) => { set({ snapToLaneEndpoints }); savePrefs({ snapToLaneEndpoints }); },

    setDrawSnapResult: (drawSnapResult) => set({ drawSnapResult }),
    addSnappedEndpoint: (entry) => set((state) => ({ snappedEndpoints: [...state.snappedEndpoints, entry] })),
    clearDrawSnap: () => set({ drawSnapResult: null, snappedEndpoints: [] }),
  };
};
