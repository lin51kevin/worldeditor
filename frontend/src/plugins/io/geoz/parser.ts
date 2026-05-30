/**
 * GeoZ parser utilities.
 * Converts GeoZ archives (ZIP containing .topo + .geo protobuf files)
 * into editor Projects.
 */

import JSZip from 'jszip';
import * as protobuf from 'protobufjs';
import type {
  Geometry,
  Junction,
  JunctionConnection,
  Lane,
  LaneLink,
  LaneSection,
  LinkElement,
  Project,
  Road,
  RoadLink,
  RoadObject,
  RoadSignal,
} from '../../../services/platform';
import mainProto from './proto/Main.proto?raw';
import mapProto from './proto/map.proto?raw';
import mapGeometryProto from './proto/map_geometry.proto?raw';
import mapJunctionGeoProto from './proto/map_junction_geo.proto?raw';
import mapJunctionTopoProto from './proto/map_junction_topo.proto?raw';
import mapLaneGeoProto from './proto/map_lane_geo.proto?raw';
import mapLaneTopoProto from './proto/map_lane_topo.proto?raw';
import mapObjectProto from './proto/map_object.proto?raw';
import mapRoadGeoProto from './proto/map_road_geo.proto?raw';
import mapRoadTopoProto from './proto/map_road_topo.proto?raw';

const DEFAULT_LANE_WIDTH = 3.5;
const MIN_SEGMENT_LENGTH = 0.01;
const ROAD_LINK_JUNCTION = 'junction';
const CONTACT_POINT_START = 'start';
const CONTACT_POINT_END = 'end';
const LEFT_SECTION = 'left_section';
const RIGHT_SECTION = 'right_section';

const PROTO_CONVERSION_OPTIONS: protobuf.IConversionOptions = {
  defaults: true,
  enums: String,
};

const PROTO_SOURCES = [
  { name: 'map_geometry.proto', content: mapGeometryProto },
  { name: 'map_lane_geo.proto', content: mapLaneGeoProto },
  { name: 'map_object.proto', content: mapObjectProto },
  { name: 'map_lane_topo.proto', content: mapLaneTopoProto },
  { name: 'map_junction_geo.proto', content: mapJunctionGeoProto },
  { name: 'map_junction_topo.proto', content: mapJunctionTopoProto },
  { name: 'map_road_geo.proto', content: mapRoadGeoProto },
  { name: 'map_road_topo.proto', content: mapRoadTopoProto },
  { name: 'map.proto', content: mapProto },
  { name: 'Main.proto', content: mainProto },
] as const;

type ProtoEnum = number | string | null | undefined;

interface ProtoPoint3D {
  x?: number | null;
  y?: number | null;
  z?: number | null;
}

interface ProtoRoadBoundary {
  point?: ProtoPoint3D[] | null;
}

interface ProtoLaneBoundary {
  point?: ProtoPoint3D[] | null;
}

interface ProtoLaneGeometry {
  id?: string | null;
  left_boundary?: ProtoLaneBoundary | null;
  right_boundary?: ProtoLaneBoundary | null;
  center_boundary?: ProtoLaneBoundary | null;
}

interface ProtoRoadGeometry {
  id?: string | null;
  reference_line?: ProtoRoadBoundary | null;
  center_line?: ProtoRoadBoundary | null;
  lane_geometrys?: ProtoLaneGeometry[] | null;
}

interface ProtoTileRoadFile {
  road_geometry?: ProtoRoadGeometry | null;
}

interface ProtoLaneLink {
  id?: string | null;
}

interface ProtoLaneHeader {
  id?: string | null;
  length?: number | null;
  lane_type?: ProtoEnum;
  name?: string | null;
}

interface ProtoLaneTopo {
  header?: ProtoLaneHeader | null;
  predecessors?: ProtoLaneLink[] | null;
  successors?: ProtoLaneLink[] | null;
}

