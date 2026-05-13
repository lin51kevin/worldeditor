import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Junction, LaneSection, Project, Road } from '../../services/platform';
import { useEditorStore } from '../../stores/editorStore';
import { DEFAULT_DISPLAY, useEditorViewStore } from '../../stores/editorViewStore';
import { makeLaneKey, makeLaneSectionKey } from '../../utils/sceneGraph';
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
    signals: [],
    objects: []
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

function makeLaneSection(): LaneSection {
  return {
    s: 0,
    single_side: false,
    left: [{ id: 2, lane_type: 'Driving', level: 0, link: { predecessor: null, successor: null }, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] }],
    center: [{ id: 0, lane_type: 'None', level: 0, link: { predecessor: null, successor: null }, width: [], road_marks: [] }],
    right: [{ id: -1, lane_type: 'Driving', level: 0, link: { predecessor: null, successor: null }, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] }],
  };
}

function makeProjectWithJunctions(roads: Road[] = [], junctions: Junction[] = []): Project {
  return { ...makeProject(roads), junctions };
}

function makeJunction(id: string, name: string): Junction {
  return { id, name, connections: [] };
}

describe('LayerPanel', () => {
  beforeEach(() => {
    // jsdom doesn't implement scrollIntoView; mock it to avoid "not a function" errors
    Element.prototype.scrollIntoView = vi.fn();

    act(() => {
      useEditorStore.setState({
        project: makeProject(),
        isDirty: false,
        selectedRoadId: null,
        selectedJunctionId: null,
        selectedObjectType: null,
        selectedSceneNode: null,
        undoStack: [],
        redoStack: [],
      });
      useEditorViewStore.setState({ display: { ...DEFAULT_DISPLAY } });
    });
  });

  it('renders layer panel', () => {
    render(<LayerPanel />);

    expect(screen.getByText('导航器')).toBeInTheDocument();
    expect(screen.getByText(/场景.*道路.*0.*路口.*0/)).toBeInTheDocument();
  });

  it('shows layer categories', () => {
    render(<LayerPanel />);

    // Layer categories card is temporarily hidden; these labels should not appear
    expect(screen.queryByText('矢量')).not.toBeInTheDocument();
    expect(screen.queryByText('道路')).not.toBeInTheDocument();
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

    // Expand the display settings section (collapsed by default)
    fireEvent.click(screen.getByText('显示设置'));

    // Test the display settings toggle
    const laneLineLabel = screen.getByText('车道线').closest('label') as HTMLElement;
    const laneLineCheckbox = laneLineLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;

    expect(laneLineCheckbox.checked).toBe(true);

    fireEvent.click(laneLineCheckbox);
    expect(laneLineCheckbox.checked).toBe(false);

    fireEvent.click(laneLineCheckbox);
    expect(laneLineCheckbox.checked).toBe(true);
  });

  it('selects roads and toggles road details and visibility', () => {
    act(() => {
      useEditorStore.setState({ project: makeProject([makeRoad('r-1', '测试道路')]) });
    });

    render(<LayerPanel />);

    fireEvent.click(screen.getByText('测试道路'));
    expect(useEditorStore.getState().selectedRoadId).toBe('r-1');

    fireEvent.click(document.querySelector('.road-expand') as HTMLElement);
    expect(screen.queryByText('长度: 120.5m')).not.toBeInTheDocument();
    expect(screen.queryByText(/几何 \(1\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/车道段 \(0\)/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('隐藏道路'));
    expect(screen.getByTitle('显示道路')).toBeInTheDocument();
  });

  it('renders lane section and lane child nodes with selection and visibility controls', () => {
    act(() => {
      useEditorStore.setState({
        project: makeProject([makeRoad('r-1', '测试道路')]),
      });
      useEditorStore.setState((state) => ({
        project: {
          ...state.project,
          roads: [{ ...state.project.roads[0]!, lane_sections: [makeLaneSection()] }],
        },
      }));
    });

    render(<LayerPanel />);

    fireEvent.click(document.querySelector('.road-expand') as HTMLElement);
    fireEvent.click(screen.getByText('车道段 #1'));
    expect(useEditorStore.getState().selectedSceneNode).toEqual({
      type: 'laneSection',
      roadId: 'r-1',
      sectionIndex: 0,
    });

    fireEvent.click(screen.getByText(/车道 L2/));
    expect(useEditorStore.getState().selectedSceneNode).toEqual({
      type: 'lane',
      roadId: 'r-1',
      sectionIndex: 0,
      side: 'left',
      laneId: 2,
    });

    fireEvent.click(screen.getAllByTitle('隐藏车道')[0] as HTMLElement);
    expect(useEditorViewStore.getState().display.hiddenLaneKeys).toEqual([
      makeLaneKey('r-1', 0, 'left', 2),
    ]);

    fireEvent.click(screen.getByTitle('隐藏车道段'));
    expect(useEditorViewStore.getState().display.hiddenLaneSectionKeys).toEqual([
      makeLaneSectionKey('r-1', 0),
    ]);
  });

  // ── Search box tests ──────────────────────────────────────────────────────

  it('shows search input inside scene list', () => {
    render(<LayerPanel />);
    expect(screen.getByPlaceholderText('搜索道路/路口...')).toBeInTheDocument();
  });

  it('filters roads by id', () => {
    act(() => {
      useEditorStore.setState({
        project: makeProject([makeRoad('road-1', '主干道'), makeRoad('road-2', '辅路')]),
      });
    });

    render(<LayerPanel />);

    fireEvent.change(screen.getByPlaceholderText('搜索道路/路口...'), { target: { value: 'road-1' } });

    expect(screen.getByText('主干道')).toBeInTheDocument();
    expect(screen.queryByText('辅路')).not.toBeInTheDocument();
  });

  it('filters roads by name (case-insensitive)', () => {
    act(() => {
      useEditorStore.setState({
        project: makeProject([makeRoad('r-1', 'MainStreet'), makeRoad('r-2', 'SideRoad')]),
      });
    });

    render(<LayerPanel />);

    fireEvent.change(screen.getByPlaceholderText('搜索道路/路口...'), { target: { value: 'main' } });

    expect(screen.getByText('MainStreet')).toBeInTheDocument();
    expect(screen.queryByText('SideRoad')).not.toBeInTheDocument();
  });

  it('filters junctions by id', () => {
    act(() => {
      useEditorStore.setState({
        project: makeProjectWithJunctions(
          [],
          [makeJunction('j-10', 'Junction Alpha'), makeJunction('j-20', 'Junction Beta')],
        ),
      });
    });

    render(<LayerPanel />);

    fireEvent.change(screen.getByPlaceholderText('搜索道路/路口...'), { target: { value: 'j-10' } });

    expect(screen.getByText('Junction Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Junction Beta')).not.toBeInTheDocument();
  });

  it('shows no-results message when nothing matches', () => {
    act(() => {
      useEditorStore.setState({
        project: makeProject([makeRoad('r-1', '测试道路')]),
      });
    });

    render(<LayerPanel />);

    fireEvent.change(screen.getByPlaceholderText('搜索道路/路口...'), { target: { value: 'xyz-不存在' } });

    expect(screen.queryByText('测试道路')).not.toBeInTheDocument();
    expect(screen.getByText('无匹配结果')).toBeInTheDocument();
  });

  it('restores full list when search is cleared', () => {
    act(() => {
      useEditorStore.setState({
        project: makeProject([makeRoad('r-1', '道路A'), makeRoad('r-2', '道路B')]),
      });
    });

    render(<LayerPanel />);
    const input = screen.getByPlaceholderText('搜索道路/路口...');

    fireEvent.change(input, { target: { value: '道路A' } });
    expect(screen.queryByText('道路B')).not.toBeInTheDocument();

    // Click the clear button
    fireEvent.click(screen.getByTitle('Clear'));
    expect(screen.getByText('道路A')).toBeInTheDocument();
    expect(screen.getByText('道路B')).toBeInTheDocument();
  });
});
