/**
 * Overpass junction template engine.
 *
 * Ports the C# `BuildJunctionOverpass1/2/3` builders: grade-separated crossings
 * where one axis is lowered by `heightDelta` (-6 m by default) and connected to
 * the other axis by three-quarter circular ramps (variants 1 & 2) or by
 * directional spline ramps (variant 3).
 */
import type {
  Road, Geometry, Elevation, Junction, JunctionConnection, LinkElement,
} from '../../../services/platform';
import type { JunctionTemplateConfig, LaneConfig, SectionConfig } from './schema';
import { genId, buildRoad, buildLaneSection, buildLaneSectionFromConfig } from './engine';
import { buildHermiteConnectorGeometry, type JunctionBuildResult } from './junctionEngine';

const DEG = Math.PI / 180;
const DEFAULT_HEIGHT_DELTA = -6;
const DEFAULT_LANE_WIDTH = 3.5;
/** C# `delta` — half-spacing between the crossing axes. */
const DELTA = 50;

const DEFAULT_SECTION: SectionConfig = {
  left: [{ laneType: 'Driving', width: DEFAULT_LANE_WIDTH }],
  right: [{ laneType: 'Driving', width: DEFAULT_LANE_WIDTH }],
};

interface Pose { x: number; y: number; hdg: number }

/** A geometry run with a linear elevation ramp along it. */
interface Piece { geometries: Geometry[]; zStart: number; zEnd: number }

function pieceLength(piece: Piece): number {
  return piece.geometries.reduce((sum, g) => sum + g.length, 0);
}

function straightPiece(x0: number, y0: number, x1: number, y1: number, zStart: number, zEnd: number): Piece {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  return {
    geometries: [{ s: 0, x: x0, y: y0, hdg: Math.atan2(dy, dx), length, geo_type: 'Line' }],
    zStart,
    zEnd,
  };
}

function hermitePiece(from: Pose, to: Pose, zStart: number, zEnd: number): Piece {
  return {
    geometries: buildHermiteConnectorGeometry(from.x, from.y, from.hdg, to.x, to.y, to.hdg),
    zStart,
    zEnd,
  };
}

/** Point on a circle at `deg`, plus the tangent heading for the given sweep direction. */
function circlePose(cx: number, cy: number, radius: number, deg: number, clockwise: boolean): Pose {
  const rad = deg * DEG;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
    hdg: clockwise ? rad - Math.PI / 2 : rad + Math.PI / 2,
  };
}

/** Exact circular-arc piece (C# samples the same circle at 45° steps). */
function arcPiece(
  cx: number, cy: number, radius: number,
  startDeg: number, sweepDeg: number,
  zStart: number, zEnd: number,
): Piece {
  const clockwise = sweepDeg < 0;
  const start = circlePose(cx, cy, radius, startDeg, clockwise);
  const length = radius * Math.abs(sweepDeg) * DEG;
  return {
    geometries: [{
      s: 0, x: start.x, y: start.y, hdg: start.hdg, length,
      geo_type: { Arc: { curvature: (clockwise ? -1 : 1) / radius } },
    }],
    zStart,
    zEnd,
  };
}

/** Concatenate pieces into a single road, re-basing `s` and building the elevation profile. */
function assembleRoad(section: SectionConfig, pieces: Piece[]): Road | null {
  const first = pieces[0]?.geometries[0];
  if (!first) return null;

  const geometries: Geometry[] = [];
  const elevation: Elevation[] = [];
  let s = 0;

  for (const piece of pieces) {
    const len = pieceLength(piece);
    for (const geo of piece.geometries) {
      geometries.push({ ...geo, s: s + geo.s });
    }
    elevation.push({
      s,
      a: piece.zStart,
      b: len > 0 ? (piece.zEnd - piece.zStart) / len : 0,
      c: 0,
      d: 0,
    });
    s += len;
  }

  const road = buildRoad(buildLaneSectionFromConfig(section), {
    x: first.x, y: first.y, hdg: first.hdg, length: s,
  });
  road.plan_view = geometries;
  road.elevation_profile = elevation;
  return road;
}

