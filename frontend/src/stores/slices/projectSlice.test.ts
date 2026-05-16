import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useProjectStore } from '../projectStore';
import type { Project } from '../../services/platform';

// Mock useViewportStore to avoid side effects
vi.mock('../viewportStore', () => ({
  useViewportStore: {
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
    useProjectStore.getState().reset();
  });

  describe('setProject', () => {
    it('should replace project and mark clean', () => {
      const p = makeProject({ name: 'New' });
      useProjectStore.getState().setProject(p);
      const state = useProjectStore.getState();
      expect(state.project.name).toBe('New');
      expect(state.isDirty).toBe(false);
    });

    it('should clear undo/redo stacks', () => {
      const store = useProjectStore.getState();
      // Add something to undo stack
      store.addRoad({ id: 'r1', name: 'R', length: 10, junction_id: null, link: { predecessor: null, successor: null }, plan_view: [], lane_sections: [], elevation_profile: [] });
      expect(useProjectStore.getState().canUndo()).toBe(true);
      // Set a new project → stacks cleared
      store.setProject(makeProject());
      expect(useProjectStore.getState().canUndo()).toBe(false);
      expect(useProjectStore.getState().canRedo()).toBe(false);
    });

    it('should increment projectLoadVersion', () => {
      const v0 = useProjectStore.getState().projectLoadVersion;
      useProjectStore.getState().setProject(makeProject());
      expect(useProjectStore.getState().projectLoadVersion).toBe(v0 + 1);
    });

    it('should save as savedProject', () => {
      const p = makeProject({ name: 'Saved' });
      useProjectStore.getState().setProject(p);
      expect(useProjectStore.getState().savedProject?.name).toBe('Saved');
    });
  });

  describe('markDirty / markClean', () => {
    it('should toggle isDirty', () => {
      useProjectStore.getState().markDirty();
      expect(useProjectStore.getState().isDirty).toBe(true);
      useProjectStore.getState().markClean();
      expect(useProjectStore.getState().isDirty).toBe(false);
    });

    it('markClean should update savedProject to current project', () => {
      const p = makeProject({ name: 'Draft' });
      useProjectStore.getState().setProject(p);
      useProjectStore.getState().markDirty();
      useProjectStore.getState().markClean();
      expect(useProjectStore.getState().savedProject?.name).toBe('Draft');
    });
  });

  describe('setCursorWorldPos', () => {
    it('should update cursor position', () => {
      useProjectStore.getState().setCursorWorldPos({ x: 5, y: 10 });
      expect(useProjectStore.getState().cursorWorldPos).toEqual({ x: 5, y: 10 });
    });

    it('should return same state when position unchanged', () => {
      useProjectStore.getState().setCursorWorldPos({ x: 1, y: 2 });
      const s1 = useProjectStore.getState();
      // Setting same value should not trigger re-render (returns same partial state)
      useProjectStore.getState().setCursorWorldPos({ x: 1, y: 2 });
      const s2 = useProjectStore.getState();
      expect(s2.cursorWorldPos).toEqual(s1.cursorWorldPos);
    });
  });

  describe('setViewportInfo', () => {
    it('should update gridSpacing and viewportMpp', () => {
      useProjectStore.getState().setViewportInfo({ gridSpacing: 20, mpp: 0.5 });
      const state = useProjectStore.getState();
      expect(state.gridSpacing).toBe(20);
      expect(state.viewportMpp).toBe(0.5);
    });
  });

  describe('reset', () => {
    it('should clear project and selection', () => {
      useProjectStore.getState().addRoad({ id: 'r1', name: '', length: 1, junction_id: null, link: { predecessor: null, successor: null }, plan_view: [], lane_sections: [], elevation_profile: [] });
      useProjectStore.getState().selectRoad('r1');
      useProjectStore.getState().reset();
      const state = useProjectStore.getState();
      expect(state.project.roads).toHaveLength(0);
      expect(state.selectedRoadId).toBeNull();
      expect(state.isDirty).toBe(false);
    });
  });

  describe('resetToSaved', () => {
    it('should restore savedProject when available', () => {
      const p = makeProject({ name: 'Original' });
      useProjectStore.getState().setProject(p);
      useProjectStore.getState().addRoad({ id: 'r1', name: '', length: 1, junction_id: null, link: { predecessor: null, successor: null }, plan_view: [], lane_sections: [], elevation_profile: [] });
      useProjectStore.getState().resetToSaved();
      expect(useProjectStore.getState().project.roads).toHaveLength(0);
    });

    it('should not crash when savedProject is null', () => {
      useProjectStore.setState({ savedProject: null });
      expect(() => useProjectStore.getState().resetToSaved()).not.toThrow();
    });
  });
});
