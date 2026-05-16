import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorStore } from '../editorStore';
import type { Junction, Road } from '../../services/platform';

vi.mock('../editorViewStore', () => ({
  useEditorViewStore: {
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
    useEditorStore.getState().reset();
  });

  describe('addRoad', () => {
    it('should add road to project', () => {
      useEditorStore.getState().addRoad(baseRoad);
      expect(useEditorStore.getState().project.roads).toHaveLength(1);
    });

    it('should push undo on add', () => {
      useEditorStore.getState().addRoad(baseRoad);
      expect(useEditorStore.getState().canUndo()).toBe(true);
    });

    it('should mark isDirty', () => {
      useEditorStore.getState().addRoad(baseRoad);
      expect(useEditorStore.getState().isDirty).toBe(true);
    });
  });

  describe('removeRoad', () => {
    it('should remove road by id', () => {
      useEditorStore.getState().addRoad(baseRoad);
      useEditorStore.getState().removeRoad('r1');
      expect(useEditorStore.getState().project.roads).toHaveLength(0);
    });

    it('should clear selectedRoadId if removed', () => {
      useEditorStore.getState().addRoad(baseRoad);
      useEditorStore.getState().selectRoad('r1');
      useEditorStore.getState().removeRoad('r1');
      expect(useEditorStore.getState().selectedRoadId).toBeNull();
    });

    it('should keep selectedRoadId if different road removed', () => {
      useEditorStore.getState().addRoad(baseRoad);
      useEditorStore.getState().addRoad({ ...baseRoad, id: 'r2' });
      useEditorStore.getState().selectRoad('r1');
      useEditorStore.getState().removeRoad('r2');
      expect(useEditorStore.getState().selectedRoadId).toBe('r1');
    });
  });

  describe('updateRoad', () => {
    it('should update road name', () => {
      useEditorStore.getState().addRoad(baseRoad);
      useEditorStore.getState().updateRoad('r1', { name: 'Updated' });
      expect(useEditorStore.getState().project.roads[0]!.name).toBe('Updated');
    });

    it('should be immutable — original not mutated', () => {
      useEditorStore.getState().addRoad(baseRoad);
      const original = useEditorStore.getState().project.roads[0]!;
      useEditorStore.getState().updateRoad('r1', { name: 'Updated' });
      expect(baseRoad.name).toBe('Road 1'); // external object unchanged
      expect(original.name).toBe('Road 1'); // prior snapshot unchanged
    });
  });

  describe('cloneRoad', () => {
    it('should create a new road with offset', () => {
      useEditorStore.getState().addRoad(baseRoad);
      useEditorStore.getState().cloneRoad('r1', 'r2', [10, 0]);
      const roads = useEditorStore.getState().project.roads;
      expect(roads).toHaveLength(2);
      expect(roads.find((r) => r.id === 'r2')).toBeDefined();
    });
  });

  describe('moveRoad', () => {
    it('should push undo and mark dirty', () => {
      useEditorStore.getState().addRoad(baseRoad);
      useEditorStore.getState().markClean();
      const stackSize = useEditorStore.getState().undoStack.length;
      useEditorStore.getState().moveRoad('r1', 5, 5);
      expect(useEditorStore.getState().undoStack.length).toBeGreaterThan(stackSize);
      expect(useEditorStore.getState().isDirty).toBe(true);
    });
  });

  describe('removeJunction', () => {
    it('should remove junction', () => {
      useEditorStore.setState((s) => ({
        project: {
          ...s.project,
          junctions: [baseJunction],
        },
      }));
      useEditorStore.getState().removeJunction('j1');
      expect(useEditorStore.getState().project.junctions).toHaveLength(0);
    });
  });

  describe('addJunctionWithRoads', () => {
    it('should add junction and associated roads', () => {
      useEditorStore.getState().addJunctionWithRoads(baseJunction, [baseRoad]);
      const state = useEditorStore.getState();
      expect(state.project.junctions).toHaveLength(1);
      expect(state.project.roads).toHaveLength(1);
    });
  });
});
