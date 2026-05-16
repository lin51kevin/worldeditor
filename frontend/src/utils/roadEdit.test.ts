import { describe, it, expect } from 'vitest';
import {
  splitRoadAt,
  weldRoads,
  deploySidewalks,
  applyStandardMarkings,
  deployCrosswalks,
  deployStopLines,
} from './roadEdit';
import type { Lane, LaneSection, Road, Project, Junction } from '../services/platform';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeLane(id: number, type = 'driving'): Lane {
  return {
    id,
    lane_type: type,
    level: 0,
    link: null,
    width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }],
    road_marks: [],
  };
}

function makeLaneSection(rightCount: number, leftCount: number, s = 0): LaneSection {
  return {
    s,
    single_side: false,
    center: [{ id: 0, lane_type: 'none', level: 0, link: null, width: [], road_marks: [] }],
    right: Array.from({ length: rightCount }, (_, i) => makeLane(-(i + 1))),
    left: Array.from({ length: leftCount }, (_, i) => makeLane(i + 1)),
  };
}

function makeRoad(id: string, length: number, rightLanes = 2, leftLanes = 2): Road {
  return {
    id,
    name: `Road ${id}`,
    length,
    junction_id: null,
    link: null,
    plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length, geo_type: 'Line' }],
    elevation_profile: [],
    lane_sections: [makeLaneSection(rightLanes, leftLanes)],
  };
}

function makeProject(roads: Road[] = [], junctions: Junction[] = []): Project {
  return {
    name: 'Test',
    header: {
      rev_major: 1, rev_minor: 6, name: '', date: '',
      north: 0, south: 0, east: 0, west: 0, geo_reference: null,
    },
    roads,
    junctions,
    signals: [],
    objects: [],
  };
}

// ─── splitRoadAt ──────────────────────────────────────────────────────────────

