//! WorldEditor WASM entry point.
//!
//! Exports we-core + we-service functions to JavaScript via wasm-bindgen.

use wasm_bindgen::prelude::*;

// Set up better panic messages in the browser console.
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
    console_log::init_with_level(log::Level::Info).unwrap_or(());
    log::info!("WorldEditor WASM initialized (v{})", we_core::VERSION);
}

/// Parse an OpenDRIVE XML string and return the project as JSON.
#[wasm_bindgen]
pub fn parse_opendrive(xml: &str) -> Result<JsValue, JsError> {
    let project = we_core::opendrive::parse_xodr(xml).map_err(|e| JsError::new(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&project).map_err(|e| JsError::new(&e.to_string()))
}

/// Serialize a project (as JSON) to OpenDRIVE XML.
#[wasm_bindgen]
pub fn write_opendrive(project_json: &str) -> Result<String, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    we_core::opendrive::write_xodr(&project).map_err(|e| JsError::new(&e.to_string()))
}

/// Get the core library version.
#[wasm_bindgen]
pub fn version() -> String {
    we_core::VERSION.to_string()
}

/// Convert WGS84 coordinates to GCJ-02.
#[wasm_bindgen]
pub fn wgs84_to_gcj02(lat: f64, lon: f64, alt: f64) -> JsValue {
    let coord = we_core::gis::GeoCoord::new(lat, lon, alt);
    let result = we_core::gis::wgs84_to_gcj02(&coord);
    serde_wasm_bindgen::to_value(&serde_json::json!({
        "lat": result.lat, "lon": result.lon, "alt": result.alt
    }))
    .unwrap_or(JsValue::NULL)
}

/// Convert GCJ-02 coordinates to WGS84.
#[wasm_bindgen]
pub fn gcj02_to_wgs84(lat: f64, lon: f64, alt: f64) -> JsValue {
    let coord = we_core::gis::GeoCoord::new(lat, lon, alt);
    let result = we_core::gis::gcj02_to_wgs84(&coord);
    serde_wasm_bindgen::to_value(&serde_json::json!({
        "lat": result.lat, "lon": result.lon, "alt": result.alt
    }))
    .unwrap_or(JsValue::NULL)
}

/// Convert WGS84 to UTM.
#[wasm_bindgen]
pub fn geo_to_utm(lat: f64, lon: f64, alt: f64) -> JsValue {
    let coord = we_core::gis::GeoCoord::new(lat, lon, alt);
    let utm = we_core::gis::geo_to_utm(&coord);
    serde_wasm_bindgen::to_value(&serde_json::json!({
        "easting": utm.easting,
        "northing": utm.northing,
        "zone": utm.zone,
        "is_northern": utm.is_northern,
        "alt": utm.alt,
    }))
    .unwrap_or(JsValue::NULL)
}

/// Convert UTM to WGS84.
#[wasm_bindgen]
pub fn utm_to_geo(easting: f64, northing: f64, zone: u8, is_northern: bool, alt: f64) -> JsValue {
    let utm = we_core::gis::UtmCoord::new(easting, northing, zone, is_northern, alt);
    let coord = we_core::gis::utm_to_geo(&utm);
    serde_wasm_bindgen::to_value(&serde_json::json!({
        "lat": coord.lat, "lon": coord.lon, "alt": coord.alt
    }))
    .unwrap_or(JsValue::NULL)
}

