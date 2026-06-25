use wasm_bindgen::prelude::*;

use super::helpers::road_point_at_s;
use super::signal_mesh::{
    crosswalk_world_polygon, emit_crosswalk_stripes, emit_longitudinal_strip, emit_polygon_outline,
    emit_polygon_outline_road_corners, emit_rect_outline, emit_square_marker, emit_transverse_bar,
    emit_world_polygon_outline,
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
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    generate_object_vertices_from_project(&project)
}

/// Generate road object vertices using the cached project (avoids JSON serialization).
///
/// Requires `set_project_cache()` to have been called previously. This is the
/// fast path used on every surface-mesh refresh so the whole project no longer
/// has to be re-serialised to JSON just to re-tessellate its objects.
#[wasm_bindgen]
pub fn generate_object_vertices_cached() -> Result<Vec<f32>, JsError> {
    use crate::picking::with_project_cache;

    with_project_cache(|cache| generate_object_vertices_from_project(&cache.project))
}

/// Internal: generate road object vertices from a parsed `Project` reference.
pub(super) fn generate_object_vertices_from_project(
    project: &we_core::model::Project,
) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::{evaluate_elevation, offset_point, sample_road_reference_line};
    use we_core::model::{CornerType, ObjectType};

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
            // Objects with s > road.length are allowed; road_point_at_s extrapolates by
            // tangent extension, which correctly positions objects that straddle the
            // road/junction boundary (common in 51World XODR exports).
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
            // 5 cm above the road surface prevents z-fighting with road/junction polygons,
            // even in perspective view where depth precision degrades with distance.
            // obj.position.z is respected as an additional offset but clamped to ≥ 0 so that
            // negative z-values in XODR data (common in 51World exports) cannot pull objects
            // below road surface.
            let z_road = evaluate_elevation(&road.elevation_profile, s) as f32
                + z_offset.max(0.0)
                + 0.05;

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
                            + z_offset.max(0.0)
                            + 0.05;
                        (if w > 0.01 { w } else { obj.width.max(3.5) }, center, rp, z)
                    } else {
                        (
                            if obj.width > 0.0 { obj.width } else { 3.5 },
                            t,
                            ref_pt,
                            z_road,
                        )
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
                                // ref_pt is the tangent-extended position at obj.s — for crosswalks
                                // with s slightly beyond road.length (common in 51World exports) this
                                // correctly places the stripes at the junction entrance, consistent
                                // with the selection-highlight box drawn by generate_single_object_vertices.
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
/// Generate a selection-highlight mesh for a single road object.
///
/// For objects that have corner data (crosswalks, parking spaces, etc.) the
/// highlight is rendered as an outline of the object polygon so the user can
/// see exactly what was selected.  Objects without corners fall back to a
/// labelled rectangle sized from the object's `length` / `width` attributes,
/// or a small square when neither is provided.
///
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
    use we_core::model::{CornerType, ObjectType, Project};

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

    let color = [r, g, b, a];
    let z_base = evaluate_elevation(&road.elevation_profile, s) as f32 + 0.08;
    let mut floats: Vec<f32> = Vec::new();

    if !obj.corners.is_empty() {
        // The highlight outline must hug the same geometry the object actually
        // renders as. Crosswalks (cornerLocal) are drawn as zebra stripes via
        // `emit_crosswalk_stripes`, which uses `crosswalk_world_polygon` for its
        // heading-convention detection — so the highlight reuses that exact
        // polygon. All other area objects share `emit_polygon_outline`.
        let is_crosswalk_local =
            obj.object_type == ObjectType::Crosswalk && obj.corner_type == CornerType::Local;
        if is_crosswalk_local {
            let world_poly = crosswalk_world_polygon(
                &obj.corners,
                &ref_pt,
                t,
                obj.hdg,
                &offset_point,
                obj.length,
                obj.width,
            );
            emit_world_polygon_outline(&world_poly, z_base, 0.35, color, &mut floats);
        } else {
            emit_polygon_outline(
                &obj.corners,
                &ref_pt,
                &road.elevation_profile,
                s,
                t,
                obj.hdg,
                z_base,
                0.35,
                color,
                &offset_point,
                &mut floats,
                obj.length,
                obj.width,
            );
        }
    } else {
        // No corner data — render a rect outline sized from length/width, or a
        // default square for objects that carry neither dimension.
        let (mx, my, _) = offset_point(&ref_pt, t, 0.0);
        let mx = mx as f32;
        let my = my as f32;
        let half_l = if obj.length > 0.0 { (obj.length / 2.0) as f32 } else { 0.6 };
        let half_w = if obj.width > 0.0 { (obj.width / 2.0) as f32 } else { 0.6 };
        let z = z_base;
        let (cos_h, sin_h) = (obj.hdg.cos() as f32, obj.hdg.sin() as f32);
        // Four corners of the oriented rectangle.
        let corners = [
            (mx + cos_h * half_l - sin_h * half_w, my + sin_h * half_l + cos_h * half_w),
            (mx + cos_h * half_l + sin_h * half_w, my + sin_h * half_l - cos_h * half_w),
            (mx - cos_h * half_l + sin_h * half_w, my - sin_h * half_l - cos_h * half_w),
            (mx - cos_h * half_l - sin_h * half_w, my - sin_h * half_l + cos_h * half_w),
        ];
        let hw = 0.18f32;
        let [cr, cg, cb, ca] = color;
        for i in 0..4 {
            let (ax, ay) = corners[i];
            let (bx, by) = corners[(i + 1) % 4];
            let dx = bx - ax;
            let dy = by - ay;
            let len = (dx * dx + dy * dy).sqrt().max(1e-5);
            let nx = -dy / len * hw;
            let ny = dx / len * hw;
            floats.extend_from_slice(&[ax + nx, ay + ny, z, cr, cg, cb, ca]);
            floats.extend_from_slice(&[ax - nx, ay - ny, z, cr, cg, cb, ca]);
            floats.extend_from_slice(&[bx - nx, by - ny, z, cr, cg, cb, ca]);
            floats.extend_from_slice(&[ax + nx, ay + ny, z, cr, cg, cb, ca]);
            floats.extend_from_slice(&[bx - nx, by - ny, z, cr, cg, cb, ca]);
            floats.extend_from_slice(&[bx + nx, by + ny, z, cr, cg, cb, ca]);
        }
    }
    Ok(floats)
}

