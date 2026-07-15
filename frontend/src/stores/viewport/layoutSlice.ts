import type { StateCreator } from 'zustand';
import type { EditorViewState } from '../viewportStore';
import type { PanelLayout } from './types';
import { DEFAULT_LAYOUT } from './types';
import { clamp, saveLayout, loadLayout } from './persistence';

export interface LayoutSlice {
  layout: PanelLayout;
  setLeftWidth: (width: number) => void;
  setRightWidth: (width: number) => void;
  setOutputHeight: (height: number) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleOutputPanel: () => void;
  toggleTemplatePanel: () => void;
  toggleToolbar: () => void;
  initLayout: () => void;
}

export const createLayoutSlice: StateCreator<EditorViewState, [], [], LayoutSlice> = (set) => ({
  layout: DEFAULT_LAYOUT,

  setLeftWidth: (width) =>
    set((state) => {
      const layout = { ...state.layout, leftWidth: clamp(width, 180, 400) };
      saveLayout(layout);
      return { layout };
    }),

  setRightWidth: (width) =>
    set((state) => {
      const layout = { ...state.layout, rightWidth: clamp(width, 220, 450) };
      saveLayout(layout);
      return { layout };
    }),

  setOutputHeight: (height) =>
    set((state) => {
      const layout = { ...state.layout, outputHeight: clamp(height, 80, 300) };
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

  toggleToolbar: () =>
    set((state) => {
      const layout = { ...state.layout, toolbarCollapsed: !state.layout.toolbarCollapsed };
      saveLayout(layout);
      return { layout };
    }),

  initLayout: () => set({ layout: loadLayout() }),
});