describe('splitRoadAt', () => {
  it('splits a line road into two halves at midpoint', () => {
    const road = makeRoad('r1', 100);
    const { road1, road2 } = splitRoadAt(road, 50);

    expect(road1.length).toBeCloseTo(50);
    expect(road2.length).toBeCloseTo(50);
  });

  it('plan_view lengths match split', () => {
    const road = makeRoad('r1', 100);
    const { road1, road2 } = splitRoadAt(road, 50);

    expect(road1.plan_view[0]!.length).toBeCloseTo(50);
    expect(road2.plan_view[0]!.length).toBeCloseTo(50);
  });

  it('positions road2 start at the split point for hdg=0', () => {
    const road = makeRoad('r1', 100);
    const { road2 } = splitRoadAt(road, 50);

    expect(road2.plan_view[0]!.x).toBeCloseTo(50);
    expect(road2.plan_view[0]!.y).toBeCloseTo(0);
    expect(road2.plan_view[0]!.s).toBeCloseTo(0);
  });

  it('positions road2 correctly for a road heading north (hdg = π/2)', () => {
    const road: Road = {
      ...makeRoad('r1', 100),
      plan_view: [{ s: 0, x: 10, y: 20, hdg: Math.PI / 2, length: 100, geo_type: 'Line' }],
    };
    const { road2 } = splitRoadAt(road, 40);

    expect(road2.plan_view[0]!.x).toBeCloseTo(10);
    expect(road2.plan_view[0]!.y).toBeCloseTo(60); // 20 + 40*sin(π/2)
  });

  it('throws when splitS is 0', () => {
    expect(() => splitRoadAt(makeRoad('r1', 100), 0)).toThrow();
  });

  it('throws when splitS equals road.length', () => {
    expect(() => splitRoadAt(makeRoad('r1', 100), 100)).toThrow();
  });

  it('throws when splitS exceeds road.length', () => {
    expect(() => splitRoadAt(makeRoad('r1', 100), 150)).toThrow();
  });

  it('gives each half a unique id different from the original', () => {
    const road = makeRoad('r1', 100);
    const { road1, road2 } = splitRoadAt(road, 50);

    expect(road1.id).not.toBe(road2.id);
    expect(road1.id).not.toBe(road.id);
    expect(road2.id).not.toBe(road.id);
  });

  it('creates a junction between the two halves', () => {
    const road = makeRoad('r1', 100);
    const { road1, road2, junction } = splitRoadAt(road, 50);

    expect(junction.connections).toHaveLength(1);
    expect(junction.connections[0]!.incoming_road).toBe(road1.id);
    expect(junction.connections[0]!.connecting_road).toBe(road2.id);
  });

  it('links road1 successor to the new junction', () => {
    const road = makeRoad('r1', 100);
    const { road1, junction } = splitRoadAt(road, 50);

    expect(road1.link?.successor?.element_id).toBe(junction.id);
    expect(road1.link?.successor?.element_type).toBe('Junction');
  });

  it('links road2 predecessor to the new junction', () => {
    const road = makeRoad('r1', 100);
    const { road2, junction } = splitRoadAt(road, 50);

    expect(road2.link?.predecessor?.element_id).toBe(junction.id);
    expect(road2.link?.predecessor?.element_type).toBe('Junction');
  });

  it('preserves lane sections in both halves', () => {
    const road = makeRoad('r1', 100, 2, 2);
    const { road1, road2 } = splitRoadAt(road, 50);

    expect(road1.lane_sections[0]!.right).toHaveLength(2);
    expect(road2.lane_sections[0]!.right).toHaveLength(2);
  });

  it('splits a road with multiple geometry segments', () => {
    const road: Road = {
      ...makeRoad('r1', 100),
      plan_view: [
        { s: 0, x: 0, y: 0, hdg: 0, length: 60, geo_type: 'Line' },
        { s: 60, x: 60, y: 0, hdg: 0, length: 40, geo_type: 'Line' },
      ],
    };
    const { road1, road2 } = splitRoadAt(road, 80);

    expect(road1.length).toBeCloseTo(80);
    expect(road2.length).toBeCloseTo(20);
    expect(road1.plan_view).toHaveLength(2); // 60m segment + partial 40m segment
    expect(road2.plan_view).toHaveLength(1);
  });

  it('splits non-evenly (70/30)', () => {
    const road = makeRoad('r1', 100);
    const { road1, road2 } = splitRoadAt(road, 70);

    expect(road1.length).toBeCloseTo(70);
    expect(road2.length).toBeCloseTo(30);
  });
});

// ─── weldRoads ────────────────────────────────────────────────────────────────

describe('weldRoads', () => {
  it('sums the lengths of both roads', () => {
    const r1 = makeRoad('r1', 60);
    const r2 = makeRoad('r2', 40);
    const welded = weldRoads(r1, r2);

    expect(welded.length).toBeCloseTo(100);
  });

  it('concatenates plan_view segments', () => {
    const r1 = makeRoad('r1', 60);
    const r2 = makeRoad('r2', 40);
    const welded = weldRoads(r1, r2);

    expect(welded.plan_view).toHaveLength(2);
  });

  it('offsets road2 geometry s values by road1.length', () => {
    const r1 = makeRoad('r1', 60);
    const r2 = makeRoad('r2', 40);
    const welded = weldRoads(r1, r2);

    expect(welded.plan_view[1]!.s).toBeCloseTo(60);
  });

  it('offsets road2 geometry x,y for hdg=0 (heading east)', () => {
    const r1 = makeRoad('r1', 60);
    const r2: Road = {
      ...makeRoad('r2', 40),
      plan_view: [{ s: 0, x: 0, y: 5, hdg: 0, length: 40, geo_type: 'Line' }],
    };
    const welded = weldRoads(r1, r2);
    // road2's x is not re-positioned — it keeps its own coordinate
    expect(welded.plan_view[1]!.s).toBeCloseTo(60);
  });

  it('concatenates lane sections and offsets their s values', () => {
    const r1 = makeRoad('r1', 60);
    const r2 = makeRoad('r2', 40);
    const welded = weldRoads(r1, r2);

    expect(welded.lane_sections).toHaveLength(2);
    expect(welded.lane_sections[1]!.s).toBeCloseTo(60);
  });

  it('uses road1 predecessor and road2 successor for links', () => {
    const r1: Road = {
      ...makeRoad('r1', 60),
      link: {
        predecessor: { element_id: 'prev', element_type: 'Road', contact_point: 'End' },
        successor: null,
      },
    };
    const r2: Road = {
      ...makeRoad('r2', 40),
      link: {
        predecessor: null,
        successor: { element_id: 'next', element_type: 'Road', contact_point: 'Start' },
      },
    };
    const welded = weldRoads(r1, r2);

    expect(welded.link?.predecessor?.element_id).toBe('prev');
    expect(welded.link?.successor?.element_id).toBe('next');
  });

  it('uses road1.id for the welded road id', () => {
    const r1 = makeRoad('r1', 60);
    const r2 = makeRoad('r2', 40);
    const welded = weldRoads(r1, r2);

    expect(welded.id).toBe('r1');
  });
});

