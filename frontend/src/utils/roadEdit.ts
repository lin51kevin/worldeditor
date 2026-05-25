/**
 * Pure road manipulation utilities.
 *
 * All functions are side-effect-free and fully unit-testable.
 * They are used by the Advanced Editing plugin to implement
 * split, weld, sidewalk deployment, standard marking application,
 * crosswalk deployment, and stop line deployment.
 */

import { genId } from '../plugins/editing/templates/engine';
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
const DEFAULT_WELD_POSITION_TOLERANCE = 0.5;
const DEFAULT_WELD_HEADING_TOLERANCE = Math.PI / 9;

export interface WeldOptions {
  positionTolerance?: number;
  headingTolerance?: number;
}

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

function distanceSquared(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy;
}

function normalizeAngle(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= 2 * Math.PI;
  while (value <= -Math.PI) value += 2 * Math.PI;
  return value;
}

function angleDelta(a: number, b: number): number {
  return Math.abs(normalizeAngle(a - b));
}

function reverseGeometryType(geoType: Geometry['geo_type']): Geometry['geo_type'] {
  if (geoType === 'Line') return 'Line';
  if ('Arc' in geoType) {
    return { Arc: { curvature: -geoType.Arc.curvature } };
  }
  if ('Spiral' in geoType) {
    return {
      Spiral: {
        curv_start: -geoType.Spiral.curv_end,
        curv_end: -geoType.Spiral.curv_start,
      },
    };
  }
  return geoType;
}

function needsResampledReverse(road: Road): boolean {
  return road.plan_view.some((geo) => geo.geo_type !== 'Line' && !('Arc' in geo.geo_type) && !('Spiral' in geo.geo_type));
}

function getRoadEndpointPose(road: Road, contactPoint: 'Start' | 'End'): { x: number; y: number; hdg: number } {
  return evalRoadAtS(road, contactPoint === 'Start' ? 0 : road.length);
}

function cloneLaneWithMirroredId(lane: Lane): Lane {
  return {
    ...lane,
    id: lane.id === 0 ? 0 : -lane.id,
    link: lane.link
      ? {
        predecessor: lane.link.successor === null ? null : -lane.link.successor,
        successor: lane.link.predecessor === null ? null : -lane.link.predecessor,
      }
      : lane.link,
  };
}

function reverseLaneSection(section: LaneSection): LaneSection {
  return {
    ...section,
    left: section.right.map(cloneLaneWithMirroredId),
    center: section.center.map(cloneLaneWithMirroredId),
    right: section.left.map(cloneLaneWithMirroredId),
  };
}

function reverseStationRecords<T extends { s: number }>(records: T[] | undefined, totalLength: number): T[] | undefined {
  if (!records) {
    return records;
  }

  return records
    .map((record) => ({ ...record, s: clampStation(totalLength - record.s, totalLength) }) as T)
    .sort((left, right) => left.s - right.s);
}

function reverseStationRangeRecords<T extends { s: number; length: number }>(records: T[] | undefined, totalLength: number): T[] | undefined {
  if (!records) {
    return records;
  }

  return records
    .map((record) => ({
      ...record,
      s: clampStation(totalLength - (record.s + record.length), totalLength),
    }) as T)
    .sort((left, right) => left.s - right.s);
}

function reverseLaneSections(laneSections: LaneSection[], totalLength: number): LaneSection[] {
  if (laneSections.length === 0) {
    return laneSections;
  }

  return laneSections
    .map((section, index) => {
      const nextStart = laneSections[index + 1]?.s ?? totalLength;
      return {
        ...reverseLaneSection(section),
        s: clampStation(totalLength - nextStart, totalLength),
      };
    })
    .reverse();
}

