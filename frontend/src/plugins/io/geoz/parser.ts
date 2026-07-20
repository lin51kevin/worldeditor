/**
 * GeoZ parser utilities.
 * Converts GeoZ archives (ZIP containing .topo + .geo protobuf files)
 * into editor Projects.
 */

import JSZip from 'jszip';
import protobuf from 'protobufjs';
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
  RoadObjectItem,
  RoadMark,
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
import type {
  ConvertedRoad,
  GeoRoadFile,
  ProtoEnum,
  ProtoJunctionTopo,
  ProtoLaneGeometry,
  ProtoLaneTopo,
  ProtoObject,
  ProtoParkingSpace,
  ProtoPoint3D,
  ProtoPropertie,
  ProtoRoadGeometry,
  ProtoRoadMark,
  ProtoRoadSection,
  ProtoRoadTopo,
  ProtoRoadlink,
  ProtoSignal,
  ProtoTileRoadFile,
  ProtoTopoMapFile,
  SectionAccumulator,
} from './protoTypes';

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

let protoRootPromise: Promise<protobuf.Root> | null = null;

/** Builds and caches the GeoZ protobuf schema root from bundled .proto sources. */
export async function buildGeoZProtoRoot(): Promise<protobuf.Root> {
  if (!protoRootPromise) {
    protoRootPromise = Promise.resolve().then(() => {
      const root = new protobuf.Root();
      for (const source of PROTO_SOURCES) {
        protobuf.parse(source.content, root, {
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
    case 'stop':
      return 'Stop';
    case '3':
    case 'shoulder':
      return 'Shoulder';
    case '4':
    case 'biking':
      return 'Biking';
    case '5':
    case 'sidewalk':
      return 'Sidewalk';
    case '6':
    case 'border':
      return 'Border';
    case '7':
    case 'restricted':
      return 'Restricted';
    case '8':
    case 'parking':
      return 'Parking';
    case '9':
    case 'bidirectional':
      return 'Bidirectional';
    case '10':
    case 'median':
      return 'Median';
    case '11':
    case 'special1':
      return 'Special1';
    case '12':
    case 'special2':
      return 'Special2';
    case '13':
    case 'special3':
      return 'Special3';
    case '14':
    case 'roadworks':
      return 'RoadWorks';
    case '15':
    case 'tram':
      return 'Tram';
    case '16':
    case 'rail':
      return 'Rail';
    case '17':
    case 'entry':
      return 'Entry';
    case '18':
    case 'exit':
      return 'Exit';
    case '19':
    case 'offramp':
    case 'mwyexit':
      return 'OffRamp';
    case '20':
    case 'onramp':
    case 'mwyentry':
      return 'OnRamp';
    case '0':
    case 'none':
    case 'unknown':
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

function mapRoadMarkType(proto: ProtoEnum): string {
  switch (proto) {
    case 'type_solid':
    case 1: return 'solid';
    case 'type_broken':
    case 2: return 'broken';
    case 'type_solid_solid':
    case 3: return 'solid_solid';
    case 'type_solid_broken':
    case 4: return 'solid_broken';
    case 'type_broken_solid':
    case 5: return 'broken_solid';
    case 'type_broken_broken':
    case 6: return 'broken';
    case 'type_botts_dots':
    case 7: return 'botts_dots';
    case 'type_grass':
    case 8: return 'grass';
    case 'type_curb':
    case 9: return 'curb';
    case 'custom':
    case 10: return 'custom';
    case 'edge':
    case 11: return 'solid';
    default: return 'none';
  }
}

function mapRoadMarkColor(proto: ProtoEnum): string {
  switch (proto) {
    case 'color_standard':
    case 1: return 'standard';
    case 'color_blue':
    case 2: return 'blue';
    case 'color_green':
    case 3: return 'green';
    case 'color_red':
    case 4: return 'red';
    case 'color_white':
    case 5: return 'white';
    case 'color_yellow':
    case 6: return 'yellow';
    case 'color_orange':
    case 7: return 'orange';
    default: return 'standard';
  }
}

function mapRoadMarkWeight(proto: ProtoEnum): string {
  switch (proto) {
    case 'weight_bold':
    case 2: return 'bold';
    default: return 'standard';
  }
}

function convertRoadMarks(marks: readonly ProtoRoadMark[] | null | undefined): RoadMark[] {
  if (!marks?.length) return [];
  return marks.map((m) => ({
    s_offset: m.offset ?? 0,
    mark_type: mapRoadMarkType(m.mark_type),
    weight: mapRoadMarkWeight(m.mark_weight),
    color: mapRoadMarkColor(m.mark_color),
    material: '',
    width: m.width ?? 0,
    lane_change: '',
  }));
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
  const roadMarkBoundary = laneGeometry
    ? (laneId > 0 ? laneGeometry.right_boundary : laneGeometry.left_boundary)
    : undefined;

  return {
    id: laneId,
    lane_type: mapLaneType(protoLane.header?.lane_type),
    level: 0,
    render_hidden: false,
    link: toLaneLink(protoLane),
    width: [{ s_offset: 0, a: width, b: 0, c: 0, d: 0 }],
    road_marks: convertRoadMarks(roadMarkBoundary?.road_mark),
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
    if (isVirtualCenterLane(lane)) {
      continue; // virtual centre-line lane carries no surface
    }
    const laneId = parseNumericLaneId(lane.header?.id);
    if (laneId !== null && laneId > 0) {
      target.leftLanes.push(lane);
      continue;
    }

    target.rightLanes.push(lane);
  }
}

/** True for the virtual CENTER_LINE lane emitted per section by the exporter. */
function isVirtualCenterLane(lane: ProtoLaneTopo): boolean {
  return normalizeEnum(lane.header?.virtual_type) === 'center_line';
}

function buildLaneSections(
  roadSections: readonly ProtoRoadSection[],
  laneGeometryMap: ReadonlyMap<string, ProtoLaneGeometry>,
): LaneSection[] {
  if (roadSections.length === 0) {
    // Return empty array so the WASM fallback ribbon renders a visible road
    // surface using the reference line geometry. A center-only section would
    // suppress the fallback (lane_sections is non-empty) while producing no
    // vertices (no left/right lanes).
    return [];
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
    const surfaceLanes = (section.lanes ?? []).filter((lane) => !isVirtualCenterLane(lane));
    if (direction === LEFT_SECTION) {
      entry.leftLanes.push(...surfaceLanes);
    } else if (direction === RIGHT_SECTION) {
      entry.rightLanes.push(...surfaceLanes);
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

/** Build a lookup map from a proto `userDataList` (key → value). */
function userDataMap(list: readonly ProtoPropertie[] | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of list ?? []) {
    const name = normalizeOptionalString(entry.name);
    if (name) {
      map.set(name, entry.value ?? '');
    }
  }
  return map;
}

function userNumber(map: Map<string, string>, key: string, fallback = 0): number {
  const raw = map.get(key);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Known built-in ObjectType variant names (PascalCase). */
const OBJECT_TYPE_NAMES = new Set([
  'Sign', 'Guardrail', 'Barrier', 'Curb', 'Wall', 'Pillar', 'TrafficCone',
  'ParkingSpace', 'Crosswalk', 'StopLine', 'CrossHatchArea', 'WovenArea',
  'ForwardWaitingArea', 'TurnLeftWaitingArea', 'SlowDownToYieldLine',
  'StopToYieldLine', 'SimpleSignalPole', 'TrafficLightPole', 'StreetLightPole',
  'SignGantry', 'LTypeSignalPole',
]);

/**
 * Map a proto object `type` string to the serialized Rust `ObjectType`:
 * a known built-in name stays a plain string; anything else becomes `{ Custom }`.
 */
function mapObjectType(type: string | null | undefined): RoadObjectItem['object_type'] {
  const name = normalizeOptionalString(type);
  if (!name) {
    return { Custom: 'object' };
  }
  return OBJECT_TYPE_NAMES.has(name) ? name : { Custom: name };
}

function protoSignalToSignal(
  signal: ProtoSignal,
  roadId: string,
  signalIndex: number,
): RoadSignal {
  const ud = userDataMap(signal.userDataList);
  const pt = signal.pt;
  // Prefer road-frame values from userDataList (our exporter); fall back to `pt`
  // (world) only for foreign GeoZ files that lack these hints.
  const hasRoadFrame = ud.has('s') || ud.has('t');
  const validities = (signal.validities ?? [])
    .map((v) => ({
      from_lane: parseNumericLaneId(v.from_lane_id) ?? 0,
      to_lane: parseNumericLaneId(v.to_lane_id) ?? 0,
    }));
  return {
    id: normalizeOptionalString(signal.id) ?? `${roadId}:signal:${signalIndex}`,
    name: ud.get('name') ?? normalizeOptionalString(signal.type) ?? 'signal',
    s: hasRoadFrame ? userNumber(ud, 's', 0) : (pt?.x ?? 0),
    t: hasRoadFrame ? userNumber(ud, 't', 0) : (pt?.y ?? 0),
    z_offset: ud.has('zOffset') ? userNumber(ud, 'zOffset', 0) : (pt?.z ?? 0),
    h_offset: userNumber(ud, 'h_offset', 0),
    width: signal.width ?? 1.0,
    height: signal.height ?? 2.0,
    signal_type: normalizeOptionalString(signal.type) ?? '-1',
    signal_subtype:
      ud.get('subtype') ?? normalizeOptionalString(signal.sub_type) ?? '-1',
    value: normalizeOptionalString(signal.value),
    orientation: ud.get('orientation') ?? '+',
    is_dynamic: signal.dynamic ?? false,
    country: ud.get('country') ?? '',
    unit: normalizeOptionalString(signal.unit) ?? '',
    validities,
  };
}

function protoObjectToRoadObject(
  object: ProtoObject,
  roadId: string,
  objectIndex: number,
): RoadObjectItem {
  const ud = userDataMap(object.userDataList);
  const pt = object.pt;
  // Prefer road-frame corners stored by our exporter; otherwise fall back to the
  // (world) boundary_knots for foreign GeoZ files.
  const cornersRf = ud.get('cornersRoadFrame');
  const corners = cornersRf
    ? cornersRf
        .split(';')
        .filter((tok) => tok.length > 0)
        .map((tok) => {
          const [x, y, z] = tok.split(',').map((n) => Number.parseFloat(n));
          return { x: x || 0, y: y || 0, z: z || 0, id: null };
        })
    : (object.boundary_knots ?? []).map((knot) => ({
        x: knot.x ?? 0,
        y: knot.y ?? 0,
        z: knot.z ?? 0,
        id: null,
      }));
  const cornerType = ud.get('cornerType') === 'Local' ? 'Local' : 'Road';
  const hasValidity = ud.has('validityFromLane') || ud.has('validityToLane');
  const hasRoadFrame = ud.has('s') || ud.has('t');

  return {
    id: normalizeOptionalString(object.id) ?? `${roadId}:object:${objectIndex}`,
    object_type: mapObjectType(object.type),
    name: ud.get('name') ?? '',
    position: {
      x: hasRoadFrame ? userNumber(ud, 's', 0) : (pt?.x ?? 0),
      y: hasRoadFrame ? userNumber(ud, 't', 0) : (pt?.y ?? 0),
      z: ud.has('zOffset') ? userNumber(ud, 'zOffset', 0) : (pt?.z ?? 0),
      id: null,
    },
    orientation: userNumber(ud, 'orientation', 0),
    hdg: userNumber(ud, 'hdg', 0),
    pitch: userNumber(ud, 'pitch', 0),
    roll: userNumber(ud, 'roll', 0),
    width: userNumber(ud, 'width', 0),
    height: userNumber(ud, 'height', 0),
    length: userNumber(ud, 'length', 0),
    corners,
    corner_type: cornerType,
    from_object_ref: ud.get('fromObjectRef') === 'true',
    validity: hasValidity
      ? {
          from_lane: Math.trunc(userNumber(ud, 'validityFromLane', 0)),
          to_lane: Math.trunc(userNumber(ud, 'validityToLane', 0)),
        }
      : null,
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

/**
 * Resolve reference line points using a fallback chain:
 * 1. roadGeometry.reference_line.point (primary)
 * 2. roadGeometry.center_line.point (alternate center-line field)
 * 3. Synthesize from innermost lane boundaries (average left+right midpoints)
 *
 * This matches WorldEditorOnline's approach of using lane geometry data when
 * the explicit reference line is unavailable.
 */
function resolveReferencePoints(
  roadGeometry: ProtoRoadGeometry | undefined,
  laneGeometryMap: ReadonlyMap<string, ProtoLaneGeometry>,
): ProtoPoint3D[] {
  // Fallback 1: explicit reference_line
  const refPoints = roadGeometry?.reference_line?.point;
  if (refPoints && refPoints.length >= 2) {
    return refPoints as ProtoPoint3D[];
  }

  // Fallback 2: center_line (alternate field in the proto)
  const centerPoints = roadGeometry?.center_line?.point;
  if (centerPoints && centerPoints.length >= 2) {
    return centerPoints as ProtoPoint3D[];
  }

  // Fallback 3: synthesize from lane boundary geometry
  // Find any lane geometry that has boundary points and compute the midline
  for (const laneGeometry of laneGeometryMap.values()) {
    const leftPoints = laneGeometry.left_boundary?.point;
    const rightPoints = laneGeometry.right_boundary?.point;
    if (leftPoints && rightPoints && leftPoints.length >= 2 && rightPoints.length >= 2) {
      return synthesizeCenterFromBoundaries(leftPoints, rightPoints);
    }

    // If only one boundary is available, use it directly as a reference line
    const singleBoundary = leftPoints ?? rightPoints;
    if (singleBoundary && singleBoundary.length >= 2) {
      return singleBoundary as ProtoPoint3D[];
    }
  }

  // No geometry data available at all
  return [];
}

/**
 * Synthesize a center-line polyline by averaging left and right boundary points.
 * Uses linear interpolation along the shorter boundary to align point counts.
 */
function synthesizeCenterFromBoundaries(
  leftPoints: readonly ProtoPoint3D[],
  rightPoints: readonly ProtoPoint3D[],
): ProtoPoint3D[] {
  const count = Math.min(leftPoints.length, rightPoints.length);
  const result: ProtoPoint3D[] = [];

  for (let i = 0; i < count; i += 1) {
    const left = leftPoints[i]!;
    const right = rightPoints[i]!;
    result.push({
      x: ((left.x ?? 0) + (right.x ?? 0)) / 2,
      y: ((left.y ?? 0) + (right.y ?? 0)) / 2,
      z: ((left.z ?? 0) + (right.z ?? 0)) / 2,
    });
  }

  return result;
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

  const referencePoints = resolveReferencePoints(roadGeometry, laneGeometryMap);
  const planView = pointsToGeometry(referencePoints);
  const computedLength = computeRoadLength(planView);
  const roadLength = roadTopo.header?.length && roadTopo.header.length > 0
    ? roadTopo.header.length
    : computedLength;
  const signals = (roadTopo.road_signal ?? []).map((signal, index) => protoSignalToSignal(signal, roadId, index));
  const pointObjects = (roadTopo.road_objects ?? []).map((object, index) =>
    protoObjectToRoadObject(object, roadId, index),
  );
  const parkingObjects = (roadTopo.road_parking_space ?? [])
    .map((space: ProtoParkingSpace, index) =>
      space.obj ? protoObjectToRoadObject(space.obj, roadId, index) : null,
    )
    .filter((obj): obj is RoadObjectItem => obj !== null);
  const objects = [...pointObjects, ...parkingObjects];

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
    signals,
    objects,
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
    // Objects and signals are carried at the road level (road.objects /
    // road.signals) with full geometry, so the project-level reference arrays
    // stay empty to avoid duplicate rendering.
    signals: [],
    objects: [],
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
    throw new Error(`Failed to read GeoZ archive: ${getErrorMessage(error)}`, { cause: error });
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