/// Generate road mesh vertices from a project JSON. Returns vertex data as Float32Array.
///
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
/// Road surfaces are colored per lane type (Driving, Sidewalk, Parking, etc.).
/// Falls back to a plain gray ribbon if no lane sections are defined.
#[wasm_bindgen]
pub fn generate_road_vertices(project_json: &str, sample_step: f64) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::{evaluate_elevation, evaluate_lane_width, offset_point, sample_road_reference_line};
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut all_floats = Vec::new();

    for road in &project.roads {
        let ref_pts = sample_road_reference_line(road, sample_step);
        if ref_pts.len() < 2 {
            continue;
        }

        let mut road_verts: Vec<[f32; 7]> = Vec::new();

        for section in &road.lane_sections {
            let section_end_s = road
                .lane_sections
                .iter()
                .find(|ls| ls.s > section.s + 1e-9)
                .map(|ls| ls.s)
                .unwrap_or(road.length);

            let section_pts: Vec<_> = ref_pts
                .iter()
                .filter(|p| p.s >= section.s - 1e-9 && p.s <= section_end_s + 1e-9)
                .collect();

            if section_pts.len() < 2 {
                continue;
            }

            // Right lanes (negative IDs, inner to outer)
            let mut right_sorted: Vec<_> = section.right.iter().collect();
            right_sorted.sort_by_key(|l| l.id.abs());
            let mut right_offset = 0.0f64;
            for lane in &right_sorted {
                let color = lane_surface_color(lane.lane_type);
                road_verts.extend(gen_lane_strip(
                    &section_pts, &lane.width, section.s,
                    &road.elevation_profile, right_offset, false, color,
                    &evaluate_elevation, &evaluate_lane_width, &offset_point,
                ));
                right_offset += avg_lane_width(&lane.width, &evaluate_lane_width);
            }

            // Left lanes (positive IDs, inner to outer)
            let mut left_sorted: Vec<_> = section.left.iter().collect();
            left_sorted.sort_by_key(|l| l.id);
            let mut left_offset = 0.0f64;
            for lane in &left_sorted {
                let color = lane_surface_color(lane.lane_type);
                road_verts.extend(gen_lane_strip(
                    &section_pts, &lane.width, section.s,
                    &road.elevation_profile, left_offset, true, color,
                    &evaluate_elevation, &evaluate_lane_width, &offset_point,
                ));
                left_offset += avg_lane_width(&lane.width, &evaluate_lane_width);
            }
        }

        // Fall back to default gray ribbon when no lane sections are defined
        if road_verts.is_empty() {
            road_verts.extend(gen_default_ribbon(
                &ref_pts, &road.elevation_profile, 3.5, [0.35, 0.35, 0.38, 1.0],
            ));
        }

        for v in &road_verts {
            all_floats.extend_from_slice(v);
        }
    }

    Ok(all_floats)
}

/// Generate junction surface mesh vertices from a project JSON. Returns Float32Array.
///
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
/// Junction areas are rendered as semi-transparent lavender polygons.
#[wasm_bindgen]
pub fn generate_junction_vertices(project_json: &str) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::evaluate_elevation;
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut all_floats = Vec::new();
    let color = [0.88f32, 0.85, 0.98, 0.4];
    let z_offset = -0.1f32;

    for junction in &project.junctions {
        if junction.connections.is_empty() {
            continue;
        }

        let mut points: Vec<[f32; 3]> = Vec::new();

        for conn in &junction.connections {
            if let Some(road) = project.roads.iter().find(|r| r.id == conn.incoming_road) {
                if let Some(geo) = road.plan_view.first() {
                    let z = evaluate_elevation(&road.elevation_profile, 0.0) as f32 + z_offset;
                    points.push([geo.x as f32, geo.y as f32, z]);
                }
            }
            if let Some(road) = project.roads.iter().find(|r| r.id == conn.connecting_road) {
                if let Some(geo) = road.plan_view.last() {
                    let end_s = geo.s + geo.length;
                    let z = evaluate_elevation(&road.elevation_profile, end_s) as f32 + z_offset;
                    let dx = geo.length as f32 * geo.hdg.cos() as f32;
                    let dy = geo.length as f32 * geo.hdg.sin() as f32;
                    points.push([geo.x as f32 + dx, geo.y as f32 + dy, z]);
                }
            }
        }

        if points.len() < 3 {
            continue;
        }

        let n = points.len() as f32;
        let cx: f32 = points.iter().map(|p| p[0]).sum::<f32>() / n;
        let cy: f32 = points.iter().map(|p| p[1]).sum::<f32>() / n;
        let cz: f32 = points.iter().map(|p| p[2]).sum::<f32>() / n;
        let [r, g, b, a] = color;

        for i in 0..points.len() {
            let j = (i + 1) % points.len();
            all_floats.extend_from_slice(&[cx, cy, cz, r, g, b, a]);
            all_floats.extend_from_slice(&[
                points[i][0], points[i][1], points[i][2], r, g, b, a,
            ]);
            all_floats.extend_from_slice(&[
                points[j][0], points[j][1], points[j][2], r, g, b, a,
            ]);
        }
    }

    Ok(all_floats)
}

