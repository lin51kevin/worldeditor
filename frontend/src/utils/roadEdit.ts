/**
 * Pure road manipulation utilities.
 *
 * All functions are side-effect-free and fully unit-testable.
 * They are used by the Advanced Editing plugin to implement
 * split, weld, sidewalk deployment, standard marking application,
 * crosswalk deployment, and stop line deployment.
 */

import type {
  Road,
  Lane,
  LaneSection,
  RoadMark,
  Project,
  Junction,
  Geometry,
} from '../services/platform';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SIDEWALK_WIDTH = 2.0;
const DEFAULT_MARK_WIDTH = 0.15;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a standard road mark record. */
function makeMark(markType: 'solid' | 'broken' | 'none', color = 'white'): RoadMark {
  return {
    s_offset: 0,
    mark_type: markType,
    weight: 'standard',
    color,
    material: 'standard',
    width: DEFAULT_MARK_WIDTH,
    lane_change: markType === 'broken' ? 'both' : 'none',
  };
}

/** Build a minimal sidewalk lane record. */
function makeSidewalkLane(id: number, width: number): Lane {
  return {
    id,
    lane_type: 'sidewalk',
    level: 0,
    link: null,
    width: [{ s_offset: 0, a: width, b: 0, c: 0, d: 0 }],
    road_marks: [makeMark('solid')],
  };
}

// ─── splitRoadAt ─────────────────────────────────────────────────────────────

/**
 * Split a road at the given s-station, returning two half-roads and a
 * junction that connects them.
 *
 * - For Line segments the split is exact.
 * - Non-Line segments that straddle the split are approximated as Line.
 * - Both halves inherit the lane section closest to the split point.
 *
 * @throws {Error} if splitS is not strictly inside (0, road.length)
 */
