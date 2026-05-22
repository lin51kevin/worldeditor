/* tslint:disable */
/* eslint-disable */

/**
 * Add an elevation point to a road and return the modified project.
 */
export function add_elevation_point(project_json: string, road_id: string, s: number, height: number): string;

/**
 * Apply a previously fitted affine transform to a point.
 *
 * `transform_json`: JSON `{ a00, a01, b0, a10, a11, b1 }`.
 * Returns JSON `{ x, y }`.
 */
export function apply_affine_transform(transform_json: string, source_x: number, source_y: number): any;

/**
 * Auto-generate connector roads for every unconnected arm pair in a junction.
 *
 * Returns the updated project as a JSON string.
 * On error, returns a JS Error.
 */
export function auto_build_junction_connectors(project_json: string, junction_id: string): string;

/**
 * Compute the boundary area of a junction from its connecting roads.
 *
 * Returns JSON with `{ id, center, boundary, area }` or null if
 * the junction has insufficient connections.
 */
export function compute_junction_area(project_json: string, junction_id: string): any;

/**
 * Compute total road width (left, right) at a given s position.
 *
 * Returns JSON: `{ "left": number, "right": number }`.
 */
export function compute_road_width(road_json: string, s: number): any;

/**
 * Compute soft selection factors for a given knot.
 *
 * Returns JSON array of `[index, factor]` pairs.
 */
export function compute_soft_selection(spline_json: string, selected_index: number, radius: number, falloff_type: string): string;

/**
 * Create a road from a spline and lane template, returning the modified project.
 *
 * - `spline_json`: JSON representation of EditableSpline
 * - `template_id`: Template ID (e.g., "single", "dual2", "dual4", "dual6")
 * - `road_id`: Unique ID for the new road
 * - `mode`: `"classify"` or `"parampoly3"` (geometry output mode)
 */
export function create_road_from_spline(project_json: string, road_id: string, spline_json: string, template_id: string, mode: string): string;

/**
 * Delete an elevation point from a road and return the modified project.
 */
export function delete_elevation_point(project_json: string, road_id: string, s: number, tolerance: number): string;

/**
 * Convert ECEF coordinates to WGS84 geodetic.
 *
 * Returns JSON `{ lat, lon, alt }` (lat/lon in degrees, alt in metres).
 */
export function ecef_to_geodetic(x: number, y: number, z: number): any;

/**
 * Export the project to Wavefront OBJ text.
 */
export function export_project_to_obj(project_json: string): string;

/**
 * Export the project's roads to CSV text.
 */
export function export_roads_to_csv(project_json: string): string;

/**
 * Export the project's signals to JSON text.
 */
export function export_signals_to_json(project_json: string): string;

/**
 * Export a project as DXF text.
 */
export function export_to_dxf(project_json: string): string;

/**
 * Export the project to HD Map XML format.
 */
export function export_to_hdmap_xml(project_json: string): string;

/**
 * Export a project (as JSON) to Lanelet2 OSM-XML.
 */
export function export_to_lanelet2(project_json: string): string;

/**
 * Export a project as MapInfo MIF text.
 */
export function export_to_mif(project_json: string): string;

/**
 * Export a project as NIO bytes.
 */
export function export_to_nio(project_json: string): Uint8Array;

/**
 * Export a project as a Shapefile bundle.
 */
export function export_to_shapefile(project_json: string): Uint8Array;

/**
 * Fit an affine transform from Ground Control Points (GCPs).
 *
 * `gcps_json`: JSON array of `{ px, py, wx, wy }`.
 * Returns JSON `{ a00, a01, b0, a10, a11, b1 }` where the transform is:
 *   `world_x = a00*px + a01*py + b0`
 *   `world_y = a10*px + a11*py + b1`
 * Returns an error if fewer than 3 GCPs are provided.
 */
export function fit_affine_from_gcps(gcps_json: string): any;

/**
 * Convert GCJ-02 coordinates to WGS84.
 */
export function gcj02_to_wgs84(lat: number, lon: number, alt: number): any;