/// Generate lane boundary line vertices from a project JSON. Returns Float32Array.
///
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
/// Generates colored road markings (solid/dashed lines) at each lane boundary.
/// Color and dash pattern are driven by each lane's `road_marks` data.
#[wasm_bindgen]
pub fn generate_lane_line_vertices(
    project_json: &str,
    sample_step: f64,
) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::{evaluate_elevation, evaluate_lane_width, offset_point, sample_road_reference_line};
    use we_core::model::{Project, RoadMarkType};

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut all_floats = Vec::new();

    for road in &project.roads {
        let ref_pts = sample_road_reference_line(road, sample_step);
        if ref_pts.len() < 2 {
            continue;
        }

        for section in &road.lane_sections {
            let section_end_s = road
                .lane_sections
                .iter()
                .find(|ls| ls.s > section.s + 1e-9)
                .map(|ls| ls.s)
                .unwrap_or(road.length);

            let section_pts: Vec<_> = ref_pts
                .iter()
                .filter(|p| p.s >= section.s - 1e-9 && p.s <= section_end_s + 1e-9)
                .collect();

            if section_pts.len() < 2 {
                continue;
            }

            // Center lane road mark at offset 0 (the center dividing line)
            if let Some(center_lane) = section.center.first() {
                if let Some(rm) = center_lane.road_marks.first() {
                    if rm.mark_type != RoadMarkType::None {
                        let lc = mark_color(rm.color);
                        let lw = if rm.width > 0.0 { rm.width as f32 } else { 0.15 };
                        let dashed = is_dashed(rm.mark_type);
                        let verts = gen_road_mark_line(
                            &section_pts, &road.elevation_profile,
                            0.0, lw, lc, dashed,
                            &evaluate_elevation, &offset_point,
                        );
                        for v in &verts { all_floats.extend_from_slice(v); }
                    }
                }
            }

            // Right lane outer boundaries (inner → outer, accumulating offset)
            let mut right_sorted: Vec<_> = section.right.iter().collect();
            right_sorted.sort_by_key(|l| l.id.abs());
            let mut right_offset = 0.0f64;
            for lane in &right_sorted {
                right_offset += avg_lane_width(&lane.width, &evaluate_lane_width);
                if let Some(rm) = lane.road_marks.first() {
                    if rm.mark_type != RoadMarkType::None {
                        let lc = mark_color(rm.color);
                        let lw = if rm.width > 0.0 { rm.width as f32 } else { 0.15 };
                        let dashed = is_dashed(rm.mark_type);
                        let verts = gen_road_mark_line(
                            &section_pts, &road.elevation_profile,
                            -right_offset, lw, lc, dashed,
                            &evaluate_elevation, &offset_point,
                        );
                        for v in &verts { all_floats.extend_from_slice(v); }
                    }
                }
            }

            // Left lane outer boundaries
            let mut left_sorted: Vec<_> = section.left.iter().collect();
            left_sorted.sort_by_key(|l| l.id);
            let mut left_offset = 0.0f64;
            for lane in &left_sorted {
                left_offset += avg_lane_width(&lane.width, &evaluate_lane_width);
                if let Some(rm) = lane.road_marks.first() {
                    if rm.mark_type != RoadMarkType::None {
                        let lc = mark_color(rm.color);
                        let lw = if rm.width > 0.0 { rm.width as f32 } else { 0.15 };
                        let dashed = is_dashed(rm.mark_type);
                        let verts = gen_road_mark_line(
                            &section_pts, &road.elevation_profile,
                            left_offset, lw, lc, dashed,
                            &evaluate_elevation, &offset_point,
                        );
                        for v in &verts { all_floats.extend_from_slice(v); }
                    }
                }
            }
        }
    }

    Ok(all_floats)
}

