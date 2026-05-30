/**
 * Platform adapter — unified interface for Desktop (Tauri) and Web backends.
 * Frontend code calls this interface without knowing the deployment target.
 */

export interface GeoReference {
  origin_lat: number;
  origin_long: number;
  origin_alt: number;
  origin_hdg: number;
}

export interface Header {
  rev_major: number;
  rev_minor: number;
  name: string;
  date: string;
  north: number;
  south: number;
  east: number;
  west: number;
  geo_reference: GeoReference | null;
}

export interface Project {
  name: string;
  header: Header;
  roads: Road[];
  junctions: Junction[];
  signals: RoadSignal[];
  objects: RoadObject[];
  shape_layers?: ShapeLayer[];
}

export interface LinkElement {
  element_id: string;
  element_type: 'Road' | 'Junction';
  contact_point: 'Start' | 'End' | null;
}

export interface RoadLink {
  predecessor: LinkElement | null;
  successor: LinkElement | null;
}

export interface Geometry {
  s: number;
  x: number;
  y: number;
  hdg: number;
  length: number;
  geo_type: GeometryType;
}

export type GeometryType =
  | 'Line'
  | { Arc: { curvature: number } }
  | { Spiral: { curv_start: number; curv_end: number } }
  | { Poly3: { a: number; b: number; c: number; d: number } }
  | { ParamPoly3: { a_u: number; b_u: number; c_u: number; d_u: number; a_v: number; b_v: number; c_v: number; d_v: number; p_range: 'ArcLength' | 'Normalized' } };

