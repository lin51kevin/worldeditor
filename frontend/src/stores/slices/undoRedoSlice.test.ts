import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useProjectStore } from '../projectStore';

vi.mock('../viewportStore', () => ({
  useViewportStore: {
    getState: () => ({ resetDisplay: vi.fn() }),
  },
}));

describe('undoRedoSlice', () => {
  beforeEach(() => {
    useProjectStore.getState().reset();
  });

  const road = {
    id: 'r1', name: 'R', length: 10, junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [], lane_sections: [], elevation_profile: [],
  };

  describe('canUndo / canRedo', () => {
    it('should be false on fresh store', () => {
      expect(useProjectStore.getState().canUndo()).toBe(false);
      expect(useProjectStore.getState().canRedo()).toBe(false);
    });

    it('should be true after addRoad', () => {
      useProjectStore.getState().addRoad(road);
      expect(useProjectStore.getState().canUndo()).toBe(true);
    });
  });

  describe('undo', () => {
    it('should revert addRoad', () => {
      useProjectStore.getState().addRoad(road);
      expect(useProjectStore.getState().project.roads).toHaveLength(1);
      useProjectStore.getState().undo();
      expect(useProjectStore.getState().project.roads).toHaveLength(0);
    });

    it('should push to redoStack when undone', () => {
      useProjectStore.getState().addRoad(road);
      useProjectStore.getState().undo();
      expect(useProjectStore.getState().canRedo()).toBe(true);
    });

    it('should do nothing when undoStack is empty', () => {
      const before = useProjectStore.getState().project;
      useProjectStore.getState().undo();
      const after = useProjectStore.getState().project;
      expect(after).toBe(before); // same reference — no change
    });

    it('should mark isDirty on undo', () => {
      useProjectStore.getState().addRoad(road);
      useProjectStore.getState().markClean();
      useProjectStore.getState().undo();
      expect(useProjectStore.getState().isDirty).toBe(true);
    });
  });

  describe('redo', () => {
    it('should reapply undone action', () => {
      useProjectStore.getState().addRoad(road);
      useProjectStore.getState().undo();
      useProjectStore.getState().redo();
      expect(useProjectStore.getState().project.roads).toHaveLength(1);
    });

    it('should do nothing when redoStack is empty', () => {
      const before = useProjectStore.getState().project;
      useProjectStore.getState().redo();
      const after = useProjectStore.getState().project;
      expect(after).toBe(before);
    });

    it('should mark isDirty on redo', () => {
      useProjectStore.getState().addRoad(road);
      useProjectStore.getState().undo();
      useProjectStore.getState().markClean();
      useProjectStore.getState().redo();
      expect(useProjectStore.getState().isDirty).toBe(true);
    });

    it('should clear redoStack after new edit', () => {
      useProjectStore.getState().addRoad(road);
      useProjectStore.getState().undo();
      expect(useProjectStore.getState().canRedo()).toBe(true);
      useProjectStore.getState().addRoad({ ...road, id: 'r2' });
      expect(useProjectStore.getState().canRedo()).toBe(false);
    });
  });

  describe('executePluginCommand', () => {
    it('should apply fn to project', () => {
      useProjectStore.getState().executePluginCommand('add road', (p) => ({
        ...p,
        roads: [...p.roads, road],
      }));
      expect(useProjectStore.getState().project.roads).toHaveLength(1);
    });

    it('should push onto undo stack', () => {
      useProjectStore.getState().executePluginCommand('noop', (p) => p);
      expect(useProjectStore.getState().canUndo()).toBe(true);
    });

    it('should mark isDirty', () => {
      useProjectStore.getState().executePluginCommand('noop', (p) => p);
      expect(useProjectStore.getState().isDirty).toBe(true);
    });
  });
});