interface ProtoRoadlink {
  id?: string | null;
  s?: number | null;
  link_type?: ProtoEnum;
  link_contact_point?: ProtoEnum;
}

interface ProtoRoadSection {
  section_id?: string | null;
  section_index?: number | null;
  s?: number | null;
  length?: number | null;
  section_direction_type?: ProtoEnum;
  lanes?: ProtoLaneTopo[] | null;
}

interface ProtoSignalValidity {
  road_id?: string | null;
  from_lane_id?: string | null;
  to_lane_id?: string | null;
}

interface ProtoSignal {
  id?: string | null;
  type?: string | null;
  road_id?: string | null;
  validities?: ProtoSignalValidity[] | null;
}

interface ProtoObject {
  id?: string | null;
  type?: string | null;
  road_id?: string | null;
}

interface ProtoRoadHeader {
  id?: string | null;
  length?: number | null;
  name?: string | null;
  junction_id?: string | null;
}

interface ProtoRoadTopo {
  header?: ProtoRoadHeader | null;
  road_predecessors?: ProtoRoadlink[] | null;
  road_successors?: ProtoRoadlink[] | null;
  road_sections?: ProtoRoadSection[] | null;
  road_signal?: ProtoSignal[] | null;
  road_objects?: ProtoObject[] | null;
}

interface ProtoTopoHeader {
  name?: string | null;
}

interface ProtoJunctionLaneLink {
  from?: string | null;
  to?: string | null;
}

interface ProtoJunctionLink {
  connecting_road?: string | null;
  incoming_road?: string | null;
  contact_point?: ProtoEnum;
  junction_lane_link?: ProtoJunctionLaneLink[] | null;
}

interface ProtoJunctionHeader {
  id?: string | null;
  name?: string | null;
}

interface ProtoJunctionTopo {
  header?: ProtoJunctionHeader | null;
  junction_links?: ProtoJunctionLink[] | null;
}

interface ProtoTopoMapFile {
  header?: ProtoTopoHeader | null;
  roads?: ProtoRoadTopo[] | null;
  junctions?: ProtoJunctionTopo[] | null;
}

interface GeoRoadFile {
  stem: string;
  data: ProtoTileRoadFile;
}

interface ConvertedRoad {
  road: Road;
  signals: RoadSignal[];
  objects: RoadObject[];
}

interface SectionAccumulator {
  s: number;
  leftLanes: ProtoLaneTopo[];
  rightLanes: ProtoLaneTopo[];
}

const pb: any = (protobuf as any).default ?? protobuf;
let protoRootPromise: Promise<protobuf.Root> | null = null;

/** Builds and caches the GeoZ protobuf schema root from bundled .proto sources. */
export async function buildGeoZProtoRoot(): Promise<protobuf.Root> {
  if (!protoRootPromise) {
    protoRootPromise = Promise.resolve().then(() => {
      const root = new (pb.Root)();
      for (const source of PROTO_SOURCES) {
        pb.parse(source.content, root, {
          keepCase: true,
          alternateCommentMode: true,
        });
      }
      return root;
    });
  }

  return protoRootPromise;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeEnum(value: ProtoEnum): string {
  return typeof value === 'string' ? value.toLowerCase() : String(value ?? '').toLowerCase();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getZipInput(content: string | ArrayBuffer): string | Uint8Array | ArrayBuffer {
  if (typeof content === 'string') {
    return new TextEncoder().encode(content);
  }

  return content;
}

function getFileStem(fileName: string): string {
  const normalized = fileName.replace(/\\/g, '/');
  const leaf = normalized.split('/').pop() ?? normalized;
  const dotIndex = leaf.lastIndexOf('.');
  return dotIndex > 0 ? leaf.slice(0, dotIndex) : leaf;
}

function createEmptyProject(name: string): Project {
  return {
    name,
    header: {
      rev_major: 1,
      rev_minor: 6,
      name,
      date: new Date().toISOString(),
      north: 0,
      south: 0,
      east: 0,
      west: 0,
      geo_reference: null,
    },
    roads: [],
    junctions: [],
    signals: [],
    objects: [],
  };
}

async function decodeZipEntry<T>(entry: JSZip.JSZipObject, messageType: protobuf.Type): Promise<T> {
  const bytes = await entry.async('uint8array');
  const decoded = messageType.decode(bytes);
  return messageType.toObject(decoded, PROTO_CONVERSION_OPTIONS) as unknown as T;
}

function pointsToGeometry(points: readonly ProtoPoint3D[]): Geometry[] {
  const geometries: Geometry[] = [];
  let s = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) {
      continue;
    }

    const x0 = start.x ?? 0;
    const y0 = start.y ?? 0;
    const x1 = end.x ?? 0;
    const y1 = end.y ?? 0;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (length < MIN_SEGMENT_LENGTH) {
      continue;
    }

    geometries.push({
      s,
      x: x0,
      y: y0,
      hdg: Math.atan2(dy, dx),
      length,
      geo_type: 'Line',
    });
    s += length;
  }

  return geometries;
}