// ─── deploySidewalks ──────────────────────────────────────────────────────────

describe('deploySidewalks', () => {
  it('adds a sidewalk lane on the left side', () => {
    const road = makeRoad('r1', 100, 2, 2);
    const result = deploySidewalks(road);

    const hasSidewalk = result.lane_sections[0]!.left.some((l) => l.lane_type === 'Sidewalk');
    expect(hasSidewalk).toBe(true);
  });

  it('adds a sidewalk lane on the right side', () => {
    const road = makeRoad('r1', 100, 2, 2);
    const result = deploySidewalks(road);

    const hasSidewalk = result.lane_sections[0]!.right.some((l) => l.lane_type === 'Sidewalk');
    expect(hasSidewalk).toBe(true);
  });

  it('places sidewalk at outermost left position (max id + 1)', () => {
    const road = makeRoad('r1', 100, 2, 2); // left lanes: id=1, id=2
    const result = deploySidewalks(road);

    const leftIds = result.lane_sections[0]!.left.map((l) => l.id);
    expect(Math.max(...leftIds)).toBe(3);
  });

  it('places sidewalk at outermost right position (min id - 1)', () => {
    const road = makeRoad('r1', 100, 2, 2); // right lanes: id=-1, id=-2
    const result = deploySidewalks(road);

    const rightIds = result.lane_sections[0]!.right.map((l) => l.id);
    expect(Math.min(...rightIds)).toBe(-3);
  });

  it('does not add duplicate sidewalks (left)', () => {
    let road = makeRoad('r1', 100, 2, 2);
    road = deploySidewalks(road);
    const afterFirst = road.lane_sections[0]!.left.filter((l) => l.lane_type === 'Sidewalk').length;
    road = deploySidewalks(road);
    const afterSecond = road.lane_sections[0]!.left.filter((l) => l.lane_type === 'Sidewalk').length;
    expect(afterSecond).toBe(afterFirst);
  });

  it('does not add duplicate sidewalks (right)', () => {
    let road = makeRoad('r1', 100, 2, 2);
    road = deploySidewalks(road);
    const afterFirst = road.lane_sections[0]!.right.filter((l) => l.lane_type === 'Sidewalk').length;
    road = deploySidewalks(road);
    const afterSecond = road.lane_sections[0]!.right.filter((l) => l.lane_type === 'Sidewalk').length;
    expect(afterSecond).toBe(afterFirst);
  });

  it('handles a road with no left lanes (only right)', () => {
    const road = makeRoad('r1', 100, 2, 0);
    const result = deploySidewalks(road);

    const hasRightSidewalk = result.lane_sections[0]!.right.some((l) => l.lane_type === 'Sidewalk');
    expect(hasRightSidewalk).toBe(true);
    const hasLeftSidewalk = result.lane_sections[0]!.left.some((l) => l.lane_type === 'Sidewalk');
    expect(hasLeftSidewalk).toBe(true); // adds sidewalk at id=1 even if no lanes before it
  });

  it('applies correct default sidewalk width', () => {
    const road = makeRoad('r1', 100, 1, 0);
    const result = deploySidewalks(road);
    const sidewalk = result.lane_sections[0]!.right.find((l) => l.lane_type === 'Sidewalk');
    expect(sidewalk?.width[0]?.a).toBeCloseTo(2.0);
  });

  it('respects custom sidewalk width', () => {
    const road = makeRoad('r1', 100, 1, 0);
    const result = deploySidewalks(road, 3.5);
    const sidewalk = result.lane_sections[0]!.right.find((l) => l.lane_type === 'Sidewalk');
    expect(sidewalk?.width[0]?.a).toBeCloseTo(3.5);
  });

  it('applies road mark to deployed sidewalk', () => {
    const road = makeRoad('r1', 100, 1, 0);
    const result = deploySidewalks(road);
    const sidewalk = result.lane_sections[0]!.right.find((l) => l.lane_type === 'Sidewalk');
    expect(sidewalk?.road_marks).toHaveLength(1);
    expect(sidewalk?.road_marks[0]?.mark_type).toBe('Solid');
  });

  it('does not mutate the original road', () => {
    const road = makeRoad('r1', 100, 2, 2);
    const original = road.lane_sections[0]!.left.length;
    deploySidewalks(road);
    expect(road.lane_sections[0]!.left.length).toBe(original);
  });
});

