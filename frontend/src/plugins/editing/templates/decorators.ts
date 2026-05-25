/**
 * Junction decorators — add road furniture to arm roads.
 *
 * These functions mutate the provided arrays (signals, objects, road_marks)
 * and are called as post-processing steps during junction construction.
 */

import type { Road } from '../../../services/platform';
import { genId } from './engine';

const DEFAULT_LANE_WIDTH = 3.5;

// ── Turn arrow helpers ───────────────────────────────────────────────────────

function getOutgoingArrowSubtype(drivingLaneCount: number, laneIndex: number): { subType: string; name: string } {
  if (drivingLaneCount === 1) {
    return { subType: 'StraightOrLeftOrRightTurnArrow', name: 'Straight Left or Right Turn Arrow Paint' };
  } else if (drivingLaneCount === 2) {
    if (laneIndex === 1) {
      return { subType: 'StraightOrLeftTurnArrow', name: 'Straight Left Turn Arrow Paint' };
    } else {
      return { subType: 'StraightOrRightTurnArrow', name: 'Straight Right Turn Arrow Paint' };
    }
  } else {
    if (laneIndex === 1) {
      return { subType: 'StraightOrLeftTurnArrow', name: 'Straight Left Turn Arrow Paint' };
    } else if (laneIndex === drivingLaneCount) {
      return { subType: 'StraightOrRightTurnArrow', name: 'Straight Right Turn Arrow Paint' };
    } else {
      return { subType: 'StraightAheadArrow', name: 'Straight Arrow Paint' };
    }
  }
}

function getIncomingArrowSubtype(drivingLaneCount: number, laneIndex: number, armCount?: number): { subType: string; name: string } {
  if (drivingLaneCount === 1) {
    return { subType: 'StraightOrLeftOrRightTurnArrow', name: 'Straight Left or Right Turn Arrow Paint' };
  } else if (drivingLaneCount === 2) {
    if (laneIndex === 1) {
      return { subType: 'LeftOrRightTurnArrow', name: 'Left or Right Turn Arrow Paint' };
    } else {
      if (armCount === 3) {
        return { subType: 'StraightOrRightTurnArrow', name: 'Straight Right Turn Arrow Paint' };
      }
      return { subType: 'RightTurnArrow', name: 'Right Turn Arrow Paint' };
    }
  } else {
    if (laneIndex === 1) {
      return { subType: 'LeftTurnArrow', name: 'Left Turn Arrow Paint' };
    } else if (laneIndex === drivingLaneCount) {
      return { subType: 'RightTurnArrow', name: 'Right Turn Arrow Paint' };
    } else {
      return { subType: 'StraightAheadArrow', name: 'Straight Arrow Paint' };
    }
  }
}

/**
 * Add turn arrow signals to arm roads on both sides.
 */
export function addTurnArrows(armRoads: Road[], armCount?: number): void {
  const SIGNAL_S_DELTA = 4.0;
  for (const road of armRoads) {
    if (!road.signals) road.signals = [];

    const rightDrivingLanes = road.lane_sections[0]!.right.filter(l => l.lane_type === 'Driving');
    const rightLaneCount = rightDrivingLanes.length;
    if (rightLaneCount >= 1) {
      const signalS = Math.max(road.length - SIGNAL_S_DELTA, 0.5);
      for (let i = 0; i < rightLaneCount; i++) {
        const laneIndex = i + 1;
        const { subType, name } = getIncomingArrowSubtype(rightLaneCount, laneIndex, armCount);
        const lane = rightDrivingLanes[i]!;
        const laneWidth = lane.width[0]?.a ?? DEFAULT_LANE_WIDTH;
        const tOffset = -(i * laneWidth + laneWidth / 2);

        road.signals!.push({
          id: genId(),
          name,
          s: signalS,
          t: tOffset,
          z_offset: 0.01,
          h_offset: 0,
          width: 3.0,
          height: 0.01,
          signal_type: 'Graphics',
          signal_subtype: subType,
          value: null,
          orientation: 'none',
          is_dynamic: false,
        });
      }
    }

    const leftDrivingLanes = road.lane_sections[0]!.left.filter(l => l.lane_type === 'Driving');
    const leftLaneCount = leftDrivingLanes.length;
    if (leftLaneCount >= 1) {
      const signalS = SIGNAL_S_DELTA;
      for (let i = 0; i < leftLaneCount; i++) {
        const laneIndex = i + 1;
        const { subType, name } = getOutgoingArrowSubtype(leftLaneCount, laneIndex);
        const lane = leftDrivingLanes[i]!;
        const laneWidth = lane.width[0]?.a ?? DEFAULT_LANE_WIDTH;
        const tOffset = i * laneWidth + laneWidth / 2;

        road.signals!.push({
          id: genId(),
          name,
          s: signalS,
          t: tOffset,
          z_offset: 0.01,
          h_offset: Math.PI,
          width: 3.0,
          height: 0.01,
          signal_type: 'Graphics',
          signal_subtype: subType,
          value: null,
          orientation: 'none',
          is_dynamic: false,
        });
      }
    }
  }
}

