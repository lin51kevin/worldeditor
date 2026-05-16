import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';
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

describe('projectStore', () => {
  beforeEach(() => {
    useProjectStore.getState().reset();
  });

  describe('updateRoad', () => {
    it('should update road name', () => {
      const store = useProjectStore.getState();
      store.addRoad(makeRoad());
      useProjectStore.getState().updateRoad('r1', { name: 'New Name' });
      const road = useProjectStore.getState().project.roads[0]!;
      expect(road.name).toBe('New Name');
    });

    it('should push undo on update', () => {
      useProjectStore.getState().addRoad(makeRoad());
      useProjectStore.getState().updateRoad('r1', { name: 'X' });
      expect(useProjectStore.getState().canUndo()).toBe(true);
    });
  });

  describe('updateJunction', () => {
    it('should update junction name', () => {
      useProjectStore.setState((s) => ({
        project: {
          ...s.project,
          junctions: [{ id: 'j1', name: 'Old', type: 'default', x: 0, y: 0, z: 0, connections: [], laneLinks: [] }],
        },
      }));
      useProjectStore.getState().updateJunction('j1', { name: 'New' });
      const j = useProjectStore.getState().project.junctions[0]!;
      expect(j.name).toBe('New');
    });
  });

  describe('Signal CRUD', () => {
    it('should add and remove signals', () => {
      const store = useProjectStore.getState();
      store.addSignal({ id: 's1', name: '', s: 10, t: 0, z_offset: 0, h_offset: 0, width: 1, height: 2, signal_type: 'traffic_light', signal_subtype: '-1', value: null, orientation: '+', is_dynamic: false });
      expect(useProjectStore.getState().project.signals!.length).toBe(1);
      store.removeSignal('s1');
      expect(useProjectStore.getState().project.signals!.length).toBe(0);
    });

    it('should update signal', () => {
      useProjectStore.getState().addSignal({ id: 's1', name: '', s: 10, t: 0, z_offset: 0, h_offset: 0, width: 1, height: 2, signal_type: 'traffic_light', signal_subtype: '-1', value: null, orientation: '+', is_dynamic: false });
      useProjectStore.getState().updateSignal('s1', { signal_type: 'stop_sign' });
      const sig = useProjectStore.getState().project.signals![0]!;
      expect(sig.signal_type).toBe('stop_sign');
    });
  });

  describe('Object CRUD', () => {
    it('should add and remove objects', () => {
      useProjectStore.getState().addObject({ id: 'o1', roadId: 'r1', sPosition: 20, laneId: -1, type: 'pole', validity: '' });
      expect(useProjectStore.getState().project.objects!.length).toBe(1);
      useProjectStore.getState().removeObject('o1');
      expect(useProjectStore.getState().project.objects!.length).toBe(0);
    });

    it('should update object', () => {
      useProjectStore.getState().addObject({ id: 'o1', roadId: 'r1', sPosition: 20, laneId: -1, type: 'pole', validity: '' });
      useProjectStore.getState().updateObject('o1', { type: 'tree' });
      const obj = useProjectStore.getState().project.objects![0]!;
      expect(obj.type).toBe('tree');
    });
  });

  describe('Lane editing', () => {
    it('should update lane type', () => {
      const road = makeRoad({
        lane_sections: [{
          s: 0,
          single_side: false,
          left: [{ id: 1, lane_type: 'driving', level: 0, link: { predecessor: null, successor: null }, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] }],
          center: [],
          right: [],
        }],
      });
      useProjectStore.getState().addRoad(road);
      useProjectStore.getState().updateLaneType('r1', 0, 'left', 1, 'shoulder');
      const lane = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.left[0] as any;
      expect(lane.lane_type).toBe('shoulder');
    });

    it('should update lane width', () => {
      const road = makeRoad({
        lane_sections: [{
          s: 0, single_side: false,
          left: [{ id: 1, lane_type: 'driving', level: 0, link: { predecessor: null, successor: null }, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] }],
          center: [], right: [],
        }],
      });
      useProjectStore.getState().addRoad(road);
      useProjectStore.getState().updateLaneWidth('r1', 0, 'left', 1, { s_offset: 0, a: 4.0, b: 0, c: 0, d: 0 });
      const lane = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.left[0] as any;
      expect(lane.width[0].a).toBe(4.0);
    });
  });

  describe('Elevation editing', () => {
    it('should add elevation point and keep s sorted', () => {
      useProjectStore.getState().addRoad(makeRoad({
        elevation_profile: [
          { s: 0, a: 0, b: 0, c: 0, d: 0 },
          { s: 100, a: 10, b: 0, c: 0, d: 0 },
        ],
      }));

      useProjectStore.getState().addElevationPoint('r1', 50, 5);

      const profile = useProjectStore.getState().project.roads[0]!.elevation_profile;
      expect(profile).toHaveLength(3);
      expect(profile.map((p) => p.s)).toEqual([0, 50, 100]);
      expect(useProjectStore.getState().canUndo()).toBe(true);
    });

    it('should update elevation point by index', () => {
      useProjectStore.getState().addRoad(makeRoad({
        elevation_profile: [{ s: 0, a: 0, b: 0, c: 0, d: 0 }],
      }));

      useProjectStore.getState().updateElevationPoint('r1', 0, { a: 2.5 });

      const profile = useProjectStore.getState().project.roads[0]!.elevation_profile;
      expect(profile[0]!.a).toBe(2.5);
    });

    it('should remove elevation point by index', () => {
      useProjectStore.getState().addRoad(makeRoad({
        elevation_profile: [
          { s: 0, a: 0, b: 0, c: 0, d: 0 },
          { s: 50, a: 5, b: 0, c: 0, d: 0 },
        ],
      }));

      useProjectStore.getState().removeElevationPoint('r1', 1);

      const profile = useProjectStore.getState().project.roads[0]!.elevation_profile;
      expect(profile).toHaveLength(1);
      expect(profile[0]!.s).toBe(0);
    });

    it('should smooth interior elevation points', () => {
      useProjectStore.getState().addRoad(makeRoad({
        elevation_profile: [
          { s: 0, a: 0, b: 0, c: 0, d: 0 },
          { s: 50, a: 9, b: 0, c: 0, d: 0 },
          { s: 100, a: 0, b: 0, c: 0, d: 0 },
        ],
      }));

      useProjectStore.getState().smoothElevation('r1', 1);

      const profile = useProjectStore.getState().project.roads[0]!.elevation_profile;
      expect(profile[1]!.a).toBeCloseTo(3, 5);
      expect(profile[0]!.a).toBe(0);
      expect(profile[2]!.a).toBe(0);
    });
  });

  describe('cursorWorldPos', () => {
    it('should update cursor position', () => {
      useProjectStore.getState().setCursorWorldPos({ x: 100, y: 200 });
      const pos = useProjectStore.getState().cursorWorldPos;
      expect(pos.x).toBe(100);
      expect(pos.y).toBe(200);
    });

    it('should reset to zero on store reset', () => {
      useProjectStore.getState().setCursorWorldPos({ x: 100, y: 200 });
      useProjectStore.getState().reset();
      const pos = useProjectStore.getState().cursorWorldPos;
      expect(pos.x).toBe(0);
      expect(pos.y).toBe(0);
    });
  });

  describe('selectMultiple', () => {
    it('should set selectedRoadIds and selectedJunctionIds', () => {
      useProjectStore.getState().selectMultiple(['r1', 'r2'], ['j1']);
      const { selectedRoadIds, selectedJunctionIds } = useProjectStore.getState();
      expect(selectedRoadIds).toEqual(['r1', 'r2']);
      expect(selectedJunctionIds).toEqual(['j1']);
    });

    it('should clear single selection when selecting multiple', () => {
      useProjectStore.getState().selectRoad('r1');
      useProjectStore.getState().selectMultiple(['r2', 'r3'], []);
      const { selectedRoadId, selectedJunctionId } = useProjectStore.getState();
      expect(selectedRoadId).toBeNull();
      expect(selectedJunctionId).toBeNull();
    });

    it('should clear multi-selection when selecting a single road', () => {
      useProjectStore.getState().selectMultiple(['r1', 'r2'], ['j1']);
      useProjectStore.getState().selectRoad('r3');
      const { selectedRoadIds, selectedJunctionIds } = useProjectStore.getState();
      expect(selectedRoadIds).toEqual([]);
      expect(selectedJunctionIds).toEqual([]);
    });

    it('should clear multi-selection when selecting a single junction', () => {
      useProjectStore.getState().selectMultiple(['r1'], ['j1', 'j2']);
      useProjectStore.getState().selectJunction('j3');
      const { selectedRoadIds, selectedJunctionIds } = useProjectStore.getState();
      expect(selectedRoadIds).toEqual([]);
      expect(selectedJunctionIds).toEqual([]);
    });

    it('should clear multi-selection on reset', () => {
      useProjectStore.getState().selectMultiple(['r1'], ['j1']);
      useProjectStore.getState().reset();
      const { selectedRoadIds, selectedJunctionIds } = useProjectStore.getState();
      expect(selectedRoadIds).toEqual([]);
      expect(selectedJunctionIds).toEqual([]);
    });
  });

  describe('undo/redo isolation', () => {
    it('should not mutate project stored in undo stack', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1', name: 'Original' }));
      useProjectStore.getState().updateRoad('r1', { name: 'Modified' });
      useProjectStore.getState().undo();
      const road = useProjectStore.getState().project.roads[0]!;
      expect(road.name).toBe('Original');
    });

    it('should not mutate project stored in redo stack', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1', name: 'V1' }));
      useProjectStore.getState().updateRoad('r1', { name: 'V2' });
      useProjectStore.getState().undo();
      // Redo should correctly restore V2
      useProjectStore.getState().redo();
      const road = useProjectStore.getState().project.roads[0]!;
      expect(road.name).toBe('V2');
    });

    it('should deep clone project when pushing to undo stack', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1', name: 'Original' }));
      useProjectStore.getState().addRoad(makeRoad({ id: 'r2', name: 'Road2' }));
      useProjectStore.getState().updateRoad('r1', { name: 'Modified R1' });
      useProjectStore.getState().updateRoad('r2', { name: 'Modified R2' });
      useProjectStore.getState().undo();
      useProjectStore.getState().undo();
      const roads = useProjectStore.getState().project.roads;
      expect(roads.find(r => r.id === 'r1')!.name).toBe('Original');
      expect(roads.find(r => r.id === 'r2')!.name).toBe('Road2');
    });
  });

  describe('scene selection', () => {
    it('should select lane sections while keeping the parent road selected', () => {
      useProjectStore.getState().selectLaneSection('r1', 2);
      const state = useProjectStore.getState();

      expect(state.selectedRoadId).toBe('r1');
      expect(state.selectedSceneNode).toEqual({ type: 'laneSection', roadId: 'r1', sectionIndex: 2 });
      expect(state.selectedObjectType).toBe('road');
    });

    it('should select lanes while keeping the parent road selected', () => {
      useProjectStore.getState().selectLane('r1', 1, 'right', -2);
      const state = useProjectStore.getState();

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

  describe('store selectors', () => {
    it('should return stable undo function reference', () => {
      const fn1 = useProjectStore.getState().undo;
      const fn2 = useProjectStore.getState().undo;
      expect(fn1).toBe(fn2);
    });

    it('should return stable redo function reference', () => {
      const fn1 = useProjectStore.getState().redo;
      const fn2 = useProjectStore.getState().redo;
      expect(fn1).toBe(fn2);
    });
  });

  describe('removeJunction', () => {
    const makeJunction = () => ({
      id: 'j1',
      name: 'J1',
      type: 'default' as const,
      x: 0,
      y: 0,
      z: 0,
      connections: [],
      laneLinks: [],
    });

    it('should remove junction by id', () => {
      useProjectStore.setState((s) => ({
        project: { ...s.project, junctions: [makeJunction()] },
      }));
      useProjectStore.getState().removeJunction('j1');
      expect(useProjectStore.getState().project.junctions).toHaveLength(0);
    });

    it('should push undo when removing junction', () => {
      useProjectStore.setState((s) => ({
        project: { ...s.project, junctions: [makeJunction()] },
      }));
      useProjectStore.getState().removeJunction('j1');
      expect(useProjectStore.getState().canUndo()).toBe(true);
    });

    it('should clear selectedJunctionId when removing the selected junction', () => {
      useProjectStore.setState((s) => ({
        project: { ...s.project, junctions: [makeJunction()] },
        selectedJunctionId: 'j1',
        selectedObjectType: 'junction',
        selectedSceneNode: { type: 'junction', junctionId: 'j1' },
      }));
      useProjectStore.getState().removeJunction('j1');
      expect(useProjectStore.getState().selectedJunctionId).toBeNull();
    });

    it('should mark project as dirty', () => {
      useProjectStore.setState((s) => ({
        project: { ...s.project, junctions: [makeJunction()] },
      }));
      useProjectStore.getState().removeJunction('j1');
      expect(useProjectStore.getState().isDirty).toBe(true);
    });
  });

  describe('deleteSelected', () => {
    const makeJunction = () => ({
      id: 'j1',
      name: 'J1',
      type: 'default' as const,
      x: 0,
      y: 0,
      z: 0,
      connections: [],
      laneLinks: [],
    });

    it('should delete the selected single road', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1' }));
      useProjectStore.getState().selectRoad('r1');
      useProjectStore.getState().deleteSelected();
      expect(useProjectStore.getState().project.roads).toHaveLength(0);
      expect(useProjectStore.getState().selectedRoadId).toBeNull();
    });

    it('should delete the selected single junction', () => {
      useProjectStore.setState((s) => ({
        project: { ...s.project, junctions: [makeJunction()] },
        selectedJunctionId: 'j1',
      }));
      useProjectStore.getState().deleteSelected();
      expect(useProjectStore.getState().project.junctions).toHaveLength(0);
      expect(useProjectStore.getState().selectedJunctionId).toBeNull();
    });

    it('should delete all multi-selected roads and junctions', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1' }));
      useProjectStore.getState().addRoad(makeRoad({ id: 'r2' }));
      useProjectStore.setState((s) => ({
        project: { ...s.project, junctions: [makeJunction()] },
      }));
      useProjectStore.getState().selectMultiple(['r1', 'r2'], ['j1']);
      useProjectStore.getState().deleteSelected();
      expect(useProjectStore.getState().project.roads).toHaveLength(0);
      expect(useProjectStore.getState().project.junctions).toHaveLength(0);
      expect(useProjectStore.getState().selectedRoadIds).toEqual([]);
      expect(useProjectStore.getState().selectedJunctionIds).toEqual([]);
    });

    it('should do nothing when nothing is selected', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1' }));
      useProjectStore.getState().deleteSelected();
      expect(useProjectStore.getState().project.roads).toHaveLength(1);
    });
  });

  describe('selectAll', () => {
    const makeJunction = (id = 'j1') => ({
      id,
      name: id,
      type: 'default' as const,
      x: 0,
      y: 0,
      z: 0,
      connections: [],
      laneLinks: [],
    });

    it('should select all roads and junctions', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1' }));
      useProjectStore.getState().addRoad(makeRoad({ id: 'r2' }));
      useProjectStore.setState((s) => ({
        project: { ...s.project, junctions: [makeJunction('j1')] },
      }));
      useProjectStore.getState().selectAll();
      expect(useProjectStore.getState().selectedRoadIds).toEqual(['r1', 'r2']);
      expect(useProjectStore.getState().selectedJunctionIds).toEqual(['j1']);
    });

    it('should work with an empty project', () => {
      useProjectStore.getState().selectAll();
      expect(useProjectStore.getState().selectedRoadIds).toEqual([]);
      expect(useProjectStore.getState().selectedJunctionIds).toEqual([]);
    });
  });

  describe('duplicateSelected', () => {
    it('should clone the selected road', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1' }));
      useProjectStore.getState().selectRoad('r1');
      useProjectStore.getState().duplicateSelected();
      expect(useProjectStore.getState().project.roads).toHaveLength(2);
    });

    it('should select the newly cloned road', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1' }));
      useProjectStore.getState().selectRoad('r1');
      useProjectStore.getState().duplicateSelected();
      const newId = useProjectStore.getState().selectedRoadId;
      expect(newId).not.toBeNull();
      expect(newId).not.toBe('r1');
    });

    it('should generate a unique ID even when default copy name already exists', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1' }));
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1_copy1' }));
      useProjectStore.getState().selectRoad('r1');
      useProjectStore.getState().duplicateSelected();
      const roads = useProjectStore.getState().project.roads;
      expect(roads.map((r) => r.id)).toContain('r1_copy2');
    });

    it('should push undo', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1' }));
      useProjectStore.getState().selectRoad('r1');
      const undoBefore = useProjectStore.getState().undoStack.length;
      useProjectStore.getState().duplicateSelected();
      expect(useProjectStore.getState().undoStack.length).toBeGreaterThan(undoBefore);
    });

    it('should do nothing when no road is selected', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1' }));
      useProjectStore.getState().duplicateSelected();
      expect(useProjectStore.getState().project.roads).toHaveLength(1);
    });
  });

  describe('copySelected / pasteFromClipboard', () => {
    it('copySelected sets clipboardRoadId to the selected road', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1' }));
      useProjectStore.getState().selectRoad('r1');
      useProjectStore.getState().copySelected();
      expect(useProjectStore.getState().clipboardRoadId).toBe('r1');
    });

    it('copySelected does nothing when no road is selected', () => {
      useProjectStore.getState().copySelected();
      expect(useProjectStore.getState().clipboardRoadId).toBeNull();
    });

    it('pasteFromClipboard clones the clipboard road and selects the copy', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1' }));
      useProjectStore.getState().selectRoad('r1');
      useProjectStore.getState().copySelected();
      useProjectStore.getState().pasteFromClipboard();
      expect(useProjectStore.getState().project.roads).toHaveLength(2);
      expect(useProjectStore.getState().selectedRoadId).not.toBe('r1');
    });

    it('pasteFromClipboard does nothing when clipboard is empty', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1' }));
      useProjectStore.getState().pasteFromClipboard();
      expect(useProjectStore.getState().project.roads).toHaveLength(1);
    });

    it('pasteFromClipboard pushes undo', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1' }));
      useProjectStore.getState().selectRoad('r1');
      useProjectStore.getState().copySelected();
      const undoBefore = useProjectStore.getState().undoStack.length;
      useProjectStore.getState().pasteFromClipboard();
      expect(useProjectStore.getState().undoStack.length).toBeGreaterThan(undoBefore);
    });
  });

  describe('moveRoad', () => {
    it('should translate all plan_view geometry by (dx, dy)', () => {
      const road = makeRoad({
        plan_view: [
          { s: 0, x: 10, y: 20, hdg: 0, length: 50, geo_type: 'Line' },
          { s: 50, x: 60, y: 20, hdg: 0, length: 50, geo_type: 'Line' },
        ],
      });
      useProjectStore.getState().addRoad(road);
      useProjectStore.getState().moveRoad('r1', 5, -3);
      const moved = useProjectStore.getState().project.roads[0]!;
      expect(moved.plan_view[0]!.x).toBeCloseTo(15);
      expect(moved.plan_view[0]!.y).toBeCloseTo(17);
      expect(moved.plan_view[1]!.x).toBeCloseTo(65);
      expect(moved.plan_view[1]!.y).toBeCloseTo(17);
    });

    it('should not change heading or length when moving', () => {
      const road = makeRoad({
        plan_view: [{ s: 0, x: 0, y: 0, hdg: 1.0, length: 100, geo_type: 'Line' }],
      });
      useProjectStore.getState().addRoad(road);
      useProjectStore.getState().moveRoad('r1', 10, 10);
      const seg = useProjectStore.getState().project.roads[0]!.plan_view[0]!;
      expect(seg.hdg).toBeCloseTo(1.0);
      expect(seg.length).toBeCloseTo(100);
    });

    it('should push undo on moveRoad', () => {
      useProjectStore.getState().addRoad(makeRoad({
        plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }],
      }));
      useProjectStore.getState().moveRoad('r1', 1, 1);
      expect(useProjectStore.getState().canUndo()).toBe(true);
    });

    it('should do nothing when road id not found', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1' }));
      const before = useProjectStore.getState().project.roads[0];
      useProjectStore.getState().moveRoad('nonexistent', 10, 10);
      expect(useProjectStore.getState().project.roads[0]).toBe(before);
    });
  });

  describe('rotateRoad', () => {
    it('should rotate plan_view geometry around the given pivot', () => {
      // Road starting at (10, 0), pivot at origin → rotated 90° → should be at (0, 10)
      const road = makeRoad({
        plan_view: [{ s: 0, x: 10, y: 0, hdg: 0, length: 10, geo_type: 'Line' }],
      });
      useProjectStore.getState().addRoad(road);
      useProjectStore.getState().rotateRoad('r1', Math.PI / 2, 0, 0);
      const seg = useProjectStore.getState().project.roads[0]!.plan_view[0]!;
      expect(seg.x).toBeCloseTo(0, 5);
      expect(seg.y).toBeCloseTo(10, 5);
    });

    it('should add angle delta to segment headings', () => {
      const road = makeRoad({
        plan_view: [{ s: 0, x: 10, y: 0, hdg: 0, length: 10, geo_type: 'Line' }],
      });
      useProjectStore.getState().addRoad(road);
      useProjectStore.getState().rotateRoad('r1', Math.PI / 4, 0, 0);
      const seg = useProjectStore.getState().project.roads[0]!.plan_view[0]!;
      expect(seg.hdg).toBeCloseTo(Math.PI / 4, 5);
    });

    it('should push undo on rotateRoad', () => {
      useProjectStore.getState().addRoad(makeRoad({
        plan_view: [{ s: 0, x: 10, y: 0, hdg: 0, length: 10, geo_type: 'Line' }],
      }));
      useProjectStore.getState().rotateRoad('r1', 0.1, 0, 0);
      expect(useProjectStore.getState().canUndo()).toBe(true);
    });

    it('should do nothing when road id not found', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1' }));
      const before = useProjectStore.getState().project.roads[0];
      useProjectStore.getState().rotateRoad('nonexistent', 1.0, 0, 0);
      expect(useProjectStore.getState().project.roads[0]).toBe(before);
    });
  });

  describe('executePluginCommand', () => {
    it('applies the execute function and updates the project', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1' }));
      useProjectStore.getState().executePluginCommand(
        'Add road via plugin',
        (project) => ({ ...project, roads: [...project.roads, makeRoad({ id: 'r2' })] }),
      );
      expect(useProjectStore.getState().project.roads).toHaveLength(2);
    });

    it('pushes the previous project onto undo stack', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1' }));
      const undoBefore = useProjectStore.getState().undoStack.length;
      useProjectStore.getState().executePluginCommand(
        'Plugin edit',
        (project) => ({ ...project, name: 'Changed' }),
      );
      expect(useProjectStore.getState().undoStack.length).toBeGreaterThan(undoBefore);
    });

    it('can undo a plugin command', () => {
      useProjectStore.getState().addRoad(makeRoad({ id: 'r1' }));
      useProjectStore.getState().executePluginCommand(
        'Add road',
        (project) => ({ ...project, roads: [...project.roads, makeRoad({ id: 'r2' })] }),
      );
      expect(useProjectStore.getState().project.roads).toHaveLength(2);
      useProjectStore.getState().undo();
      expect(useProjectStore.getState().project.roads).toHaveLength(1);
    });

    it('marks the project dirty after execution', () => {
      useProjectStore.getState().markClean();
      useProjectStore.getState().executePluginCommand(
        'Plugin dirty',
        (project) => ({ ...project, name: 'Dirty' }),
      );
      expect(useProjectStore.getState().isDirty).toBe(true);
    });
  });
});