// ─── applyStandardMarkings ────────────────────────────────────────────────────

describe('applyStandardMarkings', () => {
  it('sets solid mark on the outermost right lane (min id)', () => {
    const road = makeRoad('r1', 100, 2, 0); // right: id=-1, id=-2
    const result = applyStandardMarkings(road);
    const outer = result.lane_sections[0]!.right.find((l) => l.id === -2);
    expect(outer?.road_marks[0]?.mark_type).toBe('Solid');
  });

  it('sets broken mark on inner right lanes', () => {
    const road = makeRoad('r1', 100, 2, 0);
    const result = applyStandardMarkings(road);
    const inner = result.lane_sections[0]!.right.find((l) => l.id === -1);
    expect(inner?.road_marks[0]?.mark_type).toBe('Broken');
  });

  it('sets solid mark on the outermost left lane (max id)', () => {
    const road = makeRoad('r1', 100, 0, 2); // left: id=1, id=2
    const result = applyStandardMarkings(road);
    const outer = result.lane_sections[0]!.left.find((l) => l.id === 2);
    expect(outer?.road_marks[0]?.mark_type).toBe('Solid');
  });

  it('sets broken mark on inner left lanes', () => {
    const road = makeRoad('r1', 100, 0, 2);
    const result = applyStandardMarkings(road);
    const inner = result.lane_sections[0]!.left.find((l) => l.id === 1);
    expect(inner?.road_marks[0]?.mark_type).toBe('Broken');
  });

  it('does not throw for a road with no driving lanes', () => {
    const road = makeRoad('r1', 100, 0, 0);
    expect(() => applyStandardMarkings(road)).not.toThrow();
  });

  it('sets color to white for all marks', () => {
    const road = makeRoad('r1', 100, 2, 2);
    const result = applyStandardMarkings(road);
    const allMarks = [
      ...result.lane_sections[0]!.left,
      ...result.lane_sections[0]!.right,
    ].flatMap((l) => l.road_marks);
    expect(allMarks.every((m) => m.color === 'White')).toBe(true);
  });

  it('does not mutate the original road', () => {
    const road = makeRoad('r1', 100, 2, 2);
    applyStandardMarkings(road);
    expect(road.lane_sections[0]!.right[0]!.road_marks).toHaveLength(0);
  });

  it('handles multiple lane sections', () => {
    const road: Road = {
      ...makeRoad('r1', 100),
      lane_sections: [
        makeLaneSection(2, 2, 0),
        makeLaneSection(1, 1, 50),
      ],
    };
    const result = applyStandardMarkings(road);
    expect(result.lane_sections[0]!.right.find((l) => l.id === -2)?.road_marks[0]?.mark_type).toBe('Solid');
    expect(result.lane_sections[1]!.right.find((l) => l.id === -1)?.road_marks[0]?.mark_type).toBe('Solid');
  });
});

