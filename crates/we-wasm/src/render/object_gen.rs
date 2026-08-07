use wasm_bindgen::prelude::*;

use we_core::model::ObjectType;

use super::area_fill::{
    AREA_OUTLINE_Z_LIFT, HATCH_ANGLE_DEG, SIMPLE_HATCH_LINE_GAP, area_default_size,
    area_world_polygon, corner_world_points, emit_area_arrows, fill_angled_stripes,
    fill_cross_hatch, oriented_rect_world_polygon,
};
use super::helpers::road_point_at_s;
use super::object_palette::{object_color, object_line_width};
use super::signal_mesh::{
    emit_thick_segment, emit_transverse_bar, emit_world_polygon_outline, emit_world_polyline,
};

/// The selection highlight is drawn slightly wider than the object outline so
/// it fully covers it instead of leaving coloured fringes.
const HIGHLIGHT_WIDTH_FACTOR: f64 = 1.5;

/// C# `ObjectTessellator.BuildHeader` paints the orientation indicator red.
const HEADING_INDICATOR_COLOR: [f32; 4] = [1.0, 0.0, 0.0, 1.0];

/// Smallest footprint edge for marker objects (C# `Placable.GetDisplaySize`
/// floors both dimensions at 1 m so hair-thin poles stay visible).
const MIN_MARKER_EXTENT: f64 = 1.0;