/** C# ramp radius: `delta*1.5 - nLanes*laneWidth`, corrected for the shoulder. */
function computeRampRadius(section: SectionConfig, base: number): number {
  const driving = section.right.filter((l) => l.laneType === 'Driving');
  const shoulder = section.right.find((l) => l.laneType === 'Shoulder');
  const n = driving.length;
  let radius = base - n * (driving[0]?.width ?? DEFAULT_LANE_WIDTH);
  if (shoulder) {
    if (n === 1) radius -= shoulder.width * 4;
    else if (n === 2) radius -= shoulder.width * 2;
  }
  return Math.max(radius, 5);
}

// ---------------------------------------------------------------------------
// Junction assembly
// ---------------------------------------------------------------------------

/** A road endpoint that meets a junction. */
interface Leg { road: Road; end: 'Start' | 'End'; section: SectionConfig }

function roadStartPose(road: Road): Pose {
  const geo = road.plan_view[0]!;
  return { x: geo.x, y: geo.y, hdg: geo.hdg };
}

function roadEndPose(road: Road): Pose {
  const last = road.plan_view[road.plan_view.length - 1]!;
  const remaining = road.length - last.s;
  if (last.geo_type === 'Line' || typeof last.geo_type !== 'object' || !('Arc' in last.geo_type)) {
    return {
      x: last.x + Math.cos(last.hdg) * remaining,
      y: last.y + Math.sin(last.hdg) * remaining,
      hdg: last.hdg,
    };
  }
  const k = last.geo_type.Arc.curvature;
  if (Math.abs(k) < 1e-9) {
    return { x: last.x + Math.cos(last.hdg) * remaining, y: last.y + Math.sin(last.hdg) * remaining, hdg: last.hdg };
  }
  const r = 1 / k;
  const cx = last.x - r * Math.sin(last.hdg);
  const cy = last.y + r * Math.cos(last.hdg);
  const theta = remaining * k;
  return {
    x: cx + r * Math.sin(last.hdg + theta),
    y: cy - r * Math.cos(last.hdg + theta),
    hdg: last.hdg + theta,
  };
}

/** Traffic arriving at the junction on this leg: pose (travel direction) + lanes. */
function legInbound(leg: Leg): { pose: Pose; lanes: LaneConfig[]; laneSign: 1 | -1 } {
  return leg.end === 'End'
    ? { pose: roadEndPose(leg.road), lanes: leg.section.right, laneSign: -1 }
    : { pose: { ...roadStartPose(leg.road), hdg: roadStartPose(leg.road).hdg + Math.PI }, lanes: leg.section.left, laneSign: 1 };
}

/** Traffic departing the junction on this leg: pose (travel direction) + lanes. */
function legOutbound(leg: Leg): { pose: Pose; lanes: LaneConfig[]; laneSign: 1 | -1 } {
  if (leg.end === 'End') {
    const end = roadEndPose(leg.road);
    return { pose: { ...end, hdg: end.hdg + Math.PI }, lanes: leg.section.left, laneSign: 1 };
  }
  return { pose: roadStartPose(leg.road), lanes: leg.section.right, laneSign: -1 };
}

function offsetPose(pose: Pose, dist: number): Pose {
  return { x: pose.x + Math.sin(pose.hdg) * dist, y: pose.y - Math.cos(pose.hdg) * dist, hdg: pose.hdg };
}

function cumulativeOffset(lanes: LaneConfig[], index: number): number {
  let acc = 0;
  for (let k = 0; k < index; k++) acc += lanes[k]?.width ?? DEFAULT_LANE_WIDTH;
  return acc;
}

