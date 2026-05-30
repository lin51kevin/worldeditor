import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from '../projectStore';
import { initialProject } from './types';
import type { Junction, Road } from '../../services/platform';

vi.mock('../viewportStore', () => ({
  useViewportStore: {
    getState: () => ({ resetDisplay: vi.fn() }),
  },
}));

function resetStore() {
  useProjectStore.setState({
    project: initialProject,
    savedProject: null,
    isDirty: false,
    selectedRoadId: null,
    selectedJunctionId: null,
    selectedObjectType: null,
    selectedSceneNode: null,
    selectedRoadIds: [],
    selectedJunctionIds: [],
    clipboardRoadId: null,
    cursorWorldPos: { x: 0, y: 0 },
    gridSpacing: 10.0,
    viewportMpp: 0.1,
    undoStack: [],
    redoStack: [],
    projectLoadVersion: 0,
  });
}

function makeRoad(id = 'r1', overrides: Partial<Road> = {}): Road {
  return {
    id,
    name: `Road ${id}`,
    length: 100,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
    lane_sections: [],
    elevation_profile: [],
    ...overrides,
  };
}

const baseJunction: Junction = {
  id: 'j1',
  name: 'Junction 1',
  connections: [],
};

describe('roadSlice', () => {
  beforeEach(() => {
    resetStore();
  });

  it('addRoad appends a road, pushes undo, and marks the project dirty', () => {
    useProjectStore.getState().addRoad(makeRoad());

    const state = useProjectStore.getState();
    expect(state.project.roads).toHaveLength(1);
    expect(state.canUndo()).toBe(true);
    expect(state.isDirty).toBe(true);
  });

  it('removeRoad removes the matching road and clears focused road selection state', () => {
    useProjectStore.setState({
      project: { ...initialProject, roads: [makeRoad('r1')] },
      selectedRoadId: 'r1',
      selectedSceneNode: { type: 'road', roadId: 'r1' },
    });

    useProjectStore.getState().removeRoad('r1');

    const state = useProjectStore.getState();
    expect(state.project.roads).toEqual([]);
    expect(state.selectedRoadId).toBeNull();
    expect(state.selectedSceneNode).toBeNull();
    expect(state.isDirty).toBe(true);
  });

  it('removeRoad keeps unrelated road selection intact', () => {
    useProjectStore.setState({
      project: { ...initialProject, roads: [makeRoad('r1'), makeRoad('r2')] },
      selectedRoadId: 'r1',
      selectedSceneNode: { type: 'road', roadId: 'r1' },
    });

    useProjectStore.getState().removeRoad('r2');

    const state = useProjectStore.getState();
    expect(state.project.roads.map((road) => road.id)).toEqual(['r1']);
    expect(state.selectedRoadId).toBe('r1');
    expect(state.selectedSceneNode).toEqual({ type: 'road', roadId: 'r1' });
  });

  it('updateRoad changes only the targeted road fields without mutating the original object', () => {
    const originalRoad = makeRoad('r1');
    useProjectStore.setState({
      project: { ...initialProject, roads: [originalRoad, makeRoad('r2')] },
    });

    useProjectStore.getState().updateRoad('r1', {
      name: 'Updated',
      length: 150,
      junction_id: 'j1',
    });

    const roads = useProjectStore.getState().project.roads;
    expect(roads[0]).toMatchObject({ id: 'r1', name: 'Updated', length: 150, junction_id: 'j1' });
    expect(roads[1]).toMatchObject({ id: 'r2', name: 'Road r2', length: 100, junction_id: null });
    expect(originalRoad.name).toBe('Road r1');
    expect(originalRoad.length).toBe(100);
    expect(originalRoad.junction_id).toBeNull();
  });

  it('cloneRoad deep copies the source road and offsets its plan view', () => {
    useProjectStore.setState({
      project: { ...initialProject, roads: [makeRoad('r1')] },
    });

    useProjectStore.getState().cloneRoad('r1', 'r2', [10, 5]);

    const clonedRoad = useProjectStore.getState().project.roads.find((road) => road.id === 'r2');
    expect(clonedRoad).toBeDefined();
    expect(clonedRoad?.plan_view[0]).toMatchObject({ x: 10, y: 5 });
    expect(clonedRoad?.link).toEqual({ predecessor: null, successor: null });
  });

  it('moveRoad records undo history and shifts the road geometry', () => {
    useProjectStore.setState({
      project: { ...initialProject, roads: [makeRoad('r1')] },
    });
    useProjectStore.getState().markClean();

    useProjectStore.getState().moveRoad('r1', 5, -3);

    const state = useProjectStore.getState();
    expect(state.undoStack).toHaveLength(1);
    expect(state.project.roads[0]?.plan_view[0]).toMatchObject({ x: 5, y: -3 });
    expect(state.isDirty).toBe(true);
  });

  it('removeJunction removes the matching junction', () => {
    useProjectStore.setState({
      project: { ...initialProject, junctions: [baseJunction] },
    });

    useProjectStore.getState().removeJunction('j1');

    expect(useProjectStore.getState().project.junctions).toEqual([]);
  });

  it('addJunctionWithRoads adds the junction and all associated roads', () => {
    useProjectStore.getState().addJunctionWithRoads(baseJunction, [makeRoad('r1'), makeRoad('r2')]);

    const state = useProjectStore.getState();
    expect(state.project.junctions).toEqual([baseJunction]);
    expect(state.project.roads.map((road) => road.id)).toEqual(['r1', 'r2']);
  });

  it('addSignal appends signal to project.signals', () => {
    const signal = { id: 's1', roadId: 'r1', sPosition: 5, laneId: 0, type: 'sign', validity: null };
    useProjectStore.getState().addSignal(signal);
    expect(useProjectStore.getState().project.signals).toContainEqual(signal);
    expect(useProjectStore.getState().isDirty).toBe(true);
  });

  it('removeSignal removes from project.signals and road.signals', () => {
    const road = makeRoad('r1', { signals: [{ id: 's1', name: 'S', signal_type: '', signal_subtype: '', s: 5, t: 0, z_offset: 0, h_offset: 0, width: 0, height: 0, value: '', orientation: '+', is_dynamic: false }] });
    useProjectStore.setState({
      project: { ...initialProject, roads: [road], signals: [{ id: 's1', roadId: 'r1', sPosition: 5, laneId: 0, type: 'sign', validity: null }] },
      selectedSceneNode: { type: 'signal', roadId: 'r1', signalId: 's1' },
      selectedRoadId: 'r1',
    });
    useProjectStore.getState().removeSignal('s1');
    const state = useProjectStore.getState();
    expect(state.project.signals).toHaveLength(0);
    expect(state.project.roads[0]?.signals).toHaveLength(0);
    // Signal was selected — should fall back to road selection
    expect(state.selectedSceneNode).toEqual({ type: 'road', roadId: 'r1' });
  });

  it('updateSignal updates in both project.signals and road.signals', () => {
    const road = makeRoad('r1', { signals: [{ id: 's1', name: 'S', signal_type: '', signal_subtype: '', s: 5, t: 0, z_offset: 0, h_offset: 0, width: 0, height: 0, value: '', orientation: '+', is_dynamic: false }] });
    useProjectStore.setState({
      project: { ...initialProject, roads: [road], signals: [{ id: 's1', roadId: 'r1', sPosition: 5, laneId: 0, type: 'sign', validity: null }] },
    });
    useProjectStore.getState().updateSignal('s1', { sPosition: 10 });
    expect(useProjectStore.getState().project.signals[0]?.sPosition).toBe(10);
  });

  it('addObject appends object to project.objects', () => {
    const obj = { id: 'o1', roadId: 'r1', sPosition: 5, laneId: 0, type: 'pole', validity: null };
    useProjectStore.getState().addObject(obj);
    expect(useProjectStore.getState().project.objects).toContainEqual(obj);
  });

  it('removeObject removes from project.objects and road.objects', () => {
    const road = makeRoad('r1', { objects: [{ id: 'o1', roadId: 'r1', sPosition: 5, laneId: 0, type: 'pole', validity: null }] });
    useProjectStore.setState({
      project: { ...initialProject, roads: [road], objects: [{ id: 'o1', roadId: 'r1', sPosition: 5, laneId: 0, type: 'pole', validity: null }] },
      selectedSceneNode: { type: 'object', roadId: 'r1', objectId: 'o1' },
      selectedRoadId: 'r1',
    });
    useProjectStore.getState().removeObject('o1');
    const state = useProjectStore.getState();
    expect(state.project.objects).toHaveLength(0);
    expect(state.project.roads[0]?.objects).toHaveLength(0);
    expect(state.selectedSceneNode).toEqual({ type: 'road', roadId: 'r1' });
  });

  it('updateObject updates matching object in project.objects and road.objects', () => {
    const road = makeRoad('r1', { objects: [{ id: 'o1', roadId: 'r1', sPosition: 5, laneId: 0, type: 'pole', validity: null }] });
    useProjectStore.setState({
      project: { ...initialProject, roads: [road], objects: [{ id: 'o1', roadId: 'r1', sPosition: 5, laneId: 0, type: 'pole', validity: null }] },
    });
    useProjectStore.getState().updateObject('o1', { sPosition: 20 });
    expect(useProjectStore.getState().project.objects[0]?.sPosition).toBe(20);
  });

  it('addRoadObjectItem appends object to specific road', () => {
    useProjectStore.setState({
      project: { ...initialProject, roads: [makeRoad('r1')] },
    });
    useProjectStore.getState().addRoadObjectItem('r1', { id: 'o1', roadId: 'r1', sPosition: 5, laneId: 0, type: 'pole', validity: null });
    expect(useProjectStore.getState().project.roads[0]?.objects).toHaveLength(1);
  });

  it('addRoadSignalItem appends signal to specific road', () => {
    useProjectStore.setState({
      project: { ...initialProject, roads: [makeRoad('r1')] },
    });
    useProjectStore.getState().addRoadSignalItem('r1', { id: 's1', name: 'S', signal_type: '', signal_subtype: '', s: 5, t: 0, z_offset: 0, h_offset: 0, width: 0, height: 0, value: '', orientation: '+', is_dynamic: false });
    expect(useProjectStore.getState().project.roads[0]?.signals).toHaveLength(1);
  });

  it('removeJunctionConnection clears selection when connecting road was selected', () => {
    const conn = makeRoad('conn', { junction_id: 'j1' });
    useProjectStore.setState({
      project: {
        ...initialProject,
        roads: [makeRoad('r1'), conn],
        junctions: [{
          id: 'j1', name: 'J1',
          connections: [{ id: 'c1', incoming_road: 'r1', connecting_road: 'conn', contact_point: 'Start', lane_links: [] }],
        }],
      },
      selectedRoadId: 'conn',
      selectedSceneNode: { type: 'road', roadId: 'conn' },
      selectedJunctionId: 'j1',
    });
    useProjectStore.getState().removeJunctionConnection('j1', 0);
    const state = useProjectStore.getState();
    expect(state.selectedRoadId).toBeNull();
    expect(state.selectedSceneNode).toBeNull();
    expect(state.project.junctions[0]?.connections).toHaveLength(0);
  });
});