/// Generate reference line (centerline) visualization vertices from a project JSON.
///
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
/// Draws a thin colored ribbon along each road's reference line:
/// blue for regular roads, orange for roads inside junctions.
#[wasm_bindgen]
pub fn generate_center_line_vertices(
    project_json: &str,
    sample_step: f64,
) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::{evaluate_elevation, offset_point, sample_road_reference_line};
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut all_floats = Vec::new();
    let line_half_w = 0.10f64; // 0.2m wide ribbon
    let z_lift = 0.02f32;

    for road in &project.roads {
        let ref_pts = sample_road_reference_line(road, sample_step);
        if ref_pts.len() < 2 {
            continue;
        }

        // Orange for connecting roads inside a junction, blue for normal roads
        let [r, g, b, a]: [f32; 4] = if road.junction_id.is_some() {
            [1.0, 0.6, 0.0, 0.85]
        } else {
            [0.0, 0.5, 1.0, 0.85]
        };

        for i in 0..ref_pts.len() - 1 {
            let pt0 = &ref_pts[i];
            let pt1 = &ref_pts[i + 1];

            let z0 = evaluate_elevation(&road.elevation_profile, pt0.s) as f32 + z_lift;
            let z1 = evaluate_elevation(&road.elevation_profile, pt1.s) as f32 + z_lift;

            let (lx0, ly0, _) = offset_point(pt0, line_half_w, 0.0);
            let (rx0, ry0, _) = offset_point(pt0, -line_half_w, 0.0);
            let (lx1, ly1, _) = offset_point(pt1, line_half_w, 0.0);
            let (rx1, ry1, _) = offset_point(pt1, -line_half_w, 0.0);

            all_floats.extend_from_slice(&[lx0 as f32, ly0 as f32, z0, r, g, b, a]);
            all_floats.extend_from_slice(&[rx0 as f32, ry0 as f32, z0, r, g, b, a]);
            all_floats.extend_from_slice(&[lx1 as f32, ly1 as f32, z1, r, g, b, a]);
            all_floats.extend_from_slice(&[rx0 as f32, ry0 as f32, z0, r, g, b, a]);
            all_floats.extend_from_slice(&[rx1 as f32, ry1 as f32, z1, r, g, b, a]);
            all_floats.extend_from_slice(&[lx1 as f32, ly1 as f32, z1, r, g, b, a]);
        }
    }

    Ok(all_floats)
}

/// Generate road mesh vertices for a single road. Returns Float32Array.
///
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
/// The `color` parameter is [r, g, b, a] in 0..1 range.
/// Used for selection highlight rendering (overrides per-lane colors).
#[wasm_bindgen]
pub fn generate_single_road_vertices(
    road_json: &str,
    sample_step: f64,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::sample_road_reference_line;

    let road: we_core::model::Road =
        serde_json::from_str(road_json).map_err(|e| JsError::new(&e.to_string()))?;

    let ref_pts = sample_road_reference_line(&road, sample_step);
    let mesh_verts = gen_default_ribbon(&ref_pts, &road.elevation_profile, 3.5, [r, g, b, a]);

    let mut floats = Vec::with_capacity(mesh_verts.len() * 7);
    for v in &mesh_verts {
        floats.extend_from_slice(v);
    }
    Ok(floats)
}

// ── Geometry helpers (no wgpu dependency) ────────────────────────────────────

/// Lane surface color by lane type (RGBA).
fn lane_surface_color(lane_type: we_core::model::LaneType) -> [f32; 4] {
    use we_core::model::LaneType;
    match lane_type {
        LaneType::Driving => [0.35, 0.35, 0.38, 1.0],
        LaneType::Shoulder => [0.30, 0.30, 0.28, 1.0],
        LaneType::Sidewalk => [0.55, 0.55, 0.50, 1.0],
        LaneType::Median => [0.20, 0.35, 0.20, 1.0],
        LaneType::Border => [0.25, 0.25, 0.25, 1.0],
        LaneType::Parking => [0.40, 0.45, 0.55, 1.0],
        LaneType::Biking => [0.35, 0.55, 0.35, 1.0],
        _ => [0.40, 0.40, 0.35, 1.0],
    }
}

/// Road mark color by mark color enum (RGBA).
fn mark_color(color: we_core::model::RoadMarkColor) -> [f32; 4] {
    use we_core::model::RoadMarkColor;
    match color {
        RoadMarkColor::Yellow => [1.0, 0.9, 0.0, 1.0],
        RoadMarkColor::Red => [0.9, 0.1, 0.1, 1.0],
        RoadMarkColor::Blue => [0.1, 0.4, 0.9, 1.0],
        RoadMarkColor::Green => [0.1, 0.8, 0.1, 1.0],
        _ => [1.0, 1.0, 1.0, 1.0], // Standard / White
    }
}

/// Whether a road mark type should be rendered as a dashed line.
fn is_dashed(t: we_core::model::RoadMarkType) -> bool {
    use we_core::model::RoadMarkType;
    matches!(t, RoadMarkType::Broken | RoadMarkType::SolidBroken | RoadMarkType::BrokenSolid)
}