function reverseRoadObjects(objects: Road['objects'], totalLength: number): Road['objects'] {
  return objects
    ?.map((object) => ({
      ...object,
      position: {
        ...object.position,
        x: clampStation(totalLength - object.position.x, totalLength),
      },
      hdg: normalizeAngle(object.hdg + Math.PI),
      orientation: normalizeAngle((object.orientation * Math.PI) / 180 + Math.PI) * (180 / Math.PI),
      corners: object.corners.map((corner) => ({
        ...corner,
        x: clampStation(totalLength - corner.x, totalLength),
      })),
      validity: object.validity
        ? {
          from_lane: -object.validity.to_lane,
          to_lane: -object.validity.from_lane,
        }
        : object.validity,
    }))
    .sort((left, right) => left.position.x - right.position.x);
}

function reverseRoad(road: Road): Road {
  const roadToReverse = needsResampledReverse(road)
    ? resampleRoad(road, Math.max(Math.min(road.length / 16, 2), 0.5))
    : road;

  if (roadToReverse.plan_view.length === 0) {
    return roadToReverse;
  }

  let currentS = 0;
  const reversedPlanView: Geometry[] = roadToReverse.plan_view
    .slice()
    .reverse()
    .map((geo) => {
      const endPose = evalGeometryAtS(geo, geo.length);
      const reversed: Geometry = {
        s: currentS,
        x: endPose.x,
        y: endPose.y,
        hdg: normalizeAngle(endPose.hdg + Math.PI),
        length: geo.length,
        geo_type: reverseGeometryType(geo.geo_type),
      };
      currentS += geo.length;
      return reversed;
    });

  return {
    ...roadToReverse,
    plan_view: reversedPlanView,
    link: roadToReverse.link
      ? {
        predecessor: roadToReverse.link.successor,
        successor: roadToReverse.link.predecessor,
      }
      : roadToReverse.link,
    elevation_profile: reverseStationRecords(roadToReverse.elevation_profile, roadToReverse.length) ?? [],
    lane_sections: reverseLaneSections(roadToReverse.lane_sections, roadToReverse.length),
    lane_offsets: reverseStationRecords(roadToReverse.lane_offsets, roadToReverse.length),
    lateral_profile: roadToReverse.lateral_profile
      ? {
        ...roadToReverse.lateral_profile,
        superelevation: reverseStationRecords(roadToReverse.lateral_profile.superelevation, roadToReverse.length),
        crossfall: reverseStationRecords(roadToReverse.lateral_profile.crossfall, roadToReverse.length),
        superelevations: reverseStationRecords(roadToReverse.lateral_profile.superelevations, roadToReverse.length),
        crossfalls: reverseStationRecords(roadToReverse.lateral_profile.crossfalls, roadToReverse.length),
      }
      : roadToReverse.lateral_profile,
    bridges: reverseStationRangeRecords(roadToReverse.bridges, roadToReverse.length),
    tunnels: reverseStationRangeRecords(roadToReverse.tunnels, roadToReverse.length),
    signals: reverseStationRecords(roadToReverse.signals, roadToReverse.length),
    objects: reverseRoadObjects(roadToReverse.objects, roadToReverse.length),
    spline_edit_data: roadToReverse.spline_edit_data ? [...roadToReverse.spline_edit_data].reverse() : roadToReverse.spline_edit_data,
  };
}

function offsetStationRecords<T extends { s: number }>(records: T[] | undefined, offset: number): T[] | undefined {
  return records?.map((record) => ({ ...record, s: record.s + offset }) as T);
}

function offsetStationRangeRecords<T extends { s: number; length: number }>(records: T[] | undefined, offset: number): T[] | undefined {
  return records?.map((record) => ({ ...record, s: record.s + offset }) as T);
}

function offsetRoadObjects(objects: Road['objects'], offset: number): Road['objects'] {
  return objects?.map((object) => ({
    ...object,
    position: {
      ...object.position,
      x: object.position.x + offset,
    },
    corners: object.corners.map((corner) => ({
      ...corner,
      x: corner.x + offset,
    })),
  }));
}