function estimateLaneWidth(laneGeometry: ProtoLaneGeometry | undefined): number {
  const leftPoints = laneGeometry?.left_boundary?.point ?? [];
  const rightPoints = laneGeometry?.right_boundary?.point ?? [];
  const sampleCount = Math.min(leftPoints.length, rightPoints.length);
  if (sampleCount === 0) {
    return DEFAULT_LANE_WIDTH;
  }

  let widthTotal = 0;
  let widthSamples = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const left = leftPoints[index];
    const right = rightPoints[index];
    if (!left || !right) {
      continue;
    }

    widthTotal += Math.hypot((left.x ?? 0) - (right.x ?? 0), (left.y ?? 0) - (right.y ?? 0));
    widthSamples += 1;
  }

  if (widthSamples === 0) {
    return DEFAULT_LANE_WIDTH;
  }

  return Math.max(widthTotal / widthSamples, 0.1);
}

function parseNumericLaneId(value: string | null | undefined): number | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapLaneType(laneType: ProtoEnum): string {
  const normalized = normalizeEnum(laneType);
  switch (normalized) {
    case '1':
    case 'driving':
    case 'city_driving':
      return 'Driving';
    case '2':
    case 'shoulder':
    case 'stop':
      return 'Shoulder';
    case '3':
    case 'biking':
      return 'Biking';
    case '4':
    case 'sidewalk':
      return 'Sidewalk';
    case '5':
    case '8':
    case 'parking':
      return 'Parking';
    case '0':
    case '6':
    case 'none':
    case 'unknown':
    case 'border':
    default:
      return 'None';
  }
}

function mapContactPoint(contactPoint: ProtoEnum): LinkElement['contact_point'] {
  const normalized = normalizeEnum(contactPoint);
  if (normalized === CONTACT_POINT_START || normalized === '0') {
    return 'Start';
  }
  if (normalized === CONTACT_POINT_END || normalized === '1') {
    return 'End';
  }
  return null;
}

function mapRoadLinkElement(link: ProtoRoadlink | undefined): LinkElement | null {
  const elementId = normalizeOptionalString(link?.id);
  if (!elementId) {
    return null;
  }

  const linkType = normalizeEnum(link?.link_type);
  return {
    element_id: elementId,
    element_type: linkType === ROAD_LINK_JUNCTION || linkType === '1' ? 'Junction' : 'Road',
    contact_point: mapContactPoint(link?.link_contact_point),
  };
}

function toRoadLink(
  predecessors: readonly ProtoRoadlink[],
  successors: readonly ProtoRoadlink[],
): RoadLink | null {
  const predecessor = mapRoadLinkElement(predecessors[0]);
  const successor = mapRoadLinkElement(successors[0]);
  if (!predecessor && !successor) {
    return null;
  }

  return { predecessor, successor };
}