/// Average lane width sampled at 10 points (for offset accumulation).
fn avg_lane_width(
    widths: &[we_core::model::LaneWidth],
    eval: &dyn Fn(&[we_core::model::LaneWidth], f64) -> f64,
) -> f64 {
    if widths.is_empty() {
        return 0.0;
    }
    const N: usize = 10;
    let s_max = 100.0f64;
    let mut sum = 0.0f64;
    for i in 0..N {
        let s = s_max * (i as f64) / (N as f64 - 1.0);
        sum += eval(widths, s);
    }
    sum / N as f64
}

/// Generate a colored triangle strip for one lane.
fn gen_lane_strip(
    ref_pts: &[&we_core::geometry::eval::RefLinePoint],
    widths: &[we_core::model::LaneWidth],
    section_s: f64,
    elevations: &[we_core::model::Elevation],
    inner_offset: f64,
    is_left: bool,
    color: [f32; 4],
    eval_elev: &dyn Fn(&[we_core::model::Elevation], f64) -> f64,
    eval_width: &dyn Fn(&[we_core::model::LaneWidth], f64) -> f64,
    offset_pt: &dyn Fn(&we_core::geometry::eval::RefLinePoint, f64, f64) -> (f64, f64, f64),
) -> Vec<[f32; 7]> {
    let mut verts = Vec::new();
    let [r, g, b, a] = color;

    for i in 0..ref_pts.len() - 1 {
        let pt0 = ref_pts[i];
        let pt1 = ref_pts[i + 1];

        let ds0 = (pt0.s - section_s).max(0.0);
        let ds1 = (pt1.s - section_s).max(0.0);

        let w0 = eval_width(widths, ds0);
        let w1 = eval_width(widths, ds1);
        if w0 <= 0.0 && w1 <= 0.0 {
            continue;
        }

        let z0 = eval_elev(elevations, pt0.s) as f32;
        let z1 = eval_elev(elevations, pt1.s) as f32;

        let (in0, out0) = if is_left {
            (inner_offset, inner_offset + w0)
        } else {
            (-inner_offset, -(inner_offset + w0))
        };
        let (in1, out1) = if is_left {
            (inner_offset, inner_offset + w1)
        } else {
            (-inner_offset, -(inner_offset + w1))
        };

        let (ix0, iy0, _) = offset_pt(pt0, in0, 0.0);
        let (ox0, oy0, _) = offset_pt(pt0, out0, 0.0);
        let (ix1, iy1, _) = offset_pt(pt1, in1, 0.0);
        let (ox1, oy1, _) = offset_pt(pt1, out1, 0.0);

        verts.push([ix0 as f32, iy0 as f32, z0, r, g, b, a]);
        verts.push([ox0 as f32, oy0 as f32, z0, r, g, b, a]);
        verts.push([ix1 as f32, iy1 as f32, z1, r, g, b, a]);
        verts.push([ox0 as f32, oy0 as f32, z0, r, g, b, a]);
        verts.push([ox1 as f32, oy1 as f32, z1, r, g, b, a]);
        verts.push([ix1 as f32, iy1 as f32, z1, r, g, b, a]);
    }

    verts
}

/// Generate a default ribbon when no lane section data is available.
fn gen_default_ribbon(
    ref_pts: &[we_core::geometry::eval::RefLinePoint],
    elevations: &[we_core::model::Elevation],
    half_width: f64,
    color: [f32; 4],
) -> Vec<[f32; 7]> {
    use we_core::geometry::eval::{evaluate_elevation, offset_point};

    let mut verts = Vec::new();
    let [r, g, b, a] = color;

    for i in 0..ref_pts.len() - 1 {
        let pt0 = &ref_pts[i];
        let pt1 = &ref_pts[i + 1];

        let z0 = evaluate_elevation(elevations, pt0.s) as f32;
        let z1 = evaluate_elevation(elevations, pt1.s) as f32;

        let (lx0, ly0, _) = offset_point(pt0, half_width, 0.0);
        let (rx0, ry0, _) = offset_point(pt0, -half_width, 0.0);
        let (lx1, ly1, _) = offset_point(pt1, half_width, 0.0);
        let (rx1, ry1, _) = offset_point(pt1, -half_width, 0.0);

        verts.push([lx0 as f32, ly0 as f32, z0, r, g, b, a]);
        verts.push([rx0 as f32, ry0 as f32, z0, r, g, b, a]);
        verts.push([lx1 as f32, ly1 as f32, z1, r, g, b, a]);
        verts.push([rx0 as f32, ry0 as f32, z0, r, g, b, a]);
        verts.push([rx1 as f32, ry1 as f32, z1, r, g, b, a]);
        verts.push([lx1 as f32, ly1 as f32, z1, r, g, b, a]);
    }

    verts
}

