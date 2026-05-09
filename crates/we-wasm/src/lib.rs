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
        if road.render_hidden {
            continue;
        }

        let ref_pts = sample_road_reference_line(road, sample_step);
        if ref_pts.len() < 2 {
            continue;
        }

        let mut road_verts: Vec<[f32; 7]> = Vec::new();

        for section in &road.lane_sections {
            if section.render_hidden {
                continue;
            }

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
            let mut right_prev_widths: Vec<&[we_core::model::LaneWidth]> = Vec::new();
            for lane in &right_sorted {
                if !lane.render_hidden {
                    let color = lane_surface_color(lane.lane_type);
                    road_verts.extend(gen_lane_strip(
                        &section_pts, &lane.width, section.s,
                        &road.elevation_profile, &road.lane_offsets, &right_prev_widths, false, color,
                        &evaluate_elevation, &evaluate_lane_width, &eval_lane_offset, &offset_point,
                    ));
                }
                right_prev_widths.push(&lane.width);
            }

            // Left lanes (positive IDs, inner to outer)
            let mut left_sorted: Vec<_> = section.left.iter().collect();
            left_sorted.sort_by_key(|l| l.id);
            let mut left_prev_widths: Vec<&[we_core::model::LaneWidth]> = Vec::new();
            for lane in &left_sorted {
                if !lane.render_hidden {
                    let color = lane_surface_color(lane.lane_type);
                    road_verts.extend(gen_lane_strip(
                        &section_pts, &lane.width, section.s,
                        &road.elevation_profile, &road.lane_offsets, &left_prev_widths, true, color,
                        &evaluate_elevation, &evaluate_lane_width, &eval_lane_offset, &offset_point,
                    ));
                }
                left_prev_widths.push(&lane.width);
            }
        }

        // Fall back to default gray ribbon when no lane sections are defined
        if road_verts.is_empty() && road.lane_sections.is_empty() {
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
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut all_floats = Vec::new();
    let color = [0.88f32, 0.85, 0.98, 0.4];

    for junction in &project.junctions {
        append_junction_triangles(&mut all_floats, &project, junction, color);
    }

    Ok(all_floats)
}