/** Build all-pairs connectors for one junction. */
function buildJunction(name: string, legs: Leg[]): { junction: Junction; roads: Road[] } {
  const junctionId = genId();
  const connections: JunctionConnection[] = [];
  const roads: Road[] = [];

  for (const from of legs) {
    const inbound = legInbound(from);
    if (inbound.lanes.length === 0) continue;

    for (const to of legs) {
      if (to.road.id === from.road.id) continue;
      const outbound = legOutbound(to);
      const count = Math.min(inbound.lanes.length, outbound.lanes.length);

      for (let i = 0; i < count; i++) {
        const laneCfg = inbound.lanes[i];
        if (!laneCfg) continue;
        const start = offsetPose(inbound.pose, cumulativeOffset(inbound.lanes, i));
        const end = offsetPose(outbound.pose, cumulativeOffset(outbound.lanes, i));
        const geometries = buildHermiteConnectorGeometry(start.x, start.y, start.hdg, end.x, end.y, end.hdg);

        const connector = buildRoad(buildLaneSection([], [laneCfg]), {
          x: start.x,
          y: start.y,
          hdg: start.hdg,
          length: geometries.reduce((sum, g) => sum + g.length, 0),
          junctionId,
          link: {
            predecessor: { element_type: 'Road', element_id: from.road.id, contact_point: from.end },
            successor: { element_type: 'Road', element_id: to.road.id, contact_point: to.end },
          },
        });
        connector.plan_view = geometries;

        const connLane = connector.lane_sections[0]?.right[0];
        if (connLane) {
          connLane.link = {
            predecessor: inbound.laneSign * (i + 1),
            successor: outbound.laneSign * (i + 1),
          };
        }
        roads.push(connector);
        connections.push({
          id: genId(),
          incoming_road: from.road.id,
          connecting_road: connector.id,
          contact_point: 'Start',
          lane_links: [{ from: inbound.laneSign * (i + 1), to: -1 }],
        });
      }
    }
  }

  const junctionLink: LinkElement = { element_type: 'Junction', element_id: junctionId, contact_point: null };
  for (const leg of legs) {
    const link = leg.road.link ?? { predecessor: null, successor: null };
    leg.road.link = leg.end === 'End'
      ? { ...link, successor: junctionLink }
      : { ...link, predecessor: junctionLink };
  }

  return { junction: { id: junctionId, name, connections }, roads };
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

interface VariantResult { roads: Road[]; junctionSpecs: { name: string; legs: Leg[] }[] }

function buildVariant1(
  cx: number, cy: number, L: number, H: number,
  section: SectionConfig, ramp: SectionConfig, radius: number,
): VariantResult {
  const D = DELTA * 1.5;
  const HALF = DELTA * 0.5;

  const north = assembleRoad(section, [straightPiece(cx, cy + D + L, cx, cy + D, H, H)])!;
  const south = assembleRoad(section, [straightPiece(cx, cy + HALF, cx, cy + HALF - L, H, H)])!;
  const west = assembleRoad(section, [straightPiece(cx - L - D, cy, cx - D, cy, 0, 0)])!;
  const hcenter = assembleRoad(section, [straightPiece(cx - HALF, cy, cx + HALF, cy, 0, 0)])!;
  const east = assembleRoad(section, [straightPiece(cx + D, cy, cx + D + L, cy, 0, 0)])!;
  const rampNW = assembleRoad(ramp, [arcPiece(cx - D, cy + D, radius, 270, -270, 0, H)])!;
  const rampNE = assembleRoad(ramp, [arcPiece(cx + D, cy + D, radius, 180, -270, H, 0)])!;

  return {
    roads: [north, south, west, hcenter, east, rampNW, rampNE],
    junctionSpecs: [
      { name: 'Overpass East', legs: [
        { road: rampNE, end: 'End', section: ramp },
        { road: hcenter, end: 'End', section },
        { road: east, end: 'Start', section },
      ] },
      { name: 'Overpass West', legs: [
        { road: hcenter, end: 'Start', section },
        { road: rampNW, end: 'Start', section: ramp },
        { road: west, end: 'End', section },
      ] },
      { name: 'Overpass North', legs: [
        { road: south, end: 'Start', section },
        { road: rampNE, end: 'Start', section: ramp },
        { road: north, end: 'End', section },
        { road: rampNW, end: 'End', section: ramp },
      ] },
    ],
  };
}

function buildVariant2(
  cx: number, cy: number, L: number, H: number,
  section: SectionConfig, ramp: SectionConfig, radius: number,
): VariantResult {
  const D = DELTA * 1.5;
  const HALF = DELTA * 0.5;

  const north = assembleRoad(section, [straightPiece(cx, cy + D + L, cx, cy + D, H, H)])!;
  const south = assembleRoad(section, [straightPiece(cx, cy - D, cx, cy - D - L, H, H)])!;
  const vcenter = assembleRoad(section, [straightPiece(cx, cy + HALF, cx, cy - HALF, H, H)])!;
  const west = assembleRoad(section, [straightPiece(cx - L - D, cy, cx - D, cy, 0, 0)])!;
  const east = assembleRoad(section, [straightPiece(cx + D, cy, cx + D + L, cy, 0, 0)])!;
  const hcenter = assembleRoad(section, [straightPiece(cx - HALF, cy, cx + HALF, cy, 0, 0)])!;
  const rampNW = assembleRoad(ramp, [arcPiece(cx - D, cy + D, radius, 270, -270, 0, H)])!;
  const rampNE = assembleRoad(ramp, [arcPiece(cx + D, cy + D, radius, 180, -270, H, 0)])!;
  const rampSW = assembleRoad(ramp, [arcPiece(cx - D, cy - D, radius, 360, -270, H, 0)])!;
  const rampSE = assembleRoad(ramp, [arcPiece(cx + D, cy - D, radius, 90, -270, 0, H)])!;

  return {
    roads: [north, south, vcenter, west, east, hcenter, rampNW, rampNE, rampSW, rampSE],
    junctionSpecs: [
      { name: 'Overpass East', legs: [
        { road: rampNE, end: 'End', section: ramp },
        { road: hcenter, end: 'End', section },
        { road: east, end: 'Start', section },
        { road: rampSE, end: 'Start', section: ramp },
      ] },
      { name: 'Overpass West', legs: [
        { road: hcenter, end: 'Start', section },
        { road: rampNW, end: 'Start', section: ramp },
        { road: west, end: 'End', section },
        { road: rampSW, end: 'End', section: ramp },
      ] },
      { name: 'Overpass North', legs: [
        { road: vcenter, end: 'Start', section },
        { road: rampNE, end: 'Start', section: ramp },
        { road: north, end: 'End', section },
        { road: rampNW, end: 'End', section: ramp },
      ] },
      { name: 'Overpass South', legs: [
        { road: rampSE, end: 'End', section: ramp },
        { road: vcenter, end: 'End', section },
        { road: south, end: 'Start', section },
        { road: rampSW, end: 'Start', section: ramp },
      ] },
    ],
  };
}

function buildVariant3(
  cx: number, cy: number, L: number, H: number,
  section: SectionConfig, ramp: SectionConfig, radius: number,
): VariantResult {
  const yD = DELTA;
  const yHalf = yD * 0.5;      // 25
  const yD15 = yD * 1.5;       // 75
  const laneW = section.right.find((l) => l.laneType === 'Driving')?.width ?? DEFAULT_LANE_WIDTH;
  const shoulderW = section.right.find((l) => l.laneType === 'Shoulder')?.width ?? 2;
  const sw = Math.min(shoulderW, 0.5);
  const nL = section.left.filter((l) => l.laneType === 'Driving').length;
  const nR = section.right.filter((l) => l.laneType === 'Driving').length;

  const rampCx = cx - radius - nR * laneW - shoulderW - sw;
  const rampCy = cy + yD15;
  const eastX = cx + nL * laneW + shoulderW + sw;

  const north = assembleRoad(section, [straightPiece(cx, cy + yD15 + L, cx, cy + yD15, 0, 0)])!;
  const south = assembleRoad(section, [straightPiece(cx, cy + yHalf, cx, cy + yHalf - L, 0, 0)])!;

  // West: straight lead-in at the low level, then a three-quarter climbing arc.
  const westLead: Pose = { x: cx + L, y: cy + yHalf, hdg: Math.PI };
  const westArcStart = circlePose(rampCx, rampCy, radius, 270, true);
  const west = assembleRoad(ramp, [
    hermitePiece(westLead, westArcStart, H, H),
    arcPiece(rampCx, rampCy, radius, 270, -270, H, 0),
  ])!;

  // Southeast directional ramp (4-point spline, descending).
  const southeast = assembleRoad(ramp, [
    hermitePiece(
      { x: eastX, y: cy + yHalf - L, hdg: Math.PI / 2 },
      { x: eastX, y: cy + yHalf - L * 0.667, hdg: Math.PI / 2 },
      0, H * 0.25,
    ),
    hermitePiece(
      { x: eastX, y: cy + yHalf - L * 0.667, hdg: Math.PI / 2 },
      { x: cx + L * 0.667, y: cy + yHalf - nR * laneW - 4 * sw, hdg: 0 },
      H * 0.25, H * 0.75,
    ),
    hermitePiece(
      { x: cx + L * 0.667, y: cy + yHalf - nR * laneW - 4 * sw, hdg: 0 },
      { x: cx + L, y: cy + yHalf - nR * laneW - 4 * sw, hdg: 0 },
      H * 0.75, H,
    ),
  ])!;

  // Northeast directional ramp (4-point spline, climbing).
  const neY = cy + yHalf + nR * laneW + 2 * sw;
  const northeast = assembleRoad(ramp, [
    hermitePiece(
      { x: cx + L, y: neY, hdg: Math.PI },
      { x: cx + L * 0.667, y: neY, hdg: Math.PI },
      H, H * 0.75,
    ),
    hermitePiece(
      { x: cx + L * 0.667, y: neY, hdg: Math.PI },
      { x: eastX, y: cy + yD15 + 0.667 * L, hdg: Math.PI / 2 },
      H * 0.75, H * 0.25,
    ),
    hermitePiece(
      { x: eastX, y: cy + yD15 + 0.667 * L, hdg: Math.PI / 2 },
      { x: eastX, y: cy + yD15 + L, hdg: Math.PI / 2 },
      H * 0.25, 0,
    ),
  ])!;

  // Northwest ramp: lead-in, 135° arc, then a straight run out to the east.
  const nwRadius = radius + 2 * sw;
  const nwLead: Pose = { x: cx - nR * laneW - shoulderW - sw, y: cy + yD15 + L, hdg: -Math.PI / 2 };
  const nwArcStart = circlePose(rampCx, rampCy, nwRadius, 135, false);
  const nwArcEnd = circlePose(rampCx, rampCy, nwRadius, 270, false);
  const nwTail: Pose = { x: cx + L, y: cy + yHalf - 2 * sw, hdg: 0 };
  const northwest = assembleRoad(ramp, [
    hermitePiece(nwLead, nwArcStart, 0, H * 0.5),
    arcPiece(rampCx, rampCy, nwRadius, 135, 135, H * 0.5, H),
    hermitePiece(nwArcEnd, nwTail, H, H),
  ])!;

  return {
    roads: [north, south, west, southeast, northeast, northwest],
    junctionSpecs: [
      { name: 'Overpass Center', legs: [
        { road: west, end: 'End', section: ramp },
        { road: north, end: 'End', section },
        { road: south, end: 'Start', section },
      ] },
    ],
  };
}

export function buildOverpassFromConfig(
  config: JunctionTemplateConfig,
  cx: number,
  cy: number,
): JunctionBuildResult {
  const section = config.armSection ?? DEFAULT_SECTION;
  // C# clones the description with `NumDrivingLanesLeft = 0` for every ramp.
  const ramp: SectionConfig = { left: [], right: section.right };
  const L = config.armLength > 0 ? config.armLength : 100;
  const H = config.heightDelta ?? DEFAULT_HEIGHT_DELTA;
  const variant = config.variant ?? 1;

  let built: VariantResult;
  if (variant === 2) {
    built = buildVariant2(cx, cy, L, H, section, ramp, computeRampRadius(ramp, DELTA * 1.5));
  } else if (variant === 3) {
    built = buildVariant3(cx, cy, L, H, section, ramp, config.rampRadius ?? DELTA);
  } else {
    built = buildVariant1(cx, cy, L, H, section, ramp, computeRampRadius(ramp, DELTA * 1.5));
  }

  const junctions: Junction[] = [];
  const connectorRoads: Road[] = [];
  for (const spec of built.junctionSpecs) {
    const { junction, roads } = buildJunction(spec.name, spec.legs);
    junctions.push(junction);
    connectorRoads.push(...roads);
  }

  const [first, ...rest] = junctions;
  return {
    junction: first ?? { id: genId(), name: config.name ?? 'Overpass', connections: [] },
    roads: [...built.roads, ...connectorRoads],
    extraJunctions: rest,
  };
}
