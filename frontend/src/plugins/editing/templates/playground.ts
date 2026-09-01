/**
 * Playground junction template engine.
 *
 * Ports the C# `BuildJunctionPlayground*` builders: a rounded-rectangle closed
 * loop (4 Hermite corner curves + a north and a south straight) with 2–6
 * junctions distributed around it, each fed by a 30 m incoming arm road.
 *
 * All geometry is flat (z = 0), matching the C# reference.
 */
import type {
  Road, Junction, JunctionConnection, LinkElement,
} from '../../../services/platform';
import type { JunctionTemplateConfig, LaneConfig, SectionConfig } from './schema';
import { genId, buildRoad, buildLaneSection, buildLaneSectionFromConfig } from './engine';
import {
  roadEndPoint, buildHermiteConnectorGeometry, type JunctionBuildResult,
} from './junctionEngine';

// C# BuildJunctionPlayground constants
const POS_X1 = 60;
const DELTA_X = 35;
const POS_X2 = POS_X1 + DELTA_X;   // 95
const POS_Y1 = 15;
const DELTA_Y = 35;
const POS_Y2 = POS_Y1 + DELTA_Y;   // 50
const INCOMING_LENGTH = 30;
/** Half-way point of a shortened perimeter straight — where its junction sits. */
const MID_X = POS_X1 - DELTA_X * 0.5;  // 42.5

const DEFAULT_LOOP_SECTION: SectionConfig = {
  left: [],
  right: [{ laneType: 'Driving', width: 3.5, mark: { type: 'Solid', width: 0.15 } }],
};

/** Junction slot around the loop, in counter-clockwise perimeter order. */
type SlotKey = 'east' | 'ne' | 'nw' | 'west' | 'sw' | 'se';

interface SlotDef {
  key: SlotKey;
  /** Junction centre, relative to the click point */
  jx: number;
  jy: number;
  /** Outer tip of the incoming arm, relative to the click point */
  tipX: number;
  tipY: number;
  /** Heading of the incoming arm (pointing toward the junction) */
  inwardHdg: number;
  /** Perimeter road index arriving at this junction */
  prevRoad: number;
  /** Perimeter road index departing from this junction */
  nextRoad: number;
}

const SLOTS: Record<SlotKey, SlotDef> = {
  east: { key: 'east', jx: POS_X2, jy: 0, tipX: POS_X2 + DELTA_X + INCOMING_LENGTH, tipY: 0, inwardHdg: Math.PI, prevRoad: 0, nextRoad: 1 },
  ne: { key: 'ne', jx: MID_X, jy: POS_Y2, tipX: MID_X, tipY: POS_Y2 + DELTA_Y + INCOMING_LENGTH, inwardHdg: -Math.PI / 2, prevRoad: 1, nextRoad: 2 },
  nw: { key: 'nw', jx: -MID_X, jy: POS_Y2, tipX: -MID_X, tipY: POS_Y2 + DELTA_Y + INCOMING_LENGTH, inwardHdg: -Math.PI / 2, prevRoad: 2, nextRoad: 3 },
  west: { key: 'west', jx: -POS_X2, jy: 0, tipX: -(POS_X2 + DELTA_X + INCOMING_LENGTH), tipY: 0, inwardHdg: 0, prevRoad: 3, nextRoad: 4 },
  sw: { key: 'sw', jx: -MID_X, jy: -POS_Y2, tipX: -MID_X, tipY: -(POS_Y2 + DELTA_Y + INCOMING_LENGTH), inwardHdg: Math.PI / 2, prevRoad: 4, nextRoad: 5 },
  se: { key: 'se', jx: MID_X, jy: -POS_Y2, tipX: MID_X, tipY: -(POS_Y2 + DELTA_Y + INCOMING_LENGTH), inwardHdg: Math.PI / 2, prevRoad: 5, nextRoad: 0 },
};

/**
 * Which junction slots are active for a given arm count.
 *
 * Mirrors the C# `BuildJunctionPlayground2..6` builders exactly — note that
 * Playground 3 opens the *west* end, not the north-west one.
 */
