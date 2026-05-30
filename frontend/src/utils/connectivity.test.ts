import { describe, expect, it } from 'vitest';
import type { Lane, LaneSection, Project, Road } from '../services/platform';
import { resolveConnectivity } from './connectivity';
import type { SceneNodeSelection } from './sceneGraph';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeLane(id: number, pred: number | null = null, succ: number | null = null): Lane {
  return {
    id,
    lane_type: 'Driving',
    level: 0,
    link: pred != null || succ != null ? { predecessor: pred, successor: succ } : null,
    width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }],
    road_marks: [],
  };
}

function makeSection(s: number, leftLanes: Lane[], rightLanes: Lane[]): LaneSection {
  return {
    s,
    single_side: false,
    left: leftLanes,
    center: [{ id: 0, lane_type: 'None', level: 0, link: null, width: [], road_marks: [] }],
    right: rightLanes,
  };
}

function makeRoad(
  id: string,
  sections: LaneSection[],
  link?: Road['link'],
): Road {
  return {
    id,
    name: id,
    length: 100,
    junction_id: null,
    link: link ?? null,
    plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' }],
    elevation_profile: [],
    lane_sections: sections,
  };
}

function makeProject(roads: Road[]): Project {
  return {
    name: 'Test',
    header: {
      rev_major: 1, rev_minor: 6, name: '', date: '',
      north: 0, south: 0, east: 0, west: 0, geo_reference: null,
    },
    roads,
    junctions: [],
    signals: [],
    objects: [],
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('resolveConnectivity', () => {
  // ── Null / unsupported selection ─────────────────────────────────────────

  it('should return empty for null selection', () => {
    const project = makeProject([]);
    const result = resolveConnectivity(project, null);
    expect(result).toEqual({ predecessors: [], successors: [] });
  });

  it('should return empty for junction selection', () => {
    const project = makeProject([]);
    const sel: SceneNodeSelection = { type: 'junction', junctionId: 'j1' };
    const result = resolveConnectivity(project, sel);
    expect(result).toEqual({ predecessors: [], successors: [] });
  });

  // ── Road-level ──────────────────────────────────────────────────────────

  describe('road selection', () => {
    it('should return predecessor and successor roads', () => {
      const r1 = makeRoad('r1', [makeSection(0, [makeLane(1)], [makeLane(-1)])]);
      const r2 = makeRoad('r2', [makeSection(0, [makeLane(1)], [makeLane(-1)])], {
        predecessor: { element_id: 'r1', element_type: 'Road', contact_point: 'End' },
        successor: { element_id: 'r3', element_type: 'Road', contact_point: 'Start' },
      });
      const r3 = makeRoad('r3', [makeSection(0, [makeLane(1)], [makeLane(-1)])]);
      const project = makeProject([r1, r2, r3]);

      const result = resolveConnectivity(project, { type: 'road', roadId: 'r2' });
      expect(result.predecessors).toEqual([{ type: 'road', roadId: 'r1' }]);
      expect(result.successors).toEqual([{ type: 'road', roadId: 'r3' }]);
    });

    it('should skip junction-type links', () => {
      const r1 = makeRoad('r1', [makeSection(0, [makeLane(1)], [makeLane(-1)])], {
        predecessor: { element_id: 'j1', element_type: 'Junction', contact_point: null },
        successor: null,
      });
      const project = makeProject([r1]);

      const result = resolveConnectivity(project, { type: 'road', roadId: 'r1' });
      expect(result.predecessors).toEqual([]);
      expect(result.successors).toEqual([]);
    });

    it('should return empty when road has no link', () => {
      const r1 = makeRoad('r1', [makeSection(0, [makeLane(1)], [makeLane(-1)])]);
      const project = makeProject([r1]);

      const result = resolveConnectivity(project, { type: 'road', roadId: 'r1' });
      expect(result).toEqual({ predecessors: [], successors: [] });
    });

    it('should skip links to roads not in project', () => {
      const r1 = makeRoad('r1', [makeSection(0, [makeLane(1)], [makeLane(-1)])], {
        predecessor: { element_id: 'missing', element_type: 'Road', contact_point: 'End' },
        successor: null,
      });
      const project = makeProject([r1]);

      const result = resolveConnectivity(project, { type: 'road', roadId: 'r1' });
      expect(result.predecessors).toEqual([]);
    });
  });

  // ── LaneSection-level ───────────────────────────────────────────────────

  describe('laneSection selection', () => {
    it('should return adjacent sections within the same road', () => {
      const sections = [
        makeSection(0, [makeLane(1)], [makeLane(-1)]),
        makeSection(50, [makeLane(1)], [makeLane(-1)]),
        makeSection(80, [makeLane(1)], [makeLane(-1)]),
      ];
      const r1 = makeRoad('r1', sections);
      const project = makeProject([r1]);

      // Middle section
      const result = resolveConnectivity(project, { type: 'laneSection', roadId: 'r1', sectionIndex: 1 });
      expect(result.predecessors).toEqual([{ type: 'laneSection', roadId: 'r1', sectionIndex: 0 }]);
      expect(result.successors).toEqual([{ type: 'laneSection', roadId: 'r1', sectionIndex: 2 }]);
    });

    it('should return no same-road predecessor for first section', () => {
      const sections = [
        makeSection(0, [makeLane(1)], [makeLane(-1)]),
        makeSection(50, [makeLane(1)], [makeLane(-1)]),
      ];
      const r1 = makeRoad('r1', sections);
      const project = makeProject([r1]);

      const result = resolveConnectivity(project, { type: 'laneSection', roadId: 'r1', sectionIndex: 0 });
      expect(result.predecessors).toEqual([]);
      expect(result.successors).toEqual([{ type: 'laneSection', roadId: 'r1', sectionIndex: 1 }]);
    });

    it('should return no same-road successor for last section', () => {
      const sections = [
        makeSection(0, [makeLane(1)], [makeLane(-1)]),
        makeSection(50, [makeLane(1)], [makeLane(-1)]),
      ];
      const r1 = makeRoad('r1', sections);
      const project = makeProject([r1]);

      const result = resolveConnectivity(project, { type: 'laneSection', roadId: 'r1', sectionIndex: 1 });
      expect(result.predecessors).toEqual([{ type: 'laneSection', roadId: 'r1', sectionIndex: 0 }]);
      expect(result.successors).toEqual([]);
    });

    it('should resolve cross-road predecessor section (contact_point End)', () => {
      const r1 = makeRoad('r1', [
        makeSection(0, [makeLane(1)], [makeLane(-1)]),
        makeSection(50, [makeLane(1)], [makeLane(-1)]),
      ]);
      const r2 = makeRoad('r2', [makeSection(0, [makeLane(1)], [makeLane(-1)])], {
        predecessor: { element_id: 'r1', element_type: 'Road', contact_point: 'End' },
        successor: null,
      });
      const project = makeProject([r1, r2]);

      const result = resolveConnectivity(project, { type: 'laneSection', roadId: 'r2', sectionIndex: 0 });
      // predecessor: last section of r1 (contact_point=End)
      expect(result.predecessors).toEqual([
        { type: 'laneSection', roadId: 'r1', sectionIndex: 1 },
      ]);
    });

    it('should resolve cross-road predecessor section (contact_point Start)', () => {
      const r1 = makeRoad('r1', [
        makeSection(0, [makeLane(1)], [makeLane(-1)]),
        makeSection(50, [makeLane(1)], [makeLane(-1)]),
      ]);
      const r2 = makeRoad('r2', [makeSection(0, [makeLane(1)], [makeLane(-1)])], {
        predecessor: { element_id: 'r1', element_type: 'Road', contact_point: 'Start' },
        successor: null,
      });
      const project = makeProject([r1, r2]);

      const result = resolveConnectivity(project, { type: 'laneSection', roadId: 'r2', sectionIndex: 0 });
      // predecessor: first section of r1 (contact_point=Start)
      expect(result.predecessors).toEqual([
        { type: 'laneSection', roadId: 'r1', sectionIndex: 0 },
      ]);
    });

    it('should resolve cross-road successor section', () => {
      const r1 = makeRoad('r1', [makeSection(0, [makeLane(1)], [makeLane(-1)])], {
        predecessor: null,
        successor: { element_id: 'r2', element_type: 'Road', contact_point: 'Start' },
      });
      const r2 = makeRoad('r2', [
        makeSection(0, [makeLane(1)], [makeLane(-1)]),
        makeSection(50, [makeLane(1)], [makeLane(-1)]),
      ]);
      const project = makeProject([r1, r2]);

      const result = resolveConnectivity(project, { type: 'laneSection', roadId: 'r1', sectionIndex: 0 });
      expect(result.successors).toEqual([
        { type: 'laneSection', roadId: 'r2', sectionIndex: 0 },
      ]);
    });

    it('should not add cross-road link if section is not at boundary', () => {
      const r1 = makeRoad('r1', [
        makeSection(0, [makeLane(1)], [makeLane(-1)]),
        makeSection(50, [makeLane(1)], [makeLane(-1)]),
        makeSection(80, [makeLane(1)], [makeLane(-1)]),
      ], {
        predecessor: { element_id: 'r2', element_type: 'Road', contact_point: 'End' },
        successor: { element_id: 'r3', element_type: 'Road', contact_point: 'Start' },
      });
      const r2 = makeRoad('r2', [makeSection(0, [makeLane(1)], [makeLane(-1)])]);
      const r3 = makeRoad('r3', [makeSection(0, [makeLane(1)], [makeLane(-1)])]);
      const project = makeProject([r1, r2, r3]);

      // Middle section: only within-road adjacency, no cross-road links
      const result = resolveConnectivity(project, { type: 'laneSection', roadId: 'r1', sectionIndex: 1 });
      expect(result.predecessors).toEqual([{ type: 'laneSection', roadId: 'r1', sectionIndex: 0 }]);
      expect(result.successors).toEqual([{ type: 'laneSection', roadId: 'r1', sectionIndex: 2 }]);
    });
  });

  // ── Lane-level ──────────────────────────────────────────────────────────

  describe('lane selection', () => {
    it('should return predecessor and successor lanes within the same road', () => {
      const sections = [
        makeSection(0, [makeLane(1, null, 1)], [makeLane(-1, null, -1)]),
        makeSection(50, [makeLane(1, 1, 1)], [makeLane(-1, -1, -1)]),
        makeSection(80, [makeLane(1, 1, null)], [makeLane(-1, -1, null)]),
      ];
      const r1 = makeRoad('r1', sections);
      const project = makeProject([r1]);

      // Middle section, right lane -1
      const result = resolveConnectivity(project, {
        type: 'lane', roadId: 'r1', sectionIndex: 1, side: 'right', laneId: -1,
      });
      expect(result.predecessors).toEqual([
        { type: 'lane', roadId: 'r1', sectionIndex: 0, side: 'right', laneId: -1 },
      ]);
      expect(result.successors).toEqual([
        { type: 'lane', roadId: 'r1', sectionIndex: 2, side: 'right', laneId: -1 },
      ]);
    });

    it('should return predecessor and successor lanes for left-side lanes', () => {
      const sections = [
        makeSection(0, [makeLane(1, null, 1)], [makeLane(-1)]),
        makeSection(50, [makeLane(1, 1, null)], [makeLane(-1)]),
      ];
      const r1 = makeRoad('r1', sections);
      const project = makeProject([r1]);

      const result = resolveConnectivity(project, {
        type: 'lane', roadId: 'r1', sectionIndex: 0, side: 'left', laneId: 1,
      });
      expect(result.predecessors).toEqual([]);
      expect(result.successors).toEqual([
        { type: 'lane', roadId: 'r1', sectionIndex: 1, side: 'left', laneId: 1 },
      ]);
    });

    it('should return empty when lane has no link', () => {
      const sections = [
        makeSection(0, [makeLane(1)], [makeLane(-1)]),
        makeSection(50, [makeLane(1)], [makeLane(-1)]),
      ];
      const r1 = makeRoad('r1', sections);
      const project = makeProject([r1]);

      const result = resolveConnectivity(project, {
        type: 'lane', roadId: 'r1', sectionIndex: 0, side: 'right', laneId: -1,
      });
      expect(result).toEqual({ predecessors: [], successors: [] });
    });

    it('should resolve cross-road predecessor lane', () => {
      const r1 = makeRoad('r1', [
        makeSection(0, [makeLane(1)], [makeLane(-1)]),
      ]);
      // r2's first section, lane -1 has predecessor -1 (in connected road r1)
      const r2 = makeRoad('r2', [
        makeSection(0, [], [makeLane(-1, -1, null)]),
      ], {
        predecessor: { element_id: 'r1', element_type: 'Road', contact_point: 'End' },
        successor: null,
      });
      const project = makeProject([r1, r2]);

      const result = resolveConnectivity(project, {
        type: 'lane', roadId: 'r2', sectionIndex: 0, side: 'right', laneId: -1,
      });
      // predecessor lane -1 in r1's last section (index 0)
      expect(result.predecessors).toEqual([
        { type: 'lane', roadId: 'r1', sectionIndex: 0, side: 'right', laneId: -1 },
      ]);
    });

    it('should resolve cross-road successor lane', () => {
      const r1 = makeRoad('r1', [
        makeSection(0, [], [makeLane(-1, null, -1)]),
      ], {
        predecessor: null,
        successor: { element_id: 'r2', element_type: 'Road', contact_point: 'Start' },
      });
      const r2 = makeRoad('r2', [
        makeSection(0, [makeLane(1)], [makeLane(-1)]),
      ]);
      const project = makeProject([r1, r2]);

      const result = resolveConnectivity(project, {
        type: 'lane', roadId: 'r1', sectionIndex: 0, side: 'right', laneId: -1,
      });
      expect(result.successors).toEqual([
        { type: 'lane', roadId: 'r2', sectionIndex: 0, side: 'right', laneId: -1 },
      ]);
    });

    it('should not resolve cross-road link when not at boundary section', () => {
      const sections = [
        makeSection(0, [], [makeLane(-1, null, -1)]),
        makeSection(50, [], [makeLane(-1, -1, -1)]),
        makeSection(80, [], [makeLane(-1, -1, null)]),
      ];
      const r1 = makeRoad('r1', sections, {
        predecessor: { element_id: 'r2', element_type: 'Road', contact_point: 'End' },
        successor: { element_id: 'r3', element_type: 'Road', contact_point: 'Start' },
      });
      const r2 = makeRoad('r2', [makeSection(0, [], [makeLane(-1)])]);
      const r3 = makeRoad('r3', [makeSection(0, [], [makeLane(-1)])]);
      const project = makeProject([r1, r2, r3]);

      // Middle section — should only find within-road links
      const result = resolveConnectivity(project, {
        type: 'lane', roadId: 'r1', sectionIndex: 1, side: 'right', laneId: -1,
      });
      expect(result.predecessors).toEqual([
        { type: 'lane', roadId: 'r1', sectionIndex: 0, side: 'right', laneId: -1 },
      ]);
      expect(result.successors).toEqual([
        { type: 'lane', roadId: 'r1', sectionIndex: 2, side: 'right', laneId: -1 },
      ]);
    });

    it('should handle lane link pointing to a different lane id', () => {
      // Lane 1 in section 0 links to lane 2 in section 1
      const sections = [
        makeSection(0, [makeLane(1, null, 2)], []),
        makeSection(50, [makeLane(2, 1, null)], []),
      ];
      const r1 = makeRoad('r1', sections);
      const project = makeProject([r1]);

      const result = resolveConnectivity(project, {
        type: 'lane', roadId: 'r1', sectionIndex: 0, side: 'left', laneId: 1,
      });
      expect(result.successors).toEqual([
        { type: 'lane', roadId: 'r1', sectionIndex: 1, side: 'left', laneId: 2 },
      ]);
    });

    it('should return empty when linked lane does not exist in target section', () => {
      // Lane -1 claims successor -2, but -2 doesn't exist in next section
      const sections = [
        makeSection(0, [], [makeLane(-1, null, -2)]),
        makeSection(50, [], [makeLane(-1)]),
      ];
      const r1 = makeRoad('r1', sections);
      const project = makeProject([r1]);

      const result = resolveConnectivity(project, {
        type: 'lane', roadId: 'r1', sectionIndex: 0, side: 'right', laneId: -1,
      });
      expect(result.successors).toEqual([]);
    });
  });
});