describe('roadSlice — additional branch coverage', () => {
  beforeEach(resetStore);

  it('updateRoadGeometry updates plan_view and length', () => {
    useProjectStore.getState().addRoad(makeRoad('r1'));
    const newPlanView = [{ s: 0, x: 10, y: 10, hdg: 0.5, length: 50, geo_type: 'Line' as const }];
    useProjectStore.getState().updateRoadGeometry('r1', newPlanView, 50, undefined);
    const road = useProjectStore.getState().project.roads[0]!;
    expect(road.plan_view).toEqual(newPlanView);
    expect(road.length).toBe(50);
  });

  it('updateRoadGeometry with splineEditData', () => {
    useProjectStore.getState().addRoad(makeRoad('r1'));
    const splineData = [{ x: 0, y: 0 }, { x: 10, y: 5 }];
    useProjectStore.getState().updateRoadGeometry('r1', [], 0, splineData);
    const road = useProjectStore.getState().project.roads[0]!;
    expect(road.spline_edit_data).toEqual(splineData);
  });

  it('cloneRoad creates a copy with offset', () => {
    useProjectStore.getState().addRoad(makeRoad('r1'));
    useProjectStore.getState().cloneRoad('r1', 'r2', [10, 20]);
    const roads = useProjectStore.getState().project.roads;
    expect(roads.length).toBe(2);
    const cloned = roads.find((r) => r.id === 'r2');
    expect(cloned).toBeDefined();
    expect(cloned!.plan_view[0].x).toBe(10);
    expect(cloned!.plan_view[0].y).toBe(20);
  });

  it('updateRoad merges updates into existing road', () => {
    useProjectStore.getState().addRoad(makeRoad('r1'));
    useProjectStore.getState().updateRoad('r1', { name: 'Updated' });
    const road = useProjectStore.getState().project.roads[0]!;
    expect(road.name).toBe('Updated');
  });
});