export function splitRoadAt(
  road: Road,
  splitS: number,
): { road1: Road; road2: Road; junction: Junction } {
  if (splitS <= 0 || splitS >= road.length) {
    throw new Error(
      `splitS (${splitS}) must be strictly between 0 and road.length (${road.length})`,
    );
  }

  const ts = Date.now();
  const id1 = `${road.id}-a-${ts}`;
  const id2 = `${road.id}-b-${ts}`;
  const junctionId = `junc-split-${ts}`;

  // ── Build plan_view for each half ─────────────────────────────────────────
  const pv1: Geometry[] = [];
  const pv2: Geometry[] = [];
  let split2X = 0;
  let split2Y = 0;
  let split2Hdg = 0;

  for (const geo of road.plan_view) {
    const geoEnd = geo.s + geo.length;

    if (geoEnd <= splitS) {
      // Entire segment before the split → road1
      pv1.push(geo);
    } else if (geo.s >= splitS) {
      // Entire segment after the split → road2 (re-based to s=0)
      pv2.push({ ...geo, s: geo.s - splitS });
    } else {
      // Split falls within this segment
      const before = splitS - geo.s;
      const after = geoEnd - splitS;
      const hdg = geo.hdg;

      split2X = geo.x + before * Math.cos(hdg);
      split2Y = geo.y + before * Math.sin(hdg);
      split2Hdg = hdg;

      pv1.push({ ...geo, length: before });
      pv2.push({
        s: 0,
        x: split2X,
        y: split2Y,
        hdg: split2Hdg,
        length: after,
        geo_type: geo.geo_type,
      });
    }
  }

  // Fallback: empty plan_view edge cases
  if (pv1.length === 0) {
    const ref = road.plan_view[0] ?? { x: 0, y: 0, hdg: 0 };
    pv1.push({ s: 0, x: ref.x, y: ref.y, hdg: ref.hdg, length: splitS, geo_type: 'Line' });
  }
  if (pv2.length === 0) {
    const ref = road.plan_view[road.plan_view.length - 1] ?? { x: 0, y: 0, hdg: 0 };
    pv2.push({
      s: 0,
      x: split2X || ref.x,
      y: split2Y || ref.y,
      hdg: split2Hdg || ref.hdg,
      length: road.length - splitS,
      geo_type: 'Line',
    });
  }

  // ── Distribute lane sections ───────────────────────────────────────────────
  const ls1: LaneSection[] = road.lane_sections
    .filter((ls) => ls.s <= splitS)
    .map((ls): LaneSection => ({ ...ls }));
  const ls2: LaneSection[] = road.lane_sections
    .filter((ls) => ls.s > splitS)
    .map((ls): LaneSection => ({ ...ls, s: ls.s - splitS }));

  const firstSection = road.lane_sections[0];
  const lastSection = road.lane_sections[road.lane_sections.length - 1];
  if (ls1.length === 0 && firstSection !== undefined) {
    ls1.push({ ...firstSection, s: 0 });
  }
  if (ls2.length === 0 && lastSection !== undefined) {
    ls2.push({ ...lastSection, s: 0 });
  }

  // Auto-generate lane links from the first lane section's right lanes
  const laneLinks = (ls1[0]?.right ?? []).map((l) => ({ from: l.id, to: l.id }));

  // ── Assemble result ────────────────────────────────────────────────────────
  const road1: Road = {
    ...road,
    id: id1,
    name: `${road.name}_A`,
    length: splitS,
    plan_view: pv1,
    lane_sections: ls1,
    link: {
      predecessor: road.link?.predecessor ?? null,
      successor: { element_id: junctionId, element_type: 'Junction', contact_point: 'Start' },
    },
  };

  const road2: Road = {
    ...road,
    id: id2,
    name: `${road.name}_B`,
    length: road.length - splitS,
    plan_view: pv2,
    lane_sections: ls2,
    link: {
      predecessor: { element_id: junctionId, element_type: 'Junction', contact_point: 'End' },
      successor: road.link?.successor ?? null,
    },
  };

  const junction: Junction = {
    id: junctionId,
    name: `${road.name}_Junction`,
    connections: [
      {
        id: `conn-${ts}`,
        incoming_road: id1,
        connecting_road: id2,
        contact_point: 'Start',
        lane_links: laneLinks,
      },
    ],
  };

  return { road1, road2, junction };
}

// ─── weldRoads ────────────────────────────────────────────────────────────────

/**
 * Weld two roads together: road1 comes first, road2 follows immediately after.
 *
 * road2's geometry `s` values and lane section `s` values are offset by
 * road1.length. The welded road keeps road1's id and uses road1's predecessor
 * link and road2's successor link.
 */
export function weldRoads(road1: Road, road2: Road): Road {
  const offset = road1.length;

  const pv2: Geometry[] = road2.plan_view.map((geo) => ({ ...geo, s: geo.s + offset }));
  const ls2: LaneSection[] = road2.lane_sections.map((ls) => ({ ...ls, s: ls.s + offset }));

  return {
    ...road1,
    name: `${road1.name} + ${road2.name}`,
    length: road1.length + road2.length,
    plan_view: [...road1.plan_view, ...pv2],
    lane_sections: [...road1.lane_sections, ...ls2],
    link: {
      predecessor: road1.link?.predecessor ?? null,
      successor: road2.link?.successor ?? null,
    },
  };
}

// ─── deploySidewalks ─────────────────────────────────────────────────────────

/**
 * Deploy sidewalk lanes on both sides of all lane sections in the road.
 *
 * - Idempotent: if a sidewalk lane already exists on a side, it is not added again.
 * - The sidewalk is placed at the outermost position (max left id + 1, min right id - 1).
 * - If a side has no driving lanes, a sidewalk at id ±1 is still added.
 * - Does not mutate the input road.
 */
