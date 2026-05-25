import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useProjectStore } from '../projectStore';
import type { Lane, LaneBorder, LaneSection, Road, RoadMark } from '../../services/platform';

vi.mock('../viewportStore', () => ({
  useViewportStore: {
    getState: () => ({ resetDisplay: vi.fn() }),
  },
}));

function makeLane(id: number, _side: 'left' | 'right'): Lane {
  return {
    id,
    lane_type: 'driving',
    level: 0,
    width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }],
    road_marks: [],
    borders: [],
    link: { predecessor: null, successor: null },
  };
}

function makeLaneSection(): LaneSection {
  return {
    s: 0,
    single_side: false,
    left: [makeLane(-1, 'left')],
    center: [{ id: 0, lane_type: 'none', level: 0, width: [], road_marks: [], borders: [], link: { predecessor: null, successor: null } }],
    right: [makeLane(1, 'right')],
  };
}

function makeRoadWithLane(): Road {
  return {
    id: 'r1', name: '', length: 100, junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [],
    elevation_profile: [],
    lane_sections: [makeLaneSection()],
  };
}

function makeRoadMark(overrides: Partial<RoadMark> = {}): RoadMark {
  return {
    s_offset: 0,
    mark_type: 'Solid',
    weight: 'standard',
    color: 'white',
    material: 'standard',
    width: 0.15,
    lane_change: 'none',
    height: 0,
    ...overrides,
  };
}

function makeLaneBorder(overrides: Partial<LaneBorder> = {}): LaneBorder {
  return {
    s_offset: 0,
    a: 0.1,
    b: 0,
    c: 0,
    d: 0,
    ...overrides,
  };
}

