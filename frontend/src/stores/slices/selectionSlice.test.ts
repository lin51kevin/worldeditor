import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useProjectStore } from '../projectStore';

vi.mock('../viewportStore', () => ({
  useViewportStore: {
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
    useProjectStore.getState().reset();
  });

  describe('selectRoad', () => {
    it('should set selectedRoadId and clear junction', () => {
      useProjectStore.getState().selectJunction('j1');
      useProjectStore.getState().selectRoad('r1');
      const state = useProjectStore.getState();
      expect(state.selectedRoadId).toBe('r1');
      expect(state.selectedJunctionId).toBeNull();
      expect(state.selectedObjectType).toBe('road');
    });

    it('should set selectedSceneNode for road', () => {
      useProjectStore.getState().selectRoad('r1');
      const node = useProjectStore.getState().selectedSceneNode;
      expect(node).toMatchObject({ type: 'road', roadId: 'r1' });
    });

    it('should clear selection when null passed', () => {
      useProjectStore.getState().selectRoad('r1');
      useProjectStore.getState().selectRoad(null);
      expect(useProjectStore.getState().selectedRoadId).toBeNull();
      expect(useProjectStore.getState().selectedObjectType).toBeNull();
    });
  });

  describe('selectJunction', () => {
    it('should set selectedJunctionId and clear road', () => {
      useProjectStore.getState().selectRoad('r1');
      useProjectStore.getState().selectJunction('j1');
      const state = useProjectStore.getState();
      expect(state.selectedJunctionId).toBe('j1');
      expect(state.selectedRoadId).toBeNull();
      expect(state.selectedObjectType).toBe('junction');
    });
  });

  describe('selectMultiple', () => {
    it('should set multiple selected roads and junctions', () => {
      useProjectStore.getState().selectMultiple(['r1', 'r2'], ['j1']);
      const state = useProjectStore.getState();
      expect(state.selectedRoadIds).toEqual(['r1', 'r2']);
      expect(state.selectedJunctionIds).toEqual(['j1']);
      expect(state.selectedRoadId).toBeNull();
    });
  });

  describe('copySelected / pasteFromClipboard', () => {
    it('should set clipboard on copySelected', () => {
      useProjectStore.getState().addRoad(road);
      useProjectStore.getState().selectRoad('r1');
      useProjectStore.getState().copySelected();
      expect(useProjectStore.getState().clipboardRoadId).toBe('r1');
    });

    it('should duplicate road on paste', () => {
      useProjectStore.getState().addRoad(road);
      useProjectStore.getState().selectRoad('r1');
      useProjectStore.getState().copySelected();
      useProjectStore.getState().pasteFromClipboard();
      expect(useProjectStore.getState().project.roads.length).toBeGreaterThan(1);
    });
  });

  describe('deleteSelected', () => {
    it('should remove selected road', () => {
      useProjectStore.getState().addRoad(road);
      useProjectStore.getState().selectRoad('r1');
      useProjectStore.getState().deleteSelected();
      expect(useProjectStore.getState().project.roads).toHaveLength(0);
    });
  });

  describe('selectAll', () => {
    it('should select all roads', () => {
      useProjectStore.getState().addRoad(road);
      useProjectStore.getState().addRoad({ ...road, id: 'r2' });
      useProjectStore.getState().selectAll();
      expect(useProjectStore.getState().selectedRoadIds).toHaveLength(2);
    });
  });
});
