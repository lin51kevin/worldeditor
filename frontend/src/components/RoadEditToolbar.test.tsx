import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RoadEditToolbar } from './RoadEditToolbar';

// Mock the stores
vi.mock('../stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({
    selectedRoadId: null,
    selectedJunctionId: null,
    selectedSceneNode: null,
    project: { roads: [], junctions: [], signals: [], objects: [], name: 'Untitled', header: {} },
  })),
}));

vi.mock('../stores/editorViewStore', () => ({
  useEditorViewStore: vi.fn(() => ({
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
    expect(screen.getByTitle('Move Road')).toBeInTheDocument();
    expect(screen.getByTitle('Rotate Road')).toBeInTheDocument();
    expect(screen.getByTitle('Road Markings')).toBeInTheDocument();
    expect(screen.getByTitle('Optimize Nodes')).toBeInTheDocument();
  });
});
