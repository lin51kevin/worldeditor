import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './editorStore';
import type { Road } from '../services/platform';

function makeRoad(overrides: Partial<Road> = {}): Road {
  return {
    id: 'r1',
    name: 'Road 1',
    length: 100,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [],
    lane_sections: [],
    elevation_profile: [],
    ...overrides,
  };
}

describe('editorStore', () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
  });

  describe('updateRoad', () => {
    it('should update road name', () => {
      const store = useEditorStore.getState();
      store.addRoad(makeRoad());
      useEditorStore.getState().updateRoad('r1', { name: 'New Name' });
      const road = useEditorStore.getState().project.roads[0]!;
      expect(road.name).toBe('New Name');
    });

    it('should push undo on update', () => {
      useEditorStore.getState().addRoad(makeRoad());
      useEditorStore.getState().updateRoad('r1', { name: 'X' });
      expect(useEditorStore.getState().canUndo()).toBe(true);
    });
  });

  describe('updateJunction', () => {
    it('should update junction name', () => {
      useEditorStore.setState((s) => ({
        project: {
          ...s.project,
          junctions: [{ id: 'j1', name: 'Old', type: 'default', x: 0, y: 0, z: 0, connections: [], laneLinks: [] }],
        },
      }));
      useEditorStore.getState().updateJunction('j1', { name: 'New' });
      const j = useEditorStore.getState().project.junctions[0]!;
      expect(j.name).toBe('New');
    });
  });

  describe('Signal CRUD', () => {
    it('should add and remove signals', () => {
      const store = useEditorStore.getState();
      store.addSignal({ id: 's1', roadId: 'r1', sPosition: 10, laneId: -1, type: 'traffic_light', validity: '' });
      expect(useEditorStore.getState().project.signals!.length).toBe(1);
      store.removeSignal('s1');
      expect(useEditorStore.getState().project.signals!.length).toBe(0);
    });

    it('should update signal', () => {
      useEditorStore.getState().addSignal({ id: 's1', roadId: 'r1', sPosition: 10, laneId: -1, type: 'traffic_light', validity: '' });
      useEditorStore.getState().updateSignal('s1', { type: 'stop_sign' });
      const sig = useEditorStore.getState().project.signals![0]!;
      expect(sig.type).toBe('stop_sign');
    });
  });

  describe('Object CRUD', () => {
    it('should add and remove objects', () => {
      useEditorStore.getState().addObject({ id: 'o1', roadId: 'r1', sPosition: 20, laneId: -1, type: 'pole', validity: '' });
      expect(useEditorStore.getState().project.objects!.length).toBe(1);
      useEditorStore.getState().removeObject('o1');
      expect(useEditorStore.getState().project.objects!.length).toBe(0);
    });

    it('should update object', () => {
      useEditorStore.getState().addObject({ id: 'o1', roadId: 'r1', sPosition: 20, laneId: -1, type: 'pole', validity: '' });
      useEditorStore.getState().updateObject('o1', { type: 'tree' });
      const obj = useEditorStore.getState().project.objects![0]!;
      expect(obj.type).toBe('tree');
    });
  });

  describe('Lane editing', () => {
    it('should update lane type', () => {
      const road = makeRoad({
        lane_sections: [{
          s: 0,
          single_side: false,
          left: [{ id: 1, lane_type: 'driving', level: false, link: { predecessor: null, successor: null }, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] }],
          center: [],
          right: [],
        }],
      });
      useEditorStore.getState().addRoad(road);
      useEditorStore.getState().updateLaneType('r1', 0, 'left', 1, 'shoulder');
      const lane = useEditorStore.getState().project.roads[0]!.lane_sections[0]!.left[0] as any;
      expect(lane.lane_type).toBe('shoulder');
    });

    it('should update lane width', () => {
      const road = makeRoad({
        lane_sections: [{
          s: 0, single_side: false,
          left: [{ id: 1, lane_type: 'driving', level: false, link: { predecessor: null, successor: null }, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] }],
          center: [], right: [],
        }],
      });
      useEditorStore.getState().addRoad(road);
      useEditorStore.getState().updateLaneWidth('r1', 0, 'left', 1, { s_offset: 0, a: 4.0, b: 0, c: 0, d: 0 });
      const lane = useEditorStore.getState().project.roads[0]!.lane_sections[0]!.left[0] as any;
      expect(lane.width[0].a).toBe(4.0);
    });
  });

  describe('Elevation editing', () => {
    it('should add elevation point and keep s sorted', () => {
      useEditorStore.getState().addRoad(makeRoad({
        elevation_profile: [
          { s: 0, a: 0, b: 0, c: 0, d: 0 },
          { s: 100, a: 10, b: 0, c: 0, d: 0 },
        ],
      }));

      useEditorStore.getState().addElevationPoint('r1', 50, 5);

      const profile = useEditorStore.getState().project.roads[0]!.elevation_profile;
      expect(profile).toHaveLength(3);
      expect(profile.map((p) => p.s)).toEqual([0, 50, 100]);
      expect(useEditorStore.getState().canUndo()).toBe(true);
    });

    it('should update elevation point by index', () => {
      useEditorStore.getState().addRoad(makeRoad({
        elevation_profile: [{ s: 0, a: 0, b: 0, c: 0, d: 0 }],
      }));

      useEditorStore.getState().updateElevationPoint('r1', 0, { a: 2.5 });

      const profile = useEditorStore.getState().project.roads[0]!.elevation_profile;
      expect(profile[0]!.a).toBe(2.5);
    });

    it('should remove elevation point by index', () => {
      useEditorStore.getState().addRoad(makeRoad({
        elevation_profile: [
          { s: 0, a: 0, b: 0, c: 0, d: 0 },
          { s: 50, a: 5, b: 0, c: 0, d: 0 },
        ],
      }));

      useEditorStore.getState().removeElevationPoint('r1', 1);

      const profile = useEditorStore.getState().project.roads[0]!.elevation_profile;
      expect(profile).toHaveLength(1);
      expect(profile[0]!.s).toBe(0);
    });

    it('should smooth interior elevation points', () => {
      useEditorStore.getState().addRoad(makeRoad({
        elevation_profile: [
          { s: 0, a: 0, b: 0, c: 0, d: 0 },
          { s: 50, a: 9, b: 0, c: 0, d: 0 },
          { s: 100, a: 0, b: 0, c: 0, d: 0 },
        ],
      }));

      useEditorStore.getState().smoothElevation('r1', 1);

      const profile = useEditorStore.getState().project.roads[0]!.elevation_profile;
      expect(profile[1]!.a).toBeCloseTo(3, 5);
      expect(profile[0]!.a).toBe(0);
      expect(profile[2]!.a).toBe(0);
    });
  });

  describe('cursorWorldPos', () => {
    it('should update cursor position', () => {
      useEditorStore.getState().setCursorWorldPos({ x: 100, y: 200 });
      const pos = useEditorStore.getState().cursorWorldPos;
      expect(pos.x).toBe(100);
      expect(pos.y).toBe(200);
    });

    it('should reset to zero on store reset', () => {
      useEditorStore.getState().setCursorWorldPos({ x: 100, y: 200 });
      useEditorStore.getState().reset();
      const pos = useEditorStore.getState().cursorWorldPos;
      expect(pos.x).toBe(0);
      expect(pos.y).toBe(0);
    });
  });

  describe('scene selection', () => {
    it('should select lane sections while keeping the parent road selected', () => {
      useEditorStore.getState().selectLaneSection('r1', 2);
      const state = useEditorStore.getState();

      expect(state.selectedRoadId).toBe('r1');
      expect(state.selectedSceneNode).toEqual({ type: 'laneSection', roadId: 'r1', sectionIndex: 2 });
      expect(state.selectedObjectType).toBe('road');
    });

    it('should select lanes while keeping the parent road selected', () => {
      useEditorStore.getState().selectLane('r1', 1, 'right', -2);
      const state = useEditorStore.getState();

      expect(state.selectedRoadId).toBe('r1');
      expect(state.selectedSceneNode).toEqual({
        type: 'lane',
        roadId: 'r1',
        sectionIndex: 1,
        side: 'right',
        laneId: -2,
      });
      expect(state.selectedObjectType).toBe('road');
    });
  });
});
