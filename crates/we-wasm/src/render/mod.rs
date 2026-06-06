use wasm_bindgen::prelude::*;

mod bridge_mesh;
mod colors;
mod helpers;
mod junction_mesh;
mod line_gen;
mod marking_mesh;
mod object_gen;
mod road_gen;
mod road_mesh;
mod signal_gen;
mod signal_mesh;

pub use road_gen::*;
pub use signal_gen::*;

pub(crate) use helpers::{eval_lane_offset, road_point_at_s};
pub(crate) use junction_mesh::{build_junction_polygon_points, point_in_polygon};

pub(crate) use colors::{road_hue_color, select_lane_color};
pub(crate) use road_mesh::{gen_default_ribbon, gen_lane_strip};
pub(crate) use signal_mesh::{arrow_triangles, sign_marker_color};

use junction_mesh::append_junction_triangles;

// Re-export submodule wasm_bindgen functions for tests
#[cfg(test)]
use object_gen::generate_object_vertices;

// ── Junction ──────────────────────────────────────────────────────────────────

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
    let color = [0.88f32, 0.85, 0.98, 0.65];

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

#[cfg(test)]
mod tests {
    use super::*;

    /// Verify arrow_triangles transform: tip of StraightAheadArrow (local +y) maps to
    /// the road forward direction (cos heading, sin heading) when scale=1, cx/cy=0.
    #[test]
    fn test_arrow_triangles_tip_points_forward() {
        use std::f32::consts::PI;

        // East-going road (heading = 0): tip should point east (+x)
        let verts = arrow_triangles("StraightAheadArrow", 0.0, 0.0, 0.0, 0.0_f32, 1.0);
        // The tip vertex (0.0, 0.5) in local space → with scale=1, cx=cy=0:
        // wx = 0*sin(0) + 0.5*cos(0) = 0.5, wy = -0*cos(0) + 0.5*sin(0) = 0
        // Search for (0.5, 0.0) in x/y positions of all vertices
        let has_tip = verts
            .chunks(7)
            .any(|v| (v[0] - 0.5).abs() < 1e-4 && v[1].abs() < 1e-4);
        assert!(
            has_tip,
            "Tip should be at (0.5, 0) for east-going road (heading=0)"
        );

        // North-going road (heading = PI/2): tip should point north (+y)
        let verts = arrow_triangles("StraightAheadArrow", 0.0, 0.0, 0.0, PI / 2.0, 1.0);
        let has_tip = verts
            .chunks(7)
            .any(|v| v[0].abs() < 1e-4 && (v[1] - 0.5).abs() < 1e-4);
        assert!(
            has_tip,
            "Tip should be at (0, 0.5) for north-going road (heading=PI/2)"
        );
    }

    /// Verify arrow_triangles renders forward at heading=0: tip points east (+x).
    #[test]
    fn test_arrow_triangles_east_road_forward() {
        // For an east-going road (heading=0), the arrow tip should be at +x world
        let verts = arrow_triangles("StraightAheadArrow", 10.0, 5.0, 0.0, 0.0_f32, 3.0);
        // Tip (0, 0.5) with scale=3, cx=10, cy=5 → wx = 10 + 0.5*3*1 = 11.5, wy = 5
        let has_tip = verts
            .chunks(7)
            .any(|v| (v[0] - 11.5).abs() < 1e-3 && (v[1] - 5.0).abs() < 1e-3);
        assert!(
            has_tip,
            "Tip should be at (11.5, 5.0); arrow should point east"
        );
    }

    // ── StopLine position tests ───────────────────────────────────────────────

    /// A minimal project JSON with one straight east-going road (hdg=0, length=20)
    /// and one stop line object.
    fn make_stop_line_project(obj_s: f64, hdg: f64, corners: &[(f64, f64)]) -> String {
        let corners_json: String = corners
            .iter()
            .map(|(u, v)| format!(r#"{{"x":{u},"y":{v},"z":0.0,"id":null}}"#))
            .collect::<Vec<_>>()
            .join(",");
        format!(
            r#"{{
                "name": "",
                "header": {{"rev_major":1,"rev_minor":0,"name":"","date":"",
                            "north":0,"south":0,"east":0,"west":0,"geo_reference":null}},
                "roads": [{{
                    "id": "1", "name": "", "length": 20.0, "junction_id": null,
                    "link": null,
                    "plan_view": [{{"s":0,"x":0,"y":0,"hdg":0,"length":20.0,"geo_type":"Line"}}],
                    "elevation_profile": [{{"s":0,"a":0,"b":0,"c":0,"d":0}}],
                    "lane_sections": [],
                    "objects": [{{
                        "id":"1","object_type":"StopLine","name":"Stop Line",
                        "position":{{"x":{obj_s},"y":0.0,"z":0.0,"id":null}},
                        "orientation":0.0,"hdg":{hdg},
                        "width":0.0,"height":0.0,"length":0.0,
                        "corners":[{corners_json}],
                        "validity":null
                    }}]
                }}],
                "junctions": []
            }}"#
        )
    }

