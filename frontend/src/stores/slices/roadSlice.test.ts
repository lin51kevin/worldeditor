import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useProjectStore } from '../projectStore';
import type { Junction, Road } from '../../services/platform';

vi.mock('../viewportStore', () => ({
  useViewportStore: {
    getState: () => ({ resetDisplay: vi.fn() }),
  },
}));

const baseRoad: Road = {
  id: 'r1', name: 'Road 1', length: 100, junction_id: null,
  link: { predecessor: null, successor: null },
  plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
  lane_sections: [],
  elevation_profile: [],
};

const baseJunction: Junction = {
  id: 'j1',
  name: 'J',
  connections: [],
};

describe('roadSlice', () => {
  beforeEach(() => {
    useProjectStore.getState().reset();
  });

  describe('addRoad', () => {
    it('should add road to project', () => {
      useProjectStore.getState().addRoad(baseRoad);
      expect(useProjectStore.getState().project.roads).toHaveLength(1);
    });

    it('should push undo on add', () => {
      useProjectStore.getState().addRoad(baseRoad);
      expect(useProjectStore.getState().canUndo()).toBe(true);
    });

    it('should mark isDirty', () => {
      useProjectStore.getState().addRoad(baseRoad);
      expect(useProjectStore.getState().isDirty).toBe(true);
    });
  });

  describe('removeRoad', () => {
    it('should remove road by id', () => {
      useProjectStore.getState().addRoad(baseRoad);
      useProjectStore.getState().removeRoad('r1');
      expect(useProjectStore.getState().project.roads).toHaveLength(0);
    });

    it('should clear selectedRoadId if removed', () => {
      useProjectStore.getState().addRoad(baseRoad);
      useProjectStore.getState().selectRoad('r1');
      useProjectStore.getState().removeRoad('r1');
      expect(useProjectStore.getState().selectedRoadId).toBeNull();
    });

    it('should keep selectedRoadId if different road removed', () => {
      useProjectStore.getState().addRoad(baseRoad);
      useProjectStore.getState().addRoad({ ...baseRoad, id: 'r2' });
      useProjectStore.getState().selectRoad('r1');
      useProjectStore.getState().removeRoad('r2');
      expect(useProjectStore.getState().selectedRoadId).toBe('r1');
    });
  });

  describe('updateRoad', () => {
    it('should update road name', () => {
      useProjectStore.getState().addRoad(baseRoad);
      useProjectStore.getState().updateRoad('r1', { name: 'Updated' });
      expect(useProjectStore.getState().project.roads[0]!.name).toBe('Updated');
    });

    it('should be immutable — original not mutated', () => {
      useProjectStore.getState().addRoad(baseRoad);
      const original = useProjectStore.getState().project.roads[0]!;
      useProjectStore.getState().updateRoad('r1', { name: 'Updated' });
      expect(baseRoad.name).toBe('Road 1'); // external object unchanged
      expect(original.name).toBe('Road 1'); // prior snapshot unchanged
    });
  });

  describe('cloneRoad', () => {
    it('should create a new road with offset', () => {
      useProjectStore.getState().addRoad(baseRoad);
      useProjectStore.getState().cloneRoad('r1', 'r2', [10, 0]);
      const roads = useProjectStore.getState().project.roads;
      expect(roads).toHaveLength(2);
      expect(roads.find((r) => r.id === 'r2')).toBeDefined();
    });
  });

  describe('moveRoad', () => {
    it('should push undo and mark dirty', () => {
      useProjectStore.getState().addRoad(baseRoad);
      useProjectStore.getState().markClean();
      const stackSize = useProjectStore.getState().undoStack.length;
      useProjectStore.getState().moveRoad('r1', 5, 5);
      expect(useProjectStore.getState().undoStack.length).toBeGreaterThan(stackSize);
      expect(useProjectStore.getState().isDirty).toBe(true);
    });
  });

  describe('removeJunction', () => {
    it('should remove junction', () => {
      useProjectStore.setState((s) => ({
        project: {
          ...s.project,
          junctions: [baseJunction],
        },
      }));
      useProjectStore.getState().removeJunction('j1');
      expect(useProjectStore.getState().project.junctions).toHaveLength(0);
    });
  });

  describe('addJunctionWithRoads', () => {
    it('should add junction and associated roads', () => {
      useProjectStore.getState().addJunctionWithRoads(baseJunction, [baseRoad]);
      const state = useProjectStore.getState();
      expect(state.project.junctions).toHaveLength(1);
      expect(state.project.roads).toHaveLength(1);
    });
  });
});