function toLaneLink(protoLane: ProtoLaneTopo): LaneLink | null {
  const predecessor = parseNumericLaneId(protoLane.predecessors?.[0]?.id);
  const successor = parseNumericLaneId(protoLane.successors?.[0]?.id);
  if (predecessor === null && successor === null) {
    return null;
  }

  return { predecessor, successor };
}

function createCenterLane(): Lane {
  return {
    id: 0,
    lane_type: 'None',
    level: 0,
    render_hidden: false,
    link: null,
    width: [{ s_offset: 0, a: 0, b: 0, c: 0, d: 0 }],
    road_marks: [],
  };
}

function createLane(
  protoLane: ProtoLaneTopo,
  laneId: number,
  laneGeometryMap: ReadonlyMap<string, ProtoLaneGeometry>,
): Lane {
  const protoLaneId = normalizeOptionalString(protoLane.header?.id);
  const laneGeometry = protoLaneId ? laneGeometryMap.get(protoLaneId) : undefined;
  const width = estimateLaneWidth(laneGeometry);

  return {
    id: laneId,
    lane_type: mapLaneType(protoLane.header?.lane_type),
    level: 0,
    render_hidden: false,
    link: toLaneLink(protoLane),
    width: [{ s_offset: 0, a: width, b: 0, c: 0, d: 0 }],
    road_marks: [],
  };
}

function buildSectionKey(section: ProtoRoadSection): string {
  return [
    normalizeOptionalString(section.section_id) ?? '',
    String(section.section_index ?? 0),
    String(section.s ?? 0),
  ].join(':');
}

function distributeUnknownSectionLanes(section: ProtoRoadSection, target: SectionAccumulator): void {
  for (const lane of section.lanes ?? []) {
    const laneId = parseNumericLaneId(lane.header?.id);
    if (laneId !== null && laneId > 0) {
      target.leftLanes.push(lane);
      continue;
    }

    target.rightLanes.push(lane);
  }
}

function buildLaneSections(
  roadSections: readonly ProtoRoadSection[],
  laneGeometryMap: ReadonlyMap<string, ProtoLaneGeometry>,
): LaneSection[] {
  if (roadSections.length === 0) {
    return [
      {
        s: 0,
        single_side: false,
        render_hidden: false,
        left: [],
        center: [createCenterLane()],
        right: [],
      },
    ];
  }

  const groupedSections = new Map<string, SectionAccumulator>();

  for (const section of roadSections) {
    const key = buildSectionKey(section);
    const entry = groupedSections.get(key) ?? {
      s: section.s ?? 0,
      leftLanes: [],
      rightLanes: [],
    };

    const direction = normalizeEnum(section.section_direction_type);
    if (direction === LEFT_SECTION) {
      entry.leftLanes.push(...(section.lanes ?? []));
    } else if (direction === RIGHT_SECTION) {
      entry.rightLanes.push(...(section.lanes ?? []));
    } else {
      distributeUnknownSectionLanes(section, entry);
    }

    groupedSections.set(key, entry);
  }

  return Array.from(groupedSections.values())
    .sort((left, right) => left.s - right.s)
    .map((section) => ({
      s: section.s,
      single_side: false,
      render_hidden: false,
      left: section.leftLanes.map((lane, index) => createLane(lane, index + 1, laneGeometryMap)),
      center: [createCenterLane()],
      right: section.rightLanes.map((lane, index) => createLane(lane, -(index + 1), laneGeometryMap)),
    }));
}

function protoSignalToSignal(
  signal: ProtoSignal,
  roadId: string,
  signalIndex: number,
): RoadSignal {
  return {
    id: normalizeOptionalString(signal.id) ?? `${roadId}:signal:${signalIndex}`,
    name: normalizeOptionalString(signal.type) ?? 'signal',
    s: 0,
    t: 0,
    z_offset: 0,
    h_offset: 0,
    width: 1.0,
    height: 2.0,
    signal_type: normalizeOptionalString(signal.type) ?? '-1',
    signal_subtype: '-1',
    value: null,
    orientation: '+',
    is_dynamic: false,
  };
}

