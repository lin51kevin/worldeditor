import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RoadEditToolbar } from './RoadEditToolbar';

// Mock i18n — return EN translation key values so test titles match English
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'toolPanel.roadEditSection': 'Road Edit',
        'toolPanel.noRoadSelected': 'No road selected',
        'toolPanel.adjustNode': 'Adjust Node',
        'toolPanel.adjustEdge': 'Adjust Edge Line',
        'toolPanel.editLaneLine': 'Edit Lane Line',
        'toolPanel.moveRoad': 'Move Road',
        'toolPanel.rotateRoad': 'Rotate Road',
        'toolPanel.optimizeNode': 'Optimize Nodes',
        'toolPanel.cloneRoad': 'Clone Road',
        'toolPanel.reverseRoad': 'Reverse Road',
        'toolPanel.mirrorRoad': 'Mirror Road',
        'toolPanel.swapCenterlineAndEdge': 'Swap Centerline',
        'toolPanel.softSelectionRadius': `Soft Sel: ${opts?.radius ?? 0}`,
      };
      return map[key] ?? key;
    },
  }),
}));

const projectStoreState = {
  selectedRoadId: null,
  selectedJunctionId: null,
  selectedSceneNode: null,
  selectedLaneSectionIndex: null,
  project: { roads: [], junctions: [], signals: [], objects: [], name: 'Untitled', header: {} },
  cloneRoad: vi.fn(),
  selectRoad: vi.fn(),
  setSelectedLaneSection: vi.fn(),
  clearLaneSelection: vi.fn(),
  reverseRoad: vi.fn(),
  mirrorRoad: vi.fn(),
  swapCenterline: vi.fn(),
};

const viewportStoreState = {
  editMode: 'default',
  selectionMode: 'road',
  softSelectionRadius: 50,
  setEditMode: vi.fn(),
  setSelectionMode: vi.fn(),
  clearSplineKnots: vi.fn(),
  setSoftSelectionRadius: vi.fn(),
  geometryEditRoadId: null,
};

// Mock the stores
vi.mock('../../stores/projectStore', () => ({
  useProjectStore: Object.assign(
    vi.fn((selector?: (state: typeof projectStoreState) => unknown) =>
      selector ? selector(projectStoreState) : projectStoreState,
    ),
    { getState: () => projectStoreState },
  ),
}));

vi.mock('../../stores/viewportStore', () => ({
  useViewportStore: vi.fn((selector?: (state: typeof viewportStoreState) => unknown) =>
    selector ? selector(viewportStoreState) : viewportStoreState,
  ),
}));

describe('RoadEditToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectStoreState.selectedRoadId = null;
    projectStoreState.selectedSceneNode = null;
    viewportStoreState.selectionMode = 'road';
    viewportStoreState.editMode = 'default';
  });

  it('renders all base tool buttons', () => {
    render(<RoadEditToolbar />);
    expect(screen.getByTitle('Adjust Node')).toBeInTheDocument();
    expect(screen.getByTitle('Adjust Edge Line')).toBeInTheDocument();
    expect(screen.getByTitle('Move Road [M]')).toBeInTheDocument();
    expect(screen.getByTitle('Rotate Road [R]')).toBeInTheDocument();
    expect(screen.getByTitle('Optimize Nodes')).toBeInTheDocument();
    expect(screen.queryByTitle('Edit Lane Line')).not.toBeInTheDocument();
  });

  it('shows lane line editing button in lane selection mode', () => {
    projectStoreState.selectedRoadId = 'road-1';
    projectStoreState.selectedSceneNode = { type: 'lane', roadId: 'road-1', sectionIndex: 0, side: 'left', laneId: 1 };
    viewportStoreState.selectionMode = 'lane';

    render(<RoadEditToolbar />);
    expect(screen.getByTitle('Edit Lane Line')).toBeInTheDocument();
  });
});
