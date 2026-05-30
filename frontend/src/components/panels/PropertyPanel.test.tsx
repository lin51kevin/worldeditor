import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Junction, LaneSection, Project, Road } from '../../services/platform';
import { useProjectStore } from '../../stores/projectStore';
import { PropertyPanel } from './PropertyPanel';

function makeProject(roads: Road[] = [], junctions: Junction[] = []): Project {
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
    junctions,
    signals: [],
    objects: []
  };
}

function makeLaneSection(): LaneSection {
  return {
    s: 0,
    single_side: false,
    left: [
      { id: 1, lane_type: 'driving', level: 0, link: { predecessor: null, successor: null }, width: [], road_marks: [] },
    ],
    center: [
      { id: 0, lane_type: 'none', level: 0, link: { predecessor: null, successor: null }, width: [], road_marks: [] },
    ],
    right: [
      { id: -1, lane_type: 'driving', level: 0, link: { predecessor: null, successor: null }, width: [], road_marks: [] },
      { id: -2, lane_type: 'driving', level: 0, link: { predecessor: null, successor: null }, width: [], road_marks: [] },
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
    lateral_profile: { superelevation: [], superelevations: [], crossfall: [], crossfalls: [] },
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
      useProjectStore.setState({
        project: makeProject(),
        isDirty: false,
        selectedRoadId: null,
        selectedJunctionId: null,
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
      useProjectStore.setState({
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

    // Geometry card is collapsed by default — expand it to reveal geometry items
    const geometryHeader = screen.getByText(/几何/);
    act(() => { geometryHeader.click(); });
    expect(screen.getByText('Line (50.0m)')).toBeInTheDocument();
    expect(screen.getByText('Arc (70.5m)')).toBeInTheDocument();
    // Per-lane editing: should show lane card header with count
    expect(screen.getByText('车道 (1)')).toBeInTheDocument();
    // Lane labels: L1, R1 for each side
    expect(screen.getByText('L1')).toBeInTheDocument();
    expect(screen.getByText('R1')).toBeInTheDocument();

    // Elevation and superelevation editor card headers are visible
    expect(screen.getByText('高程 (1)')).toBeInTheDocument();
    expect(screen.getByText('超高 (0)')).toBeInTheDocument();
  });

  it('shows junction editor when a junction is selected', () => {
    const incomingRoad: Road = {
      ...makeRoad(),
      id: 'r-in',
      name: '入口道路',
      junction_id: null,
      link: { predecessor: null, successor: { element_id: 'j-1', element_type: 'Junction', contact_point: 'End' } },
    };
    const connectingRoad: Road = {
      ...makeRoad(),
      id: 'r-conn',
      name: '连接道路',
      junction_id: 'j-1',
      link: {
        predecessor: { element_id: 'r-in', element_type: 'Road', contact_point: 'End' },
        successor: { element_id: 'r-out', element_type: 'Road', contact_point: 'Start' },
      },
    };
    const outgoingRoad: Road = {
      ...makeRoad(),
      id: 'r-out',
      name: '出口道路',
      junction_id: null,
      link: { predecessor: { element_id: 'j-1', element_type: 'Junction', contact_point: 'Start' }, successor: null },
    };
    const junction: Junction = {
      id: 'j-1',
      name: '测试路口',
      connections: [{
        id: 'conn_0', incoming_road: 'r-in', connecting_road: 'r-conn', contact_point: 'Start', lane_links: [{ from: -1, to: -1 }],
      }],
    };

    act(() => {
      useProjectStore.setState({
        project: makeProject([incomingRoad, connectingRoad, outgoingRoad], [junction]),
        selectedRoadId: null,
        selectedJunctionId: 'j-1',
        selectedObjectType: 'junction',
      });
    });

    render(<PropertyPanel />);

    expect(screen.getByText('路口属性')).toBeInTheDocument();
    expect(screen.getByDisplayValue('测试路口')).toBeInTheDocument();
    expect(screen.getByText('入口道路列表 (2)')).toBeInTheDocument();
    expect(screen.getByText('路口内部连接道路 (1)')).toBeInTheDocument();
    expect(screen.getByText('连接表 (1)')).toBeInTheDocument();
    expect(screen.getAllByText('入口道路 (r-in)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('出口道路 (r-out)').length).toBeGreaterThan(0);
  });

  it('shows elevation editor actions when elevation card is expanded', () => {
    const road = makeRoad();

    act(() => {
      useProjectStore.setState({
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
      useProjectStore.setState({
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

    expect(useProjectStore.getState().project.roads[0]?.elevation_profile.length).toBe(2);

    act(() => {
      fireEvent.click(screen.getAllByText('删除')[0]!);
    });

    expect(useProjectStore.getState().project.roads[0]?.elevation_profile.length).toBe(1);
  });

  it('can add and delete superelevation points from panel actions', () => {
    const road = makeRoad();

    act(() => {
      useProjectStore.setState({
        project: makeProject([road]),
        selectedRoadId: road.id,
        selectedObjectType: 'road',
      });
    });

    render(<PropertyPanel />);

    act(() => {
      screen.getByText('超高 (0)').click();
    });

    act(() => {
      fireEvent.change(screen.getByLabelText('桩号 s'), { target: { value: '12.5' } });
      fireEvent.change(screen.getByLabelText('常数项 a'), { target: { value: '0.03' } });
      fireEvent.click(screen.getByText('添加点'));
    });

    const profile = useProjectStore.getState().project.roads[0]?.lateral_profile?.superelevation ?? [];
    expect(profile).toHaveLength(1);
    expect(profile[0]).toMatchObject({ s: 12.5, a: 0.03 });

    act(() => {
      fireEvent.click(screen.getByText('删除'));
    });

    expect(useProjectStore.getState().project.roads[0]?.lateral_profile?.superelevation ?? []).toHaveLength(0);
  });

  it('shows add lane buttons and clicking adds a lane to the correct side', () => {
    const road = makeRoad();

    act(() => {
      useProjectStore.setState({
        project: makeProject([road]),
        selectedRoadId: road.id,
        selectedObjectType: 'road',
      });
    });

    render(<PropertyPanel />);

    const addLaneButtons = screen.getAllByTitle('添加左车道');
    expect(addLaneButtons.length).toBeGreaterThan(0);

    const leftBefore = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.left.length;
    fireEvent.click(addLaneButtons[0]!);
    const leftAfter = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.left.length;
    expect(leftAfter).toBe(leftBefore + 1);

    const leftLanes = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.left;
    const newLane = leftLanes[leftLanes.length - 1]!;
    expect(newLane.id).toBeGreaterThan(0);
    expect(newLane.lane_type).toBe('Driving');
  });

  describe('RoadMarkingPanel integration', () => {
    it('renders RoadMarkingPanel when a lane is selected', () => {
      const road = makeRoad();
      act(() => {
        useProjectStore.setState({
          project: makeProject([road]),
          selectedRoadId: road.id,
          selectedSceneNode: { type: 'lane', roadId: road.id, sectionIndex: 0, side: 'right', laneId: -1 },
        });
      });
      render(<PropertyPanel />);
      expect(screen.getByText('道路标线')).toBeInTheDocument();
    });

    it('does not render RoadMarkingPanel when no lane is selected', () => {
      const road = makeRoad();
      act(() => {
        useProjectStore.setState({
          project: makeProject([road]),
          selectedRoadId: road.id,
          selectedSceneNode: null,
        });
      });
      render(<PropertyPanel />);
      expect(screen.queryByText('道路标线')).not.toBeInTheDocument();
    });
  });
});
