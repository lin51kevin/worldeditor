import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LaneSection, RoadMark } from '../../services/platform';
import type { SceneNodeSelection } from '../../utils/sceneGraph';
import { useProjectStore } from '../../stores/projectStore';
import { RoadMarkingPanel } from './RoadMarkingPanel';

function makeLaneSection(marks: RoadMark[] = []): LaneSection {
  return {
    s: 0,
    single_side: false,
    left: [],
    center: [{ id: 0, lane_type: 'none', level: 0, link: null, width: [], road_marks: [] }],
    right: [{ id: -1, lane_type: 'driving', level: 0, link: null, width: [], road_marks: marks }],
  };
}

function setupStore(marks: RoadMark[] = [], sceneNode?: SceneNodeSelection) {
  act(() => {
    useProjectStore.setState({
      project: {
        name: 'Test',
        header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
        roads: [{
          id: 'road_1',
          name: 'Road 1',
          length: 100,
          junction_id: null,
          link: { predecessor: null, successor: null },
          plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
          elevation_profile: [],
          lane_sections: [makeLaneSection(marks)],
        }],
        junctions: [],
        signals: [],
        objects: [],
      },
      selectedSceneNode: sceneNode ?? null,
      selectedRoadId: 'road_1',
      selectedJunctionId: null,
      isDirty: false,
      undoStack: [],
      redoStack: [],
    });
  });
}

const laneNode = { type: 'lane' as const, roadId: 'road_1', sectionIndex: 0, side: 'right' as const, laneId: -1 };

const defaultMark: RoadMark = { s_offset: 0, mark_type: 'Solid', weight: 'standard', color: 'standard', material: 'standard', width: 0.15, lane_change: 'none' };

describe('RoadMarkingPanel', () => {
  beforeEach(() => {
    setupStore();
  });

  it('renders nothing when no lane selected', () => {
    const { container } = render(<RoadMarkingPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('displays road mark list when lane is selected', () => {
    setupStore([defaultMark], laneNode);
    render(<RoadMarkingPanel />);
    expect(screen.getByText(/Solid/)).toBeInTheDocument();
    expect(screen.getByText(/standard/)).toBeInTheDocument();
  });

  it('adds a new marking on button click', () => {
    setupStore([], laneNode);
    render(<RoadMarkingPanel />);
    fireEvent.click(screen.getByRole('button', { name: /添加标线/ }));
    const marks = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.right[0]!.road_marks;
    expect(marks).toHaveLength(1);
    expect(marks[0]!.mark_type).toBe('Solid');
  });

  it('deletes a marking', () => {
    setupStore([defaultMark, { ...defaultMark, s_offset: 50, mark_type: 'Broken' }], laneNode);
    render(<RoadMarkingPanel />);
    const deleteButtons = screen.getAllByText('删除');
    expect(deleteButtons[0]).toBeDefined();
    fireEvent.click(deleteButtons[0]!);
    const marks = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.right[0]!.road_marks;
    expect(marks).toHaveLength(1);
  });

  it('edits and saves a marking', () => {
    setupStore([defaultMark], laneNode);
    render(<RoadMarkingPanel />);
    fireEvent.click(screen.getByText('编辑'));
    // Change type
    const select = screen.getByLabelText('类型');
    fireEvent.change(select, { target: { value: 'Broken' } });
    fireEvent.click(screen.getByText('保存'));
    const mark = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.right[0]!.road_marks[0]!;
    expect(mark.mark_type).toBe('Broken');
  });

  it('cancels editing and restores original values', () => {
    setupStore([defaultMark], laneNode);
    render(<RoadMarkingPanel />);
    fireEvent.click(screen.getByText('编辑'));
    const select = screen.getByLabelText('类型');
    fireEvent.change(select, { target: { value: 'Broken' } });
    fireEvent.click(screen.getByText('取消'));
    const mark = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.right[0]!.road_marks[0]!;
    expect(mark.mark_type).toBe('Solid');
  });

  it('sorts marks by s_offset', () => {
    setupStore([
      { ...defaultMark, s_offset: 50 },
      { ...defaultMark, s_offset: 10 },
      { ...defaultMark, s_offset: 30 },
    ], laneNode);
    render(<RoadMarkingPanel />);
    const items = screen.getAllByTestId('marking-row');
    expect(items[0]).toHaveTextContent('10');
    expect(items[1]).toHaveTextContent('30');
    expect(items[2]).toHaveTextContent('50');
  });
});
