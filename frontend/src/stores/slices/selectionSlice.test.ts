import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorStore } from '../editorStore';

vi.mock('../editorViewStore', () => ({
  useEditorViewStore: {
    getState: () => ({ resetDisplay: vi.fn() }),
  },
}));

const road = {
  id: 'r1', name: 'R', length: 10, junction_id: null,
  link: { predecessor: null, successor: null },
  plan_view: [], lane_sections: [], elevation_profile: [],
};

describe('selectionSlice', () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
  });

  describe('selectRoad', () => {
    it('should set selectedRoadId and clear junction', () => {
      useEditorStore.getState().selectJunction('j1');
      useEditorStore.getState().selectRoad('r1');
      const state = useEditorStore.getState();
      expect(state.selectedRoadId).toBe('r1');
      expect(state.selectedJunctionId).toBeNull();
      expect(state.selectedObjectType).toBe('road');
    });

    it('should set selectedSceneNode for road', () => {
      useEditorStore.getState().selectRoad('r1');
      const node = useEditorStore.getState().selectedSceneNode;
      expect(node).toMatchObject({ type: 'road', roadId: 'r1' });
    });

    it('should clear selection when null passed', () => {
      useEditorStore.getState().selectRoad('r1');
      useEditorStore.getState().selectRoad(null);
      expect(useEditorStore.getState().selectedRoadId).toBeNull();
      expect(useEditorStore.getState().selectedObjectType).toBeNull();
    });
  });

  describe('selectJunction', () => {
    it('should set selectedJunctionId and clear road', () => {
      useEditorStore.getState().selectRoad('r1');
      useEditorStore.getState().selectJunction('j1');
      const state = useEditorStore.getState();
      expect(state.selectedJunctionId).toBe('j1');
      expect(state.selectedRoadId).toBeNull();
      expect(state.selectedObjectType).toBe('junction');
    });
  });

  describe('selectMultiple', () => {
    it('should set multiple selected roads and junctions', () => {
      useEditorStore.getState().selectMultiple(['r1', 'r2'], ['j1']);
      const state = useEditorStore.getState();
      expect(state.selectedRoadIds).toEqual(['r1', 'r2']);
      expect(state.selectedJunctionIds).toEqual(['j1']);
      expect(state.selectedRoadId).toBeNull();
    });
  });

  describe('copySelected / pasteFromClipboard', () => {
    it('should set clipboard on copySelected', () => {
      useEditorStore.getState().addRoad(road);
      useEditorStore.getState().selectRoad('r1');
      useEditorStore.getState().copySelected();
      expect(useEditorStore.getState().clipboardRoadId).toBe('r1');
    });

    it('should duplicate road on paste', () => {
      useEditorStore.getState().addRoad(road);
      useEditorStore.getState().selectRoad('r1');
      useEditorStore.getState().copySelected();
      useEditorStore.getState().pasteFromClipboard();
      expect(useEditorStore.getState().project.roads.length).toBeGreaterThan(1);
    });
  });

  describe('deleteSelected', () => {
    it('should remove selected road', () => {
      useEditorStore.getState().addRoad(road);
      useEditorStore.getState().selectRoad('r1');
      useEditorStore.getState().deleteSelected();
      expect(useEditorStore.getState().project.roads).toHaveLength(0);
    });
  });

  describe('selectAll', () => {
    it('should select all roads', () => {
      useEditorStore.getState().addRoad(road);
      useEditorStore.getState().addRoad({ ...road, id: 'r2' });
      useEditorStore.getState().selectAll();
      expect(useEditorStore.getState().selectedRoadIds).toHaveLength(2);
    });
  });
});