#[cfg(test)]
mod tests {
    use super::{generate_object_vertices, generate_single_object_vertices};
    use we_core::model::{Geometry, GeometryType, ObjectType, Point3D, Project, Road, RoadObject};

    fn road_with_object(object: RoadObject, junction_id: Option<&str>) -> Project {
        let mut road = Road::from_centerline(
            "road-1",
            vec![Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length: 10.0,
                geo_type: GeometryType::Line,
            }],
        );
        road.junction_id = junction_id.map(str::to_string);
        road.objects.push(object);
        Project {
            roads: vec![road],
            ..Project::default()
        }
    }

    fn road_object(id: &str, object_type: ObjectType, s: f64, t: f64) -> RoadObject {
        RoadObject {
            id: id.to_string(),
            object_type,
            name: String::new(),
            position: Point3D::new(s, t, 0.0),
            orientation: 0.0,
            hdg: 0.0,
            pitch: 0.0,
            roll: 0.0,
            width: 0.5,
            height: 0.0,
            length: 0.0,
            corners: vec![],
            corner_type: Default::default(),
            validity: None,
            from_object_ref: false,
            user_data: vec![],
        }
    }

    #[test]
    fn test_generate_single_object_vertices_returns_colored_square_marker() {
        // Sign object: no corners, length=0 → falls back to default 0.6m half-size rect outline.
        // Rect outline = 4 edges × 6 verts × 7 floats = 168 floats.
        let project = road_with_object(road_object("obj-1", ObjectType::Sign, 5.0, 2.0), None);
        let json = serde_json::to_string(&project).unwrap();

        let verts =
            generate_single_object_vertices(&json, "road-1", "obj-1", 0.1, 0.2, 0.3, 0.4).unwrap();

        // 4 edges × 2 triangles × 3 verts × 7 floats
        assert_eq!(verts.len(), 4 * 6 * 7);
        // All vertices carry the correct colour.
        assert!(verts.chunks(7).all(|v| {
            (v[3] - 0.1).abs() < 1e-4
                && (v[4] - 0.2).abs() < 1e-4
                && (v[5] - 0.3).abs() < 1e-4
                && (v[6] - 0.4).abs() < 1e-4
        }));
        // At least one vertex is near the centre x (road s=5) + t_lateral=2
        // and within the expected half-extents (0.6 × default half, 0.25 from width=0.5).
        let xs: Vec<f32> = verts.chunks(7).map(|v| v[0]).collect();
        let ys: Vec<f32> = verts.chunks(7).map(|v| v[1]).collect();
        let xmin = xs.iter().copied().fold(f32::INFINITY, f32::min);
        let xmax = xs.iter().copied().fold(f32::NEG_INFINITY, f32::max);
        let ymin = ys.iter().copied().fold(f32::INFINITY, f32::min);
        let ymax = ys.iter().copied().fold(f32::NEG_INFINITY, f32::max);
        // half_l = 0.6, half_w = 0.25, plus outline half-width = 0.18
        assert!((xmin - (5.0 - 0.6 - 0.18)).abs() < 0.05, "xmin={xmin}");
        assert!((xmax - (5.0 + 0.6 + 0.18)).abs() < 0.05, "xmax={xmax}");
        assert!((ymin - (2.0 - 0.25 - 0.18)).abs() < 0.05, "ymin={ymin}");
        assert!((ymax - (2.0 + 0.25 + 0.18)).abs() < 0.05, "ymax={ymax}");
    }

    #[test]
    fn test_generate_single_object_vertices_returns_empty_when_lookup_fails() {
        let project = road_with_object(road_object("obj-1", ObjectType::Sign, 5.0, 2.0), None);
        let json = serde_json::to_string(&project).unwrap();

        let verts = generate_single_object_vertices(&json, "road-1", "missing", 1.0, 1.0, 1.0, 1.0)
            .unwrap();

        assert!(verts.is_empty());
    }

    #[test]
    fn test_generate_object_vertices_skips_traffic_markings_on_junction_connectors() {
        let project = road_with_object(
            road_object("obj-1", ObjectType::Crosswalk, 5.0, 0.0),
            Some("junction-1"),
        );
        let json = serde_json::to_string(&project).unwrap();

        let verts = generate_object_vertices(&json).unwrap();

        assert!(verts.is_empty());
    }

    /// Crosswalk with s > road.length is rendered at the tangent-extrapolated position,
    /// consistent with all other road objects and with the selection-highlight box from
    /// generate_single_object_vertices.  This keeps the stripes co-located with the
    /// placeholder indicator that editors show for the object.
    #[test]
    fn test_crosswalk_past_road_end_renders_at_extrapolated_position() {
        // Road: straight east, length=10. Crosswalk at s=20 (10 m past road end).
        let cw = RoadObject {
            id: "cw-1".to_string(),
            object_type: ObjectType::Crosswalk,
            name: String::new(),
            position: Point3D::new(20.0, 0.0, 0.0),
            orientation: 0.0,
            hdg: 0.0,
            pitch: 0.0,
            roll: 0.0,
            width: 3.0,
            height: 0.0,
            length: 2.0,
            corners: vec![],
            corner_type: Default::default(),
            validity: None,
            from_object_ref: false,
            user_data: vec![],
        };
        let project = road_with_object(cw, None);
        let json = serde_json::to_string(&project).unwrap();

        let verts = generate_object_vertices(&json).unwrap();

        assert!(!verts.is_empty(), "expected vertices for crosswalk at s > road.length");

        // All vertex x-coordinates must be near x≈20 (tangent-extrapolated position),
        // not clamped to x≈10 (road endpoint).  The fallback rect outline is ≤4m wide.
        for chunk in verts.chunks(7) {
            let vx = chunk[0];
            assert!(
                vx > 15.0,
                "crosswalk vertex x={vx:.2} should be near extrapolated position (~20), not clamped to road endpoint (~10)"
            );
        }
    }

    /// The cached object generator must produce byte-identical output to the
    /// JSON path — it only skips re-serialising the whole project.
    #[test]
    fn test_generate_object_vertices_cached_matches_json_path() {
        let project = road_with_object(road_object("obj-1", ObjectType::Sign, 5.0, 2.0), None);
        let json = serde_json::to_string(&project).unwrap();

        let from_json = generate_object_vertices(&json).unwrap();

        // Populate the thread-local cache, then generate via the cached path.
        crate::picking::set_project_cache(&json).unwrap();
        let from_cache = super::generate_object_vertices_cached().unwrap();

        assert_eq!(from_json, from_cache);
        assert!(!from_cache.is_empty());
    }
}