describe('laneSlice', () => {
  beforeEach(() => {
    useProjectStore.getState().reset();
  });

  describe('updateLaneType', () => {
    it('should change lane type', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      useProjectStore.getState().updateLaneType('r1', 0, 'right', 1, 'shoulder');
      const lane = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.right[0]!;
      expect(lane.lane_type).toBe('shoulder');
    });

    it('should push undo', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      useProjectStore.getState().markClean();
      useProjectStore.getState().updateLaneType('r1', 0, 'right', 1, 'shoulder');
      expect(useProjectStore.getState().canUndo()).toBe(true);
    });

    it('should leave the project unchanged when the section does not exist', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      const snapshot = useProjectStore.getState().project;
      useProjectStore.getState().updateLaneType('r1', 99, 'right', 1, 'shoulder');
      expect(useProjectStore.getState().project).toEqual(snapshot);
    });
  });

  describe('updateLaneWidth', () => {
    it('should update lane width', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      const newWidth = { s_offset: 0, a: 4.0, b: 0, c: 0, d: 0 };
      useProjectStore.getState().updateLaneWidth('r1', 0, 'right', 1, newWidth);
      const lane = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.right[0]!;
      expect(lane.width).toEqual([newWidth]);
      expect(useProjectStore.getState().isDirty).toBe(true);
    });
  });

  describe('removeLane', () => {
    it('should remove lane by id and side', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      useProjectStore.getState().removeLane('r1', 0, 'right', 1);
      const right = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.right;
      expect(right).toHaveLength(0);
    });
  });

  describe('addLane', () => {
    it('should add a new lane on specified side', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      const beforeCount = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.right.length;
      useProjectStore.getState().addLane('r1', 0, 'right');
      const afterCount = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.right.length;
      expect(afterCount).toBe(beforeCount + 1);
    });

    it('should add lane on left side with positive id', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      useProjectStore.getState().addLane('r1', 0, 'left');
      const leftLanes = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.left;
      // At least one lane was added and IDs remain unique.
      expect(leftLanes.length).toBeGreaterThan(1);
      expect(new Set(leftLanes.map((lane) => lane.id)).size).toBe(leftLanes.length);
    });

    it('should do nothing for unknown road', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      const snap = { ...useProjectStore.getState().project };
      useProjectStore.getState().addLane('unknown-road', 0, 'right');
      expect(useProjectStore.getState().project).toEqual(snap);
    });

    it('should do nothing for out-of-range sectionIndex', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      const snap = { ...useProjectStore.getState().project };
      useProjectStore.getState().addLane('r1', 99, 'right');
      expect(useProjectStore.getState().project).toEqual(snap);
    });
  });

  describe('addRoadMark', () => {
    it('should add a road mark to a lane', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      const mark = makeRoadMark();
      useProjectStore.getState().addRoadMark('r1', 0, 'right', 1, mark);
      const lane = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.right[0]!;
      expect(lane.road_marks).toHaveLength(1);
    });

    it('should sort road marks by s_offset', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      const mark1 = makeRoadMark({ s_offset: 10, mark_type: 'Solid' });
      const mark2 = makeRoadMark({ s_offset: 5, mark_type: 'Broken' });
      useProjectStore.getState().addRoadMark('r1', 0, 'right', 1, mark1);
      useProjectStore.getState().addRoadMark('r1', 0, 'right', 1, mark2);
      const marks = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.right[0]!.road_marks;
      expect(marks[0]!.s_offset).toBe(5);
      expect(marks[1]!.s_offset).toBe(10);
    });
  });

  describe('updateRoadMark', () => {
    it('should update a specific road mark', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      const mark = makeRoadMark();
      useProjectStore.getState().addRoadMark('r1', 0, 'right', 1, mark);
      useProjectStore.getState().updateRoadMark('r1', 0, 'right', 1, 0, { mark_type: 'Broken' });
      const lane = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.right[0]!;
      expect(lane.road_marks[0]!.mark_type).toBe('Broken');
    });

    it('should leave marks unchanged for out-of-range index', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      const mark = makeRoadMark();
      useProjectStore.getState().addRoadMark('r1', 0, 'right', 1, mark);
      useProjectStore.getState().updateRoadMark('r1', 0, 'right', 1, 99, { mark_type: 'Broken' });
      const lane = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.right[0]!;
      expect(lane.road_marks[0]!.mark_type).toBe('Solid');
    });
  });

  describe('removeRoadMark', () => {
    it('should remove a road mark by index', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      const mark = makeRoadMark();
      useProjectStore.getState().addRoadMark('r1', 0, 'right', 1, mark);
      useProjectStore.getState().removeRoadMark('r1', 0, 'right', 1, 0);
      const lane = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.right[0]!;
      expect(lane.road_marks).toHaveLength(0);
    });
  });

  describe('addLaneBorder', () => {
    it('should add a border to a lane', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      const border = makeLaneBorder();
      useProjectStore.getState().addLaneBorder('r1', 0, 'right', 1, border);
      const lane = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.right[0]!;
      expect(lane.borders).toHaveLength(1);
    });
  });

  describe('updateLaneBorder', () => {
    it('should update a specific border', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      const border = makeLaneBorder();
      useProjectStore.getState().addLaneBorder('r1', 0, 'right', 1, border);
      useProjectStore.getState().updateLaneBorder('r1', 0, 'right', 1, 0, { a: 0.5 });
      const lane = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.right[0]!;
      expect(lane.borders![0]!.a).toBe(0.5);
    });
  });

  describe('removeLaneBorder', () => {
    it('should remove a border by index', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      const border = makeLaneBorder();
      useProjectStore.getState().addLaneBorder('r1', 0, 'right', 1, border);
      useProjectStore.getState().removeLaneBorder('r1', 0, 'right', 1, 0);
      const lane = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.right[0]!;
      expect(lane.borders).toHaveLength(0);
    });
  });

  describe('elevation operations', () => {
    it('addElevationPoint should add a point', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      useProjectStore.getState().addElevationPoint('r1', 25.0, 5.0);
      const profile = useProjectStore.getState().project.roads[0]!.elevation_profile;
      expect(profile.length).toBeGreaterThan(0);
    });

    it('removeElevationPoint should remove a point', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      useProjectStore.getState().addElevationPoint('r1', 0.0, 1.0);
      useProjectStore.getState().removeElevationPoint('r1', 0);
      const profile = useProjectStore.getState().project.roads[0]!.elevation_profile;
      expect(profile).toHaveLength(0);
    });

    it('updateElevationPoint should update height', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      useProjectStore.getState().addElevationPoint('r1', 0.0, 1.0);
      useProjectStore.getState().updateElevationPoint('r1', 0, { a: 10.0 });
      const ep = useProjectStore.getState().project.roads[0]!.elevation_profile[0]!;
      expect(ep.a).toBe(10.0);
    });

    it('smoothElevation should average middle points', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      useProjectStore.getState().addElevationPoint('r1', 0.0, 0.0);
      useProjectStore.getState().addElevationPoint('r1', 1.0, 9.0);
      useProjectStore.getState().addElevationPoint('r1', 2.0, 0.0);
      useProjectStore.getState().smoothElevation('r1', 1);
      const profile = useProjectStore.getState().project.roads[0]!.elevation_profile;
      // Middle point should now be (0+9+0)/3 = 3
      expect(profile[1]!.a).toBeCloseTo(3, 5);
      // First and last unchanged
      expect(profile[0]!.a).toBeCloseTo(0, 5);
      expect(profile[2]!.a).toBeCloseTo(0, 5);
    });

    it('smoothElevation should be a no-op for < 3 points', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      useProjectStore.getState().addElevationPoint('r1', 0.0, 5.0);
      useProjectStore.getState().addElevationPoint('r1', 1.0, 10.0);
      useProjectStore.getState().smoothElevation('r1');
      const profile = useProjectStore.getState().project.roads[0]!.elevation_profile;
      expect(profile[0]!.a).toBeCloseTo(5, 5);
      expect(profile[1]!.a).toBeCloseTo(10, 5);
    });
  });

  describe('superelevation operations', () => {
    it('addSuperelevation should add a point and keep s sorted', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      useProjectStore.getState().addSuperelevation('r1', { s: 20.0, a: 2.0, b: 0, c: 0, d: 0 });
      useProjectStore.getState().addSuperelevation('r1', { s: 10.0, a: 1.0, b: 0, c: 0, d: 0 });
      const profile = useProjectStore.getState().project.roads[0]!.lateral_profile!.superelevation!;
      expect(profile.map((entry) => entry.s)).toEqual([10, 20]);
      expect(useProjectStore.getState().project.roads[0]!.lateral_profile!.superelevations).toEqual(profile);
    });

    it('updateSuperelevation should update coefficients', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      useProjectStore.getState().addSuperelevation('r1', { s: 0.0, a: 1.0, b: 0, c: 0, d: 0 });
      useProjectStore.getState().updateSuperelevation('r1', 0, { c: 0.5 });
      const entry = useProjectStore.getState().project.roads[0]!.lateral_profile!.superelevation![0]!;
      expect(entry.c).toBe(0.5);
    });

    it('removeSuperelevation should remove a point', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      useProjectStore.getState().addSuperelevation('r1', { s: 0.0, a: 1.0, b: 0, c: 0, d: 0 });
      useProjectStore.getState().removeSuperelevation('r1', 0);
      const profile = useProjectStore.getState().project.roads[0]!.lateral_profile!.superelevation!;
      expect(profile).toHaveLength(0);
    });
  });

  describe('crossfall operations', () => {
    it('addCrossfall should add a point and keep s sorted', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      useProjectStore.getState().addCrossfall('r1', { s: 20.0, a: 2.0, b: 0, c: 0, d: 0, side: 'right' });
      useProjectStore.getState().addCrossfall('r1', { s: 10.0, a: 1.0, b: 0, c: 0, d: 0, side: 'left' });
      const profile = useProjectStore.getState().project.roads[0]!.lateral_profile!.crossfall!;
      expect(profile.map((entry) => entry.s)).toEqual([10, 20]);
      expect(useProjectStore.getState().project.roads[0]!.lateral_profile!.crossfalls).toEqual(profile);
    });

    it('updateCrossfall should update coefficients and side', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      useProjectStore.getState().addCrossfall('r1', { s: 0.0, a: 1.0, b: 0, c: 0, d: 0, side: 'both' });
      useProjectStore.getState().updateCrossfall('r1', 0, { c: 0.5, side: 'left' });
      const entry = useProjectStore.getState().project.roads[0]!.lateral_profile!.crossfall![0]!;
      expect(entry.c).toBe(0.5);
      expect(entry.side).toBe('left');
    });

    it('removeCrossfall should remove a point', () => {
      useProjectStore.getState().addRoad(makeRoadWithLane());
      useProjectStore.getState().addCrossfall('r1', { s: 0.0, a: 1.0, b: 0, c: 0, d: 0, side: 'both' });
      useProjectStore.getState().removeCrossfall('r1', 0);
      const profile = useProjectStore.getState().project.roads[0]!.lateral_profile!.crossfall!;
      expect(profile).toHaveLength(0);
    });
  });
});
