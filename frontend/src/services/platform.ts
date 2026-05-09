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

export interface Road {
  id: string;
  name: string;
  length: number;
  junction_id: string | null;
  render_hidden?: boolean;
  link: RoadLink;
  plan_view: Geometry[];
  elevation_profile: Elevation[];
  lane_sections: LaneSection[];
  /** Signals parsed from `<signals>` block. May be absent in older projects. */
  signals?: Signal[];
}

export interface Signal {
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
}

export interface Lane {
  id: number;
  lane_type: string;
  level: boolean;
  render_hidden?: boolean;
  link: LaneLink;
  width: LaneWidth[];
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

export interface PlatformService {
  /** Parse an OpenDRIVE XML string into a Project. */
  parseOpenDrive(xml: string): Promise<Project>;

  /** Serialize a Project to OpenDRIVE XML. */
  writeOpenDrive(project: Project): Promise<string>;

  /** Open a file picker and return the file contents. */
  openFile(): Promise<{ name: string; content: string } | null>;

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
  generateRoadVertices(project: Project, sampleStep: number): Promise<Float32Array>;

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

  /** Find the closest road to a world-space point. Returns road ID or null. */
  pickRoadAtPoint(project: Project, x: number, y: number, threshold: number): Promise<string | null>;

  /** Find the closest junction to a world-space point. Returns junction ID or null. */
  pickJunctionAtPoint(project: Project, x: number, y: number, threshold: number): Promise<string | null>;
}