export function deploySidewalks(road: Road, sidewalkWidth = DEFAULT_SIDEWALK_WIDTH): Road {
  const lane_sections: LaneSection[] = road.lane_sections.map((ls) => {
    const hasLeftSidewalk = ls.left.some((l) => l.lane_type === 'sidewalk');
    const hasRightSidewalk = ls.right.some((l) => l.lane_type === 'sidewalk');

    const maxLeftId = ls.left.length > 0 ? Math.max(...ls.left.map((l) => l.id)) : 0;
    const minRightId = ls.right.length > 0 ? Math.min(...ls.right.map((l) => l.id)) : 0;

    const left = hasLeftSidewalk
      ? ls.left
      : [...ls.left, makeSidewalkLane(maxLeftId + 1, sidewalkWidth)];

    const right = hasRightSidewalk
      ? ls.right
      : [...ls.right, makeSidewalkLane(minRightId - 1, sidewalkWidth)];

    return { ...ls, left, right };
  });

  return { ...road, lane_sections };
}

// ─── applyStandardMarkings ───────────────────────────────────────────────────

/**
 * Apply standard road markings to all lane sections:
 * - Outermost lane on each side (max left id / min right id) → solid white
 * - All other lanes on each side → broken white
 * - Center lane is left unchanged.
 *
 * Does not mutate the input road.
 */
export function applyStandardMarkings(road: Road): Road {
  const lane_sections: LaneSection[] = road.lane_sections.map((ls) => {
    const maxLeftId = ls.left.length > 0 ? Math.max(...ls.left.map((l) => l.id)) : -Infinity;
    const minRightId = ls.right.length > 0 ? Math.min(...ls.right.map((l) => l.id)) : Infinity;

    const left = ls.left.map((lane) => ({
      ...lane,
      road_marks: [makeMark(lane.id === maxLeftId ? 'solid' : 'broken')],
    }));

    const right = ls.right.map((lane) => ({
      ...lane,
      road_marks: [makeMark(lane.id === minRightId ? 'solid' : 'broken')],
    }));

    return { ...ls, left, right };
  });

  return { ...road, lane_sections };
}

// ─── deployCrosswalks ────────────────────────────────────────────────────────

/**
 * Deploy crosswalk objects at the midpoint of each connecting road in the
 * specified junction. Returns the project unchanged if the junction is not found.
 *
 * Does not mutate the input project.
 */
export function deployCrosswalks(project: Project, junctionId: string): Project {
  const junction = project.junctions.find((j) => j.id === junctionId);
  if (!junction) return project;

  const ts = Date.now();
  const newObjects = junction.connections
    .map((conn) => {
      const road = project.roads.find((r) => r.id === conn.connecting_road);
      if (!road) return null;
      return {
        id: `crosswalk-${conn.connecting_road}-${ts}`,
        roadId: conn.connecting_road,
        sPosition: road.length / 2,
        laneId: 0,
        type: 'crosswalk',
        validity: 'all',
      };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null);

  return { ...project, objects: [...(project.objects ?? []), ...newObjects] };
}

// ─── deployStopLines ─────────────────────────────────────────────────────────

/**
 * Deploy stop line objects 1 m before the end of each incoming road approaching
 * the specified junction. Returns the project unchanged if the junction is not found.
 *
 * Each unique incoming road gets exactly one stop line (deduplication applied).
 *
 * Does not mutate the input project.
 */
export function deployStopLines(project: Project, junctionId: string): Project {
  const junction = project.junctions.find((j) => j.id === junctionId);
  if (!junction) return project;

  const ts = Date.now();
  const incomingRoadIds = new Set(junction.connections.map((c) => c.incoming_road));

  const newObjects = [...incomingRoadIds]
    .map((roadId) => {
      const road = project.roads.find((r) => r.id === roadId);
      if (!road) return null;
      return {
        id: `stopline-${roadId}-${ts}`,
        roadId,
        sPosition: Math.max(0, road.length - 1.0),
        laneId: 0,
        type: 'stopline',
        validity: 'all',
      };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null);

  return { ...project, objects: [...(project.objects ?? []), ...newObjects] };
}
