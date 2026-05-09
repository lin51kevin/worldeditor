import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LaneSection, Project, Road } from '../services/platform';
import { useEditorStore } from '../stores/editorStore';
import { PropertyPanel } from './PropertyPanel';

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

function makeLaneSection(): LaneSection {
  return {
    s: 0,
    single_side: false,
    left: [
      { id: 1, lane_type: 'driving', level: false, link: { predecessor: null, successor: null }, width: [], road_marks: [] },
    ],
    center: [
      { id: 0, lane_type: 'none', level: false, link: { predecessor: null, successor: null }, width: [], road_marks: [] },
    ],
    right: [
      { id: -1, lane_type: 'driving', level: false, link: { predecessor: null, successor: null }, width: [], road_marks: [] },
      { id: -2, lane_type: 'driving', level: false, link: { predecessor: null, successor: null }, width: [], road_marks: [] },
    ],
  };
}

function makeRoad(): Road {
  return {
    id: 'r-42',
    name: '测试道路',
    length: 120.5,
    junction_id: 'j-1',
    link: { predecessor: null, successor: null },
    plan_view: [
      { s: 0, x: 0, y: 0, hdg: 0, length: 50, geo_type: 'Line' },
      { s: 50, x: 50, y: 0, hdg: 0.2, length: 70.5, geo_type: { Arc: { curvature: 0.01 } } },
    ],
    elevation_profile: [{ s: 0, a: 0, b: 0, c: 0, d: 0 }],
    lane_sections: [makeLaneSection()],
  };
}

describe('PropertyPanel', () => {
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

  it('renders property panel', () => {
    render(<PropertyPanel />);

    expect(screen.getByText('属性')).toBeInTheDocument();
  });

  it('shows empty state when nothing is selected', () => {
    render(<PropertyPanel />);

    expect(screen.getByText('未选择对象')).toBeInTheDocument();
  });

  it('shows road properties when a road is selected', () => {
    const road = makeRoad();

    act(() => {
      useEditorStore.setState({
        project: makeProject([road]),
        selectedRoadId: road.id,
        selectedObjectType: 'road',
      });
    });

    render(<PropertyPanel />);

    expect(screen.getByText('道路属性')).toBeInTheDocument();
    expect(screen.getByText('r-42')).toBeInTheDocument();
    expect(screen.getByDisplayValue('测试道路')).toBeInTheDocument();
    expect(screen.getByText('120.50 m')).toBeInTheDocument();
    expect(screen.getByText('j-1')).toBeInTheDocument();
    expect(screen.getByText('Line (50.0m)')).toBeInTheDocument();
    expect(screen.getByText('Arc (70.5m)')).toBeInTheDocument();
    // Per-lane editing: should show lane card header with count
    expect(screen.getByText('车道 (1)')).toBeInTheDocument();
    // Lane labels: L1, R1 for each side
    expect(screen.getByText('L1')).toBeInTheDocument();
    expect(screen.getByText('R1')).toBeInTheDocument();

    // Elevation editor card header is visible
    expect(screen.getByText('高程 (1)')).toBeInTheDocument();
  });

  it('shows elevation editor actions when elevation card is expanded', () => {
    const road = makeRoad();

    act(() => {
      useEditorStore.setState({
        project: makeProject([road]),
        selectedRoadId: road.id,
        selectedObjectType: 'road',
      });
    });

    render(<PropertyPanel />);

    act(() => {
      screen.getByText('高程 (1)').click();
    });

    expect(screen.getByText('添加点')).toBeInTheDocument();
    expect(screen.getByText('平滑高程')).toBeInTheDocument();
  });

  it('can add and delete elevation points from panel actions', () => {
    const road = makeRoad();

    act(() => {
      useEditorStore.setState({
        project: makeProject([road]),
        selectedRoadId: road.id,
        selectedObjectType: 'road',
      });
    });

    render(<PropertyPanel />);

    act(() => {
      screen.getByText('高程 (1)').click();
    });

    act(() => {
      fireEvent.click(screen.getByText('添加点'));
    });

    expect(useEditorStore.getState().project.roads[0]?.elevation_profile.length).toBe(2);

    act(() => {
      fireEvent.click(screen.getAllByText('删除')[0]!);
    });

    expect(useEditorStore.getState().project.roads[0]?.elevation_profile.length).toBe(1);
  });
});