function combineLateralProfile(primary: Road['lateral_profile'], secondary: Road['lateral_profile'], offset: number): Road['lateral_profile'] {
  if (!primary && !secondary) {
    return undefined;
  }

  return {
    superelevation: [...(primary?.superelevation ?? []), ...(offsetStationRecords(secondary?.superelevation, offset) ?? [])],
    crossfall: [...(primary?.crossfall ?? []), ...(offsetStationRecords(secondary?.crossfall, offset) ?? [])],
    superelevations: [...(primary?.superelevations ?? []), ...(offsetStationRecords(secondary?.superelevations, offset) ?? [])],
    crossfalls: [...(primary?.crossfalls ?? []), ...(offsetStationRecords(secondary?.crossfalls, offset) ?? [])],
  };
}

function getLaneSignature(section: LaneSection | undefined): string {
  if (!section) {
    return 'none';
  }

  const encode = (lanes: Lane[]) => lanes
    .map((lane) => `${Math.abs(lane.id)}:${lane.lane_type}`)
    .sort()
    .join('|');
  return encode([...section.left, ...section.center, ...section.right]);
}

function refineClosestDs(geo: Geometry, worldPos: { x: number; y: number }, bestDs: number, sampleStep: number): number {
  let left = Math.max(0, bestDs - sampleStep);
  let right = Math.min(geo.length, bestDs + sampleStep);

  for (let i = 0; i < 8; i++) {
    const mid1 = left + (right - left) / 3;
    const mid2 = right - (right - left) / 3;
    const pose1 = evalGeometryAtS(geo, mid1);
    const pose2 = evalGeometryAtS(geo, mid2);
    const dist1 = distanceSquared(pose1.x, pose1.y, worldPos.x, worldPos.y);
    const dist2 = distanceSquared(pose2.x, pose2.y, worldPos.x, worldPos.y);

    if (dist1 <= dist2) {
      right = mid2;
    } else {
      left = mid1;
    }
  }

  return (left + right) / 2;
}

/** Evaluate a road centerline pose at station `s`. */
export function evalRoadAtS(road: Road, s: number): { x: number; y: number; hdg: number } {
  if (road.plan_view.length === 0) {
    return { x: 0, y: 0, hdg: 0 };
  }

  const clampedS = Math.max(0, Math.min(road.length, s));
  for (let i = 0; i < road.plan_view.length; i++) {
    const geo = road.plan_view[i]!;
    const geoEnd = geo.s + geo.length;
    if (clampedS <= geoEnd || i === road.plan_view.length - 1) {
      const ds = Math.max(0, Math.min(geo.length, clampedS - geo.s));
      return evalGeometryAtS(geo, ds);
    }
  }

  const lastGeo = road.plan_view[road.plan_view.length - 1]!;
  return evalGeometryAtS(lastGeo, lastGeo.length);
}

const STATION_EPSILON = 1e-9;

function clampStation(s: number, maxLength: number): number {
  return Math.max(0, Math.min(maxLength, s));
}

function dedupeStationRecords<T extends { s: number }>(records: T[]): T[] {
  const deduped: T[] = [];

  for (const record of records) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.s - record.s) <= STATION_EPSILON) {
      deduped[deduped.length - 1] = record;
    } else {
      deduped.push(record);
    }
  }

  return deduped;
}

function capStationRecords<T extends { s: number }>(records: T[] | undefined, maxLength: number): T[] | undefined {
  if (!records) {
    return records;
  }

  return dedupeStationRecords(
    records.map((record) => ({ ...record, s: clampStation(record.s, maxLength) }) as T),
  );
}

function capStationRangeRecords<T extends { s: number; length: number }>(records: T[] | undefined, maxLength: number): T[] | undefined {
  if (!records) {
    return records;
  }

  return records.map((record) => {
    const s = clampStation(record.s, maxLength);
    return {
      ...record,
      s,
      length: Math.max(0, Math.min(record.length, maxLength - s)),
    } as T;
  });
}

function capLateralProfile(profile: Road['lateral_profile'], maxLength: number): Road['lateral_profile'] {
  if (!profile) {
    return profile;
  }

  return {
    ...profile,
    superelevation: capStationRecords(profile.superelevation, maxLength),
    crossfall: capStationRecords(profile.crossfall, maxLength),
    superelevations: capStationRecords(profile.superelevations, maxLength),
    crossfalls: capStationRecords(profile.crossfalls, maxLength),
  };
}