/**
 * Add crosswalk objects at the junction-adjacent end of each arm road.
 */
export function addCrosswalks(armRoads: Road[]): void {
  const CROSSWALK_WIDTH = 4.0;
  const CROSSWALK_OFFSET = 0.0;
  for (const road of armRoads) {
    const leftLanes = road.lane_sections[0]!.left;
    const rightLanes = road.lane_sections[0]!.right;
    const leftWidth = leftLanes.reduce((sum, l) => sum + (l.width[0]?.a ?? DEFAULT_LANE_WIDTH), 0);
    const rightWidth = rightLanes.reduce((sum, l) => sum + (l.width[0]?.a ?? DEFAULT_LANE_WIDTH), 0);
    const totalRoadWidth = leftWidth + rightWidth;
    const halfWidth = totalRoadWidth / 2 + 0.1;

    const crosswalkS = road.length - CROSSWALK_OFFSET;

    const corners = [
      { x: 1, y: -halfWidth, z: 0, id: null },
      { x: 1, y: halfWidth, z: 0, id: null },
      { x: 1 + CROSSWALK_WIDTH, y: halfWidth, z: 0, id: null },
      { x: 1 + CROSSWALK_WIDTH, y: -halfWidth, z: 0, id: null },
      { x: 1, y: -halfWidth, z: 0, id: null },
    ];

    if (!road.objects) road.objects = [];
    road.objects.push({
      id: genId(),
      object_type: 'Crosswalk',
      name: 'Zebra Strips Area',
      position: { x: crosswalkS, y: 0, z: 0.01, id: null },
      orientation: 0,
      hdg: 0,
      width: totalRoadWidth + 0.2,
      height: 0.01,
      length: CROSSWALK_WIDTH,
      corners,
      validity: null,
    });
  }
}

/**
 * Convert broken lane marks to solid near the junction entry.
 */
export function solidateBrokenLinesNearJunction(armRoads: Road[]): void {
  const SOLIDATE_LENGTH = 10.0;
  for (const road of armRoads) {
    const section = road.lane_sections[0];
    if (!section) continue;

    for (const lane of section.right) {
      if (lane.road_marks.length === 0) continue;
      const mark = lane.road_marks[0]!;
      if (mark.mark_type === 'Broken' && road.length > SOLIDATE_LENGTH) {
        const solidStart = road.length - SOLIDATE_LENGTH;
        lane.road_marks = [
          { ...mark, s_offset: 0 },
          { ...mark, s_offset: solidStart, mark_type: 'Solid', lane_change: 'None' },
        ];
      }
    }

    for (const lane of section.left) {
      if (lane.road_marks.length === 0) continue;
      const mark = lane.road_marks[0]!;
      if (mark.mark_type === 'Broken' && road.length > SOLIDATE_LENGTH) {
        const solidStart = road.length - SOLIDATE_LENGTH;
        lane.road_marks = [
          { ...mark, s_offset: 0 },
          { ...mark, s_offset: solidStart, mark_type: 'Solid', lane_change: 'None' },
        ];
      }
    }
  }
}
