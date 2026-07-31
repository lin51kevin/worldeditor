import type { LaneWidth, Road } from '../../services/platform';

/** One lane laid out in a cross-section, with edge distances from the centerline. */
export interface CrossSectionLane {
  side: 'left' | 'right';
  id: number;
  laneType: string;
  width: number;
  /** Distance (m) from centerline to the inner edge. */
  inner: number;
  /** Distance (m) from centerline to the outer edge. */
  outer: number;
}

/** A computed cross-section of a road at a given station. */
export interface CrossSection {
  sectionIndex: number;
  station: number;
  lanes: CrossSectionLane[];
  totalLeft: number;
  totalRight: number;
}

/** Evaluate a lane-width polynomial at local offset `ds` (clamped to ≥ 0). */
export function evalLaneWidth(widths: LaneWidth[], ds: number): number {
  let entry: LaneWidth | undefined;
  for (const w of widths) {
    if (w.s_offset <= ds + 1e-9) entry = w;
  }
  if (!entry) entry = widths[0];
  if (!entry) return 0;
  const t = ds - entry.s_offset;
  return Math.max(0, entry.a + entry.b * t + entry.c * t * t + entry.d * t * t * t);
}

/**
 * Compute the lane layout of `road` at `station`, resolving the active lane
 * section and evaluating each lane's width. Lanes are ordered inner→outer per
 * side so their `inner`/`outer` edges stack correctly for rendering.
 */
export function computeCrossSection(road: Road, station: number): CrossSection {
  let sectionIndex = 0;
  for (let i = 0; i < road.lane_sections.length; i++) {
    if (road.lane_sections[i]!.s <= station + 1e-9) sectionIndex = i;
  }

  const section = road.lane_sections[sectionIndex];
  const lanes: CrossSectionLane[] = [];
  let totalLeft = 0;
  let totalRight = 0;

  if (section) {
    const ds = Math.max(0, station - section.s);

    const left = [...section.left].sort((a, b) => a.id - b.id);
    let inner = 0;
    for (const lane of left) {
      const width = evalLaneWidth(lane.width, ds);
      lanes.push({ side: 'left', id: lane.id, laneType: lane.lane_type, width, inner, outer: inner + width });
      inner += width;
    }
    totalLeft = inner;

    const right = [...section.right].sort((a, b) => Math.abs(a.id) - Math.abs(b.id));
    inner = 0;
    for (const lane of right) {
      const width = evalLaneWidth(lane.width, ds);
      lanes.push({ side: 'right', id: lane.id, laneType: lane.lane_type, width, inner, outer: inner + width });
      inner += width;
    }
    totalRight = inner;
  }

  return { sectionIndex, station, lanes, totalLeft, totalRight };
}