    /// Stop line whose cornerLocal have v≈0 (like road 4 stop line 16).
    /// ds = u·cos(π/2) − v·sin(π/2) ≈ 0 → actual_s ≈ obj.s = 10.
    /// Vertices should be clustered near x=10.
    #[test]
    fn test_stop_line_zero_v_corners_uses_object_s() {
        let json = make_stop_line_project(
            10.0,
            std::f64::consts::FRAC_PI_2,
            &[(0.0, 0.0), (-3.5, 0.0)],
        );
        let verts = generate_object_vertices(&json).unwrap();
        assert!(!verts.is_empty(), "Expected vertices for stop line");
        let x_avg = verts.chunks(7).map(|v| v[0]).sum::<f32>() / (verts.len() / 7) as f32;
        assert!(
            (x_avg - 10.0).abs() < 0.3,
            "Stop line (v≈0) should render at x≈10 (obj.s), got x_avg={x_avg}"
        );
    }

    /// Stop line whose cornerLocal have v≠0 (like road 82 stop line 22).
    /// With hdg=π/2: ds = u·cos(π/2) − v·sin(π/2) ≈ −v = −3.5
    /// → actual_s = 10.0 − 3.5 = 6.5.
    /// WITHOUT the fix the bar would be at x≈10; WITH the fix it should be at x≈6.5.
    #[test]
    fn test_stop_line_nonzero_v_corners_uses_corrected_s() {
        let json =
            make_stop_line_project(10.0, std::f64::consts::FRAC_PI_2, &[(0.0, 3.5), (7.0, 3.5)]);
        let verts = generate_object_vertices(&json).unwrap();
        assert!(!verts.is_empty(), "Expected vertices for stop line");
        let x_avg = verts.chunks(7).map(|v| v[0]).sum::<f32>() / (verts.len() / 7) as f32;
        assert!(
            (x_avg - 6.5).abs() < 0.3,
            "Stop line (v≠0, ds≈-3.5) should render at x≈6.5 (corrected s), got x_avg={x_avg}"
        );
        assert!(
            (x_avg - 10.0).abs() > 1.0,
            "Stop line should NOT remain at obj.s=10, got x_avg={x_avg}"
        );
    }

    /// Verify that arrow_triangles correctly renders forward vs reversed headings.
    /// heading=0 → tip at +x; heading=π → tip at -x.
    #[test]
    fn test_arrow_heading_forward_and_reversed() {
        use std::f32::consts::PI;

        let forward = arrow_triangles("StraightAheadArrow", 0.0, 0.0, 0.0, 0.0_f32, 1.0);
        let reversed = arrow_triangles("StraightAheadArrow", 0.0, 0.0, 0.0, PI, 1.0);

        let forward_max_x = forward
            .chunks(7)
            .map(|v| v[0])
            .fold(f32::NEG_INFINITY, f32::max);
        let reversed_min_x = reversed
            .chunks(7)
            .map(|v| v[0])
            .fold(f32::INFINITY, f32::min);

        assert!(
            forward_max_x > 0.4,
            "Forward tip should be in +x, got {forward_max_x}"
        );
        assert!(
            reversed_min_x < -0.4,
            "Reversed tip should reach -x, got {reversed_min_x}"
        );
    }

    // ── Signal paint heading tests ────────────────────────────────────────────

