import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LaneSection, Project, Road } from '../../services/platform';
import { useProjectStore } from '../../stores/projectStore';
import { BatchRoadEditor } from './BatchRoadEditor';

function makeLaneSection(): LaneSection {
  return {
    s: 0,
    single_side: false,
    left: [
      { id: 1, lane_type: 'Driving', level: 0, link: { predecessor: null, successor: null }, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] },
    ],
    center: [
      { id: 0, lane_type: 'None', level: 0, link: { predecessor: null, successor: null }, width: [], road_marks: [] },
    ],
    right: [
      { id: -1, lane_type: 'Driving', level: 0, link: { predecessor: null, successor: null }, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] },
    ],
  };
}

function makeRoad(id: string): Road {
  return {
    id,
    name: id,
    length: 100,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [],
    elevation_profile: [],
    lane_sections: [makeLaneSection()],
  };
}

function makeProject(roads: Road[]): Project {
  return {
    name: 'Untitled',
    header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
    roads,
    junctions: [],
    signals: [],
    objects: [],
  };
}

describe('BatchRoadEditor', () => {
  beforeEach(() => {
    act(() => {
      useProjectStore.getState().reset();
      useProjectStore.setState({ project: makeProject([makeRoad('r-1'), makeRoad('r-2'), makeRoad('r-3')]) });
    });
  });

  it('applies a name prefix with incremental suffixes to selected roads only', () => {
    render(<BatchRoadEditor roadIds={['r-1', 'r-3']} />);

    fireEvent.change(screen.getByTestId('batch-name-prefix'), { target: { value: 'Main_' } });
    fireEvent.click(screen.getByTestId('batch-name-apply'));

    const roads = useProjectStore.getState().project.roads;
    expect(roads.find((r) => r.id === 'r-1')?.name).toBe('Main_1');
    expect(roads.find((r) => r.id === 'r-3')?.name).toBe('Main_2');
    // Unselected road untouched.
    expect(roads.find((r) => r.id === 'r-2')?.name).toBe('r-2');
  });

  it('applies speed to all selected roads', () => {
    render(<BatchRoadEditor roadIds={['r-1', 'r-2']} />);

    fireEvent.change(screen.getByTestId('batch-speed'), { target: { value: '30' } });
    fireEvent.click(screen.getByTestId('batch-speed-apply'));

    const roads = useProjectStore.getState().project.roads;
    expect(roads.find((r) => r.id === 'r-1')?.speed).toBe(30);
    expect(roads.find((r) => r.id === 'r-2')?.speed).toBe(30);
    expect(roads.find((r) => r.id === 'r-3')?.speed).toBeUndefined();
  });

  it('applies lane type to non-center lanes across all sections', () => {
    render(<BatchRoadEditor roadIds={['r-1']} />);

    fireEvent.change(screen.getByTestId('batch-lane-type'), { target: { value: 'Sidewalk' } });
    fireEvent.click(screen.getByTestId('batch-lane-type-apply'));

    const section = useProjectStore.getState().project.roads.find((r) => r.id === 'r-1')!.lane_sections[0]!;
    expect(section.left[0]!.lane_type).toBe('Sidewalk');
    expect(section.right[0]!.lane_type).toBe('Sidewalk');
    // Center lane (id 0) stays untouched.
    expect(section.center[0]!.lane_type).toBe('None');
  });

  it('applies lane width as a single constant record', () => {
    render(<BatchRoadEditor roadIds={['r-2']} />);

    fireEvent.change(screen.getByTestId('batch-lane-width'), { target: { value: '4.25' } });
    fireEvent.click(screen.getByTestId('batch-lane-width-apply'));

    const section = useProjectStore.getState().project.roads.find((r) => r.id === 'r-2')!.lane_sections[0]!;
    expect(section.left[0]!.width).toEqual([{ s_offset: 0, a: 4.25, b: 0, c: 0, d: 0 }]);
  });

  it('hides and shows selected roads', () => {
    render(<BatchRoadEditor roadIds={['r-1', 'r-2']} />);

    fireEvent.click(screen.getByTestId('batch-hide'));
    let roads = useProjectStore.getState().project.roads;
    expect(roads.find((r) => r.id === 'r-1')?.render_hidden).toBe(true);
    expect(roads.find((r) => r.id === 'r-3')?.render_hidden).toBeUndefined();

    fireEvent.click(screen.getByTestId('batch-show'));
    roads = useProjectStore.getState().project.roads;
    expect(roads.find((r) => r.id === 'r-1')?.render_hidden).toBe(false);
  });

  it('deletes all selected roads and clears the multi-selection', () => {
    act(() => {
      useProjectStore.getState().selectMultiple(['r-1', 'r-2'], []);
    });
    render(<BatchRoadEditor roadIds={['r-1', 'r-2']} />);

    fireEvent.click(screen.getByTestId('batch-delete'));

    const state = useProjectStore.getState();
    expect(state.project.roads.map((r) => r.id)).toEqual(['r-3']);
    expect(state.selectedRoadIds).toEqual([]);
  });
});
