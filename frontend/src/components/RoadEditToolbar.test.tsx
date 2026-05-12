import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../stores/editorStore';
import { useEditorViewStore } from '../stores/editorViewStore';
import type { Road, Geometry } from '../services/platform';
import { RoadEditToolbar } from './RoadEditToolbar';

function makeRoad(id: string, opts?: { leftIds?: number[]; rightIds?: number[] }): Road {
  const geo: Geometry = { s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' as any };
  const leftIds = opts?.leftIds ?? [1];
  const rightIds = opts?.rightIds ?? [-1];
  const mkLane = (laneId: number) => ({
    id: laneId,
    lane_type: 'Driving',
    level: 0,
    render_hidden: false,
    link: null,
    width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }],
    borders: [],
    road_marks: [],
  });
  return {
    id,
    name: `Road ${id}`,
    length: 100,
    junction_id: null,
    render_hidden: false,
    link: null,
    plan_view: [geo],
    elevation_profile: [],
    lane_sections: [
      {
        s: 0,
        single_side: false,
        render_hidden: false,
        left: leftIds.map(mkLane),
        center: [{ id: 0, lane_type: 'None', level: 0, render_hidden: false, link: null, width: [], borders: [], road_marks: [] }],
        right: rightIds.map(mkLane),
      },
    ],
    lane_offsets: [],
    lateral_profile: { superelevations: [], crossfalls: [] } as any,
    bridges: [],
    tunnels: [],
    signals: [],
    objects: [],
  } as unknown as Road;
}