    /// Minimal project JSON with one straight east-going road and one Graphics signal.
    fn make_signal_project(signal_s: f64, signal_t: f64, h_offset: f64) -> String {
        format!(
            r#"{{
                "name": "",
                "header": {{"rev_major":1,"rev_minor":0,"name":"","date":"",
                            "north":0,"south":0,"east":0,"west":0,"geo_reference":null}},
                "roads": [{{
                    "id": "1", "name": "", "length": 100.0, "junction_id": null,
                    "link": null,
                    "plan_view": [{{"s":0,"x":0,"y":0,"hdg":0,"length":100.0,"geo_type":"Line"}}],
                    "elevation_profile": [{{"s":0,"a":0,"b":0,"c":0,"d":0}}],
                    "lane_sections": [],
                    "signals": [{{
                        "id": "1", "name": "TestArrow",
                        "s": {signal_s}, "t": {signal_t},
                        "z_offset": 0.01, "h_offset": {h_offset},
                        "width": 3.0, "height": 3.0,
                        "signal_type": "Graphics",
                        "signal_subtype": "StraightAheadArrow",
                        "value": null, "orientation": "none", "is_dynamic": false
                    }}],
                    "objects": []
                }}],
                "junctions": []
            }}"#
        )
    }

    /// Right-lane signal (t < 0) with hOffset=0 should face +s (east).
    /// With scale=3 on east road, tip is at cx + 1.5. Center cx = offset_point at t=-3
    /// on east road = x=10, y=-3. Tip should be at x ≈ 11.5.
    #[test]
    fn test_signal_h_offset_zero_points_forward() {
        let json = make_signal_project(10.0, -3.0, 0.0);
        let verts = generate_signal_paint_vertices(&json, 1.0).unwrap();
        assert!(!verts.is_empty(), "Expected signal paint vertices");

        // Tip vertex for east road + heading=0: (cx+1.5, cy) = (11.5, -3)
        let has_tip = verts
            .chunks(7)
            .any(|v| (v[0] - 11.5_f32).abs() < 0.05 && (v[1] + 3.0_f32).abs() < 0.05);
        assert!(
            has_tip,
            "hOffset=0 right-lane arrow tip should be at (11.5, -3.0) [east/+s direction]"
        );
    }

    /// Right-lane signal (t < 0) with hOffset=π should face -s (west).
    /// This is the trafficpaint.xodr convention where both arrows have hOffset≈π.
    /// With scale=3 on east road, tip is at cx - 1.5. Center cx=10, tip at (8.5, -3).
    #[test]
    fn test_signal_h_offset_pi_points_backward() {
        let json = make_signal_project(10.0, -3.0, std::f64::consts::PI);
        let verts = generate_signal_paint_vertices(&json, 1.0).unwrap();
        assert!(!verts.is_empty(), "Expected signal paint vertices");

        // Tip vertex for east road + heading=π: (cx-1.5, cy) = (8.5, -3)
        let has_tip = verts
            .chunks(7)
            .any(|v| (v[0] - 8.5_f32).abs() < 0.05 && (v[1] + 3.0_f32).abs() < 0.05);
        assert!(
            has_tip,
            "hOffset=π right-lane arrow tip should be at (8.5, -3.0) [west/-s direction]"
        );
    }

    /// Verify that ALL 16 ParkingSpace objects in parkinglot.xodr produce vertices.
    /// This catches cases where parking stalls on certain roads (e.g. vertical Road 16,
    /// west-going Road 19) might fail to render due to coordinate transform bugs.
    #[test]
    fn test_parkinglot_all_16_parking_stalls_produce_vertices() {
        let xodr = std::fs::read_to_string("../../tests/fixtures/xodr/parkinglot.xodr")
            .or_else(|_| std::fs::read_to_string("tests/fixtures/xodr/parkinglot.xodr"));
        let Ok(xodr) = xodr else { return };

        let project: we_core::model::Project =
            we_core::opendrive::parse_xodr(&xodr).expect("parse parkinglot.xodr");
        let json = serde_json::to_string(&project).expect("serialize project");

        let verts = generate_object_vertices(&json).expect("generate_object_vertices");
        assert!(!verts.is_empty(), "Expected non-empty object vertices");

        // Each parking stall has 5 corners in the xodr, but the last duplicates the
        // first (closing vertex). After dedup: 4 unique corners → 4 edges → 4×6=24
        // triangle vertices → 24×7=168 floats per stall. 16 stalls → at least 2688 floats.
        let per_stall_floats = 4 * 6 * 7; // 168
        let expected_min = 16 * per_stall_floats;
        assert!(
            verts.len() >= expected_min,
            "Expected >= {expected_min} floats for 16 stalls, got {}",
            verts.len()
        );

        // Extract bounding box of all vertices to verify spatial extent
        let xs: Vec<f32> = verts.chunks(7).map(|v| v[0]).collect();
        let ys: Vec<f32> = verts.chunks(7).map(|v| v[1]).collect();
        let x_min = xs.iter().cloned().fold(f32::INFINITY, f32::min);
        let x_max = xs.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        let y_min = ys.iter().cloned().fold(f32::INFINITY, f32::min);
        let y_max = ys.iter().cloned().fold(f32::NEG_INFINITY, f32::max);

        // Parking objects are on roads 10, 13, 16, 19:
        //   Road 10: vertical, hdg≈4.7, parking at y≈[2.4, 5]
        //   Road 13: horizontal, hdg≈3.14, parking at y≈[10, 12]
        //   Road 16: vertical, hdg≈4.7, parking at x≈[-15, -9]
        //   Road 19: horizontal west-going (hdg≈π), t=-6.3→north, parking at y≈[2.5, 5]
        // All stalls are in the y>0 range (no parking at y<0)
        assert!(
            x_min < -9.0,
            "Expected parking stalls at x<-9 (Road 16), got x_min={x_min}"
        );
        assert!(
            x_max > 5.0,
            "Expected parking stalls at x>5 (Road 13), got x_max={x_max}"
        );
        assert!(
            y_min < 3.0,
            "Expected parking stalls at y<3 (Road 10/19), got y_min={y_min}"
        );
        assert!(
            y_max > 10.0,
            "Expected parking stalls at y>10 (Road 13), got y_max={y_max}"
        );

        println!(
            "All parking stalls render: {} vertices, bbox x=[{x_min:.1}, {x_max:.1}] y=[{y_min:.1}, {y_max:.1}]",
            verts.len() / 7
        );
    }

    /// Verify road surface vertices cover the full spatial extent of parkinglot.xodr,
    /// including the bottom-left area (Roads 22, 25, 44, 47).
    #[test]
    fn test_parkinglot_road_vertices_cover_all_roads() {
        let xodr = std::fs::read_to_string("../../tests/fixtures/xodr/parkinglot.xodr")
            .or_else(|_| std::fs::read_to_string("tests/fixtures/xodr/parkinglot.xodr"));
        let Ok(xodr) = xodr else { return };

        let project: we_core::model::Project =
            we_core::opendrive::parse_xodr(&xodr).expect("parse parkinglot.xodr");
        let json = serde_json::to_string(&project).expect("serialize project");

        let verts =
            generate_road_vertices(&json, 1.0, "byLaneType").expect("generate_road_vertices");
        assert!(!verts.is_empty(), "Expected non-empty road vertices");

        let xs: Vec<f32> = verts.chunks(7).map(|v| v[0]).collect();
        let ys: Vec<f32> = verts.chunks(7).map(|v| v[1]).collect();
        let x_min = xs.iter().cloned().fold(f32::INFINITY, f32::min);
        let x_max = xs.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        let y_min = ys.iter().cloned().fold(f32::INFINITY, f32::min);
        let y_max = ys.iter().cloned().fold(f32::NEG_INFINITY, f32::max);

        // Road bounding boxes from geometry analysis:
        //   Road 25: x=[-61.5, -39.7], y=[-12.2, 22.2]  (the farthest left/bottom road)
        //   Road 1:  x=[54.6, 75.3], y=[-18.2, 18.0]    (the farthest right road)
        // Overall: x∈[-61.5, 75.3], y∈[-18.2, 22.2]
        assert!(
            x_min < -55.0,
            "Expected road surface reaching x<-55 (Road 25), got x_min={x_min}"
        );
        assert!(
            x_max > 70.0,
            "Expected road surface reaching x>70 (Road 1), got x_max={x_max}"
        );
        assert!(
            y_min < -15.0,
            "Expected road surface reaching y<-15 (Road 1), got y_min={y_min}"
        );
        assert!(
            y_max > 20.0,
            "Expected road surface reaching y>20 (Road 25), got y_max={y_max}"
        );
    }

    /// Left-lane signal (t > 0) with hOffset=-π (compliant XODR for reverse-facing)
    /// should produce the same result as hOffset=+π since cos/sin are periodic with 2π.
    /// Tip should face west (−s) regardless of the sign of π used.
    #[test]
    fn test_signal_h_offset_neg_pi_same_as_pos_pi() {
        let pos = make_signal_project(10.0, 3.0, std::f64::consts::PI);
        let neg = make_signal_project(10.0, 3.0, -std::f64::consts::PI);

        let verts_pos = generate_signal_paint_vertices(&pos, 1.0).unwrap();
        let verts_neg = generate_signal_paint_vertices(&neg, 1.0).unwrap();

        assert_eq!(
            verts_pos.len(),
            verts_neg.len(),
            "hOffset=+π and hOffset=-π should produce same number of vertices"
        );

        // All vertex positions should be equal (or nearly equal) since -π ≡ +π for cos/sin.
        for (a, b) in verts_pos.iter().zip(verts_neg.iter()) {
            assert!(
                (a - b).abs() < 1e-4,
                "hOffset=+π and hOffset=-π vertices should be identical, got {a} vs {b}"
            );
        }
    }

    /// Verify that `road_point_at_s` correctly extrapolates beyond road.length.
    /// A line geometry from (0,0) heading east (hdg=0), length=10.
    /// At s=15 (5m past road end), the point should be at (15, 0).
    #[test]
    fn test_road_point_at_s_extrapolates_beyond_length() {
        use we_core::model::{Geometry, GeometryType};

        let plan_view = vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 10.0,
            geo_type: GeometryType::Line,
        }];

        // Within range: s=5 → (5, 0)
        let pt = road_point_at_s(&plan_view, 5.0).unwrap();
        assert!((pt.x - 5.0).abs() < 1e-6);
        assert!(pt.y.abs() < 1e-6);

        // At road end: s=10 → (10, 0)
        let pt = road_point_at_s(&plan_view, 10.0).unwrap();
        assert!((pt.x - 10.0).abs() < 1e-6);
        assert!(pt.y.abs() < 1e-6);

        // Extrapolated: s=15 → (15, 0), tangent extension along hdg=0
        let pt = road_point_at_s(&plan_view, 15.0).unwrap();
        assert!(
            (pt.x - 15.0).abs() < 1e-6,
            "extrapolated x should be 15, got {}",
            pt.x
        );
        assert!(
            pt.y.abs() < 1e-6,
            "extrapolated y should be 0, got {}",
            pt.y
        );
        assert!(pt.hdg.abs() < 1e-6, "heading preserved at 0");
    }

    /// Same extrapolation test but with a northward road (hdg=π/2).
    /// Geometry: origin (10, 0), heading north, length=5.
    /// At s=12 (7m past end), point should be at (10, 12).
    #[test]
    fn test_road_point_at_s_extrapolates_north() {
        use we_core::model::{Geometry, GeometryType};

        let plan_view = vec![Geometry {
            s: 0.0,
            x: 10.0,
            y: 0.0,
            hdg: std::f64::consts::FRAC_PI_2,
            length: 5.0,
            geo_type: GeometryType::Line,
        }];

        // Extrapolated: s=12 → origin(10,0) + 12m north → (10, 12)
        let pt = road_point_at_s(&plan_view, 12.0).unwrap();
        assert!(
            (pt.x - 10.0).abs() < 1e-4,
            "x should stay at 10, got {}",
            pt.x
        );
        assert!(
            (pt.y - 12.0).abs() < 1e-4,
            "y should be 12 (extrapolated), got {}",
            pt.y
        );
    }

    /// Verify that a GeoZ-like project JSON (with lanes) deserializes and generates vertices.
    #[test]
    fn test_geoz_project_with_lanes_generates_vertices() {
        let project_json = r#"{
            "name": "test.geoz",
            "header": {
                "rev_major": 1, "rev_minor": 6, "name": "test", "date": "2026-06-01",
                "north": 10.0, "south": 0.0, "east": 10.0, "west": 0.0,
                "geo_reference": null
            },
            "roads": [{
                "id": "road-1", "name": "Road 1", "length": 10.0,
                "junction_id": null, "render_hidden": false, "link": null,
                "plan_view": [{"s": 0.0, "x": 0.0, "y": 0.0, "hdg": 0.0, "length": 10.0, "geo_type": "Line"}],
                "elevation_profile": [],
                "lane_sections": [{
                    "s": 0.0, "single_side": false, "render_hidden": false,
                    "left": [],
                    "center": [{"id": 0, "lane_type": "None", "level": 0, "render_hidden": false, "link": null, "width": [{"s_offset": 0, "a": 0, "b": 0, "c": 0, "d": 0}], "road_marks": []}],
                    "right": [{"id": -1, "lane_type": "Driving", "level": 0, "render_hidden": false, "link": null, "width": [{"s_offset": 0, "a": 3.5, "b": 0, "c": 0, "d": 0}], "road_marks": []}]
                }],
                "lane_offsets": [],
                "lateral_profile": {"superelevations": [], "crossfalls": []},
                "bridges": [], "tunnels": [], "signals": [], "objects": []
            }],
            "junctions": [],
            "signals": [{"id": "sig-1", "name": "traffic_light", "s": 5.0, "t": 2.0, "z_offset": 0.0, "h_offset": 0.0, "width": 1.0, "height": 2.0, "signal_type": "traffic_light", "signal_subtype": "-1", "value": null, "orientation": "+", "is_dynamic": false}],
            "objects": []
        }"#;

        let result = generate_road_vertices(project_json, 2.0, "byLaneType");
        assert!(
            result.is_ok(),
            "GeoZ project deserialization failed: {:?}",
            result.err()
        );
        let verts = result.unwrap();
        assert!(
            !verts.is_empty(),
            "GeoZ project with lanes should produce non-empty vertices"
        );
    }

    /// Verify that a GeoZ-like project with NO lane sections triggers the fallback ribbon.
    #[test]
    fn test_geoz_project_no_lanes_generates_fallback_ribbon() {
        let project_json = r#"{
            "name": "test.geoz",
            "header": {
                "rev_major": 1, "rev_minor": 6, "name": "test", "date": "2026-06-01",
                "north": 10.0, "south": 0.0, "east": 10.0, "west": 0.0,
                "geo_reference": null
            },
            "roads": [{
                "id": "road-1", "name": "Road 1", "length": 10.0,
                "junction_id": null, "render_hidden": false, "link": null,
                "plan_view": [{"s": 0.0, "x": 0.0, "y": 0.0, "hdg": 0.0, "length": 10.0, "geo_type": "Line"}],
                "elevation_profile": [],
                "lane_sections": [],
                "lane_offsets": [],
                "lateral_profile": {"superelevations": [], "crossfalls": []},
                "bridges": [], "tunnels": [], "signals": [], "objects": []
            }],
            "junctions": [],
            "signals": [],
            "objects": []
        }"#;

        let result = generate_road_vertices(project_json, 2.0, "byLaneType");
        assert!(
            result.is_ok(),
            "GeoZ project deserialization failed: {:?}",
            result.err()
        );
        let verts = result.unwrap();
        assert!(
            !verts.is_empty(),
            "GeoZ project with no lane sections should produce fallback ribbon vertices"
        );
    }

    /// Verify that road marks with valid types don't break deserialization.
    #[test]
    fn test_geoz_project_with_road_marks_deserializes() {
        let project_json = r#"{
            "name": "test.geoz",
            "header": {
                "rev_major": 1, "rev_minor": 6, "name": "test", "date": "2026-06-01",
                "north": 10.0, "south": 0.0, "east": 10.0, "west": 0.0,
                "geo_reference": null
            },
            "roads": [{
                "id": "road-1", "name": "Road 1", "length": 10.0,
                "junction_id": null, "render_hidden": false, "link": null,
                "plan_view": [{"s": 0.0, "x": 0.0, "y": 0.0, "hdg": 0.0, "length": 10.0, "geo_type": "Line"}],
                "elevation_profile": [],
                "lane_sections": [{
                    "s": 0.0, "single_side": false, "render_hidden": false,
                    "left": [],
                    "center": [{"id": 0, "lane_type": "None", "level": 0, "link": null, "width": [], "road_marks": []}],
                    "right": [{"id": -1, "lane_type": "Driving", "level": 0, "link": null, "width": [{"s_offset": 0, "a": 3.5, "b": 0, "c": 0, "d": 0}], "road_marks": [
                        {"s_offset": 0.0, "mark_type": "solid", "weight": "standard", "color": "white", "material": "", "width": 0.15, "lane_change": ""},
                        {"s_offset": 0.0, "mark_type": "broken", "weight": "bold", "color": "yellow", "material": "", "width": 0.1, "lane_change": ""},
                        {"s_offset": 0.0, "mark_type": "none", "weight": "standard", "color": "standard", "material": "", "width": 0.0, "lane_change": ""}
                    ]}]
                }],
                "lane_offsets": [],
                "lateral_profile": {"superelevations": [], "crossfalls": []},
                "bridges": [], "tunnels": [], "signals": [], "objects": []
            }],
            "junctions": [],
            "signals": [],
            "objects": []
        }"#;

        let result = generate_road_vertices(project_json, 2.0, "byLaneType");
        assert!(
            result.is_ok(),
            "GeoZ project with road marks failed: {:?}",
            result.err()
        );
        let verts = result.unwrap();
        assert!(!verts.is_empty(), "Should produce vertices with road marks");
    }
}
