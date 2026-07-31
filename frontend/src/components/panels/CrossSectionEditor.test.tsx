import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LaneSection, Project, Road } from '../../services/platform';
import { useProjectStore } from '../../stores/projectStore';
import { CrossSectionEditor } from './CrossSectionEditor';

function makeSection(): LaneSection {
  return {
    s: 0,
    single_side: false,
    left: [
      { id: 1, lane_type: 'Driving', level: 0, link: { predecessor: null, successor: null }, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] },
    ],
    center: [{ id: 0, lane_type: 'None', level: 0, link: { predecessor: null, successor: null }, width: [], road_marks: [] }],
    right: [
      { id: -1, lane_type: 'Driving', level: 0, link: { predecessor: null, successor: null }, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] },
    ],
  };
}

function makeRoad(): Road {
  return {
    id: 'r-1', name: 'r-1', length: 100, junction_id: null,
    link: { predecessor: null, successor: null }, plan_view: [], elevation_profile: [],
    lane_sections: [makeSection()],
  };
}

function makeProject(roads: Road[]): Project {
  return {
    name: 'Untitled',
    header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
    roads, junctions: [], signals: [], objects: [],
  };
}

describe('CrossSectionEditor', () => {
  beforeEach(() => {
    act(() => {
      useProjectStore.getState().reset();
      useProjectStore.setState({ project: makeProject([makeRoad()]) });
    });
  });

  const currentRoad = () => useProjectStore.getState().project.roads.find((r) => r.id === 'r-1')!;

  it('renders a rect per lane', () => {
    render(<CrossSectionEditor road={currentRoad()} />);
    expect(screen.getByTestId('cross-section-lane-left-1')).toBeInTheDocument();
    expect(screen.getByTestId('cross-section-lane-right--1')).toBeInTheDocument();
  });

  it('selects a lane and edits its width through the store', () => {
    render(<CrossSectionEditor road={currentRoad()} />);
    fireEvent.click(screen.getByTestId('cross-section-lane-left-1'));

    const widthInput = screen.getByTestId('cross-section-width');
    fireEvent.change(widthInput, { target: { value: '5' } });

    const lane = currentRoad().lane_sections[0]!.left.find((l) => l.id === 1)!;
    expect(lane.width[0]!.a).toBeCloseTo(5);
  });

  it('adds a right lane through the store', () => {
    render(<CrossSectionEditor road={currentRoad()} />);
    const before = currentRoad().lane_sections[0]!.right.length;
    fireEvent.click(screen.getByTestId('cross-section-add-right'));
    expect(currentRoad().lane_sections[0]!.right.length).toBe(before + 1);
  });

  it('removes the selected lane', () => {
    render(<CrossSectionEditor road={currentRoad()} />);
    fireEvent.click(screen.getByTestId('cross-section-lane-left-1'));
    fireEvent.click(screen.getByTestId('cross-section-remove'));
    expect(currentRoad().lane_sections[0]!.left.find((l) => l.id === 1)).toBeUndefined();
  });
});
