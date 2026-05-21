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

function centerLane(): Lane {
  return {
    id: 0,
    lane_type: 'None',
    level: 0,
    link: { predecessor: null, successor: null },
    width: [],
    borders: [],
    road_marks: [],
  };
}

// ── Section builder ──────────────────────────────────────────────────────────

/** Build an OpenDRIVE LaneSection from left/right LaneConfig arrays. */
export function buildLaneSection(left: LaneConfig[], right: LaneConfig[]): LaneSection {
  return {
    s: 0,
    single_side: false,
    left: left.map((cfg, i) => buildLane(i + 1, cfg)),
    center: [centerLane()],
    right: right.map((cfg, i) => buildLane(-(i + 1), cfg)),
  };
}

export function buildLaneSectionFromConfig(section: SectionConfig): LaneSection {
  return buildLaneSection(section.left, section.right);
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

/** Default arm section: dual 2-lane driving with solid white marks. */
const DEFAULT_ARM_SECTION: SectionConfig = {
  left: [{ laneType: 'Driving', width: DEFAULT_LANE_WIDTH, mark: { type: 'Solid' } }],
  right: [{ laneType: 'Driving', width: DEFAULT_LANE_WIDTH, mark: { type: 'Solid' } }],
};

function computeArmGap(section: SectionConfig): number {
  const maxLanes = Math.max(section.left.length, section.right.length);
  const avgWidth = maxLanes > 0
    ? [...section.left, ...section.right].reduce((s, l) => s + l.width, 0) / (section.left.length + section.right.length)
    : DEFAULT_LANE_WIDTH;
  return maxLanes * avgWidth + 1.0;
}

function tArms(cx: number, cy: number, gap: number): ArmDef[] {
  return [
    { x: cx + gap, y: cy, hdg: 0 },             // East
    { x: cx - gap, y: cy, hdg: Math.PI },        // West
    { x: cx, y: cy + gap, hdg: Math.PI / 2 },    // North
  ];
}

function crossArms(cx: number, cy: number, gap: number): ArmDef[] {
  return [
    { x: cx + gap, y: cy, hdg: 0 },              // East
    { x: cx - gap, y: cy, hdg: Math.PI },         // West
    { x: cx, y: cy + gap, hdg: Math.PI / 2 },     // North
    { x: cx, y: cy - gap, hdg: -Math.PI / 2 },    // South
  ];
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

function resolveArms(topology: JunctionTopology, cx: number, cy: number, gap: number, armCount?: number): ArmDef[] {
  switch (topology) {
    case 'T': return tArms(cx, cy, gap);
    case 'Cross': return crossArms(cx, cy, gap);
    case 'Radial':
      return radialArms(cx, cy, gap, armCount ?? 4);
    case 'Roundabout':
      // Roundabout arms are placed at specific positions, handled by buildRoundaboutFromConfig
      return radialArms(cx, cy, gap, armCount ?? 4);
  }
}

// ── Roundabout builder ─────────────────────────────────────────────────────

const DEFAULT_ROUNDABOUT_RADIUS = 15;

/**
 * Build a roundabout junction with arc-shaped ring road segments.
 *
 * Layout (N = armCount arcs):
 *   - Center island at (cx, cy)
 *   - Ring road: N arc segments forming a circle of `radius` around center
 *   - Each arc spans (360 - N*gapDeg) / N degrees with small gaps between arcs
 *   - Arm roads radiate outward from ring at evenly spaced angles
 *   - Each arm-to-arc intersection gets a small junction with connector roads
 *
 * Reference: BuildJunctionRoundabout.cs angle calculation with ratio=0.5 pattern
 */
function buildRoundaboutFromConfig(
  config: JunctionTemplateConfig,
  cx: number,
  cy: number,
): JunctionBuildResult {
  const section = config.armSection ?? DEFAULT_ARM_SECTION;
  const n = config.armCount ?? 4;
  const radius = config.roundaboutRadius ?? DEFAULT_ROUNDABOUT_RADIUS;
  const junctionId = genId('junction');

  // Angle calculation inspired by BuildJunctionRoundabout.cs (ratio=0.5 case)
  const segDeg = 240.0 / n;
  const startDeg = 90.0 - segDeg * 0.5;
  const ratio = 0.5;

  // ── Ring road arcs ─────────────────────────────────────────────────────
  const laneWidth = DEFAULT_LANE_WIDTH;

  const arcRoads: Road[] = [];
  const arcDeg2Rad = Math.PI / 180;

  // Ring road lane section: single driving lane on each side
  const ringSection = buildLaneSection(
    [{ laneType: 'Driving', width: laneWidth, mark: { type: 'Solid' } }],
    [{ laneType: 'Driving', width: laneWidth, mark: { type: 'Solid' } }],
  );

  for (let i = 0; i < n; i++) {
    const sDeg = startDeg + i * (1 + ratio) * segDeg;
    const eDeg = sDeg + segDeg;
    const sRad = sDeg * arcDeg2Rad;
    const eRad = eDeg * arcDeg2Rad;
    const arcAngle = eRad - sRad;

    // Arc length = radius * angle
    const arcLen = radius * arcAngle;

    // Start point on circle: (cx + r*cos(sRad), cy - r*sin(sRad))
    // OpenDRIVE heading is tangent to arc at start point
    // For a clockwise circle, heading at start = sRad + PI/2
    const sx = cx + radius * Math.cos(sRad);
    const sy = cy - radius * Math.sin(sRad);
    const hdg = sRad + Math.PI / 2; // tangent direction (clockwise)

    // Clockwise in y-down screen coords → negative curvature in OpenDRIVE y-up convention
    // Angles increase counterclockwise in math (visually clockwise on screen in y-down coords),
    // which corresponds to negative curvature in OpenDRIVE.
    const curvature = -1 / radius;

    const arcRoad = buildRoad(ringSection, {
      x: sx,
      y: sy,
      hdg,
      length: arcLen,
      junctionId,
      link: { predecessor: null, successor: null },
    });
    // Replace Line geometry with Arc geometry
    arcRoad.plan_view = [arcGeometry(sx, sy, hdg, arcLen, curvature)];
    arcRoads.push(arcRoad);
  }

  // ── Arm roads ──────────────────────────────────────────────────────────
  const armRoads: Road[] = [];
  const junctionLink: LinkElement = {
    element_type: 'Junction',
    element_id: junctionId,
    contact_point: null,
  };

  for (let i = 0; i < n; i++) {
    // Arm angle: midpoint of the gap between arc i and arc (i+1)%n
    const armDeg = startDeg + (1 + 0.5 * ratio) * segDeg + i * (1 + ratio) * segDeg;
    const armRad = armDeg * arcDeg2Rad;

    // Arm starts at ring edge, extends outward
    const ax = cx + radius * Math.cos(armRad);
    const ay = cy - radius * Math.sin(armRad);
    const ahdg = armRad + Math.PI / 2; // tangent (pointing clockwise)

    const effLength = config.armLength - radius;
    const armRoad = buildRoad(buildLaneSectionFromConfig(section), {
      x: ax,
      y: ay,
      hdg: ahdg,
      length: Math.max(effLength, 5),
      junctionId: null,
      link: { predecessor: junctionLink, successor: null },
    });
    armRoads.push(armRoad);
  }

  // ── Connections ────────────────────────────────────────────────────────
  // Each arm connects to adjacent arcs: arc[i] and arc[(i+1)%n]
  const connections: JunctionConnection[] = [];
  const rightLaneLinks = section.right.map((_: LaneConfig, i: number) => ({
    from: -(i + 1),
    to: -(i + 1),
  }));

  if (config.connectionPattern !== 'none') {
    for (let i = 0; i < n; i++) {
      // Arm → next arc (entering roundabout)
      const nextArc = arcRoads[(i + 1) % n]!;
      const prevArc = arcRoads[i]!;

      connections.push({
        id: genId('conn'),
        incoming_road: armRoads[i]!.id,
        connecting_road: nextArc.id,
        contact_point: 'Start',
        lane_links: rightLaneLinks.map((ll) => ({ ...ll })),
      });
      // Arc → arm (exiting roundabout)
      connections.push({
        id: genId('conn'),
        incoming_road: prevArc.id,
        connecting_road: armRoads[i]!.id,
        contact_point: 'Start',
        lane_links: rightLaneLinks.map((ll) => ({ ...ll })),
      });
    }
  }

  const junction: Junction = {
    id: junctionId,
    name: config.name ?? '',
    connections,
  };

  return { junction, roads: [...arcRoads, ...armRoads] };
}

// ── Connector road builder ───────────────────────────────────────────────────

/**
 * Build a short straight connector road (junction_id set) spanning between
 * the junction-edge points of two arm roads. This is the XODR-correct approach:
 * the junction's `connecting_road` references these connectors, not the arms.
 *
 * Each arm road starts at the junction edge (plan_view[0].{x,y}) and extends
 * outward. Connector roads bridge between two arms' junction-edge points.
 */
function buildConnectorRoad(armA: Road, armB: Road, junctionId: string): Road {
  const geoA = armA.plan_view[0]!;
  const geoB = armB.plan_view[0]!;
  const dx = geoB.x - geoA.x;
  const dy = geoB.y - geoA.y;
  const length = Math.max(Math.sqrt(dx * dx + dy * dy), 0.5);
  const hdg = Math.atan2(dy, dx);

  // Single right-side driving lane (movement from A towards B)
  const connectorSection = buildLaneSection(
    [],
    [{ laneType: 'Driving', width: DEFAULT_LANE_WIDTH }],
  );

  const road = buildRoad(connectorSection, {
    x: geoA.x,
    y: geoA.y,
    hdg,
    length,
    junctionId,
    link: {
      predecessor: { element_type: 'Road', element_id: armA.id, contact_point: 'Start' },
      successor: { element_type: 'Road', element_id: armB.id, contact_point: 'Start' },
    },
  });

  // Replace Line with Arc for a smooth curve through the junction.
  // Use the heading from armA's geometry to determine turn direction
  const hdgA = geoA.hdg;
  const hdgB = geoB.hdg;
  const angleDiff = ((hdgB - hdgA) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  // curvature inversely proportional to length for smooth arc
  const curvature = (2 / length) * Math.sin(angleDiff / 2);
  // Clamp curvature to a reasonable range
  const clampedCurvature = Math.max(-0.15, Math.min(0.15, curvature));

  road.plan_view = [
    { s: 0, x: geoA.x, y: geoA.y, hdg, length, geo_type: { Arc: { curvature: clampedCurvature } } },
  ];

  return road;
}

// ── Junction template → { junction, roads } ─────────────────────────────────

export interface JunctionBuildResult {
  junction: Junction;
  roads: Road[];
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
  const gap = computeArmGap(section);
  const arms = resolveArms(config.topology, cx, cy, gap, config.armCount);
  const effLength = config.armLength - gap;
  const junctionId = genId('junction');

  const junctionLink: LinkElement = {
    element_type: 'Junction',
    element_id: junctionId,
    contact_point: null,
  };

  // Arm roads: approach roads that start at the junction edge and extend outward.
  // junction_id = null because they are approach roads, not internal connectors.
  const armRoads = arms.map((arm) =>
    buildRoad(buildLaneSectionFromConfig(section), {
      x: arm.x,
      y: arm.y,
      hdg: arm.hdg,
      length: effLength,
      junctionId: null,
      link: { predecessor: junctionLink, successor: null },
    }),
  );

  // Connector roads: one per ordered pair (i→j), spanning junction-edge to junction-edge.
  // junction_id = junctionId marks them as internal connectors per the XODR spec.
  // Add stop line at junction entry for each arm road.
  // Arm roads have predecessor = junction, so the junction edge is at s = 0.
  const roadWidth = section.right.reduce((sum, l) => sum + (l.width ?? 3.5), 0);
  for (const arm of armRoads) {
    if (!arm.objects) arm.objects = [];
    arm.objects.push({
      id: genId('obj'),
      object_type: 'StopLine',
      name: 'stop_line',
      position: { x: 0.1, y: 0, z: 0.01, id: null },
      orientation: 0,
      hdg: 0,
      width: roadWidth,
      height: 0.01,
      length: 0.3,
      corners: [],
      validity: null,
    });
  }

  const connectorRoads: Road[] = [];
  const connections: JunctionConnection[] = [];
  const rightLaneLinks = section.right.map((_: LaneConfig, i: number) => ({
    from: -(i + 1),
    to: -(i + 1),
  }));

  const pattern = config.connectionPattern ?? 'all-pairs';
  if (pattern === 'all-pairs') {
    for (let i = 0; i < armRoads.length; i++) {
      for (let j = 0; j < armRoads.length; j++) {
        if (i === j) continue;
        const connector = buildConnectorRoad(armRoads[i]!, armRoads[j]!, junctionId);
        connectorRoads.push(connector);
        connections.push({
          id: genId('conn'),
          incoming_road: armRoads[i]!.id,
          connecting_road: connector.id,
          contact_point: 'Start',
          lane_links: rightLaneLinks.map((ll) => ({ ...ll })),
        });
      }
    }
  }

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
