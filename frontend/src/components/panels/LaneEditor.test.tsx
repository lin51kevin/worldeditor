import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LaneSection, Project, Road } from '../../services/platform';
import { useProjectStore } from '../../stores/projectStore';
import { LaneEditor } from './LaneEditor';

function makeLaneSection(overrides: Partial<LaneSection> = {}): LaneSection {
  return {
    s: 0,
    single_side: false,
    left: [
      {
        id: 1,
        lane_type: 'Driving',
        level: 0,
        link: { predecessor: null, successor: null },
        width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }],
        road_marks: [],
      },
    ],
    center: [
      {
        id: 0,
        lane_type: 'None',
        level: 0,
        link: { predecessor: null, successor: null },
        width: [],
        road_marks: [],
      },
    ],
    right: [
      {
        id: -1,
        lane_type: 'Driving',
        level: 0,
        link: { predecessor: null, successor: null },
        width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }],
        road_marks: [],
      },
    ],
    ...overrides,
  };
}

function makeRoad(overrides: Partial<Road> = {}): Road {
  return {
    id: 'r-1',
    name: 'Test Road',
    length: 120,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [],
    elevation_profile: [],
    lane_sections: [makeLaneSection()],
    ...overrides,
  };
}

function makeProject(roads: Road[]): Project {
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
    objects: [],
  };
}

describe('LaneEditor', () => {
  beforeEach(() => {
    act(() => {
      useProjectStore.getState().reset();
    });
  });

  it('renders lane sections and lane rows', () => {
    const road = makeRoad();
    act(() => {
      useProjectStore.setState({ project: makeProject([road]) });
    });

    render(<LaneEditor roadId={road.id} laneSections={road.lane_sections} roadLength={road.length} />);

    expect(screen.getByText('车道段 #1')).toBeInTheDocument();
    expect(screen.getByText('左侧 (1)')).toBeInTheDocument();
    expect(screen.getByText('右侧 (1)')).toBeInTheDocument();
    expect(screen.getByText('L1')).toBeInTheDocument();
    expect(screen.getByText('R1')).toBeInTheDocument();
  });

  it('updates lane type through the store when the lane type select changes', () => {
    const road = makeRoad();
    act(() => {
      useProjectStore.setState({ project: makeProject([road]) });
    });

    const { container } = render(
      <LaneEditor roadId={road.id} laneSections={road.lane_sections} roadLength={road.length} />,
    );

    const typeSelect = container.querySelector('.lane-editor-type-select') as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: 'Shoulder' } });

    expect(useProjectStore.getState().project.roads[0]?.lane_sections[0]?.left[0]?.lane_type).toBe('Shoulder');
  });

  it('adds a new left lane when the add-left action is clicked', () => {
    const road = makeRoad();
    act(() => {
      useProjectStore.setState({ project: makeProject([road]) });
    });

    render(<LaneEditor roadId={road.id} laneSections={road.lane_sections} roadLength={road.length} />);

    const beforeCount = useProjectStore.getState().project.roads[0]?.lane_sections[0]?.left.length;
    fireEvent.click(screen.getByTitle('添加左车道'));

    const leftLanes = useProjectStore.getState().project.roads[0]?.lane_sections[0]?.left;
    expect(leftLanes).toHaveLength((beforeCount ?? 0) + 1);
    expect(leftLanes?.at(-1)?.id).toBeGreaterThan(0);
  });

  it('splits a lane section when the split position is valid', () => {
    const road = makeRoad();
    act(() => {
      useProjectStore.setState({ project: makeProject([road]) });
    });

    render(<LaneEditor roadId={road.id} laneSections={road.lane_sections} roadLength={road.length} />);

    const splitInput = screen.getByPlaceholderText('s');
    fireEvent.change(splitInput, { target: { value: '35' } });
    fireEvent.click(screen.getByTitle('拆分车道段'));

    const sections = useProjectStore.getState().project.roads[0]?.lane_sections;
    expect(sections).toHaveLength(2);
    expect(sections?.[1]?.s).toBe(35);
    expect((splitInput as HTMLInputElement).value).toBe('');
  });
});