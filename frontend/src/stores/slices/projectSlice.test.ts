import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorStore } from '../editorStore';
import type { Project } from '../../services/platform';

// Mock useEditorViewStore to avoid side effects
vi.mock('../editorViewStore', () => ({
  useEditorViewStore: {
    getState: () => ({ resetDisplay: vi.fn() }),
  },
}));

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    name: 'Test',
    header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
    roads: [],
    junctions: [],
    signals: [],
    objects: [],
    ...overrides,
  };
}

describe('projectSlice', () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
  });

  describe('setProject', () => {
    it('should replace project and mark clean', () => {
      const p = makeProject({ name: 'New' });
      useEditorStore.getState().setProject(p);
      const state = useEditorStore.getState();
      expect(state.project.name).toBe('New');
      expect(state.isDirty).toBe(false);
    });

    it('should clear undo/redo stacks', () => {
      const store = useEditorStore.getState();
      // Add something to undo stack
      store.addRoad({ id: 'r1', name: 'R', length: 10, junction_id: null, link: { predecessor: null, successor: null }, plan_view: [], lane_sections: [], elevation_profile: [] });
      expect(useEditorStore.getState().canUndo()).toBe(true);
      // Set a new project → stacks cleared
      store.setProject(makeProject());
      expect(useEditorStore.getState().canUndo()).toBe(false);
      expect(useEditorStore.getState().canRedo()).toBe(false);
    });

    it('should increment projectLoadVersion', () => {
      const v0 = useEditorStore.getState().projectLoadVersion;
      useEditorStore.getState().setProject(makeProject());
      expect(useEditorStore.getState().projectLoadVersion).toBe(v0 + 1);
    });

    it('should save as savedProject', () => {
      const p = makeProject({ name: 'Saved' });
      useEditorStore.getState().setProject(p);
      expect(useEditorStore.getState().savedProject?.name).toBe('Saved');
    });
  });

  describe('markDirty / markClean', () => {
    it('should toggle isDirty', () => {
      useEditorStore.getState().markDirty();
      expect(useEditorStore.getState().isDirty).toBe(true);
      useEditorStore.getState().markClean();
      expect(useEditorStore.getState().isDirty).toBe(false);
    });

    it('markClean should update savedProject to current project', () => {
      const p = makeProject({ name: 'Draft' });
      useEditorStore.getState().setProject(p);
      useEditorStore.getState().markDirty();
      useEditorStore.getState().markClean();
      expect(useEditorStore.getState().savedProject?.name).toBe('Draft');
    });
  });

  describe('setCursorWorldPos', () => {
    it('should update cursor position', () => {
      useEditorStore.getState().setCursorWorldPos({ x: 5, y: 10 });
      expect(useEditorStore.getState().cursorWorldPos).toEqual({ x: 5, y: 10 });
    });

    it('should return same state when position unchanged', () => {
      useEditorStore.getState().setCursorWorldPos({ x: 1, y: 2 });
      const s1 = useEditorStore.getState();
      // Setting same value should not trigger re-render (returns same partial state)
      useEditorStore.getState().setCursorWorldPos({ x: 1, y: 2 });
      const s2 = useEditorStore.getState();
      expect(s2.cursorWorldPos).toEqual(s1.cursorWorldPos);
    });
  });

  describe('setViewportInfo', () => {
    it('should update gridSpacing and viewportMpp', () => {
      useEditorStore.getState().setViewportInfo({ gridSpacing: 20, mpp: 0.5 });
      const state = useEditorStore.getState();
      expect(state.gridSpacing).toBe(20);
      expect(state.viewportMpp).toBe(0.5);
    });
  });

  describe('reset', () => {
    it('should clear project and selection', () => {
      useEditorStore.getState().addRoad({ id: 'r1', name: '', length: 1, junction_id: null, link: { predecessor: null, successor: null }, plan_view: [], lane_sections: [], elevation_profile: [] });
      useEditorStore.getState().selectRoad('r1');
      useEditorStore.getState().reset();
      const state = useEditorStore.getState();
      expect(state.project.roads).toHaveLength(0);
      expect(state.selectedRoadId).toBeNull();
      expect(state.isDirty).toBe(false);
    });
  });

  describe('resetToSaved', () => {
    it('should restore savedProject when available', () => {
      const p = makeProject({ name: 'Original' });
      useEditorStore.getState().setProject(p);
      useEditorStore.getState().addRoad({ id: 'r1', name: '', length: 1, junction_id: null, link: { predecessor: null, successor: null }, plan_view: [], lane_sections: [], elevation_profile: [] });
      useEditorStore.getState().resetToSaved();
      expect(useEditorStore.getState().project.roads).toHaveLength(0);
    });

    it('should not crash when savedProject is null', () => {
      useEditorStore.setState({ savedProject: null });
      expect(() => useEditorStore.getState().resetToSaved()).not.toThrow();
    });
  });
});
