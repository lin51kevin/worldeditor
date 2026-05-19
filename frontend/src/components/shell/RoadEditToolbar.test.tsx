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

// Mock the stores
vi.mock('../../stores/projectStore', () => ({
  useProjectStore: vi.fn(() => ({
    selectedRoadId: null,
    selectedJunctionId: null,
    selectedSceneNode: null,
    project: { roads: [], junctions: [], signals: [], objects: [], name: 'Untitled', header: {} },
  })),
}));

vi.mock('../../stores/viewportStore', () => ({
  useViewportStore: vi.fn(() => ({
    editMode: null,
    setEditMode: vi.fn(),
  })),
}));

describe('RoadEditToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all tool buttons', () => {
    render(<RoadEditToolbar />);
    expect(screen.getByTitle('Adjust Node')).toBeInTheDocument();
    expect(screen.getByTitle('Adjust Edge Line')).toBeInTheDocument();
    expect(screen.getByTitle('Move Road [M]')).toBeInTheDocument();
    expect(screen.getByTitle('Rotate Road [R]')).toBeInTheDocument();
    expect(screen.getByTitle('Optimize Nodes')).toBeInTheDocument();
    expect(screen.queryByTitle('Road Markings')).not.toBeInTheDocument();
  });
});
