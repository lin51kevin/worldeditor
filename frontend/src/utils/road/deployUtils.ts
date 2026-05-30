/**
 * Deployment utilities: sidewalks, markings, crosswalks, stop lines.
 */

import type { Road, LaneSection, Project } from '../../services/platform';
import { makeSidewalkLane, makeMark } from './laneOps';

const DEFAULT_SIDEWALK_WIDTH = 2.0;

/**
 * Deploy sidewalk lanes on both sides of all lane sections in the road.
 * Idempotent: if a sidewalk lane already exists on a side, it is not added again.
 */
export function deploySidewalks(road: Road, sidewalkWidth = DEFAULT_SIDEWALK_WIDTH): Road {
  const lane_sections: LaneSection[] = road.lane_sections.map((ls) => {
    const hasLeftSidewalk = ls.left.some((l) => l.lane_type === 'Sidewalk');
    const hasRightSidewalk = ls.right.some((l) => l.lane_type === 'Sidewalk');

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

/**
 * Apply standard road markings to all lane sections:
 * - Outermost lane on each side → solid white
 * - All other lanes → broken white
 */
export function applyStandardMarkings(road: Road): Road {
  const lane_sections: LaneSection[] = road.lane_sections.map((ls) => {
    const maxLeftId = ls.left.length > 0 ? Math.max(...ls.left.map((l) => l.id)) : -Infinity;
    const minRightId = ls.right.length > 0 ? Math.min(...ls.right.map((l) => l.id)) : Infinity;

    const left = ls.left.map((lane) => ({
      ...lane,
      road_marks: [makeMark(lane.id === maxLeftId ? 'Solid' : 'Broken')],
    }));

    const right = ls.right.map((lane) => ({
      ...lane,
      road_marks: [makeMark(lane.id === minRightId ? 'Solid' : 'Broken')],
    }));

    return { ...ls, left, right };
  });

  return { ...road, lane_sections };
}

/**
 * Deploy crosswalk objects at the midpoint of each connecting road in the
 * specified junction.
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
        validity: null,
      };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null);

  return { ...project, objects: [...(project.objects ?? []), ...newObjects] };
}

/**
 * Deploy stop line objects 1 m before the end of each incoming road approaching
 * the specified junction. Each unique incoming road gets exactly one stop line.
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
        validity: null,
      };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null);

  return { ...project, objects: [...(project.objects ?? []), ...newObjects] };
}