export function resolvePlaygroundSlots(armCount: number): SlotDef[] {
  const n = Math.min(Math.max(armCount, 2), 6);
  const byCount: Record<number, SlotKey[]> = {
    2: ['east', 'west'],
    3: ['east', 'ne', 'west'],
    4: ['east', 'ne', 'nw', 'west'],
    5: ['east', 'ne', 'nw', 'west', 'sw'],
    6: ['east', 'ne', 'nw', 'west', 'sw', 'se'],
  };
  return (byCount[n] ?? byCount[4]!).map((k) => SLOTS[k]);
}

/**
 * Pair source lanes with target lanes, aligned from the outermost lane inward
 * (port of the index walk in C# `AddConnectingRoadStraightOrTurnRight`).
 *
 * Only driving/biking lanes are connected; shoulders join only when
 * `considerShoulder` is set. Lane types must match on both sides.
 */
export function connectorLanePairs(
  from: LaneConfig[],
  to: LaneConfig[],
  considerShoulder: boolean,
): Array<{ i: number; j: number }> {
  const pairs: Array<{ i: number; j: number }> = [];
  let j = 0;
  for (let i = from.length - 1; i >= 0; i--) {
    if (from.length > to.length) {
      j = i >= to.length ? to.length - 1 : j - 1;
    } else if (from.length < to.length) {
      j = i === from.length - 1 ? to.length - 1 : j - 1;
    } else {
      j = i;
    }
    if (j < 0 || j >= to.length) continue;

    const src = from[i];
    const dst = to[j];
    if (!src || !dst || src.laneType !== dst.laneType) continue;

    const usable = src.laneType === 'Driving' || src.laneType === 'Biking'
      || (considerShoulder && src.laneType === 'Shoulder');
    if (!usable) continue;

    pairs.push({ i, j });
  }
  return pairs;
}

/**
 * Derive the one-way loop cross-section from the arm section.
 *
 * C# clones the template description with `NumDrivingLanesLeft = 0` and
 * `NumDrivingLanesRight = RoundaboutDrivingLanesCount`, so the loop lane count
 * is independent of the arm lane count.
 */
function buildLoopSection(armSection: SectionConfig, laneCount: number): SectionConfig {
  const armLanes = armSection.right;
  const shoulder = armLanes.find((l) => l.laneType === 'Shoulder');
  const driving = armLanes.find((l) => l.laneType === 'Driving');
  const laneMark = driving?.mark ?? armLanes[0]?.mark;
  const width = driving?.width ?? 3.5;

  const right: LaneConfig[] = [];
  for (let i = 0; i < Math.max(1, laneCount); i++) {
    right.push({ laneType: 'Driving', width, ...(laneMark ? { mark: laneMark } : {}) });
  }
  if (shoulder) {
    right.push({ ...shoulder });
  } else {
    const outer = armLanes[armLanes.length - 1];
    const last = right[right.length - 1];
    if (outer?.mark && last) last.mark = outer.mark;
  }
  return { left: [], right };
}

/** Cumulative inner-edge offset of each right lane from the reference line. */
function laneOffsets(lanes: LaneConfig[]): number[] {
  const offsets: number[] = [];
  let acc = 0;
  for (const lane of lanes) {
    offsets.push(acc);
    acc += lane.width;
  }
  return offsets;
}

function offsetPoint(pt: { x: number; y: number; hdg: number }, dist: number) {
  return { x: pt.x + Math.sin(pt.hdg) * dist, y: pt.y - Math.cos(pt.hdg) * dist };
}

/** Build a road whose reference line is a Hermite curve between two posed points. */
function buildCurvedRoad(
  section: SectionConfig,
  x0: number, y0: number, hdg0: number,
  x1: number, y1: number, hdg1: number,
): Road {
  const geometries = buildHermiteConnectorGeometry(x0, y0, hdg0, x1, y1, hdg1);
  const length = geometries.reduce((sum, g) => sum + g.length, 0);
  const road = buildRoad(buildLaneSectionFromConfig(section), { x: x0, y: y0, hdg: hdg0, length });
  road.plan_view = geometries;
  return road;
}

