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
  signals: Signal[];
  objects: RoadObject[];
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
  | { ParamPoly3: { au: number; bu: number; cu: number; du: number; av: number; bv: number; cv: number; dv: number; p_range: 'ArcLength' | 'Normalized' } };

export interface Elevation {
  s: number;
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface LaneOffset {
  s: number;
  a: number;
  b: number;
  c: number;
  d: number;
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
  lateral_profile?: { superelevations: unknown[]; crossfalls: unknown[] };
  bridges?: unknown[];
  tunnels?: unknown[];
  signals?: Signal[];
  objects?: unknown[];
}

export interface Signal {
  id: string;
  roadId: string;
  sPosition: number;
  laneId: number;
  type: string;
  validity: string;
}

export interface RoadObject {
  id: string;
  roadId: string;
  sPosition: number;
  laneId: number;
  type: string;
  validity: string;
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

export interface JunctionLaneLink {
  from: number;
  to: number;
}

export interface Junction {
  id: string;
  name: string;
  connections: JunctionConnection[];
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
  midpoint_enabled: boolean;
  perpendicular_enabled: boolean;
}

export type SnapType = 'None' | 'Grid' | 'Endpoint' | 'Midpoint' | 'Perpendicular';

export interface SnapResult {
  x: number;
  y: number;
  snapped: boolean;
  snap_type: SnapType;
  target_id: string | null;
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

  /** Open a file directly by path when the platform supports it. */
  openFileByPath(path: string): Promise<{ name: string; content: string } | null>;

  /** Save content to a file. */
  saveFile(filename: string, content: string): Promise<void>;

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

  /** Generate vertices for a single road with a custom color. Returns Float32Array of [x,y,z,r,g,b,a] per vertex. */
  generateSingleRoadVertices(road: Road, sampleStep: number, color: [number, number, number, number]): Promise<Float32Array>;

  /** Generate vertices for a single junction with a custom color. Returns Float32Array of [x,y,z,r,g,b,a] per vertex. */
  generateSingleJunctionVertices(project: Project, junctionId: string, color: [number, number, number, number]): Promise<Float32Array>;

  /** Generate junction surface mesh vertices. Returns Float32Array of [x,y,z,r,g,b,a] per vertex. */
  generateJunctionVertices(project: Project): Promise<Float32Array>;

  /** Generate lane boundary line vertices (solid/dashed road markings). Returns Float32Array of [x,y,z,r,g,b,a] per vertex. */
  generateLaneLineVertices(project: Project, sampleStep: number): Promise<Float32Array>;

  /** Generate reference line (centerline) visualization vertices. Returns Float32Array of [x,y,z,r,g,b,a] per vertex. */
  generateCenterLineVertices(project: Project, sampleStep: number): Promise<Float32Array>;

  /** Generate signal paint mark and sign marker vertices. Returns Float32Array of [x,y,z,r,g,b,a] per vertex. */
  generateSignalPaintVertices(project: Project, sampleStep: number): Promise<Float32Array>;

  /** Generate road object vertices (crosswalks, parking spaces, stop lines, guardrails, etc.).
   *  Returns Float32Array of [x,y,z,r,g,b,a] per vertex. */
  generateObjectVertices(project: Project): Promise<Float32Array>;

  /** Find the closest road to a world-space point. Returns road ID or null. */
  pickRoadAtPoint(project: Project, x: number, y: number, threshold: number): Promise<string | null>;

  /** Find the closest junction to a world-space point. Returns junction ID or null. */
  pickJunctionAtPoint(project: Project, x: number, y: number, threshold: number): Promise<string | null>;

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

  /** List built-in road templates for spline-based road generation. */
  getRoadTemplates(): Promise<RoadTemplate[]>;

  /** Create a road from spline and template, returning updated project. */
  createRoadFromSpline(
    project: Project,
    roadId: string,
    spline: EditableSpline,
    templateId: string,
  ): Promise<Project>;

  /** Convert a road's plan_view geometry to an editable spline. */
  roadToSpline(road: Road, sampleStep: number): Promise<EditableSpline>;

  /** Move a spline knot to a new position, recomputing tangents. Returns updated spline. */
  moveSplineKnot(spline: EditableSpline, knotIndex: number, x: number, y: number, z: number): Promise<EditableSpline>;

  /** Convert an editable spline back to OpenDRIVE geometry segments. */
  splineToGeometries(spline: EditableSpline): Promise<Geometry[]>;
}