/**
 * Generate bridge and tunnel overlay vertices from a project JSON.
 *
 * Each vertex is 7 floats: `[x, y, z, r, g, b, a]`.
 * Returns a flat Float32Array containing bridge deck and tunnel enclosure quads.
 */
export function generate_bridge_tunnel_vertices(project_json: string): Float32Array;

/**
 * Generate reference line (centerline) visualization vertices from a project JSON.
 *
 * Each vertex is 7 floats: [x, y, z, r, g, b, a].
 * Draws a thin colored ribbon along each road's reference line:
 * blue for regular roads, orange for roads inside junctions.
 */
export function generate_center_line_vertices(project_json: string, sample_step: number): Float32Array;

/**
 * Generate a default lane section as JSON.
 *
 * Creates symmetric layout with `n_lanes` per side at `lane_width` meters.
 */
export function generate_default_lane_section(s: number, n_lanes_per_side: number, lane_width: number, with_shoulder: boolean): string;

/**
 * Generate junction surface mesh vertices from a project JSON. Returns Float32Array.
 *
 * Each vertex is 7 floats: [x, y, z, r, g, b, a].
 * Junction areas are rendered as semi-transparent lavender polygons.
 */
export function generate_junction_vertices(project_json: string): Float32Array;

/**
 * Generate geometric lane boundary line vertices from a project JSON.
 *
 * Unlike `generate_lane_line_vertices` (which requires `road_marks` data),
 * this function emits a thin ribbon at **every** lane edge boundary based
 * solely on the geometric lane widths. Useful for draw-mode previews where
 * template-based roads have no road_marks populated.
 *
 * Each vertex is 7 floats: [x, y, z, r, g, b, a].
 * Color: dark gray `[0.15, 0.15, 0.15, 0.9]`.
 */
export function generate_lane_boundary_vertices(project_json: string, sample_step: number): Float32Array;

/**
 * Generate lane boundary line vertices from a project JSON. Returns Float32Array.
 *
 * Each vertex is 7 floats: [x, y, z, r, g, b, a].
 * Generates colored road markings (solid/dashed lines) at each lane boundary.
 * Color and dash pattern are driven by each lane's `road_marks` data.
 */
export function generate_lane_line_vertices(project_json: string, sample_step: number): Float32Array;

/**
 * Generate road object vertices from a project JSON. Returns vertex data as Float32Array.
 *
 * Each vertex is 7 floats: [x, y, z, r, g, b, a].
 *
 * Renders the following object types:
 * - `StopLine`: white transverse bar (0.4 m thick) across the road.
 * - `Crosswalk`: navy-blue zebra stripes (0.45 m stripes / 0.6 m gaps) or outline box.
 * - `ParkingSpace`: olive-green boundary polygon.
 * - `CrossHatchArea`: orange boundary polygon.
 * - `WovenArea`: hot-pink boundary polygon.
 * - `ForwardWaitingArea`, `TurnLeftWaitingArea`: white boundary box.
 * - `SlowDownToYieldLine`: sky-blue transverse bar.
 * - `StopToYieldLine`: red transverse bar.
 * - `Guardrail`, `Barrier`: colored thin strip along the road direction.
 * - Other: small colored square marker.
 */
export function generate_object_vertices(project_json: string): Float32Array;

/**
 * Progressive WASM data pipeline (#6): validates that we-core geometry types
 * can be deserialized from JSON, mesh-generated, and returned as JSON vertices.
 * Returns a JSON object with "vertices" (array of [x,y,z,r,g,b,a]) and "count".
 *
 * Input JSON: serialized `we_core::model::Road`.
 * Output JSON: `{ "vertices": [[x,y,z,r,g,b,a], ...], "count": N }`
 */
export function generate_road_mesh_from_json(road_json: string, sample_step: number): string;

/**
 * Generate road mesh vertices from a project JSON. Returns vertex data as Float32Array.
 *
 * Each vertex is 7 floats: [x, y, z, r, g, b, a].
 * `color_mode` controls surface coloring:
 * - `"byLaneType"` (default): per-lane-type palette
 * - `"single"`: uniform asphalt gray for all lanes
 * - `"byRoad"`: distinct hue per road (golden-angle HSV cycling)
 */
