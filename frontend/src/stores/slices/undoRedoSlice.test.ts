import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorStore } from '../editorStore';

vi.mock('../editorViewStore', () => ({
  useEditorViewStore: {
    getState: () => ({ resetDisplay: vi.fn() }),
  },
}));

describe('undoRedoSlice', () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
  });

  const road = {
    id: 'r1', name: 'R', length: 10, junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [], lane_sections: [], elevation_profile: [],
  };

  describe('canUndo / canRedo', () => {
    it('should be false on fresh store', () => {
      expect(useEditorStore.getState().canUndo()).toBe(false);
      expect(useEditorStore.getState().canRedo()).toBe(false);
    });

    it('should be true after addRoad', () => {
      useEditorStore.getState().addRoad(road);
      expect(useEditorStore.getState().canUndo()).toBe(true);
    });
  });

  describe('undo', () => {
    it('should revert addRoad', () => {
      useEditorStore.getState().addRoad(road);
      expect(useEditorStore.getState().project.roads).toHaveLength(1);
      useEditorStore.getState().undo();
      expect(useEditorStore.getState().project.roads).toHaveLength(0);
    });

    it('should push to redoStack when undone', () => {
      useEditorStore.getState().addRoad(road);
      useEditorStore.getState().undo();
      expect(useEditorStore.getState().canRedo()).toBe(true);
    });

    it('should do nothing when undoStack is empty', () => {
      const before = useEditorStore.getState().project;
      useEditorStore.getState().undo();
      const after = useEditorStore.getState().project;
      expect(after).toBe(before); // same reference — no change
    });

    it('should mark isDirty on undo', () => {
      useEditorStore.getState().addRoad(road);
      useEditorStore.getState().markClean();
      useEditorStore.getState().undo();
      expect(useEditorStore.getState().isDirty).toBe(true);
    });
  });

  describe('redo', () => {
    it('should reapply undone action', () => {
      useEditorStore.getState().addRoad(road);
      useEditorStore.getState().undo();
      useEditorStore.getState().redo();
      expect(useEditorStore.getState().project.roads).toHaveLength(1);
    });

    it('should do nothing when redoStack is empty', () => {
      const before = useEditorStore.getState().project;
      useEditorStore.getState().redo();
      const after = useEditorStore.getState().project;
      expect(after).toBe(before);
    });

    it('should mark isDirty on redo', () => {
      useEditorStore.getState().addRoad(road);
      useEditorStore.getState().undo();
      useEditorStore.getState().markClean();
      useEditorStore.getState().redo();
      expect(useEditorStore.getState().isDirty).toBe(true);
    });

    it('should clear redoStack after new edit', () => {
      useEditorStore.getState().addRoad(road);
      useEditorStore.getState().undo();
      expect(useEditorStore.getState().canRedo()).toBe(true);
      useEditorStore.getState().addRoad({ ...road, id: 'r2' });
      expect(useEditorStore.getState().canRedo()).toBe(false);
    });
  });

  describe('executePluginCommand', () => {
    it('should apply fn to project', () => {
      useEditorStore.getState().executePluginCommand('add road', (p) => ({
        ...p,
        roads: [...p.roads, road],
      }));
      expect(useEditorStore.getState().project.roads).toHaveLength(1);
    });

    it('should push onto undo stack', () => {
      useEditorStore.getState().executePluginCommand('noop', (p) => p);
      expect(useEditorStore.getState().canUndo()).toBe(true);
    });

    it('should mark isDirty', () => {
      useEditorStore.getState().executePluginCommand('noop', (p) => p);
      expect(useEditorStore.getState().isDirty).toBe(true);
    });
  });
});
