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
});