function protoObjectToRoadObject(
  object: ProtoObject,
  roadId: string,
  objectIndex: number,
): RoadObject {
  return {
    id: normalizeOptionalString(object.id) ?? `${roadId}:object:${objectIndex}`,
    roadId: normalizeOptionalString(object.road_id) ?? roadId,
    sPosition: 0,
    laneId: 0,
    type: normalizeOptionalString(object.type) ?? 'object',
    validity: null,
  };
}

function protoJunctionToJunction(
  junction: ProtoJunctionTopo,
  junctionIndex: number,
): Junction {
  const junctionId = normalizeOptionalString(junction.header?.id) ?? `junction-${junctionIndex}`;
  const connections: JunctionConnection[] = (junction.junction_links ?? []).map((link, connectionIndex) => ({
    id: `${junctionId}:${connectionIndex}`,
    incoming_road: normalizeOptionalString(link.incoming_road) ?? '',
    connecting_road: normalizeOptionalString(link.connecting_road) ?? '',
    contact_point: mapContactPoint(link.contact_point) ?? 'Start',
    lane_links: (link.junction_lane_link ?? []).map((laneLink) => ({
      from: parseNumericLaneId(laneLink.from) ?? 0,
      to: parseNumericLaneId(laneLink.to) ?? 0,
    })),
  }));

  return {
    id: junctionId,
    name: normalizeOptionalString(junction.header?.name) ?? junctionId,
    connections,
  };
}

function computeRoadLength(planView: readonly Geometry[]): number {
  return planView.reduce((total, geometry) => total + geometry.length, 0);
}

function convertRoad(
  roadTopo: ProtoRoadTopo,
  roadGeometry: ProtoRoadGeometry | undefined,
  fallbackRoadId: string,
): ConvertedRoad {
  const roadId =
    normalizeOptionalString(roadTopo.header?.id) ??
    normalizeOptionalString(roadGeometry?.id) ??
    fallbackRoadId;
  const laneGeometryMap = new Map<string, ProtoLaneGeometry>();
  for (const laneGeometry of roadGeometry?.lane_geometrys ?? []) {
    const laneGeometryId = normalizeOptionalString(laneGeometry.id);
    if (laneGeometryId) {
      laneGeometryMap.set(laneGeometryId, laneGeometry);
    }
  }

  const referencePoints = roadGeometry?.reference_line?.point ?? [];
  const planView = pointsToGeometry(referencePoints);
  const computedLength = computeRoadLength(planView);
  const roadLength = roadTopo.header?.length && roadTopo.header.length > 0
    ? roadTopo.header.length
    : computedLength;
  const signals = (roadTopo.road_signal ?? []).map((signal, index) => protoSignalToSignal(signal, roadId, index));
  const objects = (roadTopo.road_objects ?? []).map((object, index) => protoObjectToRoadObject(object, roadId, index));

  const road: Road = {
    id: roadId,
    name: normalizeOptionalString(roadTopo.header?.name) ?? roadId,
    length: roadLength,
    junction_id: normalizeOptionalString(roadTopo.header?.junction_id),
    render_hidden: false,
    link: toRoadLink(roadTopo.road_predecessors ?? [], roadTopo.road_successors ?? []),
    plan_view: planView,
    elevation_profile: [],
    lane_sections: buildLaneSections(roadTopo.road_sections ?? [], laneGeometryMap),
    lane_offsets: [],
    lateral_profile: { superelevations: [], crossfalls: [] },
    bridges: [],
    tunnels: [],
    signals: [],
    objects: [],
  };

  return { road, signals, objects };
}

function computeProjectBounds(roads: readonly Road[]): Pick<Project['header'], 'north' | 'south' | 'east' | 'west'> {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const updateBounds = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const road of roads) {
    for (const geometry of road.plan_view) {
      updateBounds(geometry.x, geometry.y);
      const endX = geometry.x + Math.cos(geometry.hdg) * geometry.length;
      const endY = geometry.y + Math.sin(geometry.hdg) * geometry.length;
      updateBounds(endX, endY);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { north: 0, south: 0, east: 0, west: 0 };
  }

  return {
    north: maxY,
    south: minY,
    east: maxX,
    west: minX,
  };
}