/// Surface pattern painted inside an area object's outline.
enum AreaFill {
    /// Outline only (parking spaces).
    None,
    /// One set of parallel stripes at `angle_deg` to the road tangent.
    Stripes { angle_deg: f64, line_gap: f64 },
    /// Two perpendicular stripe sets forming a hatch grid.
    CrossHatch { angle_deg: f64, line_gap: f64 },
    /// Directional paint arrow(s), by `signal_arrows` template name.
    Arrow(&'static str),
}

/// Objects the legacy editor stores as `type="AlongRoad"`: their corner list is
/// a path to stroke, not a footprint to close.
fn is_along_road(object_type: &ObjectType) -> bool {
    matches!(
        object_type,
        ObjectType::Guardrail
            | ObjectType::Barrier
            | ObjectType::Curb
            | ObjectType::Wall
            | ObjectType::SidewalkRail
            | ObjectType::FlowerBed
            | ObjectType::Bridge
            | ObjectType::Tunnel
    )
}

/// Read the `Angle` / `LineWidth` / `LineGap` userData knobs, falling back to
/// the supplied per-type defaults.
fn stripe_user_data(
    obj: &we_core::model::RoadObject,
    default_angle_deg: f64,
    default_gap: f64,
) -> (f64, f64, f64) {
    let mut angle_deg = default_angle_deg;
    let mut line_width = 0.0;
    let mut line_gap = default_gap;
    for (code, value) in &obj.user_data {
        match code.as_str() {
            "Angle" => angle_deg = value.parse().unwrap_or(default_angle_deg),
            "LineWidth" => line_width = value.parse().unwrap_or(0.0),
            "LineGap" => line_gap = value.parse().unwrap_or(default_gap),
            _ => {}
        }
    }
    (angle_deg, line_width, line_gap)
}

/// Render an area road object as a filled surface pattern plus a thin outline.
///
/// The footprint comes from `cornerLocal` / `cornerRoad` data when present and
/// is otherwise synthesised from `length` / `width`, so template-placed objects
/// (which never carry corners) get the same fill as imported OpenDRIVE ones.
fn emit_area_object(
    obj: &we_core::model::RoadObject,
    ref_pt: &we_core::geometry::eval::RefLinePoint,
    plan_view: &[we_core::model::Geometry],
    z: f32,
    fill: AreaFill,
    out: &mut Vec<f32>,
) {
    let poly = area_world_polygon(obj, ref_pt, plan_view);
    if poly.len() < 3 {
        return;
    }
    let color = object_color(&obj.object_type);

    match fill {
        AreaFill::None => {}
        AreaFill::Stripes {
            angle_deg,
            line_gap,
        } => {
            let (angle_deg, line_width, line_gap) = stripe_user_data(obj, angle_deg, line_gap);
            fill_angled_stripes(
                &poly,
                ref_pt.hdg,
                angle_deg,
                line_width,
                line_gap,
                z,
                stripe_color(&obj.object_type, color),
                out,
            );
        }
        AreaFill::CrossHatch {
            angle_deg,
            line_gap,
        } => {
            let (angle_deg, line_width, line_gap) = stripe_user_data(obj, angle_deg, line_gap);
            fill_cross_hatch(
                &poly,
                ref_pt.hdg,
                angle_deg,
                line_width,
                line_gap,
                z,
                stripe_color(&obj.object_type, color),
                out,
            );
        }
        AreaFill::Arrow(subtype) => {
            emit_area_arrows(&poly, ref_pt.hdg + obj.hdg, subtype, z, color, out)
        }
    }

    emit_world_polygon_outline(
        &poly,
        z + AREA_OUTLINE_Z_LIFT,
        object_line_width(&obj.object_type),
        color,
        out,
    );
}

/// Crosswalk stripes are painted white regardless of the outline colour
/// (C# fills them with the "Stop Line" colour); hatches use their own colour.
fn stripe_color(object_type: &ObjectType, outline: [f32; 4]) -> [f32; 4] {
    match object_type {
        ObjectType::Crosswalk => [1.0, 1.0, 1.0, 1.0],
        _ => outline,
    }
}

/// Render a marker object the way C# `BuildObjectGeneral` does: a thin oriented
/// rectangle outline plus a red heading indicator.
fn emit_marker_object(
    obj: &we_core::model::RoadObject,
    ref_pt: &we_core::geometry::eval::RefLinePoint,
    z: f32,
    out: &mut Vec<f32>,
) {
    let color = object_color(&obj.object_type);
    let line_width = object_line_width(&obj.object_type);
    let length = obj.length.max(MIN_MARKER_EXTENT);
    let width = obj.width.max(MIN_MARKER_EXTENT);
    let poly = oriented_rect_world_polygon(ref_pt, obj.position.y, obj.hdg, length, width);
    emit_world_polygon_outline(&poly, z, line_width, color, out);
    emit_heading_indicator(obj, ref_pt, z, line_width, out);
}

/// Draw the object's forward direction as a red stub, so its heading is
/// readable even for square footprints (C# `BuildObjectTessellator.BuildHeader`).
///
/// The stub runs from the centre to the front edge of the marker rectangle, so
/// it never grows past the footprint the selection highlight traces.
fn emit_heading_indicator(
    obj: &we_core::model::RoadObject,
    ref_pt: &we_core::geometry::eval::RefLinePoint,
    z: f32,
    line_width: f64,
    out: &mut Vec<f32>,
) {
    use we_core::geometry::eval::offset_point;

    let len = obj.length.max(MIN_MARKER_EXTENT) / 2.0;
    let hdg = ref_pt.hdg + obj.hdg;
    let (ox, oy, _) = offset_point(ref_pt, obj.position.y, 0.0);
    let tip = (ox + hdg.cos() * len, oy + hdg.sin() * len);
    emit_thick_segment((ox, oy), tip, z, line_width, HEADING_INDICATOR_COLOR, out);
}

/// Generate road object vertices from a project JSON. Returns vertex data as Float32Array.
///
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
///
/// Object types fall into four families:
/// - **Painted lines** (`StopLine`, `SlowDownToYieldLine`, `StopToYieldLine`):
///   a transverse bar across the road.
/// - **Areas** (`Crosswalk`, `ParkingSpace`, `CrossHatchArea`, `SimpleCrossHatch`,
///   `WovenArea`, waiting areas): a stripe / hatch / arrow fill plus a thin outline.
/// - **Along-road objects** (`Guardrail`, `Curb`, `Wall`, `FlowerBed`,
///   `SidewalkRail`, `Bridge`, `Tunnel`): their corner list stroked as a polyline.
/// - **Markers** (signs, poles, gantries, bins): an oriented rectangle outline
///   plus a red heading indicator.
///
/// Colours and stroke widths come from [`super::object_palette`].
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
            let z_road =
                evaluate_elevation(&road.elevation_profile, s) as f32 + z_offset.max(0.0) + 0.05;

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
                        object_line_width(&ObjectType::StopLine),
                        object_color(&ObjectType::StopLine),
                        &offset_point,
                        &mut all_floats,
                    );
                }
                ObjectType::SlowDownToYieldLine | ObjectType::StopToYieldLine => {
                    // Painted yield bands: keep a visible width rather than the
                    // 0.1 m outline stroke the C# type table declares.
                    let bar_w = if obj.width > 0.0 { obj.width } else { 3.5 };
                    let thickness = if obj.object_type == ObjectType::StopToYieldLine {
                        0.3
                    } else {
                        0.4
                    };
                    emit_transverse_bar(
                        &ref_pt,
                        t,
                        z_road,
                        bar_w,
                        thickness,
                        object_color(&obj.object_type),
                        &offset_point,
                        &mut all_floats,
                    );
                }
                ObjectType::Crosswalk | ObjectType::WovenArea => {
                    emit_area_object(
                        obj,
                        &ref_pt,
                        &road.plan_view,
                        z_road,
                        AreaFill::Stripes {
                            angle_deg: 0.0,
                            line_gap: 0.0,
                        },
                        &mut all_floats,
                    );
                }
                ObjectType::ParkingSpace => {
                    emit_area_object(
                        obj,
                        &ref_pt,
                        &road.plan_view,
                        z_road,
                        AreaFill::None,
                        &mut all_floats,
                    );
                }
                ObjectType::CrossHatchArea | ObjectType::SimpleCrossHatch => {
                    let line_gap = if obj.object_type == ObjectType::SimpleCrossHatch {
                        SIMPLE_HATCH_LINE_GAP
                    } else {
                        0.0
                    };
                    emit_area_object(
                        obj,
                        &ref_pt,
                        &road.plan_view,
                        z_road,
                        AreaFill::CrossHatch {
                            angle_deg: HATCH_ANGLE_DEG,
                            line_gap,
                        },
                        &mut all_floats,
                    );
                }
                ObjectType::ForwardWaitingArea | ObjectType::TurnLeftWaitingArea => {
                    let arrow = if obj.object_type == ObjectType::TurnLeftWaitingArea {
                        "LeftTurnArrow"
                    } else {
                        "StraightAheadArrow"
                    };
                    emit_area_object(
                        obj,
                        &ref_pt,
                        &road.plan_view,
                        z_road,
                        AreaFill::Arrow(arrow),
                        &mut all_floats,
                    );
                }
                object_type if is_along_road(object_type) => {
                    let path = corner_world_points(obj, &ref_pt, &road.plan_view);
                    if path.len() >= 2 {
                        emit_world_polyline(
                            &path,
                            z_road,
                            object_line_width(object_type),
                            object_color(object_type),
                            &mut all_floats,
                        );
                    } else {
                        emit_marker_object(obj, &ref_pt, z_road, &mut all_floats);
                    }
                }
                _ => {
                    // Signs, poles, gantries, bins, cones and unknown types.
                    emit_marker_object(obj, &ref_pt, z_road, &mut all_floats);
                }
            }
        }
    }

    Ok(all_floats)
}

