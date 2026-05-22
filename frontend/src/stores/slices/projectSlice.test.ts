import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from '../projectStore';
import { initialProject } from './types';
import type { Project, Road } from '../../services/platform';

const { resetDisplayMock } = vi.hoisted(() => ({
  resetDisplayMock: vi.fn(),
}));

vi.mock('../viewportStore', () => ({
  useViewportStore: {
    getState: () => ({ resetDisplay: resetDisplayMock }),
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

function makeRoad(id = 'r1'): Road {
  return {
    id,
    name: `Road ${id}`,
    length: 25,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [],
    lane_sections: [],
    elevation_profile: [],
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    name: 'Test Project',
    header: {
      rev_major: 1,
      rev_minor: 6,
      name: '',
      date: '',
      north: 0,
      south: 0,
      east: 0,
      west: 0,
      geo_reference: null,
    },
    roads: [],
    junctions: [],
    signals: [],
    objects: [],
    ...overrides,
  };
}

describe('projectSlice', () => {
  beforeEach(() => {
    resetStore();
    resetDisplayMock.mockClear();
  });

  it('sets the project, saved snapshot, and load version', () => {
    useProjectStore.getState().addRoad(makeRoad('stale'));
    useProjectStore.getState().markDirty();
    const nextProject = makeProject({ name: 'Loaded', roads: [makeRoad('r1')] });

    useProjectStore.getState().setProject(nextProject);

    const state = useProjectStore.getState();
    expect(state.project).toEqual(nextProject);
    expect(state.savedProject).toBe(nextProject);
    expect(state.isDirty).toBe(false);
    expect(state.undoStack).toEqual([]);
    expect(state.redoStack).toEqual([]);
    expect(state.projectLoadVersion).toBe(1);
    expect(resetDisplayMock).toHaveBeenCalledTimes(1);
  });

  it('marks dirty and markClean snapshots the current project', () => {
    useProjectStore.getState().setProject(makeProject({ name: 'Saved' }));
    useProjectStore.setState((state) => ({
      project: { ...state.project, name: 'Draft' },
    }));

    useProjectStore.getState().markDirty();
    expect(useProjectStore.getState().isDirty).toBe(true);

    useProjectStore.getState().markClean();
    const state = useProjectStore.getState();
    expect(state.isDirty).toBe(false);
    expect(state.savedProject?.name).toBe('Draft');
    expect(state.savedProject).toBe(state.project);
  });

  it('updates cursorWorldPos and ignores identical coordinates', () => {
    useProjectStore.getState().setCursorWorldPos({ x: 5, y: 10 });
    const firstReference = useProjectStore.getState().cursorWorldPos;

    useProjectStore.getState().setCursorWorldPos({ x: 5, y: 10 });

    expect(useProjectStore.getState().cursorWorldPos).toBe(firstReference);
    expect(useProjectStore.getState().cursorWorldPos).toEqual({ x: 5, y: 10 });
  });

  it('updates viewport info and leaves identical values unchanged', () => {
    useProjectStore.getState().setViewportInfo({ gridSpacing: 20, mpp: 0.5 });
    const stateAfterFirstUpdate = useProjectStore.getState();

    useProjectStore.getState().setViewportInfo({ gridSpacing: 20, mpp: 0.5 });

    const state = useProjectStore.getState();
    expect(state.gridSpacing).toBe(20);
    expect(state.viewportMpp).toBe(0.5);
    expect(state.gridSpacing).toBe(stateAfterFirstUpdate.gridSpacing);
    expect(state.viewportMpp).toBe(stateAfterFirstUpdate.viewportMpp);
  });

  it('reset clears project, view state, selection state, and history', () => {
    useProjectStore.getState().setProject(makeProject({ roads: [makeRoad('r1')] }));
    useProjectStore.getState().selectRoad('r1');
    useProjectStore.getState().copySelected();
    useProjectStore.getState().setCursorWorldPos({ x: 8, y: 9 });
    useProjectStore.getState().setViewportInfo({ gridSpacing: 25, mpp: 0.25 });
    useProjectStore.getState().addRoad(makeRoad('r2'));

    useProjectStore.getState().reset();

    const state = useProjectStore.getState();
    expect(state.project).toEqual(initialProject);
    expect(state.isDirty).toBe(false);
    expect(state.selectedRoadId).toBeNull();
    expect(state.selectedJunctionId).toBeNull();
    expect(state.selectedSceneNode).toBeNull();
    expect(state.selectedRoadIds).toEqual([]);
    expect(state.selectedJunctionIds).toEqual([]);
    expect(state.clipboardRoadId).toBeNull();
    expect(state.undoStack).toEqual([]);
    expect(state.redoStack).toEqual([]);
    expect(state.cursorWorldPos).toEqual({ x: 0, y: 0 });
    expect(state.gridSpacing).toBe(10.0);
    expect(state.viewportMpp).toBe(0.1);
    expect(state.projectLoadVersion).toBe(2);
    expect(resetDisplayMock).toHaveBeenCalledTimes(2);
  });

  it('resetToSaved restores the saved project and clears transient selection/history state', () => {
    const savedProject = makeProject({ roads: [makeRoad('saved-road')] });
    useProjectStore.getState().setProject(savedProject);
    useProjectStore.getState().addRoad(makeRoad('temp-road'));
    useProjectStore.getState().selectRoad('temp-road');
    useProjectStore.getState().selectMultiple(['temp-road'], []);

    useProjectStore.getState().resetToSaved();

    const state = useProjectStore.getState();
    expect(state.project).toBe(savedProject);
    expect(state.project.roads.map((road) => road.id)).toEqual(['saved-road']);
    expect(state.isDirty).toBe(false);
    expect(state.undoStack).toEqual([]);
    expect(state.redoStack).toEqual([]);
    expect(state.selectedRoadId).toBeNull();
    expect(state.selectedJunctionId).toBeNull();
    expect(state.selectedObjectType).toBeNull();
    expect(state.selectedSceneNode).toBeNull();
    expect(state.selectedRoadIds).toEqual([]);
    expect(state.selectedJunctionIds).toEqual([]);
  });

  it('resetToSaved is a no-op when no saved project exists', () => {
    const before = useProjectStore.getState();

    useProjectStore.getState().resetToSaved();

    const after = useProjectStore.getState();
    expect(after.project).toBe(before.project);
    expect(after.savedProject).toBeNull();
    expect(after.projectLoadVersion).toBe(before.projectLoadVersion);
  });
});
