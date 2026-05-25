/**
 * Lane-level operations: cloning, reversing, section evaluation.
 */

import type { Lane, LaneSection, RoadMark } from '../../services/platform';
import { evalWidthPolyAt } from './geometryOps';

const DEFAULT_SIDEWALK_WIDTH = 2.0;
const DEFAULT_MARK_WIDTH = 0.15;

/** Build a standard road mark record. */
export function makeMark(markType: 'Solid' | 'Broken' | 'None', color = 'White'): RoadMark {
  return {
    s_offset: 0,
    mark_type: markType,
    weight: 'Standard',
    color,
    material: 'standard',
    width: DEFAULT_MARK_WIDTH,
    lane_change: markType === 'Broken' ? 'both' : 'none',
  };
}

/** Build a minimal sidewalk lane record. */
export function makeSidewalkLane(id: number, width: number = DEFAULT_SIDEWALK_WIDTH): Lane {
  return {
    id,
    lane_type: 'Sidewalk',
    level: 0,
    link: null,
    width: [{ s_offset: 0, a: width, b: 0, c: 0, d: 0 }],
    road_marks: [makeMark('Solid')],
  };
}

export function cloneLaneWithMirroredId(lane: Lane): Lane {
  return {
    ...lane,
    id: lane.id === 0 ? 0 : -lane.id,
    link: lane.link
      ? {
        predecessor: lane.link.successor === null ? null : -lane.link.successor,
        successor: lane.link.predecessor === null ? null : -lane.link.predecessor,
      }
      : lane.link,
  };
}

export function reverseLaneSection(section: LaneSection): LaneSection {
  return {
    ...section,
    left: section.right.map(cloneLaneWithMirroredId),
    center: section.center.map(cloneLaneWithMirroredId),
    right: section.left.map(cloneLaneWithMirroredId),
  };
}

export function getLaneSignature(section: LaneSection | undefined): string {
  if (!section) {
    return 'none';
  }

  const encode = (lanes: Lane[]) => lanes
    .map((lane) => `${Math.abs(lane.id)}:${lane.lane_type}`)
    .sort()
    .join('|');
  return encode([...section.left, ...section.center, ...section.right]);
}

/**
 * Create a copy of `section` with all lane widths evaluated at `sOff`
 * (arclength offset within the section) as the new constant start width.
 */
export function evalLaneSectionAtOffset(section: LaneSection, sOff: number): LaneSection {
  const bakeLanes = (lanes: Lane[]): Lane[] =>
    lanes.map((l) => ({
      ...l,
      width: l.width.length === 0
        ? l.width
        : [{ s_offset: 0, a: evalWidthPolyAt(l.width, sOff), b: 0, c: 0, d: 0 }],
    }));
  return {
    ...section,
    left: bakeLanes(section.left),
    right: bakeLanes(section.right),
    center: section.center.map((l) => ({ ...l })),
  };
}