export function generate_road_vertices(project_json: string, sample_step: number, color_mode: string): Float32Array;

/**
 * Generate signal paint mark vertices from a project JSON. Returns Float32Array.
 *
 * Each vertex is 7 floats: [x, y, z, r, g, b, a].
 *
 * For `type="Graphics"` signals (road paint arrows), the corresponding arrow
 * polygon is triangulated and placed on the road surface using the signal's
 * s/t position and h_offset heading.
 *
 * For other signal types (vertical signs), a small colored diamond marker is
 * placed at the signal position slightly above the road surface.
 *
 * # TODO: [Phase 3] Rendering enhancement — replace flat diamond markers with sprite-based
 * traffic sign icons (similar to worldeditoronline SpriteSignalRenderer). Currently rendered
 * as colored point markers; sign types are color-coded (green=traffic lights, red=speed limit,
 * yellow=generic). Lane colors already match the reference (verified against RoadTessellator.ts).
 */
export function generate_signal_paint_vertices(project_json: string, _sample_step: number): Float32Array;

/**
 * Generate highlight mesh vertices for a single junction.
 */
export function generate_single_junction_vertices(project_json: string, junction_id: string, r: number, g: number, b: number, a: number): Float32Array;

/**
 * Generate highlight vertices for a single road object.
 *
 * Looks up the object by road_id + object_id, evaluates its world position,
 * and returns a square marker mesh tinted with the given colour.
 * Each vertex is 7 floats: [x, y, z, r, g, b, a].
 */
export function generate_single_object_vertices(project_json: string, road_id: string, object_id: string, r: number, g: number, b: number, a: number): Float32Array;

/**
 * Generate road mesh vertices for a single road. Returns Float32Array.
 *
 * Each vertex is 7 floats: [x, y, z, r, g, b, a].
 * The `color` parameter is [r, g, b, a] in 0..1 range.
 * Used for selection highlight rendering (overrides per-lane colors).
 */
export function generate_single_road_vertices(road_json: string, sample_step: number, r: number, g: number, b: number, a: number): Float32Array;

/**
 * Generate highlight vertices for a single signal.
 *
 * Looks up the signal by road_id + signal_id, evaluates its world position,
 * and returns a diamond marker mesh tinted with the given colour.
 * Each vertex is 7 floats: [x, y, z, r, g, b, a].
 */
export function generate_single_signal_vertices(project_json: string, road_id: string, signal_id: string, r: number, g: number, b: number, a: number): Float32Array;

/**
 * Convert WGS84 geodetic coordinates to an MGRS grid reference string.
 *
 * `precision`: number of digits per easting/northing component (1–5).
 * Returns the MGRS string (e.g. `"50TML1234056780"`) or an error if coordinates
 * are in a polar region (not supported by MGRS).
 */
export function geo_to_mgrs(lat_deg: number, lon_deg: number, precision: number): string;

/**
 * Convert WGS84 to UTM.
 */
export function geo_to_utm(lat: number, lon: number, alt: number): any;

/**
 * Convert WGS84 geodetic coordinates to ECEF (Earth-Centered, Earth-Fixed).
 *
 * Returns JSON `{ x, y, z }` in metres.
 */
export function geodetic_to_ecef(lat_deg: number, lon_deg: number, alt_m: number): any;

/**
 * Return JSON array of junction arms for the given junction.
 *
 * Useful for frontend visualization / debugging.
 */
export function get_junction_arms(project_json: string, junction_id: string): string;

/**
 * Compute the world-space position (x, y) of a road object given its road-local position.
 *
 * Returns JSON `{ "x": f64, "y": f64 }` or null if the road/object is not found.
 */
export function get_object_world_pos(project_json: string, road_id: string, object_id: string): any;