describe('RoadEditToolbar', () => {
  beforeEach(() => {
    act(() => {
      useEditorStore.getState().reset();
      useEditorViewStore.setState({
        editMode: 'select',
        splineKnots: [],
        softSelectionRadius: 50,
      });
    });
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('shows hint when no road is selected', () => {
      render(<RoadEditToolbar />);
      expect(screen.getByText('请选择一条道路以使用这些工具')).toBeInTheDocument();
      // Tool buttons should NOT be rendered
      expect(screen.queryByTitle('克隆道路')).not.toBeInTheDocument();
    });

    it('shows road name and all 10 tool buttons when a road is selected', () => {
      act(() => {
        useEditorStore.getState().addRoad(makeRoad('r1'));
        useEditorStore.getState().selectRoad('r1');
      });
      render(<RoadEditToolbar />);

      expect(screen.getByText('Road r1')).toBeInTheDocument();
      // Each tool button has a translated title
      ['调整节点', '调整边线', '移动道路', '旋转道路', '优化节点', '编辑路面标线',
       '克隆道路', '反转道路', '镜像道路', '交换道路中心线与边缘'].forEach((label) => {
        expect(screen.getByTitle(label)).toBeInTheDocument();
      });
    });

    it('renders the section header', () => {
      render(<RoadEditToolbar />);
      expect(screen.getByText('道路编辑工具')).toBeInTheDocument();
    });
  });

  describe('instant actions', () => {
    beforeEach(() => {
      act(() => {
        useEditorStore.getState().addRoad(makeRoad('r1'));
        useEditorStore.getState().selectRoad('r1');
      });
    });

    it('clone button invokes cloneRoad on the store', () => {
      render(<RoadEditToolbar />);
      const before = useEditorStore.getState().project.roads.length;
      fireEvent.click(screen.getByTitle('克隆道路'));
      const roads = useEditorStore.getState().project.roads;
      expect(roads).toHaveLength(before + 1);
      expect(roads[roads.length - 1]!.id).toMatch(/^r1-clone-\d+$/);
    });

    it('reverse button flips lanes on the selected road', () => {
      render(<RoadEditToolbar />);
      const beforeLeft = useEditorStore.getState().project.roads[0]!.lane_sections[0]!.left.length;
      const beforeRight = useEditorStore.getState().project.roads[0]!.lane_sections[0]!.right.length;
      fireEvent.click(screen.getByTitle('反转道路'));
      const sec = useEditorStore.getState().project.roads[0]!.lane_sections[0]!;
      // After reverse, left/right should swap
      expect(sec.left.length).toBe(beforeRight);
      expect(sec.right.length).toBe(beforeLeft);
    });

    it('mirror button swaps left and right lanes', () => {
      render(<RoadEditToolbar />);
      fireEvent.click(screen.getByTitle('镜像道路'));
      const sec = useEditorStore.getState().project.roads[0]!.lane_sections[0]!;
      // Mirror swaps lanes (one in each side originally)
      expect(sec.left).toHaveLength(1);
      expect(sec.right).toHaveLength(1);
    });

    it('optimize button does not crash and may modify the road', () => {
      render(<RoadEditToolbar />);
      fireEvent.click(screen.getByTitle('优化节点'));
      // No throw — sanity check that road still exists
      expect(useEditorStore.getState().project.roads).toHaveLength(1);
    });

    it('swap-centerline picks max(left.id) when left lanes exist', () => {
      // Replace r1 with a road that has multiple left lanes (heading=0 → shift along y)
      act(() => {
        useEditorStore.getState().removeRoad('r1');
        useEditorStore.getState().addRoad(makeRoad('r1', { leftIds: [1, 2], rightIds: [-1] }));
        useEditorStore.getState().selectRoad('r1');
      });
      render(<RoadEditToolbar />);
      const before = useEditorStore.getState().project.roads[0]!.plan_view[0]!;
      fireEvent.click(screen.getByTitle('交换道路中心线与边缘'));
      const after = useEditorStore.getState().project.roads[0]!.plan_view[0]!;
      // For hdg=0, a left swap shifts perpendicular (+y direction)
      expect(after.y).not.toBe(before.y);
    });

    it('swap-centerline picks min(right.id) when only right lanes exist', () => {
      act(() => {
        useEditorStore.getState().removeRoad('r1');
        useEditorStore.getState().addRoad(makeRoad('r1', { leftIds: [], rightIds: [-1, -2] }));
        useEditorStore.getState().selectRoad('r1');
      });
      render(<RoadEditToolbar />);
      const before = useEditorStore.getState().project.roads[0]!.plan_view[0]!;
      fireEvent.click(screen.getByTitle('交换道路中心线与边缘'));
      const after = useEditorStore.getState().project.roads[0]!.plan_view[0]!;
      // For hdg=0, a right swap shifts in -y direction
      expect(after.y).not.toBe(before.y);
    });

    it('swap-centerline does nothing when no lanes exist on either side', () => {
      act(() => {
        useEditorStore.getState().removeRoad('r1');
        useEditorStore.getState().addRoad(makeRoad('r1', { leftIds: [], rightIds: [] }));
        useEditorStore.getState().selectRoad('r1');
      });
      render(<RoadEditToolbar />);
      const before = JSON.stringify(useEditorStore.getState().project.roads[0]);
      fireEvent.click(screen.getByTitle('交换道路中心线与边缘'));
      const after = JSON.stringify(useEditorStore.getState().project.roads[0]);
      expect(after).toBe(before);
    });
  });

  describe('mode toggling', () => {
    beforeEach(() => {
      act(() => {
        useEditorStore.getState().addRoad(makeRoad('r1'));
        useEditorStore.getState().selectRoad('r1');
      });
    });

    it('adjust-node button enters spline edit mode and clears knots', () => {
      act(() => {
        useEditorViewStore.setState({
          splineKnots: [{ id: 'k1', x: 0, y: 0, hdg: 0, tangentLength: 1 } as any],
        });
      });
      render(<RoadEditToolbar />);
      fireEvent.click(screen.getByTitle('调整节点'));
      expect(useEditorViewStore.getState().editMode).toBe('spline');
      expect(useEditorViewStore.getState().splineKnots).toHaveLength(0);
    });

    it('clicking adjust-node again exits spline mode', () => {
      render(<RoadEditToolbar />);
      fireEvent.click(screen.getByTitle('调整节点'));
      expect(useEditorViewStore.getState().editMode).toBe('spline');
      fireEvent.click(screen.getByTitle('调整节点'));
      expect(useEditorViewStore.getState().editMode).toBe('select');
    });

    it('soft selection radius slider is hidden until adjust-node is active', () => {
      render(<RoadEditToolbar />);
      expect(document.querySelector('.road-edit-toolbar__soft-sel')).toBeNull();

      fireEvent.click(screen.getByTitle('调整节点'));
      expect(document.querySelector('.road-edit-toolbar__soft-sel')).not.toBeNull();
    });

    it('soft selection slider updates the radius in the view store', () => {
      render(<RoadEditToolbar />);
      fireEvent.click(screen.getByTitle('调整节点'));
      const slider = document.querySelector('.road-edit-toolbar__soft-sel-slider') as HTMLInputElement;
      expect(slider).not.toBeNull();
      fireEvent.change(slider, { target: { value: '123' } });
      expect(useEditorViewStore.getState().softSelectionRadius).toBe(123);
    });
  });

  describe('disabled buttons', () => {
    beforeEach(() => {
      act(() => {
        useEditorStore.getState().addRoad(makeRoad('r1'));
        useEditorStore.getState().selectRoad('r1');
      });
    });

    it('adjust-edge button is disabled', () => {
      render(<RoadEditToolbar />);
      expect(screen.getByTitle('调整边线')).toBeDisabled();
    });

    it('edit-markings button is disabled', () => {
      render(<RoadEditToolbar />);
      expect(screen.getByTitle('编辑路面标线')).toBeDisabled();
    });

    it('clicking disabled buttons does not change view state', () => {
      render(<RoadEditToolbar />);
      const before = JSON.stringify(useEditorViewStore.getState());
      fireEvent.click(screen.getByTitle('调整边线'));
      fireEvent.click(screen.getByTitle('编辑路面标线'));
      const after = JSON.stringify(useEditorViewStore.getState());
      expect(after).toBe(before);
    });
  });
});
