/**
 * Road-level manipulation: split, weld, reverse, resample, evaluate.
 *
 * This module orchestrates geometry, lane, and station record operations
 * to provide high-level road manipulation functions.
 */

import { genId } from '../../plugins/editing/templates/engine';
import type { Road, Geometry, LaneSection, Junction } from '../../services/platform';
import {
  evalGeometryAtS,
  distanceSquared,
  normalizeAngle,
  angleDelta,
  reverseGeometryType,
  needsResampledReverse,
  splitGeometryType,
  refineClosestDs,
} from './geometryOps';
import { getLaneSignature, evalLaneSectionAtOffset } from './laneOps';
import {
  buildSampleStations,
  capStationRecords,
  capStationRangeRecords,
  capLateralProfile,
  capRoadObjects,
  offsetStationRecords,
  offsetStationRangeRecords,
  offsetRoadObjects,
  combineLateralProfile,
  reverseStationRecords,
  reverseStationRangeRecords,
  reverseLaneSections,
  reverseRoadObjects,
} from './stationRecordOps';

export interface WeldOptions {
  positionTolerance?: number;
  headingTolerance?: number;
}

const DEFAULT_WELD_POSITION_TOLERANCE = 0.5;
const DEFAULT_WELD_HEADING_TOLERANCE = Math.PI / 9;
const STATION_EPSILON = 1e-9;

// ─── evalRoadAtS ─────────────────────────────────────────────────────────────

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

function getRoadEndpointPose(road: Road, contactPoint: 'Start' | 'End'): { x: number; y: number; hdg: number } {
  return evalRoadAtS(road, contactPoint === 'Start' ? 0 : road.length);
}

// ─── resampleRoad ────────────────────────────────────────────────────────────

/**
 * Re-sample a road centerline at uniform station intervals and rebuild it as
 * piecewise line geometry.
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

// ─── findClosestSOnRoad ──────────────────────────────────────────────────────

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

// ─── reverseRoad ─────────────────────────────────────────────────────────────

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

// ─── splitRoadAt ─────────────────────────────────────────────────────────────

/**
 * Split a road at the given s-station, returning two half-roads and a
 * junction that connects them.
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

  // Build plan_view for each half
  const pv1: Geometry[] = [];
  const pv2: Geometry[] = [];
  let split2X = 0;
  let split2Y = 0;
  let split2Hdg = 0;

  for (const geo of road.plan_view) {
    const geoEnd = geo.s + geo.length;

    if (geoEnd <= splitS) {
      pv1.push(geo);
    } else if (geo.s >= splitS) {
      pv2.push({ ...geo, s: geo.s - splitS });
    } else {
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

  // Distribute lane sections
  const ls1: LaneSection[] = road.lane_sections
    .filter((ls) => ls.s <= splitS)
    .map((ls): LaneSection => ({ ...ls }));

  const sectionsAfterSplit: LaneSection[] = road.lane_sections
    .filter((ls) => ls.s > splitS)
    .map((ls): LaneSection => ({ ...ls, s: ls.s - splitS }));

  const filtered = road.lane_sections.filter((ls) => ls.s <= splitS);
  const boundarySrc: LaneSection | undefined =
    filtered[filtered.length - 1] ?? road.lane_sections[0];
  const boundarySection: LaneSection | undefined = boundarySrc
    ? { ...evalLaneSectionAtOffset(boundarySrc, splitS - boundarySrc.s), s: 0 }
    : undefined;

  const ls2: LaneSection[] = boundarySection
    ? [boundarySection, ...sectionsAfterSplit]
    : sectionsAfterSplit;

  // Fallbacks for completely empty arrays
  const firstSection = road.lane_sections[0];
  const lastSection = road.lane_sections[road.lane_sections.length - 1];
  if (ls1.length === 0 && firstSection !== undefined) {
    ls1.push({ ...firstSection, s: 0 });
  }
  if (ls2.length === 0 && lastSection !== undefined) {
    ls2.push({ ...evalLaneSectionAtOffset(lastSection, splitS - lastSection.s), s: 0 });
  }

  const laneLinks = (ls1[0]?.right ?? []).map((l) => ({ from: l.id, to: l.id }));

  // Assemble result
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

// ─── weldRoads ───────────────────────────────────────────────────────────────

/**
 * Weld two roads together: road1 comes first, road2 follows immediately after.
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
