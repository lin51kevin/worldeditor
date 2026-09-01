/**
 * Lane-change (lane-count transition) road template engine.
 *
 * Ports the C# `CreateChangedRoads*` builders: a lane-count sequence such as
 * `[1, 2]` or `[1, 2, 1]` becomes a chain of straight roads with constant lane
 * widths, separated by transition roads where the added / removed lane tapers
 * between 0 and the full lane width.
 *
 * Pure functions — callers are responsible for dispatching results to stores.
 */
import type { Road, Lane, LaneSection, LaneWidth, RoadMark } from '../../../services/platform';
import type { LaneChangeConfig, MarkConfig, RoadTemplateConfig } from './schema';
import { genId, buildRoad, markConfigToRoadMark } from './engine';

const DEFAULT_LANE_WIDTH = 3.5;
const DEFAULT_STRAIGHT_LENGTH = 33;
const DEFAULT_TRANSITION_LENGTH = 34;

const LANE_MARK: MarkConfig = { type: 'Broken', width: 0.12, laneChange: 'Both' };
const BORDER_MARK: MarkConfig = { type: 'Solid', width: 0.15 };
const CENTER_MARK: MarkConfig = { type: 'Solid', color: 'Yellow', width: 0.15 };

export interface LaneChangeBuildResult {
  roads: Road[];
}

/** One segment of the chain: `taper` is null for constant-width straights. */
interface SegmentSpec {
  laneCount: number;
  length: number;
  /** Index of the first tapered lane, or null when all lanes are constant width */
  taperFrom: number | null;
  taperDirection: 'widen' | 'narrow';
}

/**
 * Cubic width taper with zero slope at both ends, matching the Hermite lane
 * boundaries C# derives from `ConnectingRoadCurve`.
 */
function taperWidth(width: number, length: number, direction: 'widen' | 'narrow'): LaneWidth {
  const c = (3 * width) / (length * length);
  const d = (-2 * width) / (length * length * length);
  return direction === 'widen'
    ? { s_offset: 0, a: 0, b: 0, c, d }
    : { s_offset: 0, a: width, b: 0, c: -c, d: -d };
}

function buildSegmentLane(
  laneIdx: number,
  spec: SegmentSpec,
  laneWidth: number,
): Lane {
  const isOutermost = laneIdx === spec.laneCount - 1;
  const isTapered = spec.taperFrom !== null && laneIdx >= spec.taperFrom;
  const mark: RoadMark = markConfigToRoadMark(isOutermost ? BORDER_MARK : LANE_MARK);
  return {
    id: -(laneIdx + 1),
    lane_type: 'Driving',
    level: 0,
    link: { predecessor: null, successor: null },
    width: [
      isTapered
        ? taperWidth(laneWidth, spec.length, spec.taperDirection)
        : { s_offset: 0, a: laneWidth, b: 0, c: 0, d: 0 },
    ],
    borders: [],
    road_marks: [mark],
  };
}

function buildSegmentSection(spec: SegmentSpec, laneWidth: number): LaneSection {
  return {
    s: 0,
    single_side: false,
    left: [],
    center: [{
      id: 0,
      lane_type: 'None',
      level: 0,
      link: { predecessor: null, successor: null },
      width: [],
      borders: [],
      road_marks: [markConfigToRoadMark(CENTER_MARK)],
    }],
    right: Array.from({ length: spec.laneCount }, (_, i) => buildSegmentLane(i, spec, laneWidth)),
  };
}

/**
 * Expand a lane-count sequence into the alternating straight/transition chain.
 *
 * `[1, 2]`    → straight(1) · transition(2) · straight(2)
 * `[1, 2, 1]` → straight(1) · transition(2) · straight(2) · transition(2) · straight(1)
 */
export function planLaneChangeSegments(cfg: LaneChangeConfig): SegmentSpec[] {
  const straightLength = cfg.straightLength ?? DEFAULT_STRAIGHT_LENGTH;
  const transitionLength = cfg.transitionLength ?? DEFAULT_TRANSITION_LENGTH;
  const segments: SegmentSpec[] = [];

  cfg.sequence.forEach((count, i) => {
    if (i > 0) {
      const prev = cfg.sequence[i - 1] ?? count;
      const widening = count > prev;
      segments.push({
        laneCount: Math.max(prev, count),
        length: transitionLength,
        taperFrom: Math.min(prev, count),
        taperDirection: widening ? 'widen' : 'narrow',
      });
    }
    segments.push({
      laneCount: count,
      length: straightLength,
      taperFrom: null,
      taperDirection: 'widen',
    });
  });

  return segments;
}

/** Link consecutive roads and their shared lanes. */
function linkChain(roads: Road[]): void {
  for (let i = 0; i < roads.length - 1; i++) {
    const from = roads[i];
    const to = roads[i + 1];
    if (!from || !to) continue;

    from.link = {
      predecessor: from.link?.predecessor ?? null,
      successor: { element_id: to.id, element_type: 'Road', contact_point: 'Start' },
    };
    to.link = {
      predecessor: { element_id: from.id, element_type: 'Road', contact_point: 'End' },
      successor: to.link?.successor ?? null,
    };

    const fromLanes = from.lane_sections[0]?.right ?? [];
    const toLanes = to.lane_sections[0]?.right ?? [];
    const shared = Math.min(fromLanes.length, toLanes.length);
    for (let k = 0; k < shared; k++) {
      const fl = fromLanes[k];
      const tl = toLanes[k];
      if (!fl || !tl) continue;
      fl.link = { predecessor: fl.link?.predecessor ?? null, successor: tl.id };
      tl.link = { predecessor: fl.id, successor: tl.link?.successor ?? null };
    }
  }
}

/**
 * Build the full road chain for a lane-change template, starting at (x, y)
 * and running along `hdg`.
 */
export function buildLaneChangeRoads(
  config: RoadTemplateConfig,
  x: number,
  y: number,
  hdg = 0,
): LaneChangeBuildResult {
  const cfg = config.laneChange;
  if (!cfg) return { roads: [] };

  const laneWidth = cfg.laneWidth ?? DEFAULT_LANE_WIDTH;
  const segments = planLaneChangeSegments(cfg);
  const cos = Math.cos(hdg);
  const sin = Math.sin(hdg);

  let offset = 0;
  const roads = segments.map((spec) => {
    const road = buildRoad(buildSegmentSection(spec, laneWidth), {
      x: x + cos * offset,
      y: y + sin * offset,
      hdg,
      length: spec.length,
    });
    road.name = `LaneChange_${genId()}`;
    offset += spec.length;
    return road;
  });

  linkChain(roads);
  return { roads };
}