/** Converts decoded GeoZ topo/geometry protobuf data into an editor Project. */
export function geoToProject(
  topoFiles: readonly ProtoTopoMapFile[],
  geoFiles: readonly GeoRoadFile[],
  fileName = 'GeoZ Map',
): Project {
  const topoRoads = topoFiles.flatMap((file) => file.roads ?? []);
  const topoJunctions = topoFiles.flatMap((file) => file.junctions ?? []);
  const fallbackProjectName = getFileStem(fileName) || 'GeoZ Import';
  const projectName =
    normalizeOptionalString(topoFiles.find((file) => normalizeOptionalString(file.header?.name))?.header?.name) ??
    fallbackProjectName;

  if (topoRoads.length === 0 && topoJunctions.length === 0) {
    return createEmptyProject(projectName);
  }

  const roadGeometryById = new Map<string, ProtoRoadGeometry>();
  const roadGeometryByStem = new Map<string, ProtoRoadGeometry>();
  for (const geoFile of geoFiles) {
    const geometry = geoFile.data.road_geometry ?? undefined;
    if (!geometry) {
      continue;
    }

    const geometryId = normalizeOptionalString(geometry.id);
    if (geometryId) {
      roadGeometryById.set(geometryId, geometry);
    }
    roadGeometryByStem.set(geoFile.stem, geometry);
  }

  const convertedRoads = topoRoads.map((roadTopo, index) => {
    const roadId = normalizeOptionalString(roadTopo.header?.id) ?? `road-${index}`;
    const geometry = roadGeometryById.get(roadId) ?? roadGeometryByStem.get(roadId);
    return convertRoad(roadTopo, geometry, roadId);
  });
  const roads = convertedRoads.map((entry) => entry.road);
  const junctions = topoJunctions.map((junction, index) => protoJunctionToJunction(junction, index));
  const bounds = computeProjectBounds(roads);

  return {
    name: projectName,
    header: {
      rev_major: 1,
      rev_minor: 6,
      name: projectName,
      date: new Date().toISOString(),
      ...bounds,
      geo_reference: null,
    },
    roads,
    junctions,
    signals: convertedRoads.flatMap((entry) => entry.signals),
    objects: convertedRoads.flatMap((entry) => entry.objects),
  };
}

/** Loads a GeoZ archive, decodes protobuf payloads, and converts them into a Project. */
export async function importGeoZ(
  fileContent: string | ArrayBuffer,
  fileName = 'GeoZ Map',
): Promise<Project> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(getZipInput(fileContent));
  } catch (error) {
    throw new Error(`Failed to read GeoZ archive: ${getErrorMessage(error)}`);
  }

  const topoEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && entry.name.toLowerCase().endsWith('.topo'),
  );
  const geoEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && entry.name.toLowerCase().endsWith('.geo'),
  );

  if (topoEntries.length === 0 && geoEntries.length === 0) {
    return createEmptyProject(getFileStem(fileName) || 'GeoZ Import');
  }

  const root = await buildGeoZProtoRoot();
  const topoMapType = root.lookupType('rt.hdmap.TopoMapFile');
  const tileRoadType = root.lookupType('rt.hdmap.TileRoadFile');

  const topoFiles = await Promise.all(
    topoEntries.map((entry) => decodeZipEntry<ProtoTopoMapFile>(entry, topoMapType)),
  );
  const geoFiles = await Promise.all(
    geoEntries.map(async (entry) => ({
      stem: getFileStem(entry.name),
      data: await decodeZipEntry<ProtoTileRoadFile>(entry, tileRoadType),
    })),
  );

  return geoToProject(topoFiles, geoFiles, fileName);
}
