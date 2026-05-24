/**
 * Pure road manipulation utilities.
 *
 * All functions are side-effect-free and fully unit-testable.
 * They are used by the Advanced Editing plugin to implement
 * split, weld, sidewalk deployment, standard marking application,
 * crosswalk deployment, and stop line deployment.
 */

import type {
  Road,
  Lane,
  LaneSection,
  RoadMark,
  Project,
  Junction,
  Geometry,
  GeometryType,
  LaneWidth,
} from '../services/platform';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SIDEWALK_WIDTH = 2.0;
const DEFAULT_MARK_WIDTH = 0.15;
const DEFAULT_LANE_WIDTH = 3.5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a standard road mark record. */
function makeMark(markType: 'Solid' | 'Broken' | 'None', color = 'White'): RoadMark {
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
function makeSidewalkLane(id: number, width: number): Lane {
  return {
    id,
    lane_type: 'Sidewalk',
    level: 0,
    link: null,
    width: [{ s_offset: 0, a: width, b: 0, c: 0, d: 0 }],
    road_marks: [makeMark('Solid')],
  };
}

// ─── evalGeometryAtS ─────────────────────────────────────────────────────────

/**
 * Evaluate geometry at a local arclength offset `ds` from the geometry start.
 * Returns { x, y, hdg } in world coordinates.
 */
function evalGeometryAtS(geo: Geometry, ds: number): { x: number; y: number; hdg: number } {
  const { x: x0, y: y0, hdg: hdg0, geo_type } = geo;

  if (geo_type === 'Line') {
    return { x: x0 + ds * Math.cos(hdg0), y: y0 + ds * Math.sin(hdg0), hdg: hdg0 };
  }

  if ('Arc' in geo_type) {
    const kappa = geo_type.Arc.curvature;
    if (Math.abs(kappa) < 1e-12) {
      return { x: x0 + ds * Math.cos(hdg0), y: y0 + ds * Math.sin(hdg0), hdg: hdg0 };
    }
    const theta = kappa * ds;
    const lx = Math.sin(theta) / kappa;
    const ly = (1 - Math.cos(theta)) / kappa;
    return {
      x: x0 + lx * Math.cos(hdg0) - ly * Math.sin(hdg0),
      y: y0 + lx * Math.sin(hdg0) + ly * Math.cos(hdg0),
      hdg: hdg0 + theta,
    };
  }

  if ('Spiral' in geo_type) {
    const { curv_start: c0, curv_end: c1 } = geo_type.Spiral;
    const L = geo.length;
    // heading at ds: theta = c0*ds + (c1-c0)*ds^2/(2L)
    const thetaAt = (t: number) => c0 * t + ((c1 - c0) * t * t) / (2 * L);
    // Numerical integration (Gauss-Legendre 5-point)
    const gaussX = [0, 0.5384693101056831, -0.5384693101056831, 0.9061798459386640, -0.9061798459386640];
    const gaussW = [0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891, 0.2369268850561891];
    const lx = (gaussW.reduce((sum, w, i) => sum + w * Math.cos(thetaAt(ds / 2 * (1 + (gaussX[i] ?? 0)))), 0)) * ds / 2;
    const ly = (gaussW.reduce((sum, w, i) => sum + w * Math.sin(thetaAt(ds / 2 * (1 + (gaussX[i] ?? 0)))), 0)) * ds / 2;
    return {
      x: x0 + lx * Math.cos(hdg0) - ly * Math.sin(hdg0),
      y: y0 + lx * Math.sin(hdg0) + ly * Math.cos(hdg0),
      hdg: hdg0 + thetaAt(ds),
    };
  }

  if ('Poly3' in geo_type) {
    const { a, b, c, d } = geo_type.Poly3;
    // local coords: x_local = ds, y_local = a + b*ds + c*ds^2 + d*ds^3
    const yl = a + b * ds + c * ds * ds + d * ds * ds * ds;
    const dyl = b + 2 * c * ds + 3 * d * ds * ds;
    const localHdg = Math.atan2(dyl, 1);
    return {
      x: x0 + ds * Math.cos(hdg0) - yl * Math.sin(hdg0),
      y: y0 + ds * Math.sin(hdg0) + yl * Math.cos(hdg0),
      hdg: hdg0 + localHdg,
    };
  }

  if ('ParamPoly3' in geo_type) {
    const { a_u, b_u, c_u, d_u, a_v, b_v, c_v, d_v, p_range } = geo_type.ParamPoly3;
    const p = p_range === 'Normalized' ? (geo.length > 0 ? ds / geo.length : 0) : ds;
    const u = a_u + b_u * p + c_u * p * p + d_u * p * p * p;
    const v = a_v + b_v * p + c_v * p * p + d_v * p * p * p;
    const du = b_u + 2 * c_u * p + 3 * d_u * p * p;
    const dv = b_v + 2 * c_v * p + 3 * d_v * p * p;
    return {
      x: x0 + u * Math.cos(hdg0) - v * Math.sin(hdg0),
      y: y0 + u * Math.sin(hdg0) + v * Math.cos(hdg0),
      hdg: hdg0 + Math.atan2(dv, du),
    };
  }

  // Unknown: fall back to line approximation
  return { x: x0 + ds * Math.cos(hdg0), y: y0 + ds * Math.sin(hdg0), hdg: hdg0 };
}

// ─── splitGeometryType ───────────────────────────────────────────────────────

/**
 * Given a geometry type and the split position (local offset `before` within
 * the segment of total `length`), return corrected geometry types for each half.
 *
 * - Line / Arc: parameters unchanged in both halves.
 * - Spiral: `curv_end` of first half and `curv_start` of second half are set
 *   to the curvature at the split point.
 * - Poly3: second half gets a Taylor-shifted polynomial (re-based to ds'=0 at
 *   the split point); first half is unchanged.
 * - ParamPoly3: both halves get re-parametrized polynomials. The second half's
 *   coefficients are additionally rotated by β = hdg0 - splitHdg so that the
 *   polynomial offsets are expressed in the split-point's local frame (which
 *   the renderer uses) rather than the original start frame.
 */
function splitGeometryType(
  geo_type: GeometryType,
  length: number,
  before: number,
  hdg0: number,
  splitHdg: number,
): { type1: GeometryType; type2: GeometryType } {
  // Line and Arc: nothing to recompute
  if (geo_type === 'Line' || 'Arc' in geo_type) {
    return { type1: geo_type, type2: geo_type };
  }

  if ('Spiral' in geo_type) {
    const { curv_start: c0, curv_end: c1 } = geo_type.Spiral;
    const cMid = c0 + (c1 - c0) * before / length;
    return {
      type1: { Spiral: { curv_start: c0, curv_end: cMid } },
      type2: { Spiral: { curv_start: cMid, curv_end: c1 } },
    };
  }

  if ('Poly3' in geo_type) {
    const { b, c, d } = geo_type.Poly3;
    const ds0 = before;
    // Taylor shift: y_new(ds') = y(ds0 + ds') - y(ds0), so a' = 0
    const b2 = b + 2 * c * ds0 + 3 * d * ds0 * ds0;
    const c2 = c + 3 * d * ds0;
    const d2 = d;
    return {
      type1: geo_type, // first half: polynomial still valid from ds=0
      type2: { Poly3: { a: 0, b: b2, c: c2, d: d2 } },
    };
  }

  if ('ParamPoly3' in geo_type) {
    const { a_u, b_u, c_u, d_u, a_v, b_v, c_v, d_v, p_range } = geo_type.ParamPoly3;
    // p at the split point
    const p0 = p_range === 'Normalized' ? (length > 0 ? before / length : 0) : before;

    // ── First half: p ∈ [0, p0] → normalized p' ∈ [0, 1] via p = p0 * p'
    const beta1 = p0;
    // Polynomial substitution p = beta1 * p' gives new coefficients;
    // a' remains the same as a (= 0 for well-formed OpenDRIVE) but we subtract
    // the offset at p=0 which is a itself.
    const a_u1 = a_u; // = 0 for well-formed geometry
    const b_u1 = b_u * beta1;
    const c_u1 = c_u * beta1 * beta1;
    const d_u1 = d_u * beta1 * beta1 * beta1;
    const a_v1 = a_v;
    const b_v1 = b_v * beta1;
    const c_v1 = c_v * beta1 * beta1;
    const d_v1 = d_v * beta1 * beta1 * beta1;

    // ── Second half: p ∈ [p0, p_end] → normalized p' ∈ [0, 1]
    //    via p = p0 + (p_end - p0) * p'
    //    For Normalized: p_end = 1; for ArcLength: p_end = length
    const pEnd = p_range === 'Normalized' ? 1 : length;
    const beta2 = pEnd - p0;
    // Polynomial substitution p = p0 + beta2 * p':
    // dU(p') = u(p0+beta2*p') - u(p0)  (displacement in original hdg0 frame)
    // dV(p') = v(p0+beta2*p') - v(p0)
    const u_p0 = a_u + b_u * p0 + c_u * p0 * p0 + d_u * p0 * p0 * p0;
    const v_p0 = a_v + b_v * p0 + c_v * p0 * p0 + d_v * p0 * p0 * p0;
    void u_p0; void v_p0; // absorbed into split2X/Y

    // Delta coefficients in original hdg0 frame (a=0 since dU(0)=dV(0)=0)
    const B_u = (b_u + 2 * c_u * p0 + 3 * d_u * p0 * p0) * beta2;
    const C_u = (c_u + 3 * d_u * p0) * beta2 * beta2;
    const D_u = d_u * beta2 * beta2 * beta2;
    const B_v = (b_v + 2 * c_v * p0 + 3 * d_v * p0 * p0) * beta2;
    const C_v = (c_v + 3 * d_v * p0) * beta2 * beta2;
    const D_v = d_v * beta2 * beta2 * beta2;

    // Rotate from hdg0 frame into split2Hdg frame so the renderer applies the
    // polynomial correctly.  β = hdg0 - splitHdg
    // [U']   =  R(β) · [dU]  where R(β) = [[cosβ -sinβ],[sinβ cosβ]]
    // [V']            [dV]
    // NOTE: This rotation is exact only when p' ≈ arc-length (linear
    // parameterization). For extreme-curvature roads the split second-half
    // endpoint may deviate slightly.
    const beta = hdg0 - splitHdg;
    const cosB = Math.cos(beta);
    const sinB = Math.sin(beta);

    const a_u2 = 0;
    const b_u2 = cosB * B_u - sinB * B_v;
    const c_u2 = cosB * C_u - sinB * C_v;
    const d_u2 = cosB * D_u - sinB * D_v;
    const a_v2 = 0;
    const b_v2 = sinB * B_u + cosB * B_v;
    const c_v2 = sinB * C_u + cosB * C_v;
    const d_v2 = sinB * D_u + cosB * D_v;

    return {
      type1: { ParamPoly3: { a_u: a_u1, b_u: b_u1, c_u: c_u1, d_u: d_u1, a_v: a_v1, b_v: b_v1, c_v: c_v1, d_v: d_v1, p_range: 'Normalized' } },
      type2: { ParamPoly3: { a_u: a_u2, b_u: b_u2, c_u: c_u2, d_u: d_u2, a_v: a_v2, b_v: b_v2, c_v: c_v2, d_v: d_v2, p_range: 'Normalized' } },
    };
  }

  return { type1: geo_type, type2: geo_type };
}

// ─── evalWidthPolyAt / evalLaneSectionAtOffset ────────────────────────────────

/** Evaluate a lane-width cubic polynomial at arclength offset `sOff`. */
function evalWidthPolyAt(widths: LaneWidth[], sOff: number): number {
  // Find the active width entry (last one whose s_offset <= sOff)
  let active: LaneWidth | undefined;
  for (const w of widths) {
    if (w.s_offset <= sOff) active = w;
  }
  if (!active) return widths[0]?.a ?? DEFAULT_LANE_WIDTH;
  const ds = sOff - active.s_offset;
  return active.a + active.b * ds + active.c * ds * ds + active.d * ds * ds * ds;
}

/**
 * Create a copy of `section` with all lane widths evaluated at `sOff`
 * (arclength offset within the section) as the new constant start width.
 *
 * Inspired by LaneEditor.tsx `cloneLanes`: bakes the evaluated width into `a`
 * and resets the polynomial to zero so road2's lanes start at the correct width.
 */
function evalLaneSectionAtOffset(section: LaneSection, sOff: number): LaneSection {
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

// ─── splitRoadAt ─────────────────────────────────────────────────────────────

/**
 * Split a road at the given s-station, returning two half-roads and a
 * junction that connects them.
 *
 * - For Line/Arc segments the split is exact.
 * - Spiral segments get corrected curv_start/curv_end for each half.
 * - Poly3 segments get a Taylor-shifted polynomial for the second half.
 * - ParamPoly3 segments (spline-drawn roads) get re-parametrized polynomials
 *   so each half maps the normalised parameter to its sub-range of the original.
 * - Lane sections: road2 always starts with a boundary section at s=0 with
 *   widths evaluated at the split point (Bug 1 fix; inspired by LaneEditor.splitSection).
 *
 * @throws {Error} if splitS is not strictly inside (0, road.length)
 */
export function splitRoadAt(
  road: Road,
  splitS: number,
): { road1: Road; road2: Road; junction: Junction } {
  if (splitS <= 0 || splitS >= road.length) {
    throw new Error(
      `splitS (${splitS}) must be strictly between 0 and road.length (${road.length})`,
    );
  }

  const ts = Date.now();
  const id1 = `${road.id}-a-${ts}`;
  const id2 = `${road.id}-b-${ts}`;
  const junctionId = `junc-split-${ts}`;

  // ── Build plan_view for each half ─────────────────────────────────────────
  const pv1: Geometry[] = [];
  const pv2: Geometry[] = [];
  let split2X = 0;
  let split2Y = 0;
  let split2Hdg = 0;

  for (const geo of road.plan_view) {
    const geoEnd = geo.s + geo.length;

    if (geoEnd <= splitS) {
      // Entire segment before the split → road1
      pv1.push(geo);
    } else if (geo.s >= splitS) {
      // Entire segment after the split → road2 (re-based to s=0)
      pv2.push({ ...geo, s: geo.s - splitS });
    } else {
      // Split falls within this segment
      const before = splitS - geo.s;
      const after = geoEnd - splitS;

      const splitPt = evalGeometryAtS(geo, before);
      split2X = splitPt.x;
      split2Y = splitPt.y;
      split2Hdg = splitPt.hdg;

      const { type1, type2 } = splitGeometryType(geo.geo_type, geo.length, before, geo.hdg, split2Hdg);
      pv1.push({ ...geo, length: before, geo_type: type1 });
      pv2.push({
        s: 0,
        x: split2X,
        y: split2Y,
        hdg: split2Hdg,
        length: after,
        geo_type: type2,
      });
    }
  }

  // Fallback: empty plan_view edge cases
  if (pv1.length === 0) {
    const ref = road.plan_view[0] ?? { x: 0, y: 0, hdg: 0 };
    pv1.push({ s: 0, x: ref.x, y: ref.y, hdg: ref.hdg, length: splitS, geo_type: 'Line' });
  }
  if (pv2.length === 0) {
    const ref = road.plan_view[road.plan_view.length - 1] ?? { x: 0, y: 0, hdg: 0 };
    pv2.push({
      s: 0,
      x: split2X || ref.x,
      y: split2Y || ref.y,
      hdg: split2Hdg || ref.hdg,
      length: road.length - splitS,
      geo_type: 'Line',
    });
  }

  // ── Distribute lane sections ───────────────────────────────────────────────
  //
  // road1 gets all sections with s ≤ splitS (unchanged).
  // road2 always starts with a boundary section at s=0 whose lane widths are
  // evaluated at the split offset — inspired by LaneEditor.splitSection's
  // `cloneLanes` — then appends any sections that originally started after splitS.
  //
  // This fixes a coverage gap bug where, if sections existed both before and
  // after splitS, road2 would miss coverage for s = 0 .. (firstSectionAfter - splitS).

  const ls1: LaneSection[] = road.lane_sections
    .filter((ls) => ls.s <= splitS)
    .map((ls): LaneSection => ({ ...ls }));

  const sectionsAfterSplit: LaneSection[] = road.lane_sections
    .filter((ls) => ls.s > splitS)
    .map((ls): LaneSection => ({ ...ls, s: ls.s - splitS }));

  // Boundary section: the last section active at splitS, widths baked at offset
  const filtered = road.lane_sections.filter((ls) => ls.s <= splitS);
  const boundarySrc: LaneSection | undefined =
    filtered[filtered.length - 1] ?? road.lane_sections[0];
  const boundarySection: LaneSection | undefined = boundarySrc
    ? { ...evalLaneSectionAtOffset(boundarySrc, splitS - boundarySrc.s), s: 0 }
    : undefined;

  const ls2: LaneSection[] = boundarySection
    ? [boundarySection, ...sectionsAfterSplit]
    : sectionsAfterSplit;

  // Fallbacks for completely empty arrays (degenerate road)
  const firstSection = road.lane_sections[0];
  const lastSection = road.lane_sections[road.lane_sections.length - 1];
  if (ls1.length === 0 && firstSection !== undefined) {
    ls1.push({ ...firstSection, s: 0 });
  }
  if (ls2.length === 0 && lastSection !== undefined) {
    ls2.push({ ...evalLaneSectionAtOffset(lastSection, splitS - lastSection.s), s: 0 });
  }

  // Auto-generate lane links from the first lane section's right lanes
  const laneLinks = (ls1[0]?.right ?? []).map((l) => ({ from: l.id, to: l.id }));

  // ── Assemble result ────────────────────────────────────────────────────────
  const road1: Road = {
    ...road,
    id: id1,
    name: `${road.name}_A`,
    length: splitS,
    plan_view: pv1,
    lane_sections: ls1,
    link: {
      predecessor: road.link?.predecessor ?? null,
      successor: { element_id: junctionId, element_type: 'Junction', contact_point: 'End' },
    },
  };

  const road2: Road = {
    ...road,
    id: id2,
    name: `${road.name}_B`,
    length: road.length - splitS,
    plan_view: pv2,
    lane_sections: ls2,
    link: {
      predecessor: { element_id: junctionId, element_type: 'Junction', contact_point: 'Start' },
      successor: road.link?.successor ?? null,
    },
  };

  const junction: Junction = {
    id: junctionId,
    name: `${road.name}_Junction`,
    connections: [
      {
        id: `conn-${ts}`,
        incoming_road: id1,
        connecting_road: id2,
        contact_point: 'Start',
        lane_links: laneLinks,
      },
    ],
  };

  return { road1, road2, junction };
}

// ─── weldRoads ────────────────────────────────────────────────────────────────

/**
 * Weld two roads together: road1 comes first, road2 follows immediately after.
 *
 * road2's geometry `s` values and lane section `s` values are offset by
 * road1.length. The welded road keeps road1's id and uses road1's predecessor
 * link and road2's successor link.
 */
export function weldRoads(road1: Road, road2: Road): Road {
  const offset = road1.length;

  const pv2: Geometry[] = road2.plan_view.map((geo) => ({ ...geo, s: geo.s + offset }));
  const ls2: LaneSection[] = road2.lane_sections.map((ls) => ({ ...ls, s: ls.s + offset }));

  return {
    ...road1,
    name: `${road1.name} + ${road2.name}`,
    length: road1.length + road2.length,
    plan_view: [...road1.plan_view, ...pv2],
    lane_sections: [...road1.lane_sections, ...ls2],
    link: {
      predecessor: road1.link?.predecessor ?? null,
      successor: road2.link?.successor ?? null,
    },
  };
}

// ─── deploySidewalks ─────────────────────────────────────────────────────────

/**
 * Deploy sidewalk lanes on both sides of all lane sections in the road.
 *
 * - Idempotent: if a sidewalk lane already exists on a side, it is not added again.
 * - The sidewalk is placed at the outermost position (max left id + 1, min right id - 1).
 * - If a side has no driving lanes, a sidewalk at id ±1 is still added.
 * - Does not mutate the input road.
 */
export function deploySidewalks(road: Road, sidewalkWidth = DEFAULT_SIDEWALK_WIDTH): Road {
  const lane_sections: LaneSection[] = road.lane_sections.map((ls) => {
    const hasLeftSidewalk = ls.left.some((l) => l.lane_type === 'Sidewalk');
    const hasRightSidewalk = ls.right.some((l) => l.lane_type === 'Sidewalk');

    const maxLeftId = ls.left.length > 0 ? Math.max(...ls.left.map((l) => l.id)) : 0;
    const minRightId = ls.right.length > 0 ? Math.min(...ls.right.map((l) => l.id)) : 0;

    const left = hasLeftSidewalk
      ? ls.left
      : [...ls.left, makeSidewalkLane(maxLeftId + 1, sidewalkWidth)];

    const right = hasRightSidewalk
      ? ls.right
      : [...ls.right, makeSidewalkLane(minRightId - 1, sidewalkWidth)];

    return { ...ls, left, right };
  });

  return { ...road, lane_sections };
}

// ─── applyStandardMarkings ───────────────────────────────────────────────────

/**
 * Apply standard road markings to all lane sections:
 * - Outermost lane on each side (max left id / min right id) → solid white
 * - All other lanes on each side → broken white
 * - Center lane is left unchanged.
 *
 * Does not mutate the input road.
 */
export function applyStandardMarkings(road: Road): Road {
  const lane_sections: LaneSection[] = road.lane_sections.map((ls) => {
    const maxLeftId = ls.left.length > 0 ? Math.max(...ls.left.map((l) => l.id)) : -Infinity;
    const minRightId = ls.right.length > 0 ? Math.min(...ls.right.map((l) => l.id)) : Infinity;

    const left = ls.left.map((lane) => ({
      ...lane,
      road_marks: [makeMark(lane.id === maxLeftId ? 'Solid' : 'Broken')],
    }));

    const right = ls.right.map((lane) => ({
      ...lane,
      road_marks: [makeMark(lane.id === minRightId ? 'Solid' : 'Broken')],
    }));

    return { ...ls, left, right };
  });

  return { ...road, lane_sections };
}

// ─── deployCrosswalks ────────────────────────────────────────────────────────

/**
 * Deploy crosswalk objects at the midpoint of each connecting road in the
 * specified junction. Returns the project unchanged if the junction is not found.
 *
 * Does not mutate the input project.
 */
export function deployCrosswalks(project: Project, junctionId: string): Project {
  const junction = project.junctions.find((j) => j.id === junctionId);
  if (!junction) return project;

  const ts = Date.now();
  const newObjects = junction.connections
    .map((conn) => {
      const road = project.roads.find((r) => r.id === conn.connecting_road);
      if (!road) return null;
      return {
        id: `crosswalk-${conn.connecting_road}-${ts}`,
        roadId: conn.connecting_road,
        sPosition: road.length / 2,
        laneId: 0,
        type: 'crosswalk',
        validity: 'all',
      };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null);

  return { ...project, objects: [...(project.objects ?? []), ...newObjects] };
}

// ─── deployStopLines ─────────────────────────────────────────────────────────

/**
 * Deploy stop line objects 1 m before the end of each incoming road approaching
 * the specified junction. Returns the project unchanged if the junction is not found.
 *
 * Each unique incoming road gets exactly one stop line (deduplication applied).
 *
 * Does not mutate the input project.
 */
export function deployStopLines(project: Project, junctionId: string): Project {
  const junction = project.junctions.find((j) => j.id === junctionId);
  if (!junction) return project;

  const ts = Date.now();
  const incomingRoadIds = new Set(junction.connections.map((c) => c.incoming_road));

  const newObjects = [...incomingRoadIds]
    .map((roadId) => {
      const road = project.roads.find((r) => r.id === roadId);
      if (!road) return null;
      return {
        id: `stopline-${roadId}-${ts}`,
        roadId,
        sPosition: Math.max(0, road.length - 1.0),
        laneId: 0,
        type: 'stopline',
        validity: 'all',
      };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null);

  return { ...project, objects: [...(project.objects ?? []), ...newObjects] };
}
