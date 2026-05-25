/**
 * Station record manipulation: clamping, deduplication, offsetting, reversing.
 */

import type { LaneSection, Road } from '../../services/platform';
import { normalizeAngle } from './geometryOps';
import { reverseLaneSection } from './laneOps';

const STATION_EPSILON = 1e-9;

export function clampStation(s: number, maxLength: number): number {
  return Math.max(0, Math.min(maxLength, s));
}

export function dedupeStationRecords<T extends { s: number }>(records: T[]): T[] {
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

export function capStationRecords<T extends { s: number }>(records: T[] | undefined, maxLength: number): T[] | undefined {
  if (!records) {
    return records;
  }

  return dedupeStationRecords(
    records.map((record) => ({ ...record, s: clampStation(record.s, maxLength) }) as T),
  );
}

export function capStationRangeRecords<T extends { s: number; length: number }>(records: T[] | undefined, maxLength: number): T[] | undefined {
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

export function capLateralProfile(profile: Road['lateral_profile'], maxLength: number): Road['lateral_profile'] {
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

export function capRoadObjects(objects: Road['objects'], maxLength: number): Road['objects'] {
  return objects?.map((object) => ({
    ...object,
    position: {
      ...object.position,
      x: clampStation(object.position.x, maxLength),
    },
  }));
}

export function buildSampleStations(roadLength: number, segmentLength: number): number[] {
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

export function offsetStationRecords<T extends { s: number }>(records: T[] | undefined, offset: number): T[] | undefined {
  return records?.map((record) => ({ ...record, s: record.s + offset }) as T);
}

export function offsetStationRangeRecords<T extends { s: number; length: number }>(records: T[] | undefined, offset: number): T[] | undefined {
  return records?.map((record) => ({ ...record, s: record.s + offset }) as T);
}

export function offsetRoadObjects(objects: Road['objects'], offset: number): Road['objects'] {
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

export function combineLateralProfile(primary: Road['lateral_profile'], secondary: Road['lateral_profile'], offset: number): Road['lateral_profile'] {
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

export function reverseStationRecords<T extends { s: number }>(records: T[] | undefined, totalLength: number): T[] | undefined {
  if (!records) {
    return records;
  }

  return records
    .map((record) => ({ ...record, s: clampStation(totalLength - record.s, totalLength) }) as T)
    .sort((left, right) => left.s - right.s);
}

export function reverseStationRangeRecords<T extends { s: number; length: number }>(records: T[] | undefined, totalLength: number): T[] | undefined {
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

export function reverseLaneSections(laneSections: LaneSection[], totalLength: number): LaneSection[] {
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

export function reverseRoadObjects(objects: Road['objects'], totalLength: number): Road['objects'] {
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
