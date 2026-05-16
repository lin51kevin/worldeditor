import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../stores/projectStore', () => ({
  useProjectStore: vi.fn(),
}));

import { SelectionDetailsPanel } from './SelectionDetailsPanel';
import { useProjectStore } from '../../stores/projectStore';

const mockUseEditorStore = useProjectStore as unknown as ReturnType<typeof vi.fn>;

describe('SelectionDetailsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show placeholder when nothing is selected', () => {
    mockUseEditorStore.mockImplementation((sel: (s: unknown) => unknown) =>
      sel({
        selectedRoadId: null,
        selectedJunctionId: null,
        project: { roads: [], junctions: [] },
      }),
    );
    render(<SelectionDetailsPanel />);
    expect(screen.getByText(/no selection|nothing selected/i)).toBeDefined();
  });

  it('should show road details when a road is selected', () => {
    mockUseEditorStore.mockImplementation((sel: (s: unknown) => unknown) =>
      sel({
        selectedRoadId: 'road-1',
        selectedJunctionId: null,
        project: {
          roads: [{ id: 'road-1', name: 'Main St', length: 123.4, lane_sections: [], plan_view: [], elevation_profile: [] }],
          junctions: [],
    signals: [],
    objects: []
        },
      }),
    );
    render(<SelectionDetailsPanel />);
    expect(screen.getByText(/road-1/)).toBeDefined();
    expect(screen.getByText(/123/)).toBeDefined();
  });

  it('should show junction details when a junction is selected', () => {
    mockUseEditorStore.mockImplementation((sel: (s: unknown) => unknown) =>
      sel({
        selectedRoadId: null,
        selectedJunctionId: 'jct-1',
        project: {
          roads: [],
          junctions: [{ id: 'jct-1', name: 'North Junction', connections: [] }],
        },
      }),
    );
    render(<SelectionDetailsPanel />);
    expect(screen.getByText(/jct-1/)).toBeDefined();
  });

  it('should render correctly with road name', () => {
    mockUseEditorStore.mockImplementation((sel: (s: unknown) => unknown) =>
      sel({
        selectedRoadId: 'road-99',
        selectedJunctionId: null,
        project: {
          roads: [{ id: 'road-99', name: 'Highway 99', length: 500, lane_sections: [], plan_view: [], elevation_profile: [] }],
          junctions: [],
    signals: [],
    objects: []
        },
      }),
    );
    render(<SelectionDetailsPanel />);
    expect(screen.getByText(/Highway 99/)).toBeDefined();
  });
});
