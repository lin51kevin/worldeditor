/**
 * Template Engine
 *
 * Pure functions that interpret declarative template configs (schema.ts)
 * and produce domain objects (Road, Junction, RoadSignal, RoadMark).
 *
 * No side effects — callers are responsible for dispatching to stores.
 *
 * Junction / roundabout / connector builders live in their own modules
 * (`junctionEngine.ts`, `roundabout.ts`, `connectors.ts`) and are re-exported
 * below for backward compatibility.
 */
import type {
  Road, Lane, LaneSection, LaneWidth, Geometry, RoadLink,
  RoadMark,
} from '../../../services/platform';
import type {
  LaneConfig, MarkConfig, SectionConfig,
  RoadTemplateConfig,
} from './schema';

const DEFAULT_ROAD_LENGTH = 100;

// ── Unique ID generation ─────────────────────────────────────────────────────

let _globalSeq = 0;

/**
 * Generate a globally unique numeric ID string.
 *
 * If `existingIds` is provided, ensures the returned ID is greater than any
 * existing numeric ID to avoid collisions.
 */
export function genId(existingIds?: string[]): string {
  if (existingIds && existingIds.length > 0) {
    for (const id of existingIds) {
      const n = parseInt(id, 10);
      if (!isNaN(n) && n > _globalSeq) {
        _globalSeq = n;
      }
    }
  }
  return String(++_globalSeq);
}

/** Reset the global ID counter (for testing only). */
export function resetIdCounter(val = 0): void {
  _globalSeq = val;
}

// ── Mark helpers ─────────────────────────────────────────────────────────────

export function markConfigToRoadMark(cfg: MarkConfig): RoadMark {
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
    id: genId(),
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

// ── Re-export junction builders ──────────────────────────────────────────────

export { buildJunctionFromConfig } from './junctionEngine';
export type { JunctionBuildResult } from './junctionEngine';
export type { RoundaboutBuildResult } from './roundabout';

// ── Re-export converters from separate module ────────────────────────────────

export {
  buildSignalFromConfig,
  buildMarkFromConfig,
  buildRoadObjectFromConfig,
  buildSignFromConfig,
} from './converters';
