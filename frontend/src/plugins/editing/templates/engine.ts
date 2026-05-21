/**
 * Template Engine
 *
 * Pure functions that interpret declarative template configs (schema.ts)
 * and produce domain objects (Road, Junction, RoadSignal, RoadMark).
 *
 * No side effects — callers are responsible for dispatching to stores.
 */
import type {
  Road, Lane, LaneSection, LaneWidth, Geometry, RoadLink,
  RoadMark, RoadSignal, Junction, JunctionConnection, LinkElement,
  RoadObjectItem,
} from '../../../services/platform';
import type {
  LaneConfig, MarkConfig, SectionConfig,
  RoadTemplateConfig, JunctionTemplateConfig, JunctionTopology,
  SignalTemplateConfig, MarkingTemplateConfig,
  RoadObjectTemplateConfig, SignTemplateConfig,
} from './schema';

const DEFAULT_ROAD_LENGTH = 100;
const DEFAULT_LANE_WIDTH = 3.5;

// ── Unique ID generation ─────────────────────────────────────────────────────

let _seq = 0;

/** Generate a unique ID with a prefix, timestamp, and sequence counter. */
export function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${(++_seq).toString(36)}`;
}

// ── Mark helpers ─────────────────────────────────────────────────────────────

function markConfigToRoadMark(cfg: MarkConfig): RoadMark {
  const defaultWidth = cfg.type === 'Broken' ? 0.12 : 0.15;
  return {
    s_offset: 0,
    mark_type: cfg.type,
    weight: cfg.weight ?? 'Standard',
    color: cfg.color ?? 'Standard',
    material: 'standard',
    width: cfg.width ?? defaultWidth,
    lane_change: cfg.laneChange ?? 'None',
  };
}

// ── Lane helpers ─────────────────────────────────────────────────────────────

function buildLane(id: number, cfg: LaneConfig): Lane {
  const marks: RoadMark[] = cfg.mark ? [markConfigToRoadMark(cfg.mark)] : [];
  return {
    id,
    lane_type: cfg.laneType,
    level: 0,
    link: { predecessor: null, successor: null },
    width: [{ s_offset: 0, a: cfg.width, b: 0, c: 0, d: 0 } as LaneWidth],
    borders: [],
    road_marks: marks,
  };
}

function centerLane(mark?: MarkConfig): Lane {
  const marks: RoadMark[] = mark ? [markConfigToRoadMark(mark)] : [];
  return {
    id: 0,
    lane_type: 'None',
    level: 0,
    link: { predecessor: null, successor: null },
    width: [],
    borders: [],
    road_marks: marks,
  };
}

// ── Section builder ──────────────────────────────────────────────────────────

/** Build an OpenDRIVE LaneSection from left/right LaneConfig arrays. */
export function buildLaneSection(left: LaneConfig[], right: LaneConfig[], centerMark?: MarkConfig): LaneSection {
  return {
    s: 0,
    single_side: false,
    left: left.map((cfg, i) => buildLane(i + 1, cfg)),
    center: [centerLane(centerMark)],
    right: right.map((cfg, i) => buildLane(-(i + 1), cfg)),
  };
}

export function buildLaneSectionFromConfig(section: SectionConfig): LaneSection {
  // Center lane mark: solid yellow line (matching C# reference)
  const centerMark: MarkConfig = { type: 'Solid', color: 'Yellow', width: 0.15 };
  return buildLaneSection(section.left, section.right, centerMark);
}

// ── Geometry ─────────────────────────────────────────────────────────────────

function lineGeometry(x: number, y: number, hdg: number, length: number): Geometry {
  return { s: 0, x, y, hdg, length, geo_type: 'Line' };
}

function arcGeometry(x: number, y: number, hdg: number, length: number, curvature: number): Geometry {
  return { s: 0, x, y, hdg, length, geo_type: { Arc: { curvature } } };
}

// ── Road builder ─────────────────────────────────────────────────────────────

interface RoadBuildOpts {
  x?: number;
  y?: number;
  hdg?: number;
  length?: number;
  junctionId?: string | null;
  link?: RoadLink | null;
}

/** Build a Road domain object from a LaneSection and placement options. */
export function buildRoad(laneSection: LaneSection, opts: RoadBuildOpts = {}): Road {
  const x = opts.x ?? 0;
  const y = opts.y ?? 0;
  const hdg = opts.hdg ?? 0;
  const length = opts.length ?? DEFAULT_ROAD_LENGTH;
  return {
    id: genId('road'),
    name: '',
    length,
    junction_id: opts.junctionId ?? null,
    link: opts.link ?? { predecessor: null, successor: null },
    plan_view: [lineGeometry(x, y, hdg, length)],
    elevation_profile: [],
    lane_offsets: [],
    lateral_profile: { superelevations: [], crossfalls: [] },
    bridges: [],
    tunnels: [],
    signals: [],
    objects: [],
    lane_sections: [laneSection],
  };
}

// ── Road template → Road ─────────────────────────────────────────────────────

export function buildRoadFromConfig(
  config: RoadTemplateConfig,
  x: number,
  y: number,
  hdg = 0,
): Road {
  const section = buildLaneSection(config.left, config.right);
  return buildRoad(section, { x, y, hdg, length: config.length ?? DEFAULT_ROAD_LENGTH });
}

// ── Junction arm geometry helpers ────────────────────────────────────────────

interface ArmDef {
  x: number;
  y: number;
  hdg: number;
}

/** Default arm section: 2 driving + 1 shoulder per side, matching C# reference. */
const DEFAULT_ARM_SECTION: SectionConfig = {
  left: [
    { laneType: 'Driving', width: DEFAULT_LANE_WIDTH, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
    { laneType: 'Driving', width: DEFAULT_LANE_WIDTH, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
    { laneType: 'Shoulder', width: 2.0, mark: { type: 'None' } },
  ],
  right: [
    { laneType: 'Driving', width: DEFAULT_LANE_WIDTH, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
    { laneType: 'Driving', width: DEFAULT_LANE_WIDTH, mark: { type: 'Broken', width: 0.15, laneChange: 'Both' } },
    { laneType: 'Shoulder', width: 2.0, mark: { type: 'None' } },
  ],
};

/**
 * Compute the gap distance from junction center to arm road endpoints.
 *
 * Uses armLength/2 as the standard gap (matching C# reference which uses gap=50
 * for armLength=100 uniformly for all arm counts). A minimum overlap-prevention
 * check ensures very wide roads or high arm counts don't cause overlap.
 */
function computeArmGap(section: SectionConfig, armCount: number, armLength: number): number {
  const totalWidth = [...section.left, ...section.right]
    .reduce((sum, lane) => sum + (lane.width ?? DEFAULT_LANE_WIDTH), 0);
  const n = Math.max(armCount, 3);
  const angularFactor = 1 / Math.sin(Math.PI / n);
  // Minimum gap to prevent adjacent arm edges from overlapping
  const minForNonOverlap = totalWidth * angularFactor * 1.0;
  // C# uses armLength/2 as standard gap (50m for 100m arms)
  const standardGap = armLength * 0.5;
  return Math.max(minForNonOverlap, standardGap);
}

function radialArms(cx: number, cy: number, gap: number, count: number): ArmDef[] {
  const arms: ArmDef[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i * 2 * Math.PI) / count;
    arms.push({
      x: cx + gap * Math.cos(angle),
      y: cy + gap * Math.sin(angle),
      hdg: angle,
    });
  }
  return arms;
}

function tArms(cx: number, cy: number, gap: number): ArmDef[] {
  // Classic T-shape: stem at 0° (east), arms at 90° (north) and -90° (south)
  const angles = [0, Math.PI / 2, -Math.PI / 2];
  return angles.map(angle => ({
    x: cx + gap * Math.cos(angle),
    y: cy + gap * Math.sin(angle),
    hdg: angle,
  }));
}

function resolveArms(topology: JunctionTopology, cx: number, cy: number, gap: number, armCount?: number): ArmDef[] {
  switch (topology) {
    case 'T': return tArms(cx, cy, gap);
    case 'Cross': return radialArms(cx, cy, gap, 4);
    case 'Radial':
      return radialArms(cx, cy, gap, armCount ?? 4);
    case 'Roundabout':
      return radialArms(cx, cy, gap, armCount ?? 4);
  }
}

/** Resolve the arm count for a given topology. */
function resolveArmCount(topology: JunctionTopology, armCount?: number): number {
  switch (topology) {
    case 'T': return 3;
    case 'Cross': return 4;
    case 'Radial': return armCount ?? 4;
    case 'Roundabout': return armCount ?? 4;
  }
}

// ── Roundabout builder ─────────────────────────────────────────────────────

const DEFAULT_ROUNDABOUT_RADIUS = 15;

/** Result for roundabout: multiple junctions. */
export interface RoundaboutBuildResult {
  junctions: Junction[];
  roads: Road[];
}

/**
 * Build a roundabout with multi-junction topology (matching C# reference).
 *
 * Architecture:
 *   - N junctions (one at each arm-ring intersection point)
 *   - N ring arc roads connecting adjacent junctions (non-junction roads)
 *   - N arm roads approaching each junction from outside (non-junction roads)
 *   - Connector roads within each junction bridging arm↔ring traffic
 *
 * Ring arcs:
 *   arc[i]: predecessor=junction[i], successor=junction[(i+1)%N]
 * Arm roads:
 *   arm[i]: successor=junction[i] (points inward toward junction)
 */
function buildRoundaboutFromConfig(
  config: JunctionTemplateConfig,
  cx: number,
  cy: number,
): JunctionBuildResult {
  const section = config.armSection ?? DEFAULT_ARM_SECTION;
  const n = config.armCount ?? 4;
  const radius = config.roundaboutRadius ?? DEFAULT_ROUNDABOUT_RADIUS;

  const arcDeg2Rad = Math.PI / 180;
  const laneWidth = DEFAULT_LANE_WIDTH;

  // Evenly space N arms around the circle
  const armAngles: number[] = [];
  for (let i = 0; i < n; i++) {
    armAngles.push((i * 360) / n);
  }

  // ── Create N junctions ─────────────────────────────────────────────────
  const junctionIds: string[] = [];
  for (let i = 0; i < n; i++) {
    junctionIds.push(genId('junction'));
  }

  // ── Ring arc roads (between adjacent junctions) ────────────────────────
  // arc[i] goes from junction[i] to junction[(i+1)%N] clockwise
  const arcRoads: Road[] = [];
  const ringSection = buildLaneSection(
    [{ laneType: 'Driving', width: laneWidth, mark: { type: 'Solid' } }],
    [{ laneType: 'Driving', width: laneWidth, mark: { type: 'Solid' } }],
  );

  for (let i = 0; i < n; i++) {
    const nextIdx = (i + 1) % n;
    const startAngleDeg = armAngles[i]!;
    const endAngleDeg = armAngles[nextIdx]!;

    // Handle wrap-around for clockwise direction
    let arcSpanDeg = endAngleDeg - startAngleDeg;
    if (arcSpanDeg <= 0) arcSpanDeg += 360;

    const arcSpanRad = arcSpanDeg * arcDeg2Rad;
    const arcLen = radius * arcSpanRad;

    // Start point: offset from junction[i] position along ring (clockwise)
    const sRad = startAngleDeg * arcDeg2Rad;
    const sx = cx + radius * Math.cos(sRad);
    const sy = cy - radius * Math.sin(sRad);
    // Tangent direction for clockwise ring (heading perpendicular to radius, clockwise)
    const hdg = sRad + Math.PI / 2;
    const curvature = -1 / radius; // clockwise = negative curvature

    const arcRoad = buildRoad(ringSection, {
      x: sx,
      y: sy,
      hdg,
      length: arcLen,
      junctionId: null,
      link: {
        predecessor: { element_type: 'Junction', element_id: junctionIds[i]!, contact_point: null },
        successor: { element_type: 'Junction', element_id: junctionIds[nextIdx]!, contact_point: null },
      },
    });
    arcRoad.plan_view = [arcGeometry(sx, sy, hdg, arcLen, curvature)];
    arcRoads.push(arcRoad);
  }

  // ── Arm roads (radiate outward, point inward toward junction) ──────────
  const armRoads: Road[] = [];
  const effLength = Math.max(config.armLength - radius, 5);

  for (let i = 0; i < n; i++) {
    const armRad = armAngles[i]! * arcDeg2Rad;
    // Arm tip is at outer edge, arm points inward
    const tipX = cx + (radius + effLength) * Math.cos(armRad);
    const tipY = cy - (radius + effLength) * Math.sin(armRad);
    // Inward heading (toward center)
    const inwardHdg = armRad + Math.PI;

    const junctionLink: LinkElement = {
      element_type: 'Junction',
      element_id: junctionIds[i]!,
      contact_point: null,
    };

    const armRoad = buildRoad(buildLaneSectionFromConfig(section), {
      x: tipX,
      y: tipY,
      hdg: inwardHdg,
      length: effLength,
      junctionId: null,
      link: { predecessor: null, successor: junctionLink },
    });
    armRoads.push(armRoad);
  }

  // ── Build connector roads and connections per junction ──────────────────
  // At junction[i]:
  //   - arm[i] enters (right-side lanes)
  //   - arc[(i-1+n)%n] enters (right-side lanes, ring traffic arriving)
  //   - Connectors:
  //     a) arm[i] → arc[i] (entering ring, per right-side lane)
  //     b) arc[(i-1+n)%n] → arm[i] (exiting ring to arm, per right-side lane)
  //     c) arc[(i-1+n)%n] → arc[i] (passing through junction, right-side lane)
  const junctions: Junction[] = [];
  const connectorRoads: Road[] = [];

  const numRightLanes = section.right.length;

  for (let i = 0; i < n; i++) {
    const connections: JunctionConnection[] = [];
    const prevArcIdx = (i - 1 + n) % n;

    // a) arm[i] right lanes → ring arc[i] (entering ring)
    for (let laneIdx = 0; laneIdx < numRightLanes; laneIdx++) {
      const connector = buildSingleLaneConnector(
        armRoads[i]!, arcRoads[i]!, junctionIds[i]!,
        { laneType: 'Driving', width: laneWidth }, 0, [{ laneType: 'Driving', width: laneWidth }],
      );
      connectorRoads.push(connector);
      connections.push({
        id: genId('conn'),
        incoming_road: armRoads[i]!.id,
        connecting_road: connector.id,
        contact_point: 'Start',
        lane_links: [{ from: -(laneIdx + 1), to: -1 }],
      });
    }

    // b) previous arc → arm[i] (exiting ring)
    for (let laneIdx = 0; laneIdx < 1; laneIdx++) {
      const connector = buildRoundaboutExitConnector(arcRoads[prevArcIdx]!, armRoads[i]!, junctionIds[i]!, laneWidth);
      connectorRoads.push(connector);
      connections.push({
        id: genId('conn'),
        incoming_road: arcRoads[prevArcIdx]!.id,
        connecting_road: connector.id,
        contact_point: 'Start',
        lane_links: [{ from: -1, to: -1 }],
      });
    }

    // c) previous arc → current arc (pass through)
    const passConnector = buildSingleLaneConnector(
      arcRoads[prevArcIdx]!, arcRoads[i]!, junctionIds[i]!,
      { laneType: 'Driving', width: laneWidth }, 0, [{ laneType: 'Driving', width: laneWidth }],
    );
    connectorRoads.push(passConnector);
    connections.push({
      id: genId('conn'),
      incoming_road: arcRoads[prevArcIdx]!.id,
      connecting_road: passConnector.id,
      contact_point: 'Start',
      lane_links: [{ from: -1, to: -1 }],
    });

    junctions.push({
      id: junctionIds[i]!,
      name: config.name ? `${config.name} (${i + 1})` : '',
      connections,
    });
  }

  // Add stop lines and crosswalks to arm roads
  const roadWidth = section.right.reduce((sum, l) => sum + (l.width ?? 3.5), 0);
  for (const arm of armRoads) {
    if (!arm.objects) arm.objects = [];
    arm.objects.push({
      id: genId('obj'),
      object_type: 'StopLine',
      name: 'stop_line',
      position: { x: arm.length - 0.1, y: 0, z: 0.01, id: null },
      orientation: 0,
      hdg: 0,
      width: roadWidth,
      height: 0.01,
      length: 0.3,
      corners: [],
      validity: null,
    });
  }
  addCrosswalks(armRoads);
  addTurnArrows(armRoads);

  // Return first junction as "main" for backward compat, all junctions in result
  // The caller should handle multiple junctions from roundabouts
  return { junction: junctions[0]!, roads: [...arcRoads, ...armRoads, ...connectorRoads], extraJunctions: junctions.slice(1) };
}

/**
 * Build a connector for roundabout exit (arc end → arm start).
 * Special handling: the arc road ends at the junction, arm starts at tip and ends at junction.
 */
function buildRoundaboutExitConnector(
  arcRoad: Road,
  armRoad: Road,
  junctionId: string,
  laneWidth: number,
): Road {
  // Arc end point (where it reaches the junction)
  const arcGeo = arcRoad.plan_view[0]!;
  let arcEndX: number, arcEndY: number, arcEndHdg: number;

  if (typeof arcGeo.geo_type === 'object' && 'Arc' in arcGeo.geo_type) {
    const curvature = arcGeo.geo_type.Arc.curvature;
    const arcRadius = Math.abs(1 / curvature);
    const arcAngle = arcRoad.length / arcRadius;
    const sign = curvature < 0 ? -1 : 1;
    arcEndHdg = arcGeo.hdg + sign * arcAngle;
    // For arc geometry, compute end position
    if (Math.abs(curvature) > 1e-10) {
      const r = 1 / curvature;
      const cx2 = arcGeo.x - r * Math.sin(arcGeo.hdg);
      const cy2 = arcGeo.y + r * Math.cos(arcGeo.hdg);
      arcEndX = cx2 + r * Math.sin(arcEndHdg);
      arcEndY = cy2 - r * Math.cos(arcEndHdg);
    } else {
      arcEndX = arcGeo.x + Math.cos(arcGeo.hdg) * arcRoad.length;
      arcEndY = arcGeo.y + Math.sin(arcGeo.hdg) * arcRoad.length;
    }
  } else {
    arcEndX = arcGeo.x + Math.cos(arcGeo.hdg) * arcRoad.length;
    arcEndY = arcGeo.y + Math.sin(arcGeo.hdg) * arcRoad.length;
    arcEndHdg = arcGeo.hdg;
  }

  // Arm end point (junction edge)
  const armEnd = roadEndPoint(armRoad);

  const dx = armEnd.x - arcEndX;
  const dy = armEnd.y - arcEndY;
  const length = Math.max(Math.sqrt(dx * dx + dy * dy), 0.5);
  const hdg = Math.atan2(dy, dx);

  const connectorSection = buildLaneSection([], [{ laneType: 'Driving', width: laneWidth }]);
  const road = buildRoad(connectorSection, {
    x: arcEndX,
    y: arcEndY,
    hdg,
    length,
    junctionId,
    link: {
      predecessor: { element_type: 'Road', element_id: arcRoad.id, contact_point: 'End' },
      successor: { element_type: 'Road', element_id: armRoad.id, contact_point: 'End' },
    },
  });

  return road;
}

// ── Connector road builder ───────────────────────────────────────────────────

/**
 * Compute the end point of a road (junction edge for inward-pointing arm roads).
 */
function roadEndPoint(road: Road): { x: number; y: number; hdg: number } {
  const geo = road.plan_view[0]!;
  return {
    x: geo.x + Math.cos(geo.hdg) * road.length,
    y: geo.y + Math.sin(geo.hdg) * road.length,
    hdg: geo.hdg,
  };
}

/**
 * Build a single-lane connector road between two arm roads (matching C# per-lane pattern).
 *
 * Each connector carries exactly ONE lane. The connector reference line is offset
 * laterally from the arm road's end to align with the inner edge of the target lane.
 *
 * @param armA - Source arm road (incoming traffic)
 * @param armB - Target arm road (outgoing traffic)
 * @param junctionId - Junction ID
 * @param laneCfg - Lane type/width for this connector
 * @param laneIdx - 0-based index of the lane (0=innermost, counting outward)
 * @param allLanes - All right-side lanes (for computing cumulative offset)
 */
function buildSingleLaneConnector(
  armA: Road,
  armB: Road,
  junctionId: string,
  laneCfg: LaneConfig,
  laneIdx: number,
  allLanes: LaneConfig[],
): Road {
  const endA = roadEndPoint(armA);
  const endB = roadEndPoint(armB);

  // Compute lateral offset: cumulative width of all lanes inside this one
  let cumulativeOffset = 0;
  for (let k = 0; k < laneIdx; k++) {
    cumulativeOffset += allLanes[k]!.width ?? DEFAULT_LANE_WIDTH;
  }

  // Offset direction: perpendicular right from road heading = (sin(hdg), -cos(hdg))
  const offsetAx = Math.sin(endA.hdg) * cumulativeOffset;
  const offsetAy = -Math.cos(endA.hdg) * cumulativeOffset;

  // For target arm: the connector arrives at armB's left-side lane (positive IDs).
  // The target lane index mirrors the source. Offset from armB end is the same amount
  // but in the perpendicular-left direction of armB's heading (since it enters from the left).
  // ArmB heading + π = departure direction. Perpendicular right of departure = perpendicular left of armB.
  const departureHdg = endB.hdg + Math.PI;
  const offsetBx = Math.sin(departureHdg) * cumulativeOffset;
  const offsetBy = -Math.cos(departureHdg) * cumulativeOffset;

  // Connector start/end with lateral offsets
  const startX = endA.x + offsetAx;
  const startY = endA.y + offsetAy;
  const endX = endB.x + offsetBx;
  const endY = endB.y + offsetBy;

  // Build single-lane section
  const connectorSection = buildLaneSection([], [laneCfg]);

  // Arrival direction: traffic flows along armA's heading
  const arrivalHdg = endA.hdg;

  // Generate paramPoly3 geometry segments for smooth S-curve
  const geometries = buildHermiteConnectorGeometry(
    startX, startY, arrivalHdg,
    endX, endY, departureHdg,
  );

  const totalLength = geometries.reduce((sum, g) => sum + g.length, 0);

  // Lane link in road: connector's lane -1 links to source lane and target lane
  const sourceLaneId = -(laneIdx + 1); // e.g., -1, -2, -3
  const targetLaneId = laneIdx + 1;     // e.g., 1, 2, 3 (left-side of target arm)

  const road = buildRoad(connectorSection, {
    x: startX,
    y: startY,
    hdg: arrivalHdg,
    length: totalLength,
    junctionId,
    link: {
      predecessor: { element_type: 'Road', element_id: armA.id, contact_point: 'End' },
      successor: { element_type: 'Road', element_id: armB.id, contact_point: 'End' },
    },
  });

  // Store lane links inside the lane section for OpenDRIVE compatibility
  const connLane = road.lane_sections[0]?.right[0];
  if (connLane) {
    connLane.link = {
      predecessor: sourceLaneId,
      successor: targetLaneId,
    };
  }

  road.plan_view = geometries;
  return road;
}

/**
 * Build Hermite-interpolated paramPoly3 geometry for a connector road.
 * Splits the curve into 3 segments for better approximation (matching C# reference).
 *
 * Uses cubic Hermite interpolation in local (u,v) frame:
 *   u(t) = au + bu*t + cu*t² + du*t³
 *   v(t) = av + bv*t + cv*t² + dv*t³
 * where t ∈ [0,1] (normalized pRange).
 */
function buildHermiteConnectorGeometry(
  x0: number, y0: number, hdg0: number,
  x1: number, y1: number, hdg1: number,
): Geometry[] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const chordLength = Math.sqrt(dx * dx + dy * dy);
  if (chordLength < 0.01) {
    // Degenerate: return minimal Line
    return [{ s: 0, x: x0, y: y0, hdg: hdg0, length: 0.01, geo_type: 'Line' }];
  }

  // Number of segments (3 for long connectors, 2 for shorter ones)
  const numSegments = chordLength > 30 ? 3 : 2;

  // Sample the Hermite curve at segment boundaries
  // Hermite basis: P(t) = (2t³-3t²+1)P0 + (t³-2t²+t)T0 + (-2t³+3t²)P1 + (t³-t²)T1
  // where T0/T1 are tangent vectors scaled by chord length
  const tangentScale = chordLength; // Scale tangents to match chord for natural curve
  const t0x = Math.cos(hdg0) * tangentScale;
  const t0y = Math.sin(hdg0) * tangentScale;
  const t1x = Math.cos(hdg1) * tangentScale;
  const t1y = Math.sin(hdg1) * tangentScale;

  // Evaluate Hermite curve position and tangent at parameter t
  function hermitePos(t: number): { x: number; y: number } {
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return {
      x: h00 * x0 + h10 * t0x + h01 * x1 + h11 * t1x,
      y: h00 * y0 + h10 * t0y + h01 * y1 + h11 * t1y,
    };
  }

  function hermiteTangent(t: number): { tx: number; ty: number } {
    const t2 = t * t;
    const dh00 = 6 * t2 - 6 * t;
    const dh10 = 3 * t2 - 4 * t + 1;
    const dh01 = -6 * t2 + 6 * t;
    const dh11 = 3 * t2 - 2 * t;
    return {
      tx: dh00 * x0 + dh10 * t0x + dh01 * x1 + dh11 * t1x,
      ty: dh00 * y0 + dh10 * t0y + dh01 * y1 + dh11 * t1y,
    };
  }

  // Split into segments at equal parameter intervals
  const geometries: Geometry[] = [];
  let sAccum = 0;

  for (let seg = 0; seg < numSegments; seg++) {
    const tStart = seg / numSegments;
    const tEnd = (seg + 1) / numSegments;

    const pStart = hermitePos(tStart);
    const tanStart = hermiteTangent(tStart);
    const segHdg = Math.atan2(tanStart.ty, tanStart.tx);

    // Estimate segment arc-length
    const subSamples = 20;
    let segLen = 0;
    let prev = pStart;
    for (let i = 1; i <= subSamples; i++) {
      const t = tStart + (tEnd - tStart) * (i / subSamples);
      const pt = hermitePos(t);
      segLen += Math.sqrt((pt.x - prev.x) ** 2 + (pt.y - prev.y) ** 2);
      prev = pt;
    }
    segLen = Math.max(segLen, 0.01);

    // Fit paramPoly3 to this segment in local frame
    // Local frame: origin at pStart, x-axis along segHdg
    const cosH = Math.cos(segHdg);
    const sinH = Math.sin(segHdg);

    // Sample points in local frame and fit cubic
    const samples: { t: number; u: number; v: number }[] = [];
    for (let i = 0; i <= 10; i++) {
      const tParam = i / 10;
      const tGlobal = tStart + (tEnd - tStart) * tParam;
      const pt = hermitePos(tGlobal);
      const lx = pt.x - pStart.x;
      const ly = pt.y - pStart.y;
      // Rotate to local frame
      const u = lx * cosH + ly * sinH;
      const v = -lx * sinH + ly * cosH;
      samples.push({ t: tParam, u, v });
    }

    // Fit cubic u(t) and v(t) using endpoint + tangent constraints (Hermite in local)
    const uEnd = samples[10]!.u;
    const vEnd = samples[10]!.v;

    // Local tangent at start
    const tanEnd = hermiteTangent(tEnd);
    const localTanStartU = tanStart.tx * cosH + tanStart.ty * sinH;
    const localTanStartV = -tanStart.tx * sinH + tanStart.ty * cosH;
    const localTanEndU = tanEnd.tx * cosH + tanEnd.ty * sinH;
    const localTanEndV = -tanEnd.tx * sinH + tanEnd.ty * cosH;

    // Scale tangents to normalized parameter [0,1]
    const dt = tEnd - tStart; // fraction of total parameter
    const bu = localTanStartU * dt;
    const bv = localTanStartV * dt;
    const endTanU = localTanEndU * dt;
    const endTanV = localTanEndV * dt;

    // Hermite cubic: P(t) where P(0)=0, P'(0)=b, P(1)=end, P'(1)=endTan
    // cu = 3*(uEnd) - 2*bu - endTanU
    // du = -2*(uEnd) + bu + endTanU
    const cu = 3 * uEnd - 2 * bu - endTanU;
    const du = -2 * uEnd + bu + endTanU;
    const cv = 3 * vEnd - 2 * bv - endTanV;
    const dv = -2 * vEnd + bv + endTanV;

    geometries.push({
      s: sAccum,
      x: pStart.x,
      y: pStart.y,
      hdg: segHdg,
      length: segLen,
      geo_type: {
        ParamPoly3: {
          a_u: 0, b_u: bu, c_u: cu, d_u: du,
          a_v: 0, b_v: bv, c_v: cv, d_v: dv,
          p_range: 'Normalized',
        },
      },
    });

    sAccum += segLen;
  }

  return geometries;
}

// ── Junction template → { junction, roads } ─────────────────────────────────

export interface JunctionBuildResult {
  junction: Junction;
  roads: Road[];
  /** Additional junctions (used by roundabout multi-junction topology) */
  extraJunctions?: Junction[];
}

// ── Turn arrow helpers ───────────────────────────────────────────────────────

/**
 * Determine arrow signal subtype for outgoing (left) lane based on driving lane count
 * and lane position index (1-based from innermost).
 * For outgoing direction: mirrors C# placement at s≈4 on left-side lanes.
 */
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

/**
 * Determine arrow signal subtype for incoming (right) lane based on driving lane count
 * and lane position index (1-based from innermost).
 * Matches C# GetPaintSubTye logic for right-hand driving, incoming direction.
 */
function getIncomingArrowSubtype(drivingLaneCount: number, laneIndex: number): { subType: string; name: string } {
  if (drivingLaneCount === 1) {
    return { subType: 'StraightOrLeftOrRightTurnArrow', name: 'Straight Left or Right Turn Arrow Paint' };
  } else if (drivingLaneCount === 2) {
    if (laneIndex === 1) {
      return { subType: 'LeftOrRightTurnArrow', name: 'Left or Right Turn Arrow Paint' };
    } else {
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
 * Add turn arrow signals to arm roads on both sides (matching C# reference):
 * - Right-side (incoming traffic): placed at s ≈ length - 4m, t < 0
 * - Left-side (outgoing traffic): placed at s ≈ 4m, t > 0
 */
function addTurnArrows(armRoads: Road[]): void {
  const SIGNAL_S_DELTA = 4.0;
  for (const road of armRoads) {
    if (!road.signals) road.signals = [];

    // Right-side (incoming) arrows near junction entry (s ≈ length - 4)
    const rightDrivingLanes = road.lane_sections[0]!.right.filter(l => l.lane_type === 'Driving');
    const rightLaneCount = rightDrivingLanes.length;
    if (rightLaneCount >= 1) {
      const signalS = Math.max(road.length - SIGNAL_S_DELTA, 0.5);
      for (let i = 0; i < rightLaneCount; i++) {
        const laneIndex = i + 1;
        const { subType, name } = getIncomingArrowSubtype(rightLaneCount, laneIndex);
        const lane = rightDrivingLanes[i]!;
        const laneWidth = lane.width[0]?.a ?? DEFAULT_LANE_WIDTH;
        const tOffset = -(i * laneWidth + laneWidth / 2);

        road.signals!.push({
          id: genId('signal'),
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

    // Left-side (outgoing) arrows near road start (s ≈ 4)
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
          id: genId('signal'),
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
 * For inward-pointing arm roads, junction edge is at s=length (successor=junction).
 * Includes cornerLocal outline matching C# reference format.
 */
function addCrosswalks(armRoads: Road[]): void {
  const CROSSWALK_WIDTH = 4.0;
  // Crosswalk sits between the stop line and junction edge (junction side of stop line)
  // Layout: ... → stop_line (s=length-6) → crosswalk (s=length-2) → junction edge (s=length)
  const CROSSWALK_OFFSET = 0.0;
  for (const road of armRoads) {
    const leftLanes = road.lane_sections[0]!.left;
    const rightLanes = road.lane_sections[0]!.right;
    const leftWidth = leftLanes.reduce((sum, l) => sum + (l.width[0]?.a ?? DEFAULT_LANE_WIDTH), 0);
    const rightWidth = rightLanes.reduce((sum, l) => sum + (l.width[0]?.a ?? DEFAULT_LANE_WIDTH), 0);
    const totalRoadWidth = leftWidth + rightWidth;
    const halfWidth = totalRoadWidth / 2 + 0.1;

    // Crosswalk position: close to junction edge (past the stop line)
    const crosswalkS = road.length - CROSSWALK_OFFSET;

    // Corner outline (matching C# reference: u→x, v→y, z→z)
    const corners = [
      { x: 1, y: -halfWidth, z: 0, id: null },
      { x: 1, y: halfWidth, z: 0, id: null },
      { x: 1 + CROSSWALK_WIDTH, y: halfWidth, z: 0, id: null },
      { x: 1 + CROSSWALK_WIDTH, y: -halfWidth, z: 0, id: null },
      { x: 1, y: -halfWidth, z: 0, id: null },
    ];

    if (!road.objects) road.objects = [];
    road.objects.push({
      id: genId('obj'),
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
 * For inward-pointing arm roads, junction edge is at s=length.
 * Split broken marks: solid for last SOLIDATE_LENGTH, broken for the rest.
 */
function solidateBrokenLinesNearJunction(armRoads: Road[]): void {
  const SOLIDATE_LENGTH = 10.0;
  for (const road of armRoads) {
    const section = road.lane_sections[0];
    if (!section) continue;

    // Process right-side lanes (incoming traffic)
    for (const lane of section.right) {
      if (lane.road_marks.length === 0) continue;
      const mark = lane.road_marks[0]!;
      if (mark.mark_type === 'Broken' && road.length > SOLIDATE_LENGTH) {
        // Replace with two marks: broken for most of the road, solid near junction
        const solidStart = road.length - SOLIDATE_LENGTH;
        lane.road_marks = [
          { ...mark, s_offset: 0 }, // broken from start
          { ...mark, s_offset: solidStart, mark_type: 'Solid', lane_change: 'None' }, // solid near junction
        ];
      }
    }

    // Process left-side lanes (outgoing traffic)
    for (const lane of section.left) {
      if (lane.road_marks.length === 0) continue;
      const mark = lane.road_marks[0]!;
      if (mark.mark_type === 'Broken' && road.length > SOLIDATE_LENGTH) {
        // For left lanes (outgoing), solid near junction entry (s=length end)
        const solidStart = road.length - SOLIDATE_LENGTH;
        lane.road_marks = [
          { ...mark, s_offset: 0 },
          { ...mark, s_offset: solidStart, mark_type: 'Solid', lane_change: 'None' },
        ];
      }
    }
  }
}

export function buildJunctionFromConfig(
  config: JunctionTemplateConfig,
  cx: number,
  cy: number,
): JunctionBuildResult {
  if (config.topology === 'Roundabout') {
    return buildRoundaboutFromConfig(config, cx, cy);
  }

  const section = config.armSection ?? DEFAULT_ARM_SECTION;
  const armCount = resolveArmCount(config.topology, config.armCount);
  const gap = computeArmGap(section, armCount, config.armLength);
  const arms = resolveArms(config.topology, cx, cy, gap, config.armCount);
  // Road length = armLength (gap is additional space beyond road, matching C# reference)
  const effLength = config.armLength;
  const junctionId = genId('junction');

  const junctionLink: LinkElement = {
    element_type: 'Junction',
    element_id: junctionId,
    contact_point: null,
  };

  // Arm roads: approach roads that start at the outer tip and end at the junction edge.
  // They point INWARD (toward the junction center), matching OpenDRIVE convention where
  // right-side lanes (negative IDs) carry traffic toward the junction (incoming).
  // successor = Junction because junction is at the end (s=length) of each arm road.
  const armRoads = arms.map((arm) => {
    // arm.x/y is the junction edge position; compute tip position (outer end)
    const tipX = arm.x + Math.cos(arm.hdg) * effLength;
    const tipY = arm.y + Math.sin(arm.hdg) * effLength;
    // Inward heading (toward junction center)
    const inwardHdg = arm.hdg + Math.PI;

    return buildRoad(buildLaneSectionFromConfig(section), {
      x: tipX,
      y: tipY,
      hdg: inwardHdg,
      length: effLength,
      junctionId: null,
      link: { predecessor: null, successor: junctionLink },
    });
  });

  // Add stop line at junction entry for each arm road.
  // Arm roads point inward, so junction edge is at s = length.
  // Stop line is positioned before the crosswalk (driver stops here).
  const roadWidth = section.right.reduce((sum, l) => sum + (l.width ?? 3.5), 0);
  for (const arm of armRoads) {
    if (!arm.objects) arm.objects = [];
    arm.objects.push({
      id: genId('obj'),
      object_type: 'StopLine',
      name: 'stop_line',
      position: { x: arm.length - 0.1, y: 0, z: 0.01, id: null },
      orientation: 0,
      hdg: 0,
      width: roadWidth,
      height: 0.01,
      length: 0.3,
      corners: [],
      validity: null,
    });
  }

  // ── Build per-lane connectors (matching C# reference) ────────────────────────
  // Each lane gets its own connector road (1 lane per connector).
  // Lane selection depends on the angular distance between arms:
  //   - Adjacent CW (1 step): all lanes (shoulder + driving)
  //   - Non-adjacent (2 to N-2 steps): driving lanes only (no shoulder)
  //   - Reverse CCW (N-1 steps = 1 step backward): innermost driving lane only

  const connectorRoads: Road[] = [];
  const connections: JunctionConnection[] = [];
  const n = armRoads.length;

  const rightLanes = section.right; // [Driving, Driving, Shoulder] ordered inside→outside

  const pattern = config.connectionPattern ?? 'all-pairs';
  if (pattern === 'all-pairs') {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        // CW distance: how many steps clockwise from i to j
        const cwDist = (j - i + n) % n;

        // Select which lanes to connect based on distance
        let lanesToConnect: { laneIdx: number; config: LaneConfig }[];
        if (cwDist === 1) {
          // Adjacent CW: all lanes (shoulder + driving)
          lanesToConnect = rightLanes.map((cfg, idx) => ({ laneIdx: idx, config: cfg }));
        } else if (cwDist === n - 1) {
          // Reverse CCW (1 step backward): innermost driving lane only
          lanesToConnect = [{ laneIdx: 0, config: rightLanes[0]! }];
        } else {
          // Non-adjacent: driving lanes only (no shoulder)
          lanesToConnect = rightLanes
            .map((cfg, idx) => ({ laneIdx: idx, config: cfg }))
            .filter(l => l.config.laneType === 'Driving');
        }

        // Create one connector per lane
        for (const { laneIdx, config: laneCfg } of lanesToConnect) {
          const connector = buildSingleLaneConnector(
            armRoads[i]!, armRoads[j]!, junctionId,
            laneCfg, laneIdx, rightLanes,
          );
          connectorRoads.push(connector);
          // Lane link: from incoming arm's lane to connector's single lane
          const fromLaneId = -(laneIdx + 1); // arm lane ID (e.g., -1, -2, -3)
          connections.push({
            id: genId('conn'),
            incoming_road: armRoads[i]!.id,
            connecting_road: connector.id,
            contact_point: 'Start',
            lane_links: [{ from: fromLaneId, to: -1 }],
          });
        }
      }
    }
  }

  // ── Post-processing: add road furniture ────────────────────────────────────

  // Add turn arrows on arm roads
  addTurnArrows(armRoads);

  // Add crosswalks at junction-adjacent ends
  addCrosswalks(armRoads);

  // Convert broken lines to solid near junction entry
  solidateBrokenLinesNearJunction(armRoads);

  const junction: Junction = {
    id: junctionId,
    name: config.name ?? '',
    connections,
  };

  return { junction, roads: [...armRoads, ...connectorRoads] };
}

// ── Signal template → RoadSignal ─────────────────────────────────────────────

export function buildSignalFromConfig(config: SignalTemplateConfig): RoadSignal {
  return {
    id: genId('signal'),
    name: '',
    s: 0,
    t: 0,
    z_offset: 0,
    h_offset: 0,
    width: config.width ?? 1.0,
    height: config.height ?? 2.0,
    signal_type: config.signalType,
    signal_subtype: config.signalSubtype ?? '-1',
    value: null,
    orientation: '+',
    is_dynamic: false,
  };
}

// ── Marking template → RoadMark ──────────────────────────────────────────────

export function buildMarkFromConfig(config: MarkingTemplateConfig): RoadMark {
  return markConfigToRoadMark(config.mark);
}

// ── Road-object template → RoadObjectItem ────────────────────────────────────

export function buildRoadObjectFromConfig(
  config: RoadObjectTemplateConfig,
  s: number,
  t: number,
  hdg = 0,
): RoadObjectItem {
  return {
    id: genId('obj'),
    object_type: config.objectType,
    name: '',
    position: { x: s, y: t, z: 0.1, id: null },
    orientation: hdg,
    hdg,
    width: config.defaultWidth ?? 1.0,
    height: config.defaultHeight ?? 0.5,
    length: config.defaultLength ?? 1.0,
    corners: [],
    validity: null,
  };
}

// ── Sign template → RoadObjectItem ───────────────────────────────────────────

export function buildSignFromConfig(
  config: SignTemplateConfig,
  s: number,
  t: number,
  hdg = 0,
): RoadObjectItem {
  return {
    id: genId('sign'),
    object_type: config.objectType,
    name: '',
    position: { x: s, y: t, z: 0.1, id: null },
    orientation: hdg,
    hdg,
    width: config.defaultWidth ?? 1.0,
    height: config.defaultHeight ?? 3.0,
    length: config.defaultWidth ?? 1.0,
    corners: [],
    validity: null,
  };
}