/// Build the selection-highlight outline for a single road object.
///
/// Every branch traces the exact footprint the render path draws — area objects
/// reuse [`area_world_polygon`], along-road objects their corner polyline and
/// markers their oriented rectangle — so the highlight can never drift from
/// what is on screen.
pub(super) fn object_highlight_vertices(
    road: &we_core::model::Road,
    obj: &we_core::model::RoadObject,
    color: [f32; 4],
) -> Vec<f32> {
    use we_core::geometry::eval::evaluate_elevation;

    let s = obj.position.x;
    let t = obj.position.y;
    let Some(ref_pt) = road_point_at_s(&road.plan_view, s) else {
        return Vec::new();
    };

    let z_base = evaluate_elevation(&road.elevation_profile, s) as f32 + 0.08;
    let thickness = object_line_width(&obj.object_type) * HIGHLIGHT_WIDTH_FACTOR;
    let mut floats: Vec<f32> = Vec::new();

    // Stop lines are drawn as a transverse bar whose position is corrected by
    // the corner data (see the render path above); replicate that correction.
    if obj.object_type == ObjectType::StopLine {
        let (bar_ref, bar_t, bar_w) = if obj.corners.len() >= 2 {
            let (cos_h, sin_h) = (obj.hdg.cos(), obj.hdg.sin());
            let ds0 = obj.corners[0].x * cos_h - obj.corners[0].y * sin_h;
            let ds1 = obj.corners[1].x * cos_h - obj.corners[1].y * sin_h;
            let dt0 = obj.corners[0].x * sin_h + obj.corners[0].y * cos_h;
            let dt1 = obj.corners[1].x * sin_h + obj.corners[1].y * cos_h;
            let w = (dt1 - dt0).abs();
            let actual_s = (s + (ds0 + ds1) / 2.0).clamp(0.0, road.length);
            let rp = road_point_at_s(&road.plan_view, actual_s).unwrap_or(ref_pt);
            (
                rp,
                t + (dt0 + dt1) / 2.0,
                if w > 0.01 { w } else { obj.width.max(3.5) },
            )
        } else {
            (ref_pt, t, if obj.width > 0.0 { obj.width } else { 3.5 })
        };
        let z = evaluate_elevation(&road.elevation_profile, bar_ref.s) as f32 + 0.08;
        let bar_thickness = object_line_width(&ObjectType::StopLine);
        let poly = oriented_rect_world_polygon(&bar_ref, bar_t, 0.0, bar_thickness, bar_w);
        emit_world_polygon_outline(&poly, z, thickness, color, &mut floats);
        return floats;
    }

    if area_default_size(&obj.object_type).is_some() {
        let poly = area_world_polygon(obj, &ref_pt, &road.plan_view);
        emit_world_polygon_outline(&poly, z_base, thickness, color, &mut floats);
        return floats;
    }

    if is_along_road(&obj.object_type) {
        let path = corner_world_points(obj, &ref_pt, &road.plan_view);
        if path.len() >= 2 {
            emit_world_polyline(&path, z_base, thickness, color, &mut floats);
            return floats;
        }
    } else if obj.corners.len() >= 3 {
        let poly = corner_world_points(obj, &ref_pt, &road.plan_view);
        emit_world_polygon_outline(&poly, z_base, thickness, color, &mut floats);
        return floats;
    }

    // Markers: box them at the same footprint `emit_marker_object` draws.
    let poly = oriented_rect_world_polygon(
        &ref_pt,
        t,
        obj.hdg,
        obj.length.max(MIN_MARKER_EXTENT),
        obj.width.max(MIN_MARKER_EXTENT),
    );
    emit_world_polygon_outline(&poly, z_base, thickness, color, &mut floats);
    floats
}