export interface Elevation {
  s: number;
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface Superelevation extends Elevation {}

export interface Crossfall extends Elevation {
  side?: 'left' | 'right' | 'both';
}

export interface LateralProfile {
  superelevation?: Superelevation[];
  crossfall?: Crossfall[];
  superelevations?: Superelevation[];
  crossfalls?: Crossfall[];
}

export interface LaneOffset {
  s: number;
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface Bridge {
  id: string;
  s: number;
  length: number;
  bridge_type: string;
}

export interface Tunnel {
  id: string;
  s: number;
  length: number;
  tunnel_type: string;
}

// ── Shape vector layer types ──────────────────────────────────────────────────

export interface ShapeTag {
  key: string;
  value: string;
}

export interface ShapeNode {
  id: string;
  x: number;
  y: number;
  z?: number;
  tags?: ShapeTag[];
}

export interface ShapeWay {
  id: string;
  node_ids: string[];
  tags?: ShapeTag[];
}

export interface ShapeRelationMember {
  member_id: string;
  member_type: string;
  role?: string;
}

export interface ShapeRelation {
  id: string;
  members?: ShapeRelationMember[];
  tags?: ShapeTag[];
}

export interface ShapeLayer {
  id: string;
  name: string;
  visible?: boolean;
  nodes: ShapeNode[];
  ways: ShapeWay[];
  relations?: ShapeRelation[];
}

export interface Road {
  id: string;
  name: string;
  length: number;
  junction_id: string | null;
  render_hidden?: boolean;
  link: RoadLink | null;
  plan_view: Geometry[];
  elevation_profile: Elevation[];
  lane_sections: LaneSection[];
  lane_offsets?: LaneOffset[];
  lateral_profile?: LateralProfile;
  bridges?: Bridge[];
  tunnels?: Tunnel[];
  signals?: RoadSignal[];
  objects?: RoadObjectItem[];
  speed?: number;
  /** Original user-placed spline control point positions [x, y, z].
   * Used to restore exact control points in geometry-edit mode without re-sampling. */
  spline_edit_data?: [number, number, number][];
}

/** Project-level signal reference (simplified, for project.signals array). */
export interface Signal {
  id: string;
  roadId: string;
  sPosition: number;
  laneId: number;
  type: string;
  validity: RoadObjectValidity | null;
}

/** Road-level signal as parsed from OpenDRIVE `<signal>` elements (road.signals[]). */
export interface RoadSignal {
  id: string;
  name: string;
  s: number;
  t: number;
  z_offset: number;
  h_offset: number;
  width: number;
  height: number;
  signal_type: string;
  signal_subtype: string;
  value: string | null;
  orientation: string;
  is_dynamic: boolean;
}

/** Project-level road object reference (simplified, for project.objects array). */
export interface RoadObject {
  id: string;
  roadId: string;
  sPosition: number;
  laneId: number;
  type: string;
  validity: RoadObjectValidity | null;
}

/** Road-level object as parsed from OpenDRIVE `<object>` elements (road.objects[]). */
export interface RoadObjectValidity {
  from_lane: number;
  to_lane: number;
}

export interface RoadObjectPosition {
  x: number;
  y: number;
  z: number;
  id: string | null;
}

export interface RoadObjectItem {
  id: string;
  /** Serialized ObjectType: unit variants as string (e.g. "ParkingSpace"), Custom as { Custom: string }. */
  object_type: string | { Custom: string };
  name: string;
  /** position.x = s (station), position.y = t (lateral offset), position.z = z_offset */
  position: RoadObjectPosition;
  /** Heading offset relative to road direction (degrees). */
  orientation: number;
  /** Object heading in radians relative to road direction. */
  hdg: number;
  width: number;
  height: number;
  length: number;
  corners: RoadObjectPosition[];
  validity: RoadObjectValidity | null;
}

export interface LaneSection {
  s: number;
  single_side: boolean;
  render_hidden?: boolean;
  left: Lane[];
  center: Lane[];
  right: Lane[];
}

export interface LaneLink {
  predecessor: number | null;
  successor: number | null;
}

export interface RoadMark {
  s_offset: number;
  mark_type: string;
  weight: string;
  color: string;
  material: string;
  width: number;
  lane_change: string;
  height?: number;
}

export interface LaneBorder {
  s_offset: number;
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface Lane {
  id: number;
  lane_type: string;
  level: number;
  render_hidden?: boolean;
  link: LaneLink | null;
  width: LaneWidth[];
  borders?: LaneBorder[];
  road_marks: RoadMark[];
}

export interface LaneWidth {
  s_offset: number;
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface LaneBoundaryPoint {
  x: number;
  y: number;
  z: number;
  s: number;
  t: number;
}

export interface JunctionLaneLink {
  from: number;
  to: number;
}

export interface Junction {
  id: string;
  name: string;
  connections: JunctionConnection[];
}

export interface JunctionArea {
  id: string;
  center: [number, number];
  boundary: Array<{ x: number; y: number }>;
  area: number;
}

export interface JunctionConnection {
  id: string;
  incoming_road: string;
  connecting_road: string;
  contact_point: 'Start' | 'End';
  lane_links: JunctionLaneLink[];
}

export interface GisCoord {
  lat: number;
  lon: number;
  alt: number;
}

export interface UtmCoord {
  easting: number;
  northing: number;
  zone: number;
  is_northern: boolean;
  alt: number;
}

export interface ElevationQueryResult {
  elevation: number;
  grade: number;
  grade_pct: number;
}

export interface SnapConfig {
  grid_enabled: boolean;
  grid_size: number;
  endpoint_enabled: boolean;
  endpoint_threshold: number;
  snap_to_lane_endpoints: boolean;
  midpoint_enabled: boolean;
  perpendicular_enabled: boolean;
}

export type SnapType = 'None' | 'Grid' | 'Endpoint' | 'LaneEndpoint' | 'Midpoint' | 'Perpendicular';

export interface SnapResult {
  x: number;
  y: number;
  snapped: boolean;
  snap_type: SnapType;
  target_id: string | null;
  contact_point: string | null;
}

export interface EndpointTangent {
  x: number;
  y: number;
  hdg: number;
}

export interface DistanceMeasurement {
  straight: number;
  horizontal: number;
  vertical: number;
}

export interface AngleMeasurement {
  radians: number;
  degrees: number;
}

export interface AreaMeasurement {
  area: number;
  perimeter: number;
}

export interface SplineKnot {
  position: [number, number, number];
  tangent_in: [number, number, number];
  tangent_out: [number, number, number];
  s: number;
  knot_type: 'Key' | 'Intermediate' | 'Anchor';
  tangent_mode: 'Auto' | 'Manual';
}

export interface EditableSpline {
  knots: SplineKnot[];
}

export interface RoadTemplate {
  id: string;
  name: string;
  left_lanes: number;
  right_lanes: number;
  lane_width: number;
}

export interface PlatformService {
  /** Parse an OpenDRIVE XML string into a Project. */
  parseOpenDrive(xml: string): Promise<Project>;

