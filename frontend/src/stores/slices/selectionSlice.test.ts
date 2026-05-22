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

function makeRoad(id: string): Road {
  return {
    id,
    name: `Road ${id}`,
    length: 50,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 50, geo_type: 'Line' }],
    lane_sections: [],
    elevation_profile: [],
  };
}

function makeJunction(id: string): Junction {
  return {
    id,
    name: `Junction ${id}`,
    connections: [],
  };
}

describe('selectionSlice', () => {
  beforeEach(() => {
    resetStore();
  });

  it('selectRoad stores the selected road and clears other selection modes', () => {
    useProjectStore.setState({
      selectedJunctionId: 'j1',
      selectedObjectType: 'junction',
      selectedSceneNode: { type: 'junction', junctionId: 'j1' },
      selectedRoadIds: ['r2'],
      selectedJunctionIds: ['j2'],
    });

    useProjectStore.getState().selectRoad('r1');

    const state = useProjectStore.getState();
    expect(state.selectedRoadId).toBe('r1');
    expect(state.selectedJunctionId).toBeNull();
    expect(state.selectedObjectType).toBe('road');
    expect(state.selectedSceneNode).toEqual({ type: 'road', roadId: 'r1' });
    expect(state.selectedRoadIds).toEqual([]);
    expect(state.selectedJunctionIds).toEqual([]);
  });

  it('selectRoad(null) clears the focused road selection', () => {
    useProjectStore.getState().selectRoad('r1');

    useProjectStore.getState().selectRoad(null);

    const state = useProjectStore.getState();
    expect(state.selectedRoadId).toBeNull();
    expect(state.selectedObjectType).toBeNull();
    expect(state.selectedSceneNode).toBeNull();
  });

  it('selectJunction stores the selected junction and clears road selection', () => {
    useProjectStore.getState().selectRoad('r1');

    useProjectStore.getState().selectJunction('j1');

    const state = useProjectStore.getState();
    expect(state.selectedJunctionId).toBe('j1');
    expect(state.selectedRoadId).toBeNull();
    expect(state.selectedObjectType).toBe('junction');
    expect(state.selectedSceneNode).toEqual({ type: 'junction', junctionId: 'j1' });
  });

  it('selectMultiple tracks road and junction ids and clears focused selection', () => {
    useProjectStore.getState().selectRoad('r1');

    useProjectStore.getState().selectMultiple(['r1', 'r2'], ['j1']);

    const state = useProjectStore.getState();
    expect(state.selectedRoadIds).toEqual(['r1', 'r2']);
    expect(state.selectedJunctionIds).toEqual(['j1']);
    expect(state.selectedRoadId).toBeNull();
    expect(state.selectedJunctionId).toBeNull();
    expect(state.selectedObjectType).toBeNull();
    expect(state.selectedSceneNode).toBeNull();
  });

  it('stores selectedSceneNode for lane sections, lanes, signals, and objects', () => {
    const store = useProjectStore.getState();

    store.selectLaneSection('r1', 2);
    expect(useProjectStore.getState().selectedSceneNode).toEqual({
      type: 'laneSection',
      roadId: 'r1',
      sectionIndex: 2,
    });

    store.selectLane('r1', 1, 'left', 3);
    expect(useProjectStore.getState().selectedSceneNode).toEqual({
      type: 'lane',
      roadId: 'r1',
      sectionIndex: 1,
      side: 'left',
      laneId: 3,
    });

    store.selectSignal('r1', 'sig-1');
    expect(useProjectStore.getState().selectedSceneNode).toEqual({
      type: 'signal',
      roadId: 'r1',
      signalId: 'sig-1',
    });

    store.selectObject('r1', 'obj-1');
    const state = useProjectStore.getState();
    expect(state.selectedRoadId).toBe('r1');
    expect(state.selectedObjectType).toBe('road');
    expect(state.selectedSceneNode).toEqual({
      type: 'object',
      roadId: 'r1',
      objectId: 'obj-1',
    });
  });

  it('selectAll selects every road and junction in the current project', () => {
    useProjectStore.setState({
      project: {
        ...initialProject,
        roads: [makeRoad('r1'), makeRoad('r2')],
        junctions: [makeJunction('j1')],
      },
    });

    useProjectStore.getState().selectAll();

    const state = useProjectStore.getState();
    expect(state.selectedRoadIds).toEqual(['r1', 'r2']);
    expect(state.selectedJunctionIds).toEqual(['j1']);
  });

  it('deleteSelected removes multi-selected roads and junctions first', () => {
    useProjectStore.setState({
      project: {
        ...initialProject,
        roads: [makeRoad('r1'), makeRoad('r2')],
        junctions: [makeJunction('j1'), makeJunction('j2')],
      },
    });
    useProjectStore.getState().selectMultiple(['r2'], ['j1']);

    useProjectStore.getState().deleteSelected();

    const state = useProjectStore.getState();
    expect(state.project.roads.map((road) => road.id)).toEqual(['r1']);
    expect(state.project.junctions.map((junction) => junction.id)).toEqual(['j2']);
    expect(state.selectedRoadIds).toEqual([]);
    expect(state.selectedJunctionIds).toEqual([]);
    expect(state.isDirty).toBe(true);
  });

  it('deleteSelected removes the focused road selection', () => {
    useProjectStore.setState({
      project: { ...initialProject, roads: [makeRoad('r1')] },
    });
    useProjectStore.getState().selectRoad('r1');

    useProjectStore.getState().deleteSelected();

    const state = useProjectStore.getState();
    expect(state.project.roads).toEqual([]);
    expect(state.selectedRoadId).toBeNull();
    expect(state.selectedSceneNode).toBeNull();
  });

  it('duplicateSelected clones the selected road with a unique id and selects the clone', () => {
    useProjectStore.setState({
      project: {
        ...initialProject,
        roads: [makeRoad('r1'), makeRoad('r1_copy1')],
      },
    });
    useProjectStore.getState().selectRoad('r1');

    useProjectStore.getState().duplicateSelected();

    const state = useProjectStore.getState();
    expect(state.project.roads.map((road) => road.id)).toContain('r1_copy2');
    expect(state.selectedRoadId).toBe('r1_copy2');
    expect(state.selectedSceneNode).toEqual({ type: 'road', roadId: 'r1_copy2' });
  });

  it('duplicateSelected is a no-op when no road is selected', () => {
    const before = useProjectStore.getState().project;

    useProjectStore.getState().duplicateSelected();

    expect(useProjectStore.getState().project).toBe(before);
  });

  it('copySelected and pasteFromClipboard duplicate the selected road', () => {
    useProjectStore.setState({
      project: {
        ...initialProject,
        roads: [makeRoad('r1'), makeRoad('r1_copy1')],
      },
    });
    useProjectStore.getState().selectRoad('r1');

    useProjectStore.getState().copySelected();
    useProjectStore.getState().pasteFromClipboard();

    const state = useProjectStore.getState();
    expect(state.clipboardRoadId).toBe('r1');
    expect(state.project.roads.map((road) => road.id)).toContain('r1_copy2');
    expect(state.selectedRoadId).toBe('r1_copy2');
  });

  it('copySelected and pasteFromClipboard are safe no-ops without a selected road', () => {
    const before = useProjectStore.getState().project;

    useProjectStore.getState().copySelected();
    useProjectStore.getState().pasteFromClipboard();

    const state = useProjectStore.getState();
    expect(state.clipboardRoadId).toBeNull();
    expect(state.project).toBe(before);
  });
});