/**
 * Get the position and heading at a road endpoint for tangent inheritance.
 *
 * `contact_point` should be `"Start"` or `"End"`.
 * Returns `{ x, y, hdg }` or null if the road is not found.
 */
export function get_road_endpoint_tangent(project_json: string, road_id: string, contact_point: string): any;

/**
 * List built-in road templates available for spline-based road creation.
 */
export function get_road_templates(): any;

/**
 * Compute the world-space position (x, y) of a signal given its s/t road coordinates.
 *
 * Returns JSON `{ "x": f64, "y": f64 }` or null if the road/signal is not found.
 */
export function get_signal_world_pos(project_json: string, road_id: string, signal_id: string): any;

/**
 * Returns `true` if a project cache has been initialised.
 */
export function has_project_cache(): boolean;

/**
 * Import a DXF string and return the project as JSON.
 */
export function import_from_dxf(dxf: string): any;

/**
 * Import a Lanelet2 OSM-XML string and return the project as JSON.
 */
export function import_from_lanelet2(xml: string): any;

/**
 * Import a MapInfo MIF string and return the project as JSON.
 */
export function import_from_mif(mif: string): any;

/**
 * Import NIO bytes and return the project as JSON.
 */
export function import_from_nio(bytes: Uint8Array): any;

/**
 * Import a Shapefile bundle and return the project as JSON.
 */
export function import_from_shapefile(bytes: Uint8Array): any;

/**
 * Import roads from CSV text.
 *
 * Returns a JSON string representing the imported `Road[]` array.
 */
export function import_roads_from_csv(csv: string, options_json: string): string;

/**
 * Import signals from a JSON string.
 *
 * Returns a JSON string representing the imported `SignalEntry[]` array.
 */
export function import_signals_from_json(json: string): string;

export function init(): void;

/**
 * Mark the spatial index as dirty so it is rebuilt on the next query.
 *
 * Lighter than `set_project_cache` when only the spatial structure changed
 * but the project reference is the same.
 */
export function invalidate_project_cache(): void;

/**
 * Measure the angle at a vertex (p2) formed by p1-p2-p3.
 *
 * Returns JSON `{ radians, degrees }`.
 */
export function measure_angle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): any;

/**
 * Measure the area and perimeter of a polygon.
 *
 * `points_json` is a JSON array of `[x, y]` pairs.
 * Returns JSON `{ area, perimeter }`.
 */
export function measure_area(points_json: string): any;

/**
 * Measure the distance between two 3D points.
 *
 * Returns JSON `{ straight, horizontal, vertical }`.
 */
export function measure_distance(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): any;

/**
 * Measure the arc length along a road between two stations.
 */
export function measure_road_length(road_json: string, s_start: number, s_end: number): number;

/**
 * Move a knot in a spline and return the updated spline as JSON.
 *
 * `spline_json`: the current spline state.
 * `knot_index`: index of the knot to move.
 * `new_x, new_y, new_z`: new position for the knot.
 */
export function move_spline_knot(spline_json: string, knot_index: number, new_x: number, new_y: number, new_z: number): string;

/**
 * Optimize a junction's connections based on actual road topology.
 *
 * Returns the new connections as JSON, or null if the junction was not found.
 */
export function optimize_junction(project_json: string, junction_id: string): any;

/**
 * Parse an OpenDRIVE XML string and return the project as JSON.
 */
export function parse_opendrive(xml: string): any;

/**
 * Parse a Proj4 CRS string and return a JSON object with key-value pairs.
 *
 * Example input: `"+proj=utm +zone=50 +datum=WGS84 +units=m"`
 * Returns JSON object like `{ "proj": "utm", "zone": "50", "datum": "WGS84", "units": "m" }`.
 */
export function parse_proj4_crs(proj4_str: string): any;

/**
 * Parse a WKT (Well-Known Text) CRS string and return metadata as JSON.
 *
 * Returns JSON `{ crs_type, name, epsg }` where `epsg` may be null.
 */
export function parse_wkt_crs(wkt_str: string): any;

/**
 * Find the closest junction to a world-space point.
 */