  /** Serialize a Project to OpenDRIVE XML. */
  writeOpenDrive(project: Project): Promise<string>;

  /** Open a file picker and return the file contents. */
  openFile(): Promise<{ name: string; content: string; path?: string } | null>;

  /**
   * Show the OS file-picker dialog and return the selected absolute path,
   * WITHOUT reading the file. This allows the caller to show a loading
   * indicator before the (potentially slow) file-read begins.
   * Optional — platforms that cannot expose paths (e.g. Web) may omit this.
   */
  openFilePath?(): Promise<string | null>;

  /** Open a file directly by path when the platform supports it. */
  openFileByPath(path: string): Promise<{ name: string; content: string } | null>;

  /** Save content to a file. */
  saveFile(filename: string, content: string): Promise<string | null>;

  /** Get platform info. */
  getPlatformInfo(): { type: 'tauri' | 'web'; version: string };

  /** Convert WGS84 to GCJ-02. */
  wgs84ToGcj02(lat: number, lon: number, alt: number): Promise<GisCoord>;

  /** Convert GCJ-02 to WGS84. */
  gcj02ToWgs84(lat: number, lon: number, alt: number): Promise<GisCoord>;

  /** Convert WGS84 to UTM. */
  geoToUtm(lat: number, lon: number, alt: number): Promise<UtmCoord>;

  /** Convert UTM to WGS84. */
  utmToGeo(easting: number, northing: number, zone: number, isNorthern: boolean, alt: number): Promise<GisCoord>;

  /** Generate road mesh vertices from a project. Returns Float32Array of [x,y,z,r,g,b,a] per vertex. */
  generateRoadVertices(project: Project, sampleStep: number, colorMode?: string): Promise<Float32Array>;

  /** Generate road mesh using cached project (skips JSON serialization). */
  generateRoadVerticesCached(sampleStep: number, colorMode?: string): Promise<Float32Array>;

  /** Generate vertices for a single road with a custom color. Returns Float32Array of [x,y,z,r,g,b,a] per vertex. */
  generateSingleRoadVertices(road: Road, sampleStep: number, color: [number, number, number, number]): Promise<Float32Array>;

  /** Generate vertices for a single junction with a custom color. Returns Float32Array of [x,y,z,r,g,b,a] per vertex. */
  generateSingleJunctionVertices(project: Project, junctionId: string, color: [number, number, number, number]): Promise<Float32Array>;

  /** Generate junction surface mesh vertices. Returns Float32Array of [x,y,z,r,g,b,a] per vertex. */
  generateJunctionVertices(project: Project): Promise<Float32Array>;

  /** Generate lane boundary line vertices (solid geometric lines, no road_marks needed). Returns Float32Array of [x,y,z,r,g,b,a] per vertex. */
  generateLaneBoundaryVertices(project: Project, sampleStep: number): Promise<Float32Array>;

  /** Generate lane boundary line vertices (solid/dashed road markings). Returns Float32Array of [x,y,z,r,g,b,a] per vertex. */
  generateLaneLineVertices(project: Project, sampleStep: number): Promise<Float32Array>;

  /** Generate reference line (centerline) visualization vertices. Returns Float32Array of [x,y,z,r,g,b,a] per vertex. */
  generateCenterLineVertices(project: Project, sampleStep: number): Promise<Float32Array>;

  /** Generate signal paint mark and sign marker vertices. Returns Float32Array of [x,y,z,r,g,b,a] per vertex. */
  generateSignalPaintVertices(project: Project, sampleStep: number): Promise<Float32Array>;

  /** Generate road object vertices (crosswalks, parking spaces, stop lines, guardrails, etc.).
   *  Returns Float32Array of [x,y,z,r,g,b,a] per vertex. */
  generateObjectVertices(project: Project): Promise<Float32Array>;