// ─── deployCrosswalks ─────────────────────────────────────────────────────────

describe('deployCrosswalks', () => {
  it('returns project unchanged for unknown junctionId', () => {
    const project = makeProject();
    const result = deployCrosswalks(project, 'nonexistent');
    expect(result).toBe(project);
  });

  it('adds a crosswalk object for each connecting road', () => {
    const road = makeRoad('r-connect', 20);
    const junction: Junction = {
      id: 'j1',
      name: 'J1',
      connections: [{
        id: 'c1', incoming_road: 'r-in', connecting_road: 'r-connect',
        contact_point: 'Start', lane_links: [],
      }],
    };
    const project = makeProject([road], [junction]);
    const result = deployCrosswalks(project, 'j1');

    const crosswalks = (result.objects ?? []).filter((o) => o.type === 'crosswalk');
    expect(crosswalks).toHaveLength(1);
    expect(crosswalks[0]?.roadId).toBe('r-connect');
  });

  it('places the crosswalk at mid-road (sPosition = length/2)', () => {
    const road = makeRoad('r-connect', 20);
    const junction: Junction = {
      id: 'j1', name: 'J1',
      connections: [{ id: 'c1', incoming_road: 'r-in', connecting_road: 'r-connect', contact_point: 'Start', lane_links: [] }],
    };
    const project = makeProject([road], [junction]);
    const result = deployCrosswalks(project, 'j1');

    const cw = (result.objects ?? []).find((o) => o.type === 'crosswalk');
    expect(cw?.sPosition).toBeCloseTo(10);
  });

  it('does not mutate the original project', () => {
    const project = makeProject();
    deployCrosswalks(project, 'nonexistent');
    expect(project.objects).toEqual([]);
  });
});

// ─── deployStopLines ──────────────────────────────────────────────────────────

describe('deployStopLines', () => {
  it('returns project unchanged for unknown junctionId', () => {
    const project = makeProject();
    const result = deployStopLines(project, 'nonexistent');
    expect(result).toBe(project);
  });

  it('adds a stop line object for each incoming road', () => {
    const road = makeRoad('r-in', 50);
    const junction: Junction = {
      id: 'j1', name: 'J1',
      connections: [{ id: 'c1', incoming_road: 'r-in', connecting_road: 'r-con', contact_point: 'Start', lane_links: [] }],
    };
    const project = makeProject([road], [junction]);
    const result = deployStopLines(project, 'j1');

    const stopLines = (result.objects ?? []).filter((o) => o.type === 'stopline');
    expect(stopLines).toHaveLength(1);
    expect(stopLines[0]?.roadId).toBe('r-in');
  });

  it('places the stop line 1m before road end', () => {
    const road = makeRoad('r-in', 50);
    const junction: Junction = {
      id: 'j1', name: 'J1',
      connections: [{ id: 'c1', incoming_road: 'r-in', connecting_road: 'r-con', contact_point: 'Start', lane_links: [] }],
    };
    const project = makeProject([road], [junction]);
    const result = deployStopLines(project, 'j1');

    const sl = (result.objects ?? []).find((o) => o.type === 'stopline');
    expect(sl?.sPosition).toBeCloseTo(49);
  });

  it('deduplicates incoming roads with multiple connections', () => {
    const road = makeRoad('r-in', 50);
    const junction: Junction = {
      id: 'j1', name: 'J1',
      connections: [
        { id: 'c1', incoming_road: 'r-in', connecting_road: 'r-con1', contact_point: 'Start', lane_links: [] },
        { id: 'c2', incoming_road: 'r-in', connecting_road: 'r-con2', contact_point: 'Start', lane_links: [] },
      ],
    };
    const project = makeProject([road], [junction]);
    const result = deployStopLines(project, 'j1');

    const stopLines = (result.objects ?? []).filter((o) => o.type === 'stopline');
    expect(stopLines).toHaveLength(1); // r-in appears twice but is one road
  });
});
