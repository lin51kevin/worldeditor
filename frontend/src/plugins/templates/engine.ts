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
} from '../../services/platform';
import type {
  LaneConfig, MarkConfig, SectionConfig,
  RoadTemplateConfig, JunctionTemplateConfig, JunctionTopology,
  SignalTemplateConfig, MarkingTemplateConfig,
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
    case 'Roundabout':
      return radialArms(cx, cy, gap, armCount ?? 4);
  }
}

// ── Junction connections ─────────────────────────────────────────────────────

function buildAllPairsConnections(roads: Road[], section: SectionConfig): JunctionConnection[] {
  const connections: JunctionConnection[] = [];
  const laneIds = [
    ...section.left.map((_: LaneConfig, i: number) => i + 1),
    ...section.right.map((_: LaneConfig, i: number) => -(i + 1)),
  ];
  const laneLinks = laneIds.map((id) => ({ from: id, to: id }));

  for (let i = 0; i < roads.length; i++) {
    for (let j = 0; j < roads.length; j++) {
      if (i === j) continue;
      const incoming = roads[i];
      const connecting = roads[j];
      if (!incoming || !connecting) continue;
      connections.push({
        id: genId('conn'),
        incoming_road: incoming.id,
        connecting_road: connecting.id,
        contact_point: 'Start',
        lane_links: laneLinks.map((ll) => ({ ...ll })),
      });
    }
  }
  return connections;
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

  const roads = arms.map((arm) =>
    buildRoad(
      // Each arm gets its own clone of the lane section
      buildLaneSectionFromConfig(section),
      {
        x: arm.x,
        y: arm.y,
        hdg: arm.hdg,
        length: effLength,
        junctionId: null,
        link: { predecessor: junctionLink, successor: null },
      },
    ),
  );

  const pattern = config.connectionPattern ?? 'all-pairs';
  const connections = pattern === 'all-pairs'
    ? buildAllPairsConnections(roads, section)
    : [];

  const junction: Junction = {
    id: junctionId,
    name: config.name ?? '',
    connections,
  };

  return { junction, roads };
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