function buildStraightRoad(section: SectionConfig, x0: number, y0: number, x1: number, y1: number): Road {
  const dx = x1 - x0;
  const dy = y1 - y0;
  return buildRoad(buildLaneSectionFromConfig(section), {
    x: x0, y: y0, hdg: Math.atan2(dy, dx), length: Math.hypot(dx, dy),
  });
}

/**
 * Build the 6 perimeter roads of the loop, in counter-clockwise order:
 * `[SE corner, NE corner, north straight, NW corner, SW corner, south straight]`.
 */
function buildPerimeter(section: SectionConfig, cx: number, cy: number, active: Set<SlotKey>): Road[] {
  const northStartX = active.has('ne') ? POS_X1 - DELTA_X : POS_X1;
  const northEndX = active.has('nw') ? -(POS_X1 - DELTA_X) : -POS_X1;
  const southStartX = active.has('sw') ? -(POS_X1 - DELTA_X) : -POS_X1;
  const southEndX = active.has('se') ? POS_X1 - DELTA_X : POS_X1;

  return [
    buildCurvedRoad(section, cx + POS_X1, cy - POS_Y2, 0, cx + POS_X2, cy - POS_Y1, Math.PI / 2),
    buildCurvedRoad(section, cx + POS_X2, cy + POS_Y1, Math.PI / 2, cx + POS_X1, cy + POS_Y2, Math.PI),
    buildStraightRoad(section, cx + northStartX, cy + POS_Y2, cx + northEndX, cy + POS_Y2),
    buildCurvedRoad(section, cx - POS_X1, cy + POS_Y2, Math.PI, cx - POS_X2, cy + POS_Y1, -Math.PI / 2),
    buildCurvedRoad(section, cx - POS_X2, cy - POS_Y1, -Math.PI / 2, cx - POS_X1, cy - POS_Y2, 0),
    buildStraightRoad(section, cx + southStartX, cy - POS_Y2, cx + southEndX, cy - POS_Y2),
  ];
}

/** Build a single-lane connector road inside a junction. */
function buildConnector(
  start: { x: number; y: number; hdg: number },
  end: { x: number; y: number; hdg: number },
  laneCfg: LaneConfig,
  junctionId: string,
  predRoadId: string,
  succRoadId: string,
  predContact: 'Start' | 'End',
  succContact: 'Start' | 'End',
): Road {
  const geometries = buildHermiteConnectorGeometry(start.x, start.y, start.hdg, end.x, end.y, end.hdg);
  const road = buildRoad(buildLaneSection([], [laneCfg]), {
    x: start.x,
    y: start.y,
    hdg: start.hdg,
    length: geometries.reduce((sum, g) => sum + g.length, 0),
    junctionId,
    link: {
      predecessor: { element_type: 'Road', element_id: predRoadId, contact_point: predContact },
      successor: { element_type: 'Road', element_id: succRoadId, contact_point: succContact },
    },
  });
  road.plan_view = geometries;
  return road;
}