function capRoadObjects(objects: Road['objects'], maxLength: number): Road['objects'] {
  return objects?.map((object) => ({
    ...object,
    position: {
      ...object.position,
      x: clampStation(object.position.x, maxLength),
    },
  }));
}

function buildSampleStations(roadLength: number, segmentLength: number): number[] {
  if (roadLength <= 0) {
    return [0];
  }

  const stations = [0];
  for (let s = segmentLength; s < roadLength; s += segmentLength) {
    stations.push(s);
  }

  if (roadLength - stations[stations.length - 1]! > STATION_EPSILON) {
    stations.push(roadLength);
  }

  return stations;
}

/**
 * Re-sample a road centerline at uniform station intervals and rebuild it as
 * piecewise line geometry. All station-based child records are clamped to the
 * new length so the returned road stays self-consistent.
 */
export function resampleRoad(road: Road, segmentLength: number): Road {
  if (!Number.isFinite(segmentLength) || segmentLength <= 0) {
    throw new Error(`segmentLength (${segmentLength}) must be a finite number greater than 0`);
  }

  const sampleStations = buildSampleStations(road.length, segmentLength);
  const sampledPoses = sampleStations.map((s) => ({ s, ...evalRoadAtS(road, s) }));

  const plan_view: Geometry[] = [];
  let accumulatedLength = 0;

  for (let i = 0; i < sampledPoses.length - 1; i++) {
    const start = sampledPoses[i]!;
    const end = sampledPoses[i + 1]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);

    if (length <= STATION_EPSILON) {
      continue;
    }

    plan_view.push({
      s: accumulatedLength,
      x: start.x,
      y: start.y,
      hdg: Math.atan2(dy, dx),
      length,
      geo_type: 'Line',
    });
    accumulatedLength += length;
  }

  const fallbackPose = sampledPoses[0] ?? { x: 0, y: 0, hdg: 0 };
  const nextPlanView = plan_view.length > 0
    ? plan_view
    : [{ s: 0, x: fallbackPose.x, y: fallbackPose.y, hdg: fallbackPose.hdg, length: 0, geo_type: 'Line' as const }];
  const nextLength = plan_view.length > 0 ? accumulatedLength : 0;

  return {
    ...road,
    length: nextLength,
    plan_view: nextPlanView,
    elevation_profile: capStationRecords(road.elevation_profile, nextLength) ?? [],
    lane_sections: capStationRecords(road.lane_sections, nextLength) ?? [],
    lane_offsets: capStationRecords(road.lane_offsets, nextLength),
    lateral_profile: capLateralProfile(road.lateral_profile, nextLength),
    bridges: capStationRangeRecords(road.bridges, nextLength),
    tunnels: capStationRangeRecords(road.tunnels, nextLength),
    signals: capStationRecords(road.signals, nextLength),
    objects: capRoadObjects(road.objects, nextLength),
    spline_edit_data: sampledPoses.map((pose) => [pose.x, pose.y, 0] as [number, number, number]),
  };
}

