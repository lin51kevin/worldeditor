import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Project, Road } from '../services/platform';
import { useEditorStore } from '../stores/editorStore';
import { LayerPanel } from './LayerPanel';

function makeProject(roads: Road[] = []): Project {
  return {
    name: 'Untitled',
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
    roads,
    junctions: [],
  };
}

function makeRoad(id: string, name: string): Road {
  return {
    id,
    name,
    length: 120.5,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 120.5, geo_type: 'Line' }],
    elevation_profile: [],
    lane_sections: [],
  };
}

describe('LayerPanel', () => {
  beforeEach(() => {
    act(() => {
      useEditorStore.setState({
        project: makeProject(),
        isDirty: false,
        selectedRoadId: null,
        selectedObjectType: null,
        undoStack: [],
        redoStack: [],
      });
    });
  });

  it('renders layer panel', () => {
    render(<LayerPanel />);

    expect(screen.getByText('导航器')).toBeInTheDocument();
    expect(screen.getByText(/场景.*道路.*0.*路口.*0/)).toBeInTheDocument();
  });

  it('shows layer categories', () => {
    render(<LayerPanel />);

    ['矢量', '道路'].forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  it('shows empty road list when project has no roads', () => {
    render(<LayerPanel />);

    expect(screen.getByText(/场景.*道路.*0.*路口.*0/)).toBeInTheDocument();
    expect(screen.queryByText('测试道路')).not.toBeInTheDocument();
  });

  it('shows roads when project has roads', () => {
    act(() => {
      useEditorStore.setState({ project: makeProject([makeRoad('r-1', '测试道路')]) });
    });

    render(<LayerPanel />);

    expect(screen.getByText(/场景.*道路.*1.*路口.*0/)).toBeInTheDocument();
    expect(screen.getByText('测试道路')).toBeInTheDocument();
    expect(screen.getByText('(r-1)')).toBeInTheDocument();
  });

  it('toggles layer visibility via checkbox', () => {
    render(<LayerPanel />);

    const vectorLabel = screen.getByText('矢量').closest('label') as HTMLElement;
    const vectorCheckbox = vectorLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;

    expect(vectorCheckbox.checked).toBe(true);

    fireEvent.click(vectorCheckbox);
    expect(vectorCheckbox.checked).toBe(false);

    fireEvent.click(vectorCheckbox);
    expect(vectorCheckbox.checked).toBe(true);
  });

  it('selects roads and toggles road details and visibility', () => {
    act(() => {
      useEditorStore.setState({ project: makeProject([makeRoad('r-1', '测试道路')]) });
    });

    render(<LayerPanel />);

    fireEvent.click(screen.getByText('测试道路'));
    expect(useEditorStore.getState().selectedRoadId).toBe('r-1');

    fireEvent.click(document.querySelector('.road-expand') as HTMLElement);
    expect(screen.getByText('长度: 120.5m')).toBeInTheDocument();
    expect(screen.getByText(/几何 \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/车道段 \(0\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('隐藏道路'));
    expect(screen.getByTitle('显示道路')).toBeInTheDocument();
  });
});