  /** Generate bridge deck and tunnel enclosure overlay vertices.
   *  Returns Float32Array of [x,y,z,r,g,b,a] per vertex. */
  generateBridgeTunnelVertices(project: Project): Promise<Float32Array>;

  /** Auto-generate connector roads for all unconnected arm pairs in a junction.
   *  Returns the updated Project. */
  autoJunctionConnectors(project: Project, junctionId: string): Promise<Project>;

  /** Compute the boundary polygon and area of a junction.
   *  Returns { id, center, boundary, area } or null if insufficient data. */
  computeJunctionArea(project: Project, junctionId: string): Promise<JunctionArea | null>;

  // --- Project cache (avoids per-call JSON serialisation on 60 Hz mousemove) ---

  /** Store the project in the WASM-side cache. Call once per project mutation. */
  setProjectCache(project: Project): Promise<void>;

  /** Invalidate the WASM spatial index without re-parsing the project. */
  invalidateProjectCache(): Promise<void>;

  /** Whether a WASM project cache has been initialised. */
  hasProjectCache(): Promise<boolean>;

  // --- Cached picking (no JSON serialisation per call) ---

  /** Pick road using cached project. Call setProjectCache() first. */
  pickRoadAtPointCached(x: number, y: number, threshold: number): Promise<string | null>;

  /** Pick junction using cached project. Call setProjectCache() first. */
  pickJunctionAtPointCached(x: number, y: number, threshold: number): Promise<string | null>;

  /** Pick lane using cached project. Call setProjectCache() first. */
  pickLaneAtPointCached(x: number, y: number, threshold: number): Promise<{ roadId: string; sectionIndex: number; laneId: number } | null>;

  /** Snap point using cached project. Call setProjectCache() first. */
  snapPointCached(x: number, y: number, config: SnapConfig, excludeRoadId?: string): Promise<SnapResult>;

  /** Pick signal using cached project. Call setProjectCache() first. */
  pickSignalAtPointCached(x: number, y: number, threshold: number): Promise<{ roadId: string; signalId: string } | null>;

  /** Pick road object using cached project. Call setProjectCache() first. */
  pickObjectAtPointCached(x: number, y: number, threshold: number): Promise<{ roadId: string; objectId: string } | null>;

  // --- Uncached picking (legacy, for one-off calls) ---

  /** Find the closest road to a world-space point. Returns road ID or null. */
  pickRoadAtPoint(project: Project, x: number, y: number, threshold: number): Promise<string | null>;

  /** Find the closest junction to a world-space point. Returns junction ID or null. */
  pickJunctionAtPoint(project: Project, x: number, y: number, threshold: number): Promise<string | null>;

  /** Find the closest signal to a world-space point. Returns { roadId, signalId } or null. */
  pickSignalAtPoint(project: Project, x: number, y: number, threshold: number): Promise<{ roadId: string; signalId: string } | null>;

  /** Find the closest road object to a world-space point. Returns { roadId, objectId } or null. */
  pickObjectAtPoint(project: Project, x: number, y: number, threshold: number): Promise<{ roadId: string; objectId: string } | null>;

  /** Project a world-space point onto a road's reference line.
   *  Returns road-local `{ s, t, hdg }` at the closest point on the reference line.
   *  - s: arc-length station (metres from road start)
   *  - t: signed lateral offset (positive = left)
   *  - hdg: road heading at that station (radians)
   *  Used after pickRoadAtPoint to convert a click position into correct s/t for signal/object placement.
   */
  snapPointOnRoad(road: Road, worldX: number, worldY: number): Promise<{ s: number; t: number; hdg: number }>;

  /** Generate highlight vertices for a single signal. Returns Float32Array of [x,y,z,r,g,b,a] per vertex. */
  generateSingleSignalVertices(project: Project, roadId: string, signalId: string, color: [number, number, number, number]): Promise<Float32Array>;

  /** Generate highlight vertices for a single signal using cached project (no JSON serialization). */
  generateSingleSignalVerticesCached?(roadId: string, signalId: string, color: [number, number, number, number]): Promise<Float32Array>;