/// Generate a road marking line as a thin triangle strip at a lateral offset.
///
/// For dashed marks, segments are skipped every `dash_len + gap_len` meters.
fn gen_road_mark_line(
    ref_pts: &[&we_core::geometry::eval::RefLinePoint],
    elevations: &[we_core::model::Elevation],
    lateral_offset: f64,
    line_width: f32,
    color: [f32; 4],
    is_dashed: bool,
    eval_elev: &dyn Fn(&[we_core::model::Elevation], f64) -> f64,
    offset_pt: &dyn Fn(&we_core::geometry::eval::RefLinePoint, f64, f64) -> (f64, f64, f64),
) -> Vec<[f32; 7]> {
    let mut verts = Vec::new();
    let z_lift = 0.01f32;
    let half_w = (line_width * 0.5) as f64;
    let dash_len = 3.0f64;
    let cycle = 6.0f64; // dash + gap
    let [r, g, b, a] = color;

    for i in 0..ref_pts.len() - 1 {
        let pt0 = ref_pts[i];
        let pt1 = ref_pts[i + 1];

        if is_dashed {
            let phase = ((pt0.s + pt1.s) / 2.0) % cycle;
            if phase > dash_len {
                continue;
            }
        }

        let z0 = eval_elev(elevations, pt0.s) as f32 + z_lift;
        let z1 = eval_elev(elevations, pt1.s) as f32 + z_lift;

        // Center points at lateral_offset, then expand ±half_w using reference heading
        let (cx0, cy0, _) = offset_pt(pt0, lateral_offset, 0.0);
        let (cx1, cy1, _) = offset_pt(pt1, lateral_offset, 0.0);
        let (lx0, ly0, _) = offset_pt(pt0, lateral_offset + half_w, 0.0);
        let (rx0, ry0, _) = offset_pt(pt0, lateral_offset - half_w, 0.0);
        let (lx1, ly1, _) = offset_pt(pt1, lateral_offset + half_w, 0.0);
        let (rx1, ry1, _) = offset_pt(pt1, lateral_offset - half_w, 0.0);

        // Suppress unused center coords (used only for readability)
        let _ = (cx0, cy0, cx1, cy1);

        verts.push([lx0 as f32, ly0 as f32, z0, r, g, b, a]);
        verts.push([rx0 as f32, ry0 as f32, z0, r, g, b, a]);
        verts.push([lx1 as f32, ly1 as f32, z1, r, g, b, a]);
        verts.push([rx0 as f32, ry0 as f32, z0, r, g, b, a]);
        verts.push([rx1 as f32, ry1 as f32, z1, r, g, b, a]);
        verts.push([lx1 as f32, ly1 as f32, z1, r, g, b, a]);
    }

    verts
}

/// Find the closest road to a world-space point.
///
/// Returns the road ID as a string, or null if no road is within the threshold.
#[wasm_bindgen]
pub fn pick_road_at_point(
    project_json: &str,
    x: f64,
    y: f64,
    threshold: f64,
) -> Result<JsValue, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut best_road_id: Option<String> = None;
    let mut best_dist = threshold;

    for road in &project.roads {
        let ref_pts = we_core::geometry::eval::sample_road_reference_line(road, 2.0);
        for pt in &ref_pts {
            let dx = pt.x - x;
            let dy = pt.y - y;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist < best_dist {
                best_dist = dist;
                best_road_id = Some(road.id.clone());
            }
        }
    }

    match best_road_id {
        Some(id) => Ok(JsValue::from_str(&id)),
        None => Ok(JsValue::NULL),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn test_version() {
        let v = version();
        assert!(!v.is_empty());
    }

    #[wasm_bindgen_test]
    fn test_parse_opendrive() {
        let xml =
            r#"<?xml version="1.0"?><OpenDRIVE><header revMajor="1" revMinor="6"/></OpenDRIVE>"#;
        let result = parse_opendrive(xml);
        assert!(result.is_ok());
    }
}
