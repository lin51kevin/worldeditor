import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerToolbarButton = vi.fn();
const registerMenuItem = vi.fn();
const unregisterPlugin = vi.fn();

const projectState = {
  selectedRoadId: 'road-1' as string | null,
  project: {} as Record<string, unknown>,
  cloneRoad: vi.fn(),
  reverseRoad: vi.fn(),
  mirrorRoad: vi.fn(),
  optimizeRoad: vi.fn(),
  swapCenterline: vi.fn(),
};

const viewportState = {
  editMode: 'default',
  clearSplineKnots: vi.fn(),
  setEditMode: vi.fn((mode: string) => {
    viewportState.editMode = mode;
  }),
};

vi.mock('../../../stores/pluginContribStore', () => ({
  usePluginContribStore: {
    getState: vi.fn(() => ({
      registerToolbarButton,
      registerMenuItem,
      unregisterPlugin,
    })),
  },
}));

vi.mock('../../../stores/projectStore', () => ({
  useProjectStore: {
    getState: vi.fn(() => projectState),
  },
}));

vi.mock('../../../stores/viewportStore', () => ({
  useViewportStore: {
    getState: vi.fn(() => viewportState),
  },
}));

import { mountRoadToolsPlugin } from './road-tools.plugin';

function makeProject(leftLaneIds: number[] = [2, 4], rightLaneIds: number[] = [-1]) {
  return {
    name: 'Road Tools',
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
    roads: [
      {
        id: 'road-1',
        lane_sections: [
          {
            left: leftLaneIds.map((id) => ({ id })),
            right: rightLaneIds.map((id) => ({ id })),
          },
        ],
      },
    ],
    junctions: [],
    signals: [],
    objects: [],
  };
}

function getMenuItem(id: string) {
  return registerMenuItem.mock.calls.map(([item]) => item).find((item) => item.id === id);
}

describe('road-tools.plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectState.selectedRoadId = 'road-1';
    projectState.project = makeProject();
    projectState.cloneRoad = vi.fn();
    projectState.reverseRoad = vi.fn();
    projectState.mirrorRoad = vi.fn();
    projectState.optimizeRoad = vi.fn();
    projectState.swapCenterline = vi.fn();
    viewportState.editMode = 'default';
    viewportState.clearSplineKnots = vi.fn();
    viewportState.setEditMode = vi.fn((mode: string) => {
      viewportState.editMode = mode;
    });
  });

  it('mounts menu contributions (no toolbar buttons) and unregisters on cleanup', () => {
    const cleanup = mountRoadToolsPlugin();

    // Toolbar buttons are no longer registered (moved to RoadEditToolbar panel)
    expect(registerToolbarButton).not.toHaveBeenCalled();
    expect(registerMenuItem).toHaveBeenCalledTimes(8);
    expect(registerMenuItem.mock.calls.map(([item]) => item.id)).toEqual(
      expect.arrayContaining([
        'road-tools:menu-draw-arc',
        'road-tools:menu-clone',
        'road-tools:menu-reverse',
        'road-tools:menu-mirror',
        'road-tools:menu-optimize',
        'road-tools:menu-swap',
        'road-tools:menu-draw-spiral',
        'road-tools:menu-sep',
      ]),
    );

    cleanup();
    expect(unregisterPlugin).toHaveBeenCalledWith('road-tools');
  });

  it('runs clone action via menu item', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(4242);
    mountRoadToolsPlugin();

    getMenuItem('road-tools:menu-clone')?.onClick();

    expect(projectState.cloneRoad).toHaveBeenCalledWith('road-1', 'road-1-clone-4242', [20, 20]);

    nowSpy.mockRestore();
  });

  it('swaps the centerline with the outermost left lane via menu action', () => {
    mountRoadToolsPlugin();

    getMenuItem('road-tools:menu-swap')?.onClick();

    expect(projectState.swapCenterline).toHaveBeenCalledWith('road-1', 4);
  });

  it('falls back to the right-side lane when no left lanes are available', () => {
    projectState.project = makeProject([], [-3, -1]);
    mountRoadToolsPlugin();

    getMenuItem('road-tools:menu-swap')?.onClick();

    expect(projectState.swapCenterline).toHaveBeenCalledWith('road-1', -3);
    expect(getMenuItem('road-tools:menu-sep')).toMatchObject({ separator: true, menu: 'road' });
  });

  it('registers an arc draw road menu command', () => {
    mountRoadToolsPlugin();

    getMenuItem('road-tools:menu-draw-arc')?.onClick();

    expect(viewportState.clearSplineKnots).toHaveBeenCalledTimes(1);
    expect(viewportState.setEditMode).toHaveBeenCalledWith('drawArc');
  });

  it('registers a spiral draw road menu command', () => {
    mountRoadToolsPlugin();

    getMenuItem('road-tools:menu-draw-spiral')?.onClick();

    expect(viewportState.clearSplineKnots).toHaveBeenCalledTimes(1);
    expect(viewportState.setEditMode).toHaveBeenCalledWith('drawSpiral');
  });
});