  /** Generate highlight vertices for a single road object. Returns Float32Array of [x,y,z,r,g,b,a] per vertex. */
  generateSingleObjectVertices(project: Project, roadId: string, objectId: string, color: [number, number, number, number]): Promise<Float32Array>;

  /** Generate highlight vertices for a single road object using cached project (no JSON serialization). */
  generateSingleObjectVerticesCached?(roadId: string, objectId: string, color: [number, number, number, number]): Promise<Float32Array>;

  /** Get the world-space XY position of a signal. Returns { x, y } or null. */
  getSignalWorldPos(project: Project, roadId: string, signalId: string): Promise<{ x: number; y: number } | null>;

  /** Get the world-space XY position of a road object. Returns { x, y } or null. */
  getObjectWorldPos(project: Project, roadId: string, objectId: string): Promise<{ x: number; y: number } | null>;

  /** Get the world-space XY position of a signal using the cached project (no per-call serialization). */
  getSignalWorldPosCached(roadId: string, signalId: string): Promise<{ x: number; y: number } | null>;

  /** Get the world-space XY position of a road object using the cached project (no per-call serialization). */
  getObjectWorldPosCached(roadId: string, objectId: string): Promise<{ x: number; y: number } | null>;

  /** Get the world-space XY position of a lane center using the cached project. */
  getLaneWorldPosCached(roadId: string, sectionIndex: number, laneId: number): Promise<{ x: number; y: number } | null>;

  /** Query elevation and grade at a station on a road. */
  queryElevation(road: Road, s: number): Promise<ElevationQueryResult>;

  /** Add an elevation point and return the updated project. */
  addElevationPoint(project: Project, roadId: string, s: number, height: number): Promise<Project>;

  /** Delete an elevation point and return the updated project. */
  deleteElevationPoint(project: Project, roadId: string, s: number, tolerance: number): Promise<Project>;

  /** Smooth elevation profile and return the updated project. */
  smoothElevation(project: Project, roadId: string, iterations: number): Promise<Project>;

  /** Snap a point according to current snap configuration. */
  snapPoint(project: Project, x: number, y: number, config: SnapConfig, excludeRoadId?: string): Promise<SnapResult>;

  /** Get the position and heading at a road endpoint for tangent inheritance. */
  getRoadEndpointTangent(project: Project, roadId: string, contactPoint: string): Promise<EndpointTangent | null>;

  /** Measure 3D distance between two points. */
  measureDistance(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
  ): Promise<DistanceMeasurement>;

  /** Measure angle at vertex point p2 in 2D. */
  measureAngle(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
  ): Promise<AngleMeasurement>;

  /** Measure polygon area from points. */
  measureArea(points: Array<[number, number]>): Promise<AreaMeasurement>;

  /** Measure road arc length between two stations. */
  measureRoadLength(road: Road, sStart: number, sEnd: number): Promise<number>;

  /** Sample a selected lane's outer boundary at regular s intervals. */
  sampleLaneBoundary(road: Road, sectionStart: number, laneId: number, step: number): Promise<LaneBoundaryPoint[]>;

  /** List built-in road templates for spline-based road generation. */
  getRoadTemplates(): Promise<RoadTemplate[]>;

  /** Create a road from spline and template, returning updated project.
   * @param mode - `'classify'` (optimal geometry types) or `'parampoly3'` (force ParamPoly3)
   */
  createRoadFromSpline(
    project: Project,
    roadId: string,
    spline: EditableSpline,
    templateId: string,
    mode?: 'classify' | 'parampoly3',
  ): Promise<Project>;

  /** Convert a road's plan_view geometry to an editable spline. */
  roadToSpline(road: Road, sampleStep: number): Promise<EditableSpline>;

  /** Move a spline knot to a new position, recomputing tangents. Returns updated spline. */
  moveSplineKnot(spline: EditableSpline, knotIndex: number, x: number, y: number, z: number): Promise<EditableSpline>;

  /** Convert an editable spline back to OpenDRIVE geometry segments.
   * @param mode - `'classify'` (optimal geometry types) or `'parampoly3'` (force ParamPoly3)
   */
  splineToGeometries(spline: EditableSpline, mode?: 'classify' | 'parampoly3'): Promise<Geometry[]>;
}
