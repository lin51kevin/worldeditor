use wasm_bindgen::prelude::*;

use super::helpers::road_point_at_s;
use super::signal_mesh::{
    emit_crosswalk_stripes, emit_longitudinal_strip, emit_polygon_outline,
    emit_polygon_outline_road_corners, emit_rect_outline, emit_square_marker,
    emit_transverse_bar,
};

/// Generate road object vertices from a project JSON. Returns vertex data as Float32Array.
///
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
///
/// Renders the following object types:
/// - `StopLine`: white transverse bar (0.4 m thick) across the road.
/// - `Crosswalk`: navy-blue zebra stripes (0.45 m stripes / 0.6 m gaps) or outline box.
/// - `ParkingSpace`: olive-green boundary polygon.
/// - `CrossHatchArea`: orange boundary polygon.
/// - `WovenArea`: hot-pink boundary polygon.
/// - `ForwardWaitingArea`, `TurnLeftWaitingArea`: white boundary box.
/// - `SlowDownToYieldLine`: sky-blue transverse bar.
/// - `StopToYieldLine`: red transverse bar.
/// - `Guardrail`, `Barrier`: colored thin strip along the road direction.
/// - Other: small colored square marker.
#[wasm_bindgen]
pub fn generate_object_vertices(project_json: &str) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::{evaluate_elevation, offset_point, sample_road_reference_line};
    use we_core::model::{CornerType, ObjectType, Project};

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut all_floats = Vec::new();

    for road in &project.roads {
        if road.render_hidden || road.objects.is_empty() {
            continue;
        }

        let ref_pts = sample_road_reference_line(road, 1.0);
        if ref_pts.len() < 2 {
            continue;
        }

        // Junction connector roads inherit objectReference associations but
        // should not render traffic-control markings — those are defined once
        // on the approach road and would appear with incorrect orientation on
        // the connector's tangent.
        let is_junction_connector = matches!(&road.junction_id, Some(j) if j != "-1");

        for obj in &road.objects {
            let s = obj.position.x;
            let t = obj.position.y;
            let z_offset = obj.position.z as f32;

            // Skip objects with negative s (invalid placement).
            // Objects with s > road.length are allowed — road_point_at_s
            // extrapolates the road geometry by tangent extension.
            if s < -1.0 {
                continue;
            }

            // Skip traffic-control markings on junction connectors.
            if is_junction_connector {
                match &obj.object_type {
                    ObjectType::Crosswalk
                    | ObjectType::StopLine
                    | ObjectType::SlowDownToYieldLine
                    | ObjectType::StopToYieldLine => continue,
                    _ => {}
                }
            }

            // Find reference line point at object s-coordinate
            let Some(ref_pt) = road_point_at_s(&road.plan_view, s) else {
                continue;
            };
            let z_road = evaluate_elevation(&road.elevation_profile, s) as f32 + z_offset + 0.02;

            match &obj.object_type {
                ObjectType::StopLine => {
                    // Determine bar width, lateral centre, and the corrected road-s position
                    // from corner data if available.
                    //
                    // cornerLocal (u, v) is in the object's local frame (origin at obj s/t,
                    // axes rotated by obj.hdg). Road-local conversion:
                    //   ds (along-road) = u * cos(hdg) - v * sin(hdg)
                    //   dt (lateral)    = u * sin(hdg) + v * cos(hdg)
                    //
                    // When the corner v-values are non-zero (e.g. road 82 stop line 22,
                    // v ≈ 6.6 m with hdg ≈ π/2), the actual stop line is shifted ~6.6 m
                    // along the road from obj.s. Ignoring ds causes a large positional error.
                    let (bar_w, bar_t, stop_ref_pt, stop_z) = if obj.corners.len() >= 2 {
                        let (cos_h, sin_h) = (obj.hdg.cos(), obj.hdg.sin());
                        // Along-road offsets from each corner endpoint
                        let ds0 = obj.corners[0].x * cos_h - obj.corners[0].y * sin_h;
                        let ds1 = obj.corners[1].x * cos_h - obj.corners[1].y * sin_h;
                        // Lateral offsets from each corner endpoint
                        let dt0 = obj.corners[0].x * sin_h + obj.corners[0].y * cos_h;
                        let dt1 = obj.corners[1].x * sin_h + obj.corners[1].y * cos_h;
                        let w = (dt1 - dt0).abs();
                        let center = t + (dt0 + dt1) / 2.0;
                        // Actual road station of the bar midpoint (clamped to road extent)
                        let actual_s = (s + (ds0 + ds1) / 2.0).clamp(0.0, road.length);
                        let rp = road_point_at_s(&road.plan_view, actual_s).unwrap_or(ref_pt);
                        let z = evaluate_elevation(&road.elevation_profile, actual_s) as f32
                            + z_offset
                            + 0.02;
                        (if w > 0.01 { w } else { obj.width.max(3.5) }, center, rp, z)
                    } else {
                        (if obj.width > 0.0 { obj.width } else { 3.5 }, t, ref_pt, z_road)
                    };
                    emit_transverse_bar(
                        &stop_ref_pt,
                        bar_t,
                        stop_z,
                        bar_w,
                        0.4,
                        [1.0, 1.0, 1.0, 1.0],
                        &offset_point,
                        &mut all_floats,
                    );
                }
                ObjectType::SlowDownToYieldLine => {
                    // Sky-blue transverse bar
                    let bar_w = if obj.width > 0.0 { obj.width } else { 3.5 };
                    emit_transverse_bar(
                        &ref_pt,
                        t,
                        z_road,
                        bar_w,
                        0.4,
                        [0.000, 0.749, 1.000, 1.0], // (0,191,255)
                        &offset_point,
                        &mut all_floats,
                    );
                }
                ObjectType::StopToYieldLine => {
                    // Red transverse bar
                    let bar_w = if obj.width > 0.0 { obj.width } else { 3.5 };
                    emit_transverse_bar(
                        &ref_pt,
                        t,
                        z_road,
                        bar_w,
                        0.3,
                        [0.816, 0.008, 0.106, 1.0], // (208,2,27)
                        &offset_point,
                        &mut all_floats,
                    );
                }
                ObjectType::Crosswalk => {
                    if !obj.corners.is_empty() {
                        match obj.corner_type {
                            CornerType::Road => {
                                // cornerRoad: render as polygon outline (stripe fill not supported
                                // for absolute coordinates — would need per-corner interpolation).
                                emit_polygon_outline_road_corners(
                                    &obj.corners,
                                    &road.plan_view,
                                    &road.elevation_profile,
                                    0.3,
                                    [1.0, 1.0, 1.0, 1.0],
                                    &offset_point,
                                    &road_point_at_s,
                                    &mut all_floats,
                                );
                            }
                            CornerType::Local => {
                                // Extract userData: Angle, LineWidth, LineGap
                                let mut angle_deg = 0.0_f64;
                                let mut line_width = 0.0_f64;
                                let mut line_gap = 0.0_f64;
                                for (code, value) in &obj.user_data {
                                    match code.as_str() {
                                        "Angle" => angle_deg = value.parse().unwrap_or(0.0),
                                        "LineWidth" => line_width = value.parse().unwrap_or(0.0),
                                        "LineGap" => line_gap = value.parse().unwrap_or(0.0),
                                        _ => {}
                                    }
                                }
                                // Corner-based zebra stripe generation with correct heading rotation.
                                emit_crosswalk_stripes(
                                    &obj.corners,
                                    &ref_pt,
                                    &road.elevation_profile,
                                    s,
                                    t,
                                    obj.hdg,
                                    z_road,
                                    &offset_point,
                                    angle_deg,
                                    line_width,
                                    line_gap,
                                    obj.length,
                                    obj.width,
                                    &mut all_floats,
                                );
                            }
                        }
                    } else {
                        // Fallback: navy rectangle outline
                        let len = if obj.length > 0.0 { obj.length } else { 4.0 };
                        let wid = if obj.width > 0.0 { obj.width } else { 3.5 };
                        emit_rect_outline(
                            &ref_pt,
                            t,
                            z_road,
                            wid,
                            len,
                            0.3,
                            [0.000, 0.000, 0.502, 1.0], // navy
                            obj.hdg,
                            &offset_point,
                            &mut all_floats,
                        );
                    }
                }
                ObjectType::ParkingSpace => {
                    // Olive-green boundary
                    if !obj.corners.is_empty() {
                        match obj.corner_type {
                            CornerType::Road => {
                                emit_polygon_outline_road_corners(
                                    &obj.corners,
                                    &road.plan_view,
                                    &road.elevation_profile,
                                    0.15,
                                    [0.424, 0.549, 0.278, 1.0],
                                    &offset_point,
                                    &road_point_at_s,
                                    &mut all_floats,
                                );
                            }
                            CornerType::Local => {
                                emit_polygon_outline(
                                    &obj.corners,
                                    &ref_pt,
                                    &road.elevation_profile,
                                    s,
                                    t,
                                    obj.hdg,
                                    z_road,
                                    0.15,
                                    [0.424, 0.549, 0.278, 1.0],
                                    &offset_point,
                                    &mut all_floats,
                                    obj.length,
                                    obj.width,
                                );
                            }
                        }
                    } else {
                        let len = if obj.length > 0.0 { obj.length } else { 5.0 };
                        let wid = if obj.width > 0.0 { obj.width } else { 2.5 };
                        emit_rect_outline(
                            &ref_pt,
                            t,
                            z_road,
                            wid,
                            len,
                            0.12,
                            [0.424, 0.549, 0.278, 1.0],
                            obj.hdg,
                            &offset_point,
                            &mut all_floats,
                        );
                    }
                }
                ObjectType::CrossHatchArea => {
                    // Orange boundary
                    if !obj.corners.is_empty() {
                        match obj.corner_type {
                            CornerType::Road => {
                                emit_polygon_outline_road_corners(
                                    &obj.corners,
                                    &road.plan_view,
                                    &road.elevation_profile,
                                    0.15,
                                    [0.965, 0.651, 0.137, 1.0],
                                    &offset_point,
                                    &road_point_at_s,
                                    &mut all_floats,
                                );
                            }
                            CornerType::Local => {
                                emit_polygon_outline(
                                    &obj.corners,
                                    &ref_pt,
                                    &road.elevation_profile,
                                    s,
                                    t,
                                    obj.hdg,
                                    z_road,
                                    0.15,
                                    [0.965, 0.651, 0.137, 1.0],
                                    &offset_point,
                                    &mut all_floats,
                                    obj.length,
                                    obj.width,
                                );
                            }
                        }
                    } else {
                        let len = if obj.length > 0.0 { obj.length } else { 5.0 };
                        let wid = if obj.width > 0.0 { obj.width } else { 3.0 };
                        emit_rect_outline(
                            &ref_pt,
                            t,
                            z_road,
                            wid,
                            len,
                            0.15,
                            [0.965, 0.651, 0.137, 1.0],
                            obj.hdg,
                            &offset_point,
                            &mut all_floats,
                        );
                    }
                }
                ObjectType::WovenArea => {
                    // Hot-pink boundary
                    let color = [1.000, 0.051, 0.651, 1.0]; // (255,13,166)
                    if !obj.corners.is_empty() {
                        match obj.corner_type {
                            CornerType::Road => {
                                emit_polygon_outline_road_corners(
                                    &obj.corners,
                                    &road.plan_view,
                                    &road.elevation_profile,
                                    0.15,
                                    color,
                                    &offset_point,
                                    &road_point_at_s,
                                    &mut all_floats,
                                );
                            }
                            CornerType::Local => {
                                emit_polygon_outline(
                                    &obj.corners,
                                    &ref_pt,
                                    &road.elevation_profile,
                                    s,
                                    t,
                                    obj.hdg,
                                    z_road,
                                    0.15,
                                    color,
                                    &offset_point,
                                    &mut all_floats,
                                    obj.length,
                                    obj.width,
                                );
                            }
                        }
                    } else {
                        let len = if obj.length > 0.0 { obj.length } else { 5.0 };
                        let wid = if obj.width > 0.0 { obj.width } else { 3.5 };
                        emit_rect_outline(
                            &ref_pt,
                            t,
                            z_road,
                            wid,
                            len,
                            0.15,
                            color,
                            obj.hdg,
                            &offset_point,
                            &mut all_floats,
                        );
                    }
                }
                ObjectType::ForwardWaitingArea | ObjectType::TurnLeftWaitingArea => {
                    // White boundary box
                    let len = if obj.length > 0.0 { obj.length } else { 4.0 };
                    let wid = if obj.width > 0.0 { obj.width } else { 3.5 };
                    emit_rect_outline(
                        &ref_pt,
                        t,
                        z_road,
                        wid,
                        len,
                        0.15,
                        [1.0, 1.0, 1.0, 0.9],
                        obj.hdg,
                        &offset_point,
                        &mut all_floats,
                    );
                }
                ObjectType::Guardrail => {
                    // Dark thin strip along road direction
                    let len = if obj.length > 0.0 { obj.length } else { 5.0 };
                    emit_longitudinal_strip(
                        &ref_pts,
                        &road.elevation_profile,
                        s,
                        t,
                        z_road,
                        len,
                        0.2,
                        [0.173, 0.173, 0.173, 1.0], // (44,44,44)
                        &evaluate_elevation,
                        &offset_point,
                        &mut all_floats,
                    );
                }
                ObjectType::Barrier => {
                    let len = if obj.length > 0.0 { obj.length } else { 5.0 };
                    emit_longitudinal_strip(
                        &ref_pts,
                        &road.elevation_profile,
                        s,
                        t,
                        z_road,
                        len,
                        0.3,
                        [0.800, 0.600, 0.200, 1.0], // orange
                        &evaluate_elevation,
                        &offset_point,
                        &mut all_floats,
                    );
                }
                ObjectType::SimpleSignalPole | ObjectType::TrafficLightPole => {
                    // Cyan / blue-purple small square marker
                    let color = match &obj.object_type {
                        ObjectType::TrafficLightPole => [0.400, 0.251, 1.000, 1.0],
                        _ => [0.000, 1.000, 1.000, 1.0],
                    };
                    emit_square_marker(
                        &ref_pt,
                        t,
                        z_road,
                        0.6,
                        color,
                        &offset_point,
                        &mut all_floats,
                    );
                }
                ObjectType::StreetLightPole => {
                    emit_square_marker(
                        &ref_pt,
                        t,
                        z_road,
                        0.6,
                        [0.612, 0.553, 0.839, 1.0], // lavender (156,141,214)
                        &offset_point,
                        &mut all_floats,
                    );
                }
                ObjectType::SignGantry => {
                    emit_square_marker(
                        &ref_pt,
                        t,
                        z_road,
                        1.0,
                        [0.071, 0.455, 0.212, 1.0], // dark green (18,116,54)
                        &offset_point,
                        &mut all_floats,
                    );
                }
                ObjectType::Sign
                | ObjectType::Pillar
                | ObjectType::TrafficCone
                | ObjectType::LTypeSignalPole => {
                    let size = if obj.width > 0.0 {
                        obj.width.min(1.0)
                    } else {
                        0.5
                    };
                    emit_square_marker(
                        &ref_pt,
                        t,
                        z_road,
                        size,
                        [0.9, 0.9, 0.9, 1.0],
                        &offset_point,
                        &mut all_floats,
                    );
                }
                _ => {} // Curb, Wall, Custom — omit for now
            }
        }
    }

    Ok(all_floats)
}

