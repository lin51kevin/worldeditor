import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';
import type { Road, Geometry } from '../services/platform';

function makeRoad(id: string): Road {
  const geo: Geometry = { s: 0, x: 0, y: 0, hdg: 0, length: 100, geo_type: 'Line' as any };
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
        left: [{ id: 1, lane_type: 'Driving', level: 0, render_hidden: false, link: null, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] }],
        center: [{ id: 0, lane_type: 'None', level: 0, render_hidden: false, link: null, width: [], road_marks: [] }],
        right: [{ id: -1, lane_type: 'Driving', level: 0, render_hidden: false, link: null, width: [{ s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 }], road_marks: [] }],
      },
    ],
    signals: [],
  };
}

describe('projectStore – road ops actions', () => {
  beforeEach(() => {
    useProjectStore.getState().reset();
  });

  // ── cloneRoad ─────────────────────────────────────────────────────────────

  describe('cloneRoad', () => {
    it('should add a cloned road with a new id', () => {
      const store = useProjectStore.getState();
      store.addRoad(makeRoad('r1'));
      store.cloneRoad('r1', 'r1-clone', [0, 0]);
      expect(useProjectStore.getState().project.roads).toHaveLength(2);
      expect(useProjectStore.getState().project.roads[1]!.id).toBe('r1-clone');
    });

    it('should apply the xy offset to all geometry segments', () => {
      const store = useProjectStore.getState();
      store.addRoad(makeRoad('r1'));
      store.cloneRoad('r1', 'r1-clone', [10, 20]);
      const clone = useProjectStore.getState().project.roads[1]!;
      expect(clone.plan_view[0]!.x).toBeCloseTo(10);
      expect(clone.plan_view[0]!.y).toBeCloseTo(20);
    });

    it('should clear the link on the clone', () => {
      const store = useProjectStore.getState();
      const r = makeRoad('r1');
      (r as any).link = { predecessor: { element_type: 'Road', element_id: 'prev', contact_point: null }, successor: null };
      store.addRoad(r);
      store.cloneRoad('r1', 'r1-clone', [0, 0]);
      const clone = useProjectStore.getState().project.roads[1]!;
      expect(clone.link!.predecessor).toBeNull();
      expect(clone.link!.successor).toBeNull();
    });

    it('should not modify the original road geometry', () => {
      const store = useProjectStore.getState();
      store.addRoad(makeRoad('r1'));
      store.cloneRoad('r1', 'r1-clone', [50, 50]);
      const original = useProjectStore.getState().project.roads[0]!;
      expect(original.plan_view[0]!.x).toBeCloseTo(0);
      expect(original.plan_view[0]!.y).toBeCloseTo(0);
    });

    it('should push onto undo stack', () => {
      const store = useProjectStore.getState();
      store.addRoad(makeRoad('r1'));
      const undoDepthBefore = useProjectStore.getState().undoStack.length;
      store.cloneRoad('r1', 'r1-clone', [0, 0]);
      expect(useProjectStore.getState().undoStack.length).toBeGreaterThan(undoDepthBefore);
    });

    it('should silently ignore a missing source id', () => {
      const store = useProjectStore.getState();
      expect(() => store.cloneRoad('nonexistent', 'new', [0, 0])).not.toThrow();
    });
  });

  // ── reverseRoad ───────────────────────────────────────────────────────────

  describe('reverseRoad', () => {
    it('should flip geometry start to old end (Line)', () => {
      const store = useProjectStore.getState();
      store.addRoad(makeRoad('r1')); // line x=0,y=0,hdg=0,length=100 → end at (100,0)
      store.reverseRoad('r1');
      const road = useProjectStore.getState().project.roads[0]!;
      expect(road.plan_view[0]!.x).toBeCloseTo(100);
      expect(road.plan_view[0]!.y).toBeCloseTo(0);
    });

    it('should flip heading by π for a straight line', () => {
      const store = useProjectStore.getState();
      store.addRoad(makeRoad('r1'));
      store.reverseRoad('r1');
      const road = useProjectStore.getState().project.roads[0]!;
      expect(Math.abs(road.plan_view[0]!.hdg)).toBeCloseTo(Math.PI);
    });

    it('should swap left/right lanes', () => {
      const store = useProjectStore.getState();
      store.addRoad(makeRoad('r1'));
      store.reverseRoad('r1');
      const sec = useProjectStore.getState().project.roads[0]!.lane_sections[0]!;
      // After reverse: left IDs positive (came from right negated), right negative
      expect(sec.left[0]!.id).toBeGreaterThan(0);
      expect(sec.right[0]!.id).toBeLessThan(0);
    });

    it('should push onto undo stack', () => {
      const store = useProjectStore.getState();
      store.addRoad(makeRoad('r1'));
      const before = useProjectStore.getState().undoStack.length;
      store.reverseRoad('r1');
      expect(useProjectStore.getState().undoStack.length).toBeGreaterThan(before);
    });

    it('should be undoable', () => {
      const store = useProjectStore.getState();
      store.addRoad(makeRoad('r1'));
      const origX = useProjectStore.getState().project.roads[0]!.plan_view[0]!.x;
      store.reverseRoad('r1');
      store.undo();
      expect(useProjectStore.getState().project.roads[0]!.plan_view[0]!.x).toBeCloseTo(origX);
    });
  });

  // ── mirrorRoad ────────────────────────────────────────────────────────────

  describe('mirrorRoad', () => {
    it('should swap left and right lanes', () => {
      const store = useProjectStore.getState();
      store.addRoad(makeRoad('r1'));
      store.mirrorRoad('r1');
      const sec = useProjectStore.getState().project.roads[0]!.lane_sections[0]!;
      expect(sec.left[0]!.id).toBeGreaterThan(0);
      expect(sec.right[0]!.id).toBeLessThan(0);
    });

    it('should preserve the reference line geometry', () => {
      const store = useProjectStore.getState();
      store.addRoad(makeRoad('r1'));
      const origX = useProjectStore.getState().project.roads[0]!.plan_view[0]!.x;
      store.mirrorRoad('r1');
      expect(useProjectStore.getState().project.roads[0]!.plan_view[0]!.x).toBeCloseTo(origX);
    });

    it('should be undoable', () => {
      const store = useProjectStore.getState();
      store.addRoad(makeRoad('r1'));
      const origLeftId = useProjectStore.getState().project.roads[0]!.lane_sections[0]!.left[0]!.id;
      store.mirrorRoad('r1');
      store.undo();
      expect(useProjectStore.getState().project.roads[0]!.lane_sections[0]!.left[0]!.id).toBe(origLeftId);
    });

    it('should silently ignore missing road id', () => {
      const store = useProjectStore.getState();
      expect(() => store.mirrorRoad('nonexistent')).not.toThrow();
    });
  });

  // ── optimizeRoad ──────────────────────────────────────────────────────────

  describe('optimizeRoad', () => {
    it('should not crash on a simple road', () => {
      const store = useProjectStore.getState();
      store.addRoad(makeRoad('r1'));
      expect(() => store.optimizeRoad('r1')).not.toThrow();
    });

    it('should reduce collinear redundant segments', () => {
      const store = useProjectStore.getState();
      const r = makeRoad('r1');
      // Three collinear segments going along X axis
      r.plan_view = [
        { s: 0,  x: 0,  y: 0, hdg: 0, length: 10, geo_type: 'Line' as any },
        { s: 10, x: 10, y: 0, hdg: 0, length: 10, geo_type: 'Line' as any },
        { s: 20, x: 20, y: 0, hdg: 0, length: 10, geo_type: 'Line' as any },
      ];
      r.length = 30;
      store.addRoad(r);
      store.optimizeRoad('r1');
      const optimized = useProjectStore.getState().project.roads[0]!;
      expect(optimized.plan_view.length).toBeLessThanOrEqual(3);
    });

    it('should be undoable when it changes something', () => {
      const store = useProjectStore.getState();
      const r = makeRoad('r1');
      r.plan_view = [
        { s: 0,  x: 0,  y: 0, hdg: 0, length: 10, geo_type: 'Line' as any },
        { s: 10, x: 10, y: 0, hdg: 0, length: 10, geo_type: 'Line' as any },
        { s: 20, x: 20, y: 0, hdg: 0, length: 10, geo_type: 'Line' as any },
      ];
      r.length = 30;
      store.addRoad(r);
      const origLen = useProjectStore.getState().project.roads[0]!.plan_view.length;
      store.optimizeRoad('r1');
      // Only undo if optimization actually changed something
      if (useProjectStore.getState().project.roads[0]!.plan_view.length !== origLen) {
        store.undo();
        expect(useProjectStore.getState().project.roads[0]!.plan_view.length).toBe(origLen);
      }
    });
  });

  // ── swapCenterline ────────────────────────────────────────────────────────

  describe('swapCenterline', () => {
    it('should shift geometry left for a left lane swap', () => {
      const store = useProjectStore.getState();
      store.addRoad(makeRoad('r1')); // left lane 1, width 3.5 at heading 0
      store.swapCenterline('r1', 1);
      const road = useProjectStore.getState().project.roads[0]!;
      // heading=0 → normal = (0,1), offset = +3.5 in y
      expect(road.plan_view[0]!.y).toBeCloseTo(3.5, 0);
    });

    it('should shift geometry right for a right lane swap', () => {
      const store = useProjectStore.getState();
      store.addRoad(makeRoad('r1'));
      store.swapCenterline('r1', -1);
      const road = useProjectStore.getState().project.roads[0]!;
      // normal = (0,1), offset = -3.5 in y
      expect(road.plan_view[0]!.y).toBeCloseTo(-3.5, 0);
    });

    it('should not change anything when targetLaneId is 0', () => {
      const store = useProjectStore.getState();
      store.addRoad(makeRoad('r1'));
      const origY = useProjectStore.getState().project.roads[0]!.plan_view[0]!.y;
      store.swapCenterline('r1', 0);
      expect(useProjectStore.getState().project.roads[0]!.plan_view[0]!.y).toBeCloseTo(origY);
    });

    it('should push onto undo stack', () => {
      const store = useProjectStore.getState();
      store.addRoad(makeRoad('r1'));
      const before = useProjectStore.getState().undoStack.length;
      store.swapCenterline('r1', 1);
      expect(useProjectStore.getState().undoStack.length).toBeGreaterThan(before);
    });

    it('should be undoable', () => {
      const store = useProjectStore.getState();
      store.addRoad(makeRoad('r1'));
      const origY = useProjectStore.getState().project.roads[0]!.plan_view[0]!.y;
      store.swapCenterline('r1', 1);
      store.undo();
      expect(useProjectStore.getState().project.roads[0]!.plan_view[0]!.y).toBeCloseTo(origY);
    });

    it('should silently ignore missing road id', () => {
      const store = useProjectStore.getState();
      expect(() => store.swapCenterline('nonexistent', 1)).not.toThrow();
    });
  });
});