/** Find the closest centerline station on a road to the given world position. */
export function findClosestSOnRoad(road: Road, worldPos: { x: number; y: number }): number {
  if (road.plan_view.length === 0) {
    return 0;
  }

  let bestS = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const geo of road.plan_view) {
    const sampleCount = Math.max(8, Math.ceil(geo.length / 2));
    const sampleStep = geo.length > 0 ? geo.length / sampleCount : 0;

    let localBestDs = 0;
    let localBestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i <= sampleCount; i++) {
      const ds = sampleStep * i;
      const pose = evalGeometryAtS(geo, ds);
      const distance = distanceSquared(pose.x, pose.y, worldPos.x, worldPos.y);
      if (distance < localBestDistance) {
        localBestDistance = distance;
        localBestDs = ds;
      }
    }

    const refinedDs = sampleStep > 0
      ? refineClosestDs(geo, worldPos, localBestDs, sampleStep)
      : 0;
    const refinedPose = evalGeometryAtS(geo, refinedDs);
    const refinedDistance = distanceSquared(refinedPose.x, refinedPose.y, worldPos.x, worldPos.y);

    if (refinedDistance < bestDistance) {
      bestDistance = refinedDistance;
      bestS = geo.s + refinedDs;
    }
  }

  return Math.max(0, Math.min(road.length, bestS));
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

  const id1 = genId();
  const id2 = genId();
  const junctionId = genId();

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
        id: genId(),
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
export function weldRoads(road1: Road, road2: Road, options?: WeldOptions): Road {
  const positionTolerance = options?.positionTolerance ?? DEFAULT_WELD_POSITION_TOLERANCE;
  const headingTolerance = options?.headingTolerance ?? DEFAULT_WELD_HEADING_TOLERANCE;
  const road1End = getRoadEndpointPose(road1, 'End');
  const road2Start = getRoadEndpointPose(road2, 'Start');
  const road2End = getRoadEndpointPose(road2, 'End');
  const startDistance = distanceSquared(road1End.x, road1End.y, road2Start.x, road2Start.y);
  const endDistance = distanceSquared(road1End.x, road1End.y, road2End.x, road2End.y);
  const orientedRoad2 = endDistance < startDistance ? reverseRoad(road2) : road2;
  const orientedRoad2Start = getRoadEndpointPose(orientedRoad2, 'Start');
  const seamDistance = Math.sqrt(
    distanceSquared(road1End.x, road1End.y, orientedRoad2Start.x, orientedRoad2Start.y),
  );

  if (seamDistance > positionTolerance) {
    throw new Error(`Road endpoints are too far apart to weld (${seamDistance.toFixed(2)} m)`);
  }

  const seamHeadingDelta = angleDelta(road1End.hdg, orientedRoad2Start.hdg);
  if (seamHeadingDelta > headingTolerance) {
    throw new Error('Road headings are incompatible at the weld point');
  }

  if (getLaneSignature(road1.lane_sections[road1.lane_sections.length - 1]) !== getLaneSignature(orientedRoad2.lane_sections[0])) {
    throw new Error('Road lane layouts are incompatible at the weld point');
  }

  const offset = road1.length;

  const pv2: Geometry[] = orientedRoad2.plan_view.map((geo) => ({ ...geo, s: geo.s + offset }));
  const ls2: LaneSection[] = orientedRoad2.lane_sections.map((ls) => ({ ...ls, s: ls.s + offset }));

  return {
    ...road1,
    name: `${road1.name} + ${orientedRoad2.name}`,
    junction_id: null,
    length: road1.length + orientedRoad2.length,
    plan_view: [...road1.plan_view, ...pv2],
    elevation_profile: [...road1.elevation_profile, ...(offsetStationRecords(orientedRoad2.elevation_profile, offset) ?? [])],
    lane_sections: [...road1.lane_sections, ...ls2],
    lane_offsets: [...(road1.lane_offsets ?? []), ...(offsetStationRecords(orientedRoad2.lane_offsets, offset) ?? [])],
    lateral_profile: combineLateralProfile(road1.lateral_profile, orientedRoad2.lateral_profile, offset),
    bridges: [...(road1.bridges ?? []), ...(offsetStationRangeRecords(orientedRoad2.bridges, offset) ?? [])],
    tunnels: [...(road1.tunnels ?? []), ...(offsetStationRangeRecords(orientedRoad2.tunnels, offset) ?? [])],
    signals: [...(road1.signals ?? []), ...(offsetStationRecords(orientedRoad2.signals, offset) ?? [])],
    objects: [...(road1.objects ?? []), ...(offsetRoadObjects(orientedRoad2.objects, offset) ?? [])],
    spline_edit_data: [...(road1.spline_edit_data ?? []), ...(orientedRoad2.spline_edit_data ?? [])],
    link: {
      predecessor: road1.link?.predecessor ?? null,
      successor: orientedRoad2.link?.successor ?? null,
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