/// Generate highlight vertices for a single road object.
///
/// Looks up the object by road_id + object_id, evaluates its world position,
/// and returns a square marker mesh tinted with the given colour.
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
#[wasm_bindgen]
pub fn generate_single_object_vertices(
    project_json: &str,
    road_id: &str,
    object_id: &str,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::{evaluate_elevation, offset_point};
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let road = project.roads.iter().find(|rd| rd.id == road_id);
    let obj = road.and_then(|rd| rd.objects.iter().find(|o| o.id == object_id));

    let (road, obj) = match (road, obj) {
        (Some(road), Some(obj)) => (road, obj),
        _ => return Ok(Vec::new()),
    };

    let s = obj.position.x;
    let t = obj.position.y;
    let Some(ref_pt) = road_point_at_s(&road.plan_view, s) else {
        return Ok(Vec::new());
    };

    let (mx, my, _) = offset_point(&ref_pt, t, 0.0);
    let z_road = evaluate_elevation(&road.elevation_profile, s) as f32;
    let mx = mx as f32;
    let my = my as f32;
    let sz = 0.6f32;
    let z = z_road + 0.05;

    // Square (4 triangles from center):  2 triangles top-right + bottom-left halves
    let tl = [mx - sz, my - sz, z];
    let tr = [mx + sz, my - sz, z];
    let bl = [mx - sz, my + sz, z];
    let br = [mx + sz, my + sz, z];

    let mut floats = Vec::with_capacity(6 * 7);
    for p in &[tl, tr, br, tl, br, bl] {
        floats.extend_from_slice(&[p[0], p[1], p[2], r, g, b, a]);
    }
    Ok(floats)
}