/// Generate a selection-highlight mesh for a single road object.
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
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let Some(road) = project.roads.iter().find(|rd| rd.id == road_id) else {
        return Ok(Vec::new());
    };
    let Some(obj) = road.objects.iter().find(|o| o.id == object_id) else {
        return Ok(Vec::new());
    };

    Ok(object_highlight_vertices(road, obj, [r, g, b, a]))
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
        // Sign object: no corners, length=0 and width=0.5 → both floored at
        // MIN_MARKER_EXTENT (1.0 m), giving a 1 m × 1 m oriented rect outline.
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
        let xs: Vec<f32> = verts.chunks(7).map(|v| v[0]).collect();
        let ys: Vec<f32> = verts.chunks(7).map(|v| v[1]).collect();
        let xmin = xs.iter().copied().fold(f32::INFINITY, f32::min);
        let xmax = xs.iter().copied().fold(f32::NEG_INFINITY, f32::max);
        let ymin = ys.iter().copied().fold(f32::INFINITY, f32::min);
        let ymax = ys.iter().copied().fold(f32::NEG_INFINITY, f32::max);
        // half extents 0.5 each way, plus the highlight stroke half-width
        // (DEFAULT_LINE_WIDTH 0.1 × HIGHLIGHT_WIDTH_FACTOR 1.5 / 2 = 0.075).
        let hw = 0.075;
        assert!((xmin - (5.0 - 0.5 - hw)).abs() < 0.05, "xmin={xmin}");
        assert!((xmax - (5.0 + 0.5 + hw)).abs() < 0.05, "xmax={xmax}");
        assert!((ymin - (2.0 - 0.5 - hw)).abs() < 0.05, "ymin={ymin}");
        assert!((ymax - (2.0 + 0.5 + hw)).abs() < 0.05, "ymax={ymax}");
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

        assert!(
            !verts.is_empty(),
            "expected vertices for crosswalk at s > road.length"
        );

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

    /// Template-placed area objects carry no corner data (`corners: []`), only
    /// `length`/`width`.  They must still be filled with their surface pattern,
    /// not drawn as a bare outline box.
    #[test]
    fn test_corner_less_area_objects_emit_surface_fill() {
        // Outline alone is 4 edges × 6 verts × 7 floats = 168 floats.
        const OUTLINE_FLOATS: usize = 4 * 6 * 7;

        for object_type in [
            ObjectType::Crosswalk,
            ObjectType::CrossHatchArea,
            ObjectType::WovenArea,
            ObjectType::ForwardWaitingArea,
            ObjectType::TurnLeftWaitingArea,
        ] {
            let mut obj = road_object("area-1", object_type.clone(), 5.0, 0.0);
            obj.length = 4.0;
            obj.width = 3.0;
            let project = road_with_object(obj, None);
            let json = serde_json::to_string(&project).unwrap();

            let verts = generate_object_vertices(&json).unwrap();

            assert!(
                verts.len() > OUTLINE_FLOATS,
                "{object_type:?} emitted {} floats — expected outline plus interior fill",
                verts.len()
            );

            // Every vertex must stay inside the 4 m × 3 m footprint (plus outline
            // half-width) centred at s=5 on a straight east-bound road.
            for chunk in verts.chunks(7) {
                assert!(
                    (chunk[0] - 5.0).abs() < 2.1 && chunk[1].abs() < 1.6,
                    "{object_type:?} vertex ({}, {}) escaped the footprint",
                    chunk[0],
                    chunk[1]
                );
            }
        }
    }

    /// Parking spaces keep the outline-only look (no surface pattern).
    #[test]
    fn test_corner_less_parking_space_stays_outline_only() {
        let mut obj = road_object("ps-1", ObjectType::ParkingSpace, 5.0, 0.0);
        obj.length = 5.0;
        obj.width = 2.5;
        let project = road_with_object(obj, None);
        let json = serde_json::to_string(&project).unwrap();

        let verts = generate_object_vertices(&json).unwrap();

        assert_eq!(verts.len(), 4 * 6 * 7);
    }

    /// The selection highlight must trace the object's real footprint.  On a
    /// road whose heading is not zero the highlight used to be rotated by
    /// `obj.hdg` alone, leaving a visible gap against the rendered area.
    #[test]
    fn test_area_object_highlight_matches_rendered_footprint() {
        fn bounds(verts: &[f32]) -> (f32, f32, f32, f32) {
            verts.chunks(7).fold(
                (f32::MAX, f32::MIN, f32::MAX, f32::MIN),
                |(x0, x1, y0, y1), v| (x0.min(v[0]), x1.max(v[0]), y0.min(v[1]), y1.max(v[1])),
            )
        }

        for object_type in [
            ObjectType::Crosswalk,
            ObjectType::CrossHatchArea,
            ObjectType::ParkingSpace,
        ] {
            let mut obj = road_object("area-1", object_type.clone(), 6.0, 1.5);
            obj.length = 4.0;
            obj.width = 3.0;
            obj.hdg = std::f64::consts::FRAC_PI_2;

            // Road heading 0.7 rad — the case the old highlight got wrong.
            let mut road = Road::from_centerline(
                "road-1",
                vec![Geometry {
                    s: 0.0,
                    x: 10.0,
                    y: -4.0,
                    hdg: 0.7,
                    length: 20.0,
                    geo_type: GeometryType::Line,
                }],
            );
            road.objects.push(obj);
            let project = Project {
                roads: vec![road],
                ..Project::default()
            };
            let json = serde_json::to_string(&project).unwrap();

            let fill = generate_object_vertices(&json).unwrap();
            let highlight =
                generate_single_object_vertices(&json, "road-1", "area-1", 1.0, 0.0, 0.0, 1.0)
                    .unwrap();

            let (fx0, fx1, fy0, fy1) = bounds(&fill);
            let (hx0, hx1, hy0, hy1) = bounds(&highlight);

            // Both strokes straddle the same polygon edges, so the bounding
            // boxes agree to within half the (thicker) highlight stroke.
            const TOL: f32 = 0.2;
            for (f, h, axis) in [
                (fx0, hx0, "xmin"),
                (fx1, hx1, "xmax"),
                (fy0, hy0, "ymin"),
                (fy1, hy1, "ymax"),
            ] {
                assert!(
                    (f - h).abs() < TOL,
                    "{object_type:?} {axis}: rendered {f:.3} vs highlight {h:.3}"
                );
            }
        }
    }

    /// Objects the legacy editor stores as `type="AlongRoad"` stroke their
    /// corner list as an open path — one quad per segment, never a closed loop.
    #[test]
    fn test_along_road_objects_stroke_their_corner_path() {
        for object_type in [
            ObjectType::Guardrail,
            ObjectType::Curb,
            ObjectType::Wall,
            ObjectType::SidewalkRail,
            ObjectType::FlowerBed,
            ObjectType::Bridge,
            ObjectType::Tunnel,
        ] {
            let mut obj = road_object("rail-1", object_type.clone(), 2.0, 0.0);
            obj.corners = vec![
                Point3D::new(0.0, 0.0, 0.0),
                Point3D::new(2.0, 0.5, 0.0),
                Point3D::new(4.0, 0.5, 0.0),
                Point3D::new(6.0, 0.0, 0.0),
            ];
            let project = road_with_object(obj, None);
            let json = serde_json::to_string(&project).unwrap();

            let verts = generate_object_vertices(&json).unwrap();

            // 3 segments × 2 triangles × 3 verts × 7 floats (an open polyline;
            // a closed outline would emit a fourth segment).
            assert_eq!(
                verts.len(),
                3 * 6 * 7,
                "{object_type:?} emitted {} floats",
                verts.len()
            );
        }
    }

    /// Regression guard: these types used to fall into a `_ => {}` arm and
    /// render nothing at all.
    #[test]
    fn test_every_object_type_emits_geometry() {
        for object_type in [
            ObjectType::Sign,
            ObjectType::Guardrail,
            ObjectType::Barrier,
            ObjectType::Curb,
            ObjectType::Wall,
            ObjectType::Pillar,
            ObjectType::Pole,
            ObjectType::TrafficCone,
            ObjectType::ParkingSpace,
            ObjectType::Crosswalk,
            ObjectType::StopLine,
            ObjectType::CrossHatchArea,
            ObjectType::SimpleCrossHatch,
            ObjectType::WovenArea,
            ObjectType::ForwardWaitingArea,
            ObjectType::TurnLeftWaitingArea,
            ObjectType::SlowDownToYieldLine,
            ObjectType::StopToYieldLine,
            ObjectType::SimpleSignalPole,
            ObjectType::TrafficLightPole,
            ObjectType::StreetLightPole,
            ObjectType::SignGantry,
            ObjectType::LTypeSignalPole,
            ObjectType::TTypeSignalPole,
            ObjectType::SidewalkRail,
            ObjectType::TrashBin,
            ObjectType::Bridge,
            ObjectType::Tunnel,
            ObjectType::Custom("unknown-kind".into()),
        ] {
            let mut obj = road_object("any-1", object_type.clone(), 5.0, 0.0);
            obj.length = 4.0;
            obj.width = 3.0;
            let project = road_with_object(obj, None);
            let json = serde_json::to_string(&project).unwrap();

            let verts = generate_object_vertices(&json).unwrap();

            assert!(!verts.is_empty(), "{object_type:?} rendered nothing");
            assert_eq!(
                verts.len() % 7,
                0,
                "{object_type:?} emitted a partial vertex"
            );
        }
    }

    /// Markers get an oriented rectangle plus a red heading stub so their
    /// facing direction is readable (C# `BuildHeader`).
    #[test]
    fn test_marker_objects_emit_a_red_heading_indicator() {
        let mut obj = road_object("pole-1", ObjectType::TrafficLightPole, 5.0, 1.0);
        obj.length = 1.5;
        obj.width = 1.5;
        let project = road_with_object(obj, None);
        let json = serde_json::to_string(&project).unwrap();

        let verts = generate_object_vertices(&json).unwrap();

        // 4 outline edges + 1 heading stub = 5 quads.
        assert_eq!(verts.len(), 5 * 6 * 7);
        let red = verts
            .chunks(7)
            .filter(|v| v[3] > 0.99 && v[4] < 0.01 && v[5] < 0.01)
            .count();
        assert_eq!(red, 6, "expected exactly one red heading quad");
    }

    /// `SimpleCrossHatch` uses a 3 m gap versus `CrossHatchArea`'s 0.6 m, so it
    /// must produce visibly fewer stripes over the same footprint.
    #[test]
    fn test_simple_cross_hatch_is_sparser_than_cross_hatch_area() {
        let area_floats = |object_type: ObjectType| {
            let mut obj = road_object("hatch-1", object_type, 5.0, 0.0);
            obj.length = 8.0;
            obj.width = 4.0;
            let project = road_with_object(obj, None);
            let json = serde_json::to_string(&project).unwrap();
            generate_object_vertices(&json).unwrap().len()
        };

        let dense = area_floats(ObjectType::CrossHatchArea);
        let sparse = area_floats(ObjectType::SimpleCrossHatch);
        assert!(sparse < dense, "sparse={sparse} dense={dense}");
    }

    /// Woven areas keep a single stripe direction; hatch areas cross two sets,
    /// so the hatch emits roughly twice the fill geometry.
    #[test]
    fn test_woven_area_uses_a_single_stripe_direction() {
        let fill_floats = |object_type: ObjectType| {
            let mut obj = road_object("area-1", object_type, 5.0, 0.0);
            obj.length = 8.0;
            obj.width = 4.0;
            let project = road_with_object(obj, None);
            let json = serde_json::to_string(&project).unwrap();
            // Subtract the 4-edge outline to compare fill geometry only.
            generate_object_vertices(&json).unwrap().len() - 4 * 6 * 7
        };

        let woven = fill_floats(ObjectType::WovenArea);
        let hatch = fill_floats(ObjectType::CrossHatchArea);
        assert!(woven > 0 && hatch > woven, "woven={woven} hatch={hatch}");
    }

    /// Crosswalk stripes are painted white even though the outline is navy.
    #[test]
    fn test_crosswalk_stripes_are_white_over_a_navy_outline() {
        let mut obj = road_object("cw-1", ObjectType::Crosswalk, 5.0, 0.0);
        obj.length = 4.0;
        obj.width = 3.0;
        let project = road_with_object(obj, None);
        let json = serde_json::to_string(&project).unwrap();

        let verts = generate_object_vertices(&json).unwrap();

        let white = verts
            .chunks(7)
            .filter(|v| v[3] > 0.99 && v[4] > 0.99 && v[5] > 0.99)
            .count();
        let navy = verts
            .chunks(7)
            .filter(|v| v[3] < 0.01 && v[4] < 0.01 && v[5] > 0.4)
            .count();
        assert!(white > 0, "no white stripe vertices");
        assert_eq!(navy, 4 * 6, "outline should be one navy quad per edge");
    }

    /// The highlight must trace the rendered footprint for markers and
    /// along-road objects too, not just areas.
    #[test]
    fn test_marker_and_along_road_highlights_match_rendered_footprint() {
        fn bounds(verts: &[f32]) -> (f32, f32, f32, f32) {
            verts.chunks(7).fold(
                (f32::MAX, f32::MIN, f32::MAX, f32::MIN),
                |(x0, x1, y0, y1), v| (x0.min(v[0]), x1.max(v[0]), y0.min(v[1]), y1.max(v[1])),
            )
        }

        for (object_type, with_corners) in [
            (ObjectType::TrafficLightPole, false),
            (ObjectType::SignGantry, false),
            (ObjectType::TrashBin, false),
            (ObjectType::Guardrail, true),
            (ObjectType::FlowerBed, true),
        ] {
            let mut obj = road_object("obj-1", object_type.clone(), 6.0, 1.5);
            obj.length = 3.0;
            obj.width = 2.0;
            obj.hdg = 0.4;
            if with_corners {
                obj.corners = vec![
                    Point3D::new(0.0, 0.0, 0.0),
                    Point3D::new(3.0, 1.0, 0.0),
                    Point3D::new(6.0, 1.0, 0.0),
                ];
            }

            let mut road = Road::from_centerline(
                "road-1",
                vec![Geometry {
                    s: 0.0,
                    x: 10.0,
                    y: -4.0,
                    hdg: 0.7,
                    length: 20.0,
                    geo_type: GeometryType::Line,
                }],
            );
            road.objects.push(obj);
            let project = Project {
                roads: vec![road],
                ..Project::default()
            };
            let json = serde_json::to_string(&project).unwrap();

            let rendered = generate_object_vertices(&json).unwrap();
            let highlight =
                generate_single_object_vertices(&json, "road-1", "obj-1", 1.0, 0.0, 0.0, 1.0)
                    .unwrap();

            let (fx0, fx1, fy0, fy1) = bounds(&rendered);
            let (hx0, hx1, hy0, hy1) = bounds(&highlight);

            // The rendered marker also carries the heading stub, which stays
            // inside the footprint, so both boxes agree to within the stroke.
            const TOL: f32 = 0.2;
            for (f, h, axis) in [
                (fx0, hx0, "xmin"),
                (fx1, hx1, "xmax"),
                (fy0, hy0, "ymin"),
                (fy1, hy1, "ymax"),
            ] {
                assert!(
                    (f - h).abs() < TOL,
                    "{object_type:?} {axis}: rendered {f:.3} vs highlight {h:.3}"
                );
            }
        }
    }
}