export function buildPlaygroundFromConfig(
  config: JunctionTemplateConfig,
  cx: number,
  cy: number,
): JunctionBuildResult {
  const armSection = config.armSection ?? DEFAULT_LOOP_SECTION;
  const drivingLaneCount = armSection.right.filter((l) => l.laneType === 'Driving').length;
  // C# forces `NumDrivingLanesLeft = 0` on the loop: perimeter roads are one-way,
  // and their lane count comes from `RoundaboutDrivingLanesCount`, not the arm.
  const loopSection = buildLoopSection(armSection, config.roundaboutLaneCount ?? drivingLaneCount);
  const loopLanes = loopSection.right;
  const loopOffsets = laneOffsets(loopLanes);

  const slots = resolvePlaygroundSlots(config.armCount ?? 4);
  const active = new Set(slots.map((s) => s.key));
  const perimeter = buildPerimeter(loopSection, cx, cy, active);

  const armLength = config.armLength > 0 ? config.armLength : INCOMING_LENGTH;
  const armRightOffsets = laneOffsets(armSection.right);
  const armLeftOffsets = laneOffsets(armSection.left);
  const junctions: Junction[] = [];
  const armRoads: Road[] = [];
  const connectorRoads: Road[] = [];

  for (const slot of slots) {
    const junctionId = genId();
    const junctionLink: LinkElement = { element_type: 'Junction', element_id: junctionId, contact_point: null };

    // Incoming arm: starts at the outer tip and points inward toward the junction.
    const arm = buildRoad(buildLaneSectionFromConfig(armSection), {
      x: cx + slot.tipX,
      y: cy + slot.tipY,
      hdg: slot.inwardHdg,
      length: armLength,
      link: { predecessor: null, successor: junctionLink },
    });
    armRoads.push(arm);

    const prev = perimeter[slot.prevRoad];
    const next = perimeter[slot.nextRoad];
    if (!prev || !next) continue;

    const prevEnd = roadEndPoint(prev);
    const nextGeo = next.plan_view[0];
    if (!nextGeo) continue;
    const nextStart = { x: nextGeo.x, y: nextGeo.y, hdg: nextGeo.hdg };
    const armEnd = roadEndPoint(arm);

    const connections: JunctionConnection[] = [];

    // 1. Loop pass-through: arriving perimeter lane → departing perimeter lane.
    for (const { i, j } of connectorLanePairs(loopLanes, loopLanes, false)) {
      const laneCfg = loopLanes[i];
      if (!laneCfg) continue;
      const connector = buildConnector(
        { ...offsetPoint(prevEnd, loopOffsets[i] ?? 0), hdg: prevEnd.hdg },
        { ...offsetPoint(nextStart, loopOffsets[j] ?? 0), hdg: nextStart.hdg },
        laneCfg, junctionId, prev.id, next.id, 'End', 'Start',
      );
      connectorRoads.push(connector);
      connections.push({
        id: genId(),
        incoming_road: prev.id,
        connecting_road: connector.id,
        contact_point: 'Start',
        lane_links: [{ from: -(i + 1), to: -1 }],
      });
    }

    // 2. Merge: incoming arm lane → departing perimeter lane.
    for (const { i, j } of connectorLanePairs(armSection.right, loopLanes, true)) {
      const laneCfg = armSection.right[i];
      if (!laneCfg) continue;
      const connector = buildConnector(
        { ...offsetPoint(armEnd, armRightOffsets[i] ?? 0), hdg: armEnd.hdg },
        { ...offsetPoint(nextStart, loopOffsets[j] ?? 0), hdg: nextStart.hdg },
        laneCfg, junctionId, arm.id, next.id, 'End', 'Start',
      );
      connectorRoads.push(connector);
      connections.push({
        id: genId(),
        incoming_road: arm.id,
        connecting_road: connector.id,
        contact_point: 'Start',
        lane_links: [{ from: -(i + 1), to: -1 }],
      });
    }

    // 3. Exit: arriving perimeter lane → outbound (left) lanes of the incoming arm.
    // Travelling outbound flips the frame, so the arm's left-lane offsets apply
    // to the right of the reversed heading.
    const outboundHdg = armEnd.hdg + Math.PI;
    const outboundPose = { x: armEnd.x, y: armEnd.y, hdg: outboundHdg };
    for (const { i, j } of connectorLanePairs(loopLanes, armSection.left, true)) {
      const laneCfg = loopLanes[i];
      if (!laneCfg) continue;
      const connector = buildConnector(
        { ...offsetPoint(prevEnd, loopOffsets[i] ?? 0), hdg: prevEnd.hdg },
        { ...offsetPoint(outboundPose, armLeftOffsets[j] ?? 0), hdg: outboundHdg },
        laneCfg, junctionId, prev.id, arm.id, 'End', 'End',
      );
      connectorRoads.push(connector);
      connections.push({
        id: genId(),
        incoming_road: prev.id,
        connecting_road: connector.id,
        contact_point: 'Start',
        lane_links: [{ from: -(i + 1), to: -1 }],
      });
    }

    junctions.push({
      id: junctionId,
      name: `${config.name ?? 'Playground'} ${slot.key}`,
      connections,
    });
  }

  const [first, ...rest] = junctions;
  return {
    junction: first ?? { id: genId(), name: config.name ?? 'Playground', connections: [] },
    roads: [...perimeter, ...armRoads, ...connectorRoads],
    extraJunctions: rest,
  };
}