export function pick_junction_at_point(project_json: string, x: number, y: number, threshold: number): any;

/**
 * Pick the nearest junction using the cached project.
 */
export function pick_junction_at_point_cached(x: number, y: number, threshold: number): any;

/**
 * Pick the nearest lane using the cached project + spatial index.
 *
 * Returns JSON `{ "roadId": string, "sectionIndex": number, "laneId": number }` or null.
 */
export function pick_lane_at_point_cached(x: number, y: number, threshold: number): any;

/**
 * Pick the closest road object to a world-space point.
 *
 * Returns JSON `{ "roadId": string, "objectId": string }` or null.
 */
export function pick_object_at_point(project_json: string, x: number, y: number, threshold: number): any;

/**
 * Pick the nearest road object using the cached project + spatial index.
 *
 * Returns `{ roadId, objectId }` or null. No JSON serialisation per call.
 */
export function pick_object_at_point_cached(x: number, y: number, threshold: number): any;

/**
 * Find the closest road to a world-space point.
 *
 * Returns the road ID as a string, or null if no road is within the threshold.
 * Hit-testing uses the full road surface width (sum of all lane widths), not just
 * the reference line centre.
 */
export function pick_road_at_point(project_json: string, x: number, y: number, threshold: number): any;

/**
 * Pick the nearest road using the cached project + spatial index.
 *
 * Falls back to the uncached path if no cache has been set.
 */
export function pick_road_at_point_cached(x: number, y: number, threshold: number): any;

/**
 * Pick the closest signal to a world-space point.
 *
 * Returns JSON `{ "roadId": string, "signalId": string }` or null.
 */
export function pick_signal_at_point(project_json: string, x: number, y: number, threshold: number): any;

/**
 * Pick the nearest signal using the cached project + spatial index.
 *
 * Returns `{ roadId, signalId }` or null. No JSON serialisation per call.
 */
export function pick_signal_at_point_cached(x: number, y: number, threshold: number): any;

/**
 * Pick the closest knot to a point.
 *
 * Returns JSON: `{ "index": number, "distance": number }` or `null` if none within threshold.
 */
export function pick_spline_knot(spline_json: string, x: number, y: number, threshold: number): any;

/**
 * Test if a point is inside a junction's computed area.
 */
export function point_in_junction(project_json: string, junction_id: string, x: number, y: number): boolean;

/**
 * Return true if a project (JSON) passes all validation checks (no errors, warnings allowed).
 */
export function project_is_valid(project_json: string): boolean;

/**
 * Query the elevation and grade at a station on a road.
 *
 * Returns JSON `{ elevation, grade, grade_pct }`.
 */
export function query_elevation(road_json: string, s: number): any;

/**
 * Repair topology issues in a project and return the repaired project JSON
 * along with a list of actions taken.
 *
 * Returns `{ project: string, actions: string[] }`.
 */
export function repair_topology(project_json: string): any;

/**
 * Convert a road (as JSON) to an editable spline (as JSON).
 *
 * `sample_step`: distance between intermediate sample points (0 = no intermediates).
 */
export function road_to_spline(road_json: string, sample_step: number): string;

/**
 * Rotate a road around a pivot point and return the modified project JSON.
 */
export function rotate_road(project_json: string, road_id: string, pivot_x: number, pivot_y: number, angle_rad: number): string;

/**
 * Sample a lane boundary polyline as JSON.
 *
 * Returns JSON array of `{ x, y, z, s, t }` points.
 */
export function sample_lane_boundary(road_json: string, section_s: number, lane_id: number, step: number): string;

/**
 * Store (or replace) the cached project used by `pick_road_cached` / `snap_point_cached`.
 *
 * Call this once after every project mutation. Subsequent pick/snap calls will
 * reuse the parsed project and its spatial index without re-parsing JSON.
 */
export function set_project_cache(project_json: string): void;

/**
 * Smooth a road's elevation profile.
 */
export function smooth_elevation(project_json: string, road_id: string, iterations: number): string;

