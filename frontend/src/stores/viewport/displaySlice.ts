import type { StateCreator } from 'zustand';
import type { EditorViewState } from '../viewportStore';
import { makeLaneKey, makeSignalKey, makeObjectKey } from '../../utils/sceneGraph';
import type { LaneSide } from '../../utils/sceneGraph';
import type { DisplaySettings, DisplayBooleanKey, ColorMode } from './types';
import { loadDisplay, saveDisplay } from './persistence';

export interface DisplaySlice {
  display: DisplaySettings;
  toggleDisplaySetting: (key: DisplayBooleanKey) => void;
  setColorMode: (mode: ColorMode) => void;
  toggleRoadVisibility: (roadId: string) => void;
  toggleJunctionVisibility: (junctionId: string) => void;
  toggleLaneSectionVisibility: (sectionKey: string) => void;
  toggleLaneVisibility: (roadId: string, sectionIndex: number, side: LaneSide, laneId: number) => void;
  toggleSignalVisibility: (roadId: string, signalId: string) => void;
  toggleObjectVisibility: (roadId: string, objectId: string) => void;
}

export const createDisplaySlice: StateCreator<EditorViewState, [], [], DisplaySlice> = (set) => ({
  display: loadDisplay(),

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
});