/// Generate highlight mesh vertices for a single junction.
#[wasm_bindgen]
pub fn generate_single_junction_vertices(
    project_json: &str,
    junction_id: &str,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
) -> Result<Vec<f32>, JsError> {
    use we_core::model::Project;
    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    let mut all_floats = Vec::new();
    if let Some(junction) = project.junctions.iter().find(|j| j.id == junction_id) {
        append_junction_triangles(&mut all_floats, &project, junction, [r, g, b, a]);
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
        if road.render_hidden {
            continue;
        }

        let ref_pts = sample_road_reference_line(road, sample_step);
        if ref_pts.len() < 2 {
            continue;
        }

        for section in &road.lane_sections {
            if section.render_hidden {
                continue;
            }

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
                if !center_lane.render_hidden {
                    if let Some(rm) = center_lane.road_marks.first() {
                        if rm.mark_type != RoadMarkType::None {
                            let lc = mark_color(rm.color);
                            let lw = if rm.width > 0.0 { rm.width as f32 } else { 0.15 };
                            let dashed = is_dashed(rm.mark_type);
                            let verts = gen_road_mark_line(
                                &section_pts, &road.elevation_profile,
                                section.s, &road.lane_offsets, &|_| 0.0, lw, lc, dashed,
                                &evaluate_elevation, &eval_lane_offset, &offset_point,
                            );
                            for v in &verts { all_floats.extend_from_slice(v); }
                        }
                    }
                }
            }

            // Right lane outer boundaries (inner → outer, accumulating offset)
            let mut right_sorted: Vec<_> = section.right.iter().collect();
            right_sorted.sort_by_key(|l| l.id.abs());
            let mut right_prev_widths: Vec<&[we_core::model::LaneWidth]> = Vec::new();
            for lane in &right_sorted {
                if !lane.render_hidden {
                    if let Some(rm) = lane.road_marks.first() {
                        if rm.mark_type != RoadMarkType::None {
                            let lc = mark_color(rm.color);
                            let lw = if rm.width > 0.0 { rm.width as f32 } else { 0.15 };
                            let dashed = is_dashed(rm.mark_type);
                            let mut boundary_widths = right_prev_widths.clone();
                            boundary_widths.push(&lane.width);
                            let verts = gen_road_mark_line(
                                &section_pts, &road.elevation_profile,
                                section.s, &road.lane_offsets,
                                &|ds| -sum_widths_at_ds(&boundary_widths, ds, &evaluate_lane_width),
                                lw, lc, dashed,
                                &evaluate_elevation, &eval_lane_offset, &offset_point,
                            );
                            for v in &verts { all_floats.extend_from_slice(v); }
                        }
                    }
                }
                right_prev_widths.push(&lane.width);
            }

            // Left lane outer boundaries
            let mut left_sorted: Vec<_> = section.left.iter().collect();
            left_sorted.sort_by_key(|l| l.id);
            let mut left_prev_widths: Vec<&[we_core::model::LaneWidth]> = Vec::new();
            for lane in &left_sorted {
                if !lane.render_hidden {
                    if let Some(rm) = lane.road_marks.first() {
                        if rm.mark_type != RoadMarkType::None {
                            let lc = mark_color(rm.color);
                            let lw = if rm.width > 0.0 { rm.width as f32 } else { 0.15 };
                            let dashed = is_dashed(rm.mark_type);
                            let mut boundary_widths = left_prev_widths.clone();
                            boundary_widths.push(&lane.width);
                            let verts = gen_road_mark_line(
                                &section_pts, &road.elevation_profile,
                                section.s, &road.lane_offsets,
                                &|ds| sum_widths_at_ds(&boundary_widths, ds, &evaluate_lane_width),
                                lw, lc, dashed,
                                &evaluate_elevation, &eval_lane_offset, &offset_point,
                            );
                            for v in &verts { all_floats.extend_from_slice(v); }
                        }
                    }
                }
                left_prev_widths.push(&lane.width);
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

/// Sum lane widths at ds across multiple lanes.
fn sum_widths_at_ds(
    widths_list: &[&[we_core::model::LaneWidth]],
    ds: f64,
    eval: &dyn Fn(&[we_core::model::LaneWidth], f64) -> f64,
) -> f64 {
    widths_list.iter().map(|w| eval(w, ds)).sum()
}

/// Evaluate laneOffset polynomial at station `s`.
///
/// OpenDRIVE `laneOffset` applies to the whole lane cross-section:
/// positive values shift all lanes to the left of the reference line.
fn eval_lane_offset(offsets: &[we_core::model::LaneOffset], s: f64) -> f64 {
    let Some(entry) = offsets.iter().rev().find(|o| o.s <= s + 1e-9) else {
        return 0.0;
    };
    let ds = (s - entry.s).max(0.0);
    entry.evaluate(ds)
}

/// Generate a colored triangle strip for one lane.
fn gen_lane_strip(
    ref_pts: &[&we_core::geometry::eval::RefLinePoint],
    widths: &[we_core::model::LaneWidth],
    section_s: f64,
    elevations: &[we_core::model::Elevation],
    lane_offsets: &[we_core::model::LaneOffset],
    prev_widths: &[&[we_core::model::LaneWidth]],
    is_left: bool,
    color: [f32; 4],
    eval_elev: &dyn Fn(&[we_core::model::Elevation], f64) -> f64,
    eval_width: &dyn Fn(&[we_core::model::LaneWidth], f64) -> f64,
    eval_lane_off: &dyn Fn(&[we_core::model::LaneOffset], f64) -> f64,
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
        let inner0 = sum_widths_at_ds(prev_widths, ds0, eval_width);
        let inner1 = sum_widths_at_ds(prev_widths, ds1, eval_width);

        let z0 = eval_elev(elevations, pt0.s) as f32;
        let z1 = eval_elev(elevations, pt1.s) as f32;

        let lo0 = eval_lane_off(lane_offsets, pt0.s);
        let lo1 = eval_lane_off(lane_offsets, pt1.s);

        let (in0, out0) = if is_left {
            (lo0 + inner0, lo0 + inner0 + w0)
        } else {
            (lo0 - inner0, lo0 - (inner0 + w0))
        };
        let (in1, out1) = if is_left {
            (lo1 + inner1, lo1 + inner1 + w1)
        } else {
            (lo1 - inner1, lo1 - (inner1 + w1))
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
    section_s: f64,
    lane_offsets: &[we_core::model::LaneOffset],
    lateral_offset_at_ds: &dyn Fn(f64) -> f64,
    line_width: f32,
    color: [f32; 4],
    is_dashed: bool,
    eval_elev: &dyn Fn(&[we_core::model::Elevation], f64) -> f64,
    eval_lane_off: &dyn Fn(&[we_core::model::LaneOffset], f64) -> f64,
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
        let ds0 = (pt0.s - section_s).max(0.0);
        let ds1 = (pt1.s - section_s).max(0.0);
        let lateral_offset0 = lateral_offset_at_ds(ds0);
        let lateral_offset1 = lateral_offset_at_ds(ds1);

        let lo0 = eval_lane_off(lane_offsets, pt0.s);
        let lo1 = eval_lane_off(lane_offsets, pt1.s);
        let t0 = lo0 + lateral_offset0;
        let t1 = lo1 + lateral_offset1;

        // Center points at lane-offset-adjusted lateral position, then expand ±half_w
        let (cx0, cy0, _) = offset_pt(pt0, t0, 0.0);
        let (cx1, cy1, _) = offset_pt(pt1, t1, 0.0);
        let (lx0, ly0, _) = offset_pt(pt0, t0 + half_w, 0.0);
        let (rx0, ry0, _) = offset_pt(pt0, t0 - half_w, 0.0);
        let (lx1, ly1, _) = offset_pt(pt1, t1 + half_w, 0.0);
        let (rx1, ry1, _) = offset_pt(pt1, t1 - half_w, 0.0);

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

/// Generate signal paint mark vertices from a project JSON. Returns Float32Array.
///
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
///
/// For `type="Graphics"` signals (road paint arrows), the corresponding arrow
/// polygon is triangulated and placed on the road surface using the signal's
/// s/t position and h_offset heading.
///
/// For other signal types (vertical signs), a small colored diamond marker is
/// placed at the signal position slightly above the road surface.
#[wasm_bindgen]
pub fn generate_signal_paint_vertices(
    project_json: &str,
    _sample_step: f64,
) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::{evaluate_elevation, offset_point};
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut all_floats = Vec::new();

    for road in &project.roads {
        if road.signals.is_empty() {
            continue;
        }

        for signal in &road.signals {
            // Evaluate road reference line at signal.s
            let Some(ref_pt) = road_point_at_s(&road.plan_view, signal.s) else {
                continue;
            };

            let z_road = evaluate_elevation(&road.elevation_profile, signal.s) as f32;

            if signal.signal_type == "Graphics" {
                // Paint arrow on the road surface
                let (cx, cy, _) = offset_point(&ref_pt, signal.t, 0.0);
                let heading = ref_pt.hdg + signal.h_offset;
                let scale = if signal.width > 0.0 { signal.width } else { 3.0 };
                let z = z_road + 0.02; // 2 cm above road surface

                let tris = arrow_triangles(&signal.signal_subtype, cx as f32, cy as f32, z, heading as f32, scale as f32);
                all_floats.extend(tris);
            } else {
                // Vertical sign: render as a small diamond marker above the road
                let (mx, my, _) = offset_point(&ref_pt, signal.t, 0.0);
                let z = z_road + 0.5; // 50 cm above road (approximate pole height)
                let sz = 0.4f32; // marker half-size
                let [r, g, b, a] = sign_marker_color(&signal.signal_type);

                // Two triangles forming a diamond (tilted square)
                //   top  (-y)
                //  left  (-x)  right (+x)
                //   bot  (+y)
                let top = [mx as f32, my as f32 - sz, z + sz];
                let bot = [mx as f32, my as f32 + sz, z - sz];
                let lft = [mx as f32 - sz, my as f32, z];
                let rgt = [mx as f32 + sz, my as f32, z];

                for p in &[top, lft, bot, top, bot, rgt] {
                    all_floats.extend_from_slice(&[p[0], p[1], p[2], r, g, b, a]);
                }
            }
        }
    }

    Ok(all_floats)
}

/// Evaluate road reference position at a given `s` station.
///
/// Finds the geometry element that covers `s` and evaluates it.
fn road_point_at_s(plan_view: &[we_core::model::Geometry], s: f64) -> Option<we_core::geometry::eval::RefLinePoint> {
    use we_core::geometry::eval::evaluate_geometry;

    if plan_view.is_empty() {
        return None;
    }

    // Find the geometry segment that contains s
    let geo = plan_view
        .iter()
        .rev()
        .find(|g| g.s <= s + 1e-9)
        .unwrap_or(&plan_view[0]);

    let ds = (s - geo.s).clamp(0.0, geo.length);
    Some(evaluate_geometry(geo, ds))
}

/// Build filled triangle geometry for a paint arrow, using a centroid fan.
///
/// `subtype` selects the polygon template. The result is a flat list of 7-float
/// vertex records ready for GPU upload.
fn arrow_triangles(
    subtype: &str,
    cx: f32,
    cy: f32,
    z: f32,
    heading: f32,
    scale: f32,
) -> Vec<f32> {
    // Normalized arrow polygons (local space, y-axis = forward):
    // Coordinates are pre-scaled to approx. ±0.5 range.
    // All are closed outlines (last point equals first).
    let template: &[(f32, f32)] = match subtype {
        "StraightAheadArrow" => &[
            (-0.025, -0.5), (-0.025, 0.1), (-0.075, 0.1),
            (0.0, 0.5), (0.075, 0.1), (0.025, 0.1), (0.025, -0.5),
        ],
        "LeftTurnArrow" => &[
            (0.075, -0.5), (0.075, 0.0), (-0.0583, 0.1333),
            (-0.0583, -0.0167), (-0.125, 0.2333), (-0.0583, 0.5),
            (-0.0583, 0.3333), (0.125, 0.15), (0.125, -0.5),
        ],
        "RightTurnArrow" => &[
            (-0.075, -0.5), (-0.075, 0.0), (0.0583, 0.1333),
            (0.0583, -0.0167), (0.125, 0.2333), (0.0583, 0.5),
            (0.0583, 0.3333), (-0.125, 0.15), (-0.125, -0.5),
        ],
        "UTurnArrow" => &[
            (0.025, -0.5), (0.025, 0.25), (-0.1, 0.25),
            (-0.1, -0.1), (-0.2, 0.0), (-0.1, 0.1), (-0.1, 0.45),
            (0.125, 0.45), (0.125, -0.5),
        ],
        "StraightOrLeftTurnArrow" => &[
            (-0.025, -0.5), (-0.025, 0.1), (-0.075, 0.1),
            (0.0, 0.5), (0.075, 0.1), (0.025, 0.1),
            (0.025, 0.0), (0.1, 0.0), (0.1, -0.5),
        ],
        "StraightOrRightTurnArrow" => &[
            (0.025, -0.5), (0.025, 0.1), (0.075, 0.1),
            (0.0, 0.5), (-0.075, 0.1), (-0.025, 0.1),
            (-0.025, 0.0), (-0.1, 0.0), (-0.1, -0.5),
        ],
        "LeftOrRightTurnArrow" => &[
            (-0.1, -0.2), (-0.1, 0.0), (0.0, 0.5), (0.1, 0.0),
            (0.1, -0.2), (0.05, -0.2), (0.05, -0.5),
            (-0.05, -0.5), (-0.05, -0.2),
        ],
        // Fallback: simple upward arrow for unknown subtypes
        _ => &[
            (-0.025, -0.5), (-0.025, 0.1), (-0.075, 0.1),
            (0.0, 0.5), (0.075, 0.1), (0.025, 0.1), (0.025, -0.5),
        ],
    };

    // The C# transform: rotate by (heading - pi/2) so y-forward local → road forward
    // newX = (v.x * cos0 - v.y * sin0) * scale
    // newY = (v.x * sin0 + v.y * cos0) * scale
    // where cos0/sin0 encode road forward direction
    let cos_h = heading.cos();
    let sin_h = heading.sin();

    let transform = |vx: f32, vy: f32| -> (f32, f32) {
        // Local space: y = forward → rotate so it aligns with road heading
        // heading=0 → east, so forward (+y local) should map to east (+x world)
        // Use: world_x = vx*cos - vy*sin + cx (standard 2D rotation)
        let wx = (vx * cos_h - vy * sin_h) * scale + cx;
        let wy = (vx * sin_h + vy * cos_h) * scale + cy;
        (wx, wy)
    };

    // Compute centroid for fan triangulation
    let n = template.len() as f32;
    let cent_lx: f32 = template.iter().map(|(x, _)| x).sum::<f32>() / n;
    let cent_ly: f32 = template.iter().map(|(_, y)| y).sum::<f32>() / n;
    let (ccx, ccy) = transform(cent_lx, cent_ly);

    let [r, g, b, a] = [1.0f32, 1.0, 1.0, 0.95];
    let mut out = Vec::with_capacity(template.len() * 3 * 7);

    for i in 0..template.len() {
        let j = (i + 1) % template.len();
        let (px0, py0) = transform(template[i].0, template[i].1);
        let (px1, py1) = transform(template[j].0, template[j].1);

        // Triangle: centroid, p0, p1
        out.extend_from_slice(&[ccx, ccy, z, r, g, b, a]);
        out.extend_from_slice(&[px0, py0, z, r, g, b, a]);
        out.extend_from_slice(&[px1, py1, z, r, g, b, a]);
    }

    out
}

/// Marker color for vertical sign types.
fn sign_marker_color(signal_type: &str) -> [f32; 4] {
    match signal_type {
        t if t.starts_with("1000") => [0.2, 0.8, 0.2, 0.9], // traffic lights → green
        "1010203800001413" | "1010203900001613" => [0.9, 0.2, 0.2, 0.9], // speed limit → red
        _ => [0.8, 0.8, 0.1, 0.9], // generic sign → yellow
    }
}

fn append_junction_triangles(
    out: &mut Vec<f32>,
    project: &we_core::model::Project,
    junction: &we_core::model::Junction,
    color: [f32; 4],
) {
    let points = build_junction_polygon_points(project, junction);
    if points.len() < 3 {
        return;
    }
    let n = points.len() as f32;
    let cx: f32 = points.iter().map(|p| p[0]).sum::<f32>() / n;
    let cy: f32 = points.iter().map(|p| p[1]).sum::<f32>() / n;
    let cz: f32 = points.iter().map(|p| p[2]).sum::<f32>() / n;
    let [r, g, b, a] = color;
    for i in 0..points.len() {
        let j = (i + 1) % points.len();
        out.extend_from_slice(&[cx, cy, cz, r, g, b, a]);
        out.extend_from_slice(&[points[i][0], points[i][1], points[i][2], r, g, b, a]);
        out.extend_from_slice(&[points[j][0], points[j][1], points[j][2], r, g, b, a]);
    }
}

fn build_junction_polygon_points(
    project: &we_core::model::Project,
    junction: &we_core::model::Junction,
) -> Vec<[f32; 3]> {
    use we_core::geometry::eval::{evaluate_elevation, evaluate_lane_width, offset_point};

    let mut points: Vec<[f32; 3]> = Vec::new();
    for conn in &junction.connections {
        let Some(connecting) = project.roads.iter().find(|r| r.id == conn.connecting_road) else {
            continue;
        };
        if connecting.render_hidden {
            continue;
        }
        let connecting_s = if conn.contact_point == we_core::model::ContactPoint::Start {
            0.0
        } else {
            connecting.length
        };
        let Some(connecting_pt) = road_point_at_s(&connecting.plan_view, connecting_s) else {
            continue;
        };
        append_road_boundary_points(
            connecting,
            connecting_s,
            &mut points,
            &evaluate_elevation,
            &evaluate_lane_width,
            &offset_point,
        );

        // Incoming road endpoint is not described by connection.contactPoint.
        // Choose start/end by nearest distance to connecting-road contact point.
        let Some(incoming) = project.roads.iter().find(|r| r.id == conn.incoming_road) else {
            continue;
        };
        if incoming.render_hidden {
            continue;
        }
        let Some(in_start) = road_point_at_s(&incoming.plan_view, 0.0) else {
            continue;
        };
        let Some(in_end) = road_point_at_s(&incoming.plan_view, incoming.length) else {
            continue;
        };
        let ds_start =
            (in_start.x - connecting_pt.x).powi(2) + (in_start.y - connecting_pt.y).powi(2);
        let ds_end = (in_end.x - connecting_pt.x).powi(2) + (in_end.y - connecting_pt.y).powi(2);
        let incoming_s = if ds_start <= ds_end { 0.0 } else { incoming.length };
        append_road_boundary_points(
            incoming,
            incoming_s,
            &mut points,
            &evaluate_elevation,
            &evaluate_lane_width,
            &offset_point,
        );
    }

    if points.len() < 3 {
        return points;
    }

    // Deduplicate near-identical points.
    let mut dedup: Vec<[f32; 3]> = Vec::new();
    for p in points {
        if !dedup.iter().any(|q| {
            let dx = p[0] - q[0];
            let dy = p[1] - q[1];
            (dx * dx + dy * dy) < 0.01 // 10cm
        }) {
            dedup.push(p);
        }
    }
    if dedup.len() < 3 {
        return dedup;
    }

    // Sort by polar angle around centroid to build a stable polygon ring.
    let cx: f32 = dedup.iter().map(|p| p[0]).sum::<f32>() / dedup.len() as f32;
    let cy: f32 = dedup.iter().map(|p| p[1]).sum::<f32>() / dedup.len() as f32;
    dedup.sort_by(|a, b| {
        let aa = (a[1] - cy).atan2(a[0] - cx);
        let bb = (b[1] - cy).atan2(b[0] - cx);
        aa.total_cmp(&bb)
    });
    dedup
}

fn append_road_boundary_points(
    road: &we_core::model::Road,
    s: f64,
    points: &mut Vec<[f32; 3]>,
    evaluate_elevation: &dyn Fn(&[we_core::model::Elevation], f64) -> f64,
    evaluate_lane_width: &dyn Fn(&[we_core::model::LaneWidth], f64) -> f64,
    offset_point: &dyn Fn(&we_core::geometry::eval::RefLinePoint, f64, f64) -> (f64, f64, f64),
) {
    let Some(ref_pt) = road_point_at_s(&road.plan_view, s) else {
        return;
    };
    let lane_offset = eval_lane_offset(&road.lane_offsets, s);
    let Some(section) = road
        .lane_sections
        .iter()
        .rev()
        .find(|ls| !ls.render_hidden && ls.s <= s + 1e-9)
        .or_else(|| road.lane_sections.iter().find(|ls| !ls.render_hidden))
    else {
        return;
    };
    let ds = (s - section.s).max(0.0);
    let left_width: f64 = section
        .left
        .iter()
        .map(|l| evaluate_lane_width(&l.width, ds))
        .sum();
    let right_width: f64 = section
        .right
        .iter()
        .map(|l| evaluate_lane_width(&l.width, ds))
        .sum();
    let z = evaluate_elevation(&road.elevation_profile, s) as f32 - 0.1;
    let (lx, ly, _) = offset_point(&ref_pt, lane_offset + left_width, 0.0);
    let (rx, ry, _) = offset_point(&ref_pt, lane_offset - right_width, 0.0);
    points.push([lx as f32, ly as f32, z]);
    points.push([rx as f32, ry as f32, z]);
}

fn point_in_polygon(x: f64, y: f64, poly: &[[f32; 3]]) -> bool {
    let mut inside = false;
    let mut j = poly.len() - 1;
    for i in 0..poly.len() {
        let xi = poly[i][0] as f64;
        let yi = poly[i][1] as f64;
        let xj = poly[j][0] as f64;
        let yj = poly[j][1] as f64;
        let intersect = ((yi > y) != (yj > y))
            && (x < (xj - xi) * (y - yi) / ((yj - yi).abs().max(1e-12)) + xi);
        if intersect {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Find the closest junction to a world-space point.
#[wasm_bindgen]
pub fn pick_junction_at_point(
    project_json: &str,
    x: f64,
    y: f64,
    threshold: f64,
) -> Result<JsValue, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut best: Option<String> = None;
    let mut best_dist = threshold;

    for junction in &project.junctions {
        let poly = build_junction_polygon_points(&project, junction);
        if poly.len() < 3 {
            continue;
        }
        if point_in_polygon(x, y, &poly) {
            return Ok(JsValue::from_str(&junction.id));
        }
        let cx: f64 = poly.iter().map(|p| p[0] as f64).sum::<f64>() / poly.len() as f64;
        let cy: f64 = poly.iter().map(|p| p[1] as f64).sum::<f64>() / poly.len() as f64;
        let dx = cx - x;
        let dy = cy - y;
        let dist = (dx * dx + dy * dy).sqrt();
        if dist < best_dist {
            best_dist = dist;
            best = Some(junction.id.clone());
        }
    }
    match best {
        Some(id) => Ok(JsValue::from_str(&id)),
        None => Ok(JsValue::NULL),
    }
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
        if road.render_hidden {
            continue;
        }
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