/**
 * Snap a point to the nearest grid/endpoint/etc.
 *
 * Returns JSON `{ x, y, snapped, snap_type, target_id }`.
 */
export function snap_point(project_json: string, x: number, y: number, config_json: string, exclude_road_id?: string | null): any;

/**
 * Snap a point using the cached project + spatial index.
 *
 * Falls back to the uncached path if no cache has been set.
 */
export function snap_point_cached(x: number, y: number, config_json: string, exclude_road_id?: string | null): any;

/**
 * Project a world-space point onto a road's reference line, returning road-local
 * coordinates `{ s, t, hdg }` at the closest point.
 *
 * - `s`: arc-length station along the road reference line (metres from road start)
 * - `t`: signed lateral offset from the reference line (positive = left)
 * - `hdg`: road heading at that station (radians)
 *
 * Used by the viewport after picking a road via `pick_road_at_point` to convert
 * the world click position into correct road-local s/t for placing signals and objects.
 */
export function snap_point_on_road(road_json: string, world_x: number, world_y: number): any;

/**
 * Query elements near a point using a spatial index.
 *
 * Returns JSON array of `{ id, kind, aabb }`.
 */
export function spatial_query_point(project_json: string, x: number, y: number, radius: number): any;

/**
 * Convert an editable spline (as JSON) back to OpenDRIVE geometry segments (as JSON).
 *
 * `mode`: `"classify"` (default — picks optimal geometry types) or
 *         `"parampoly3"` (always emit ParamPoly3, except straight Lines).
 */
export function spline_to_geometries(spline_json: string, mode: string): string;

/**
 * Translate a road by (dx, dy, dz) and return the modified project JSON.
 */
export function translate_road(project_json: string, road_id: string, dx: number, dy: number, dz: number): string;

/**
 * Convert UTM to WGS84.
 */
export function utm_to_geo(easting: number, northing: number, zone: number, is_northern: boolean, alt: number): any;

/**
 * Validate a project (JSON) using the built-in OpenDRIVE validator.
 *
 * Returns a JSON array of issues, each with:
 * - `code`: e.g. `"E001"`, `"W001"`
 * - `severity`: `"error"` | `"warning"`
 * - `message`: human-readable description
 * - `road_id`: the affected road ID (may be null for project-level issues)
 */
export function validate_project(project_json: string): any;

/**
 * Validate the topology of a project and return a JSON report.
 *
 * The report contains issues with severity, kind, message, and element_id.
 */
export function validate_topology(project_json: string): any;

/**
 * Get the core library version.
 */
export function version(): string;

/**
 * Convert WGS84 coordinates to GCJ-02.
 */
export function wgs84_to_gcj02(lat: number, lon: number, alt: number): any;

/**
 * Serialize a project (as JSON) to OpenDRIVE XML.
 */
