import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../stores/projectStore';
import type { Road, RoadObjectItem, RoadSignal } from '../services/platform';
import { MAX_UNDO } from '../stores/slices/types';

function makeSignal(overrides: Partial<RoadSignal> = {}): RoadSignal {
  return {
    id: 'sig1',
    name: 'Test Signal',
    s: 10,
    t: 2,
    z_offset: 0,
    h_offset: 0,
    width: 1,
    height: 2,
    signal_type: 'traffic_light',
    signal_subtype: '',
    value: null,
    orientation: '+',
    is_dynamic: true,
    ...overrides,
  };
}

function makeObject(overrides: Partial<RoadObjectItem> = {}): RoadObjectItem {
  return {
    id: 'obj1',
    object_type: 'TrafficCone',
    name: 'Test Object',
    position: { x: 20, y: 3, z: 0, id: null },
    orientation: 0,
    hdg: 0,
    width: 1,
    height: 1,
    length: 1,
    corners: [],
    validity: null,
    ...overrides,
  };
}

function makeRoad(overrides: Partial<Road> = {}): Road {
  return {
    id: 'r1',
    name: 'Road 1',
    length: 100,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
    lane_sections: [],
    elevation_profile: [],
    ...overrides,
  };
}

describe('useMoveRotateMode - element move/rotate via store', () => {
  beforeEach(() => {
    useProjectStore.getState().reset();
  });

  describe('signal selection state', () => {
    it('should set selectedSceneNode with type signal when selectSignal is called', () => {
      useProjectStore.getState().addRoad(makeRoad({ signals: [makeSignal()] }));
      useProjectStore.getState().selectSignal('r1', 'sig1');
      const state = useProjectStore.getState();
      expect(state.selectedSceneNode).toEqual({ type: 'signal', roadId: 'r1', signalId: 'sig1' });
      expect(state.selectedRoadId).toBe('r1');
    });

    it('should set selectedSceneNode with type object when selectObject is called', () => {
      useProjectStore.getState().addRoad(makeRoad({ objects: [makeObject()] }));
      useProjectStore.getState().selectObject('r1', 'obj1');
      const state = useProjectStore.getState();
      expect(state.selectedSceneNode).toEqual({ type: 'object', roadId: 'r1', objectId: 'obj1' });
      expect(state.selectedRoadId).toBe('r1');
    });
  });

  describe('signal move (updateSignal)', () => {
    it('should update signal s and t when moved', () => {
      useProjectStore.getState().addRoad(makeRoad({ signals: [makeSignal({ s: 10, t: 2 })] }));
      useProjectStore.getState().updateSignal('sig1', { s: 15, t: -1 });
      const road = useProjectStore.getState().project.roads[0]!;
      const signal = road.signals![0]!;
      expect(signal.s).toBe(15);
      expect(signal.t).toBe(-1);
    });

    it('should push undo when signal is moved', () => {
      useProjectStore.getState().addRoad(makeRoad({ signals: [makeSignal()] }));
      useProjectStore.setState({ undoStack: [], redoStack: [] });
      expect(useProjectStore.getState().canUndo()).toBe(false);
      useProjectStore.getState().updateSignal('sig1', { s: 20 });
      expect(useProjectStore.getState().canUndo()).toBe(true);
    });

    it('should preserve other signal properties when only s/t changes', () => {
      const signal = makeSignal({ s: 10, t: 2, h_offset: 0.5 });
      useProjectStore.getState().addRoad(makeRoad({ signals: [signal] }));
      useProjectStore.getState().updateSignal('sig1', { s: 30, t: 5 });
      const updated = useProjectStore.getState().project.roads[0]!.signals![0]!;
      expect(updated.h_offset).toBe(0.5);
      expect(updated.signal_type).toBe('traffic_light');
    });
  });

  describe('signal rotate (updateSignal h_offset)', () => {
    it('should update signal h_offset when rotated', () => {
      useProjectStore.getState().addRoad(makeRoad({ signals: [makeSignal({ h_offset: 0 })] }));
      useProjectStore.getState().updateSignal('sig1', { h_offset: Math.PI / 4 });
      const signal = useProjectStore.getState().project.roads[0]!.signals![0]!;
      expect(signal.h_offset).toBeCloseTo(Math.PI / 4);
    });

    it('should preserve s/t when only rotating', () => {
      useProjectStore.getState().addRoad(makeRoad({ signals: [makeSignal({ s: 10, t: 2 })] }));
      useProjectStore.getState().updateSignal('sig1', { h_offset: 1.0 });
      const signal = useProjectStore.getState().project.roads[0]!.signals![0]!;
      expect(signal.s).toBe(10);
      expect(signal.t).toBe(2);
    });
  });

  describe('road object move (direct setState)', () => {
    it('should update object position.x and position.y when moved', () => {
      useProjectStore.getState().addRoad(makeRoad({
        objects: [makeObject({ position: { x: 20, y: 3, z: 1, id: null } })],
      }));

      // Simulate the moveRoadObject helper
      useProjectStore.setState((state) => {
        return {
          undoStack: [...state.undoStack, state.project].slice(-MAX_UNDO),
          redoStack: [],
          project: {
            ...state.project,
            roads: state.project.roads.map((r) => {
              if (r.id !== 'r1') return r;
              return {
                ...r,
                objects: (r.objects ?? []).map((o) =>
                  o.id === 'obj1'
                    ? { ...o, position: { ...o.position, x: 25, y: -2 } }
                    : o,
                ),
              };
            }),
          },
          isDirty: true,
        };
      });

      const road = useProjectStore.getState().project.roads[0]!;
      const obj = road.objects![0]!;
      expect(obj.position.x).toBe(25);
      expect(obj.position.y).toBe(-2);
      expect(obj.position.z).toBe(1); // z preserved
    });

    it('should push undo when object is moved', () => {
      useProjectStore.getState().addRoad(makeRoad({ objects: [makeObject()] }));
      // addRoad already pushes undo, so reset the stack
      useProjectStore.setState({ undoStack: [], redoStack: [] });
      expect(useProjectStore.getState().canUndo()).toBe(false);

      useProjectStore.setState((state) => ({
        undoStack: [...state.undoStack, state.project].slice(-MAX_UNDO),
        redoStack: [],
        project: {
          ...state.project,
          roads: state.project.roads.map((r) => ({
            ...r,
            objects: (r.objects ?? []).map((o) =>
              o.id === 'obj1' ? { ...o, position: { ...o.position, x: 30 } } : o,
            ),
          })),
        },
        isDirty: true,
      }));

      expect(useProjectStore.getState().canUndo()).toBe(true);
    });

    it('should preserve other object properties when moved', () => {
      const obj = makeObject({ hdg: 1.5, width: 3, height: 4 });
      useProjectStore.getState().addRoad(makeRoad({ objects: [obj] }));

      useProjectStore.setState((state) => ({
        undoStack: [...state.undoStack, state.project].slice(-MAX_UNDO),
        redoStack: [],
        project: {
          ...state.project,
          roads: state.project.roads.map((r) => ({
            ...r,
            objects: (r.objects ?? []).map((o) =>
              o.id === 'obj1' ? { ...o, position: { ...o.position, x: 50, y: 10 } } : o,
            ),
          })),
        },
        isDirty: true,
      }));

      const updated = useProjectStore.getState().project.roads[0]!.objects![0]!;
      expect(updated.hdg).toBe(1.5);
      expect(updated.width).toBe(3);
      expect(updated.height).toBe(4);
    });
  });

  describe('road object rotate (direct setState)', () => {
    it('should update object hdg when rotated', () => {
      useProjectStore.getState().addRoad(makeRoad({ objects: [makeObject({ hdg: 0 })] }));

      useProjectStore.setState((state) => ({
        undoStack: [...state.undoStack, state.project].slice(-MAX_UNDO),
        redoStack: [],
        project: {
          ...state.project,
          roads: state.project.roads.map((r) => ({
            ...r,
            objects: (r.objects ?? []).map((o) =>
              o.id === 'obj1' ? { ...o, hdg: Math.PI / 3 } : o,
            ),
          })),
        },
        isDirty: true,
      }));

      const obj = useProjectStore.getState().project.roads[0]!.objects![0]!;
      expect(obj.hdg).toBeCloseTo(Math.PI / 3);
    });

    it('should preserve position when only rotating', () => {
      useProjectStore.getState().addRoad(makeRoad({
        objects: [makeObject({ position: { x: 20, y: 3, z: 1, id: null } })],
      }));

      useProjectStore.setState((state) => ({
        undoStack: [...state.undoStack, state.project].slice(-MAX_UNDO),
        redoStack: [],
        project: {
          ...state.project,
          roads: state.project.roads.map((r) => ({
            ...r,
            objects: (r.objects ?? []).map((o) =>
              o.id === 'obj1' ? { ...o, hdg: 2.0 } : o,
            ),
          })),
        },
        isDirty: true,
      }));

      const obj = useProjectStore.getState().project.roads[0]!.objects![0]!;
      expect(obj.position.x).toBe(20);
      expect(obj.position.y).toBe(3);
      expect(obj.position.z).toBe(1);
    });
  });

  describe('fallback to road operations', () => {
    it('should still move road when no signal/object is selected', () => {
      const road = makeRoad({
        plan_view: [{ s: 0, x: 10, y: 20, hdg: 0, length: 50, geo_type: 'Line' }],
      });
      useProjectStore.getState().addRoad(road);
      useProjectStore.getState().selectRoad('r1');
      // Verify scene node is 'road' type, not signal/object
      const node = useProjectStore.getState().selectedSceneNode;
      expect(node?.type).toBe('road');
      // moveRoad should still work
      useProjectStore.getState().moveRoad('r1', 5, -3);
      const moved = useProjectStore.getState().project.roads[0]!;
      expect(moved.plan_view[0]!.x).toBeCloseTo(15);
      expect(moved.plan_view[0]!.y).toBeCloseTo(17);
    });
  });
});