export function write_opendrive(project_json: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly add_elevation_point: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly apply_affine_transform: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly auto_build_junction_connectors: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly compute_junction_area: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly compute_road_width: (a: number, b: number, c: number) => [number, number, number];
    readonly compute_soft_selection: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly create_road_from_spline: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number, number];
    readonly delete_elevation_point: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly ecef_to_geodetic: (a: number, b: number, c: number) => [number, number, number];
    readonly export_project_to_obj: (a: number, b: number) => [number, number, number, number];
    readonly export_roads_to_csv: (a: number, b: number) => [number, number, number, number];
    readonly export_signals_to_json: (a: number, b: number) => [number, number, number, number];
    readonly export_to_dxf: (a: number, b: number) => [number, number, number, number];
    readonly export_to_hdmap_xml: (a: number, b: number) => [number, number, number, number];
    readonly export_to_lanelet2: (a: number, b: number) => [number, number, number, number];
    readonly export_to_mif: (a: number, b: number) => [number, number, number, number];
    readonly export_to_nio: (a: number, b: number) => [number, number, number, number];
    readonly export_to_shapefile: (a: number, b: number) => [number, number, number, number];
    readonly fit_affine_from_gcps: (a: number, b: number) => [number, number, number];
    readonly gcj02_to_wgs84: (a: number, b: number, c: number) => any;
    readonly generate_bridge_tunnel_vertices: (a: number, b: number) => [number, number, number, number];
    readonly generate_center_line_vertices: (a: number, b: number, c: number) => [number, number, number, number];
    readonly generate_default_lane_section: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly generate_junction_vertices: (a: number, b: number) => [number, number, number, number];
    readonly generate_lane_boundary_vertices: (a: number, b: number, c: number) => [number, number, number, number];
    readonly generate_lane_line_vertices: (a: number, b: number, c: number) => [number, number, number, number];
    readonly generate_object_vertices: (a: number, b: number) => [number, number, number, number];
    readonly generate_road_mesh_from_json: (a: number, b: number, c: number) => [number, number, number, number];
    readonly generate_road_vertices: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly generate_signal_paint_vertices: (a: number, b: number, c: number) => [number, number, number, number];
    readonly generate_single_junction_vertices: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly generate_single_object_vertices: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number, number];
    readonly generate_single_road_vertices: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly generate_single_signal_vertices: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number, number];
    readonly geo_to_mgrs: (a: number, b: number, c: number) => [number, number, number, number];
    readonly geo_to_utm: (a: number, b: number, c: number) => any;
    readonly geodetic_to_ecef: (a: number, b: number, c: number) => [number, number, number];
    readonly get_junction_arms: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly get_object_world_pos: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly get_road_endpoint_tangent: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly get_road_templates: () => [number, number, number];
    readonly get_signal_world_pos: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly has_project_cache: () => number;
    readonly import_from_dxf: (a: number, b: number) => [number, number, number];
    readonly import_from_lanelet2: (a: number, b: number) => [number, number, number];
    readonly import_from_mif: (a: number, b: number) => [number, number, number];
    readonly import_from_nio: (a: number, b: number) => [number, number, number];
    readonly import_from_shapefile: (a: number, b: number) => [number, number, number];
    readonly import_roads_from_csv: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly import_signals_from_json: (a: number, b: number) => [number, number, number, number];
    readonly init: () => void;
    readonly invalidate_project_cache: () => void;
    readonly measure_angle: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly measure_area: (a: number, b: number) => [number, number, number];
    readonly measure_distance: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly measure_road_length: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly move_spline_knot: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly optimize_junction: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly parse_opendrive: (a: number, b: number) => [number, number, number];
    readonly parse_proj4_crs: (a: number, b: number) => [number, number, number];
    readonly parse_wkt_crs: (a: number, b: number) => [number, number, number];
    readonly pick_junction_at_point: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly pick_junction_at_point_cached: (a: number, b: number, c: number) => [number, number, number];
    readonly pick_lane_at_point_cached: (a: number, b: number, c: number) => [number, number, number];
    readonly pick_object_at_point: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly pick_road_at_point: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly pick_road_at_point_cached: (a: number, b: number, c: number) => [number, number, number];
    readonly pick_signal_at_point: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly pick_spline_knot: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly point_in_junction: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly project_is_valid: (a: number, b: number) => [number, number, number];
    readonly query_elevation: (a: number, b: number, c: number) => [number, number, number];
    readonly repair_topology: (a: number, b: number) => [number, number, number];
    readonly road_to_spline: (a: number, b: number, c: number) => [number, number, number, number];
    readonly rotate_road: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly sample_lane_boundary: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly set_project_cache: (a: number, b: number) => [number, number];
    readonly smooth_elevation: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly snap_point: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly snap_point_cached: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly snap_point_on_road: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly spatial_query_point: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly spline_to_geometries: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly translate_road: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly utm_to_geo: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly validate_project: (a: number, b: number) => [number, number, number];
    readonly validate_topology: (a: number, b: number) => [number, number, number];
    readonly version: () => [number, number];
    readonly wgs84_to_gcj02: (a: number, b: number, c: number) => any;
    readonly write_opendrive: (a: number, b: number) => [number, number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
