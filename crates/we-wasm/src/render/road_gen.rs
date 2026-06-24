//! Road mesh generation wasm exports.

use wasm_bindgen::prelude::*;

use super::{
    eval_lane_offset, gen_default_ribbon, gen_lane_strip, road_hue_color, select_lane_color,
};

/// Generate road mesh vertices from a project JSON. Returns vertex data as Float32Array.
///
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
/// `color_mode` controls surface coloring:
/// - `"byLaneType"` (default): per-lane-type palette
/// - `"single"`: uniform asphalt gray for all lanes
/// - `"byRoad"`: distinct hue per road (golden-angle HSV cycling)
#[wasm_bindgen]
pub fn generate_road_vertices(
    project_json: &str,
    sample_step: f64,
    color_mode: &str,
) -> Result<Vec<f32>, JsError> {
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    generate_road_vertices_from_project(&project, sample_step, color_mode)
}

/// Generate road mesh vertices using the cached project (avoids JSON serialization).
///
/// Requires `set_project_cache()` to have been called previously.
/// Falls back to error if cache is empty.
#[wasm_bindgen]
pub fn generate_road_vertices_cached(
    sample_step: f64,
    color_mode: &str,
) -> Result<Vec<f32>, JsError> {
    use crate::picking::with_project_cache;

    with_project_cache(|cache| {
        generate_road_vertices_from_project(&cache.project, sample_step, color_mode)
    })
}

/// Internal: generate road vertices from a parsed Project reference.
pub(super) fn generate_road_vertices_from_project(
    project: &we_core::model::Project,
    sample_step: f64,
    color_mode: &str,
) -> Result<Vec<f32>, JsError> {
    let mut all_floats = Vec::new();

    for (road_idx, road) in project.roads.iter().enumerate() {
        let road_verts = build_road_surface_vertices(road, road_idx, sample_step, color_mode);
        for v in &road_verts {
            all_floats.extend_from_slice(v);
        }
    }

    Ok(all_floats)
}

/// Generate the per-lane-colored surface vertices for a single road.
///
/// Mirrors one iteration of [`generate_road_vertices_from_project`]'s road loop.
/// `road_idx` is the road's position in the project — required so that the
/// `"byRoad"` palette (golden-angle hue per index) matches the full-project
/// output exactly, making single-road regeneration splice-compatible.
pub(super) fn build_road_surface_vertices(
    road: &we_core::model::Road,
    road_idx: usize,
    sample_step: f64,
    color_mode: &str,
) -> Vec<[f32; 7]> {
    use we_core::geometry::eval::{
        TessellationParams, evaluate_elevation, evaluate_lane_width, offset_point,
        sample_road_reference_line_adaptive,
    };

    if road.render_hidden {
        return Vec::new();
    }

    let ref_pts =
        sample_road_reference_line_adaptive(road, &TessellationParams::with_max_step(sample_step));
    if ref_pts.len() < 2 {
        return Vec::new();
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
                let color = select_lane_color(color_mode, lane.lane_type, road_idx);
                road_verts.extend(gen_lane_strip(
                    &section_pts,
                    &lane.width,
                    section.s,
                    &road.elevation_profile,
                    &road.lane_offsets,
                    &right_prev_widths,
                    false,
                    color,
                    &evaluate_elevation,
                    &evaluate_lane_width,
                    &eval_lane_offset,
                    &offset_point,
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
                let color = select_lane_color(color_mode, lane.lane_type, road_idx);
                road_verts.extend(gen_lane_strip(
                    &section_pts,
                    &lane.width,
                    section.s,
                    &road.elevation_profile,
                    &road.lane_offsets,
                    &left_prev_widths,
                    true,
                    color,
                    &evaluate_elevation,
                    &evaluate_lane_width,
                    &eval_lane_offset,
                    &offset_point,
                ));
            }
            left_prev_widths.push(&lane.width);
        }
    }

    // Fall back to default gray ribbon when no lane sections are defined
    if road_verts.is_empty() && road.lane_sections.is_empty() {
        let ribbon_color = match color_mode {
            "single" => [0.45f32, 0.45, 0.45, 1.0],
            "byRoad" => road_hue_color(road_idx),
            _ => [0.35, 0.35, 0.38, 1.0],
        };
        road_verts.extend(gen_default_ribbon(
            &ref_pts,
            &road.elevation_profile,
            3.5,
            ribbon_color,
        ));
    }

    road_verts
}

/// Generate the per-lane-colored surface vertices for a single road, looked up
/// by id from the cached project (avoids JSON serialization).
///
/// Requires `set_project_cache()` to have been called previously. Returns an
/// empty vec when the road id is not present. The output is byte-identical to
/// the corresponding road's slice in [`generate_road_vertices_cached`], so the
/// frontend can splice it into the merged surface buffer for incremental,
/// single-road mesh updates during drag-edit.
#[wasm_bindgen]
pub fn generate_single_road_surface_vertices_cached(
    road_id: &str,
    sample_step: f64,
    color_mode: &str,
) -> Result<Vec<f32>, JsError> {
    use crate::picking::with_project_cache;

    with_project_cache(|cache| {
        let Some((road_idx, road)) = cache
            .project
            .roads
            .iter()
            .enumerate()
            .find(|(_, r)| r.id == road_id)
        else {
            return Ok(Vec::new());
        };
        let road_verts = build_road_surface_vertices(road, road_idx, sample_step, color_mode);
        let mut floats = Vec::with_capacity(road_verts.len() * 7);
        for v in &road_verts {
            floats.extend_from_slice(v);
        }
        Ok(floats)
    })
}

fn build_single_road_preview_vertices(
    road: &we_core::model::Road,
    sample_step: f64,
    color: [f32; 4],
) -> Vec<f32> {
    use we_core::geometry::eval::{
        TessellationParams, evaluate_elevation, evaluate_lane_width, offset_point,
        sample_road_reference_line_adaptive,
    };

    let ref_pts =
        sample_road_reference_line_adaptive(road, &TessellationParams::with_max_step(sample_step));
    if ref_pts.len() < 2 {
        return Vec::new();
    }

    let mut road_verts: Vec<[f32; 7]> = Vec::new();

    for section in &road.lane_sections {
        if section.render_hidden {
            continue;
        }

        let section_end_s = road
            .lane_sections
            .iter()
            .find(|lane_section| lane_section.s > section.s + 1e-9)
            .map(|lane_section| lane_section.s)
            .unwrap_or(road.length);

        let section_pts: Vec<_> = ref_pts
            .iter()
            .filter(|point| point.s >= section.s - 1e-9 && point.s <= section_end_s + 1e-9)
            .collect();

        if section_pts.len() < 2 {
            continue;
        }

        let mut right_sorted: Vec<_> = section.right.iter().collect();
        right_sorted.sort_by_key(|lane| lane.id.abs());
        let mut right_prev_widths: Vec<&[we_core::model::LaneWidth]> = Vec::new();
        for lane in &right_sorted {
            if !lane.render_hidden {
                road_verts.extend(gen_lane_strip(
                    &section_pts,
                    &lane.width,
                    section.s,
                    &road.elevation_profile,
                    &road.lane_offsets,
                    &right_prev_widths,
                    false,
                    color,
                    &evaluate_elevation,
                    &evaluate_lane_width,
                    &eval_lane_offset,
                    &offset_point,
                ));
            }
            right_prev_widths.push(&lane.width);
        }

        let mut left_sorted: Vec<_> = section.left.iter().collect();
        left_sorted.sort_by_key(|lane| lane.id);
        let mut left_prev_widths: Vec<&[we_core::model::LaneWidth]> = Vec::new();
        for lane in &left_sorted {
            if !lane.render_hidden {
                road_verts.extend(gen_lane_strip(
                    &section_pts,
                    &lane.width,
                    section.s,
                    &road.elevation_profile,
                    &road.lane_offsets,
                    &left_prev_widths,
                    true,
                    color,
                    &evaluate_elevation,
                    &evaluate_lane_width,
                    &eval_lane_offset,
                    &offset_point,
                ));
            }
            left_prev_widths.push(&lane.width);
        }
    }

    if road_verts.is_empty() && road.lane_sections.is_empty() {
        road_verts.extend(gen_default_ribbon(
            &ref_pts,
            &road.elevation_profile,
            3.5,
            color,
        ));
    }

    let mut floats = Vec::with_capacity(road_verts.len() * 7);
    for vertex in &road_verts {
        floats.extend_from_slice(vertex);
    }
    floats
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
    let road: we_core::model::Road =
        serde_json::from_str(road_json).map_err(|e| JsError::new(&e.to_string()))?;

    Ok(build_single_road_preview_vertices(
        &road,
        sample_step,
        [r, g, b, a],
    ))
}

/// Progressive WASM data pipeline (#6): validates that we-core geometry types
/// can be deserialized from JSON, mesh-generated, and returned as JSON vertices.
/// Returns a JSON object with "vertices" (array of [x,y,z,r,g,b,a]) and "count".
///
/// Input JSON: serialized `we_core::model::Road`.
/// Output JSON: `{ "vertices": [[x,y,z,r,g,b,a], ...], "count": N }`
// TODO: [Phase 3] 待实现 — replace the simple ribbon bridge with full WASM road mesh generation
#[wasm_bindgen]
pub fn generate_road_mesh_from_json(road_json: &str, sample_step: f64) -> Result<String, JsError> {
    use we_core::geometry::eval::{evaluate_elevation, offset_point, sample_road_reference_line};
    use we_core::model::Road;

    let road: Road = serde_json::from_str(road_json).map_err(|e| JsError::new(&e.to_string()))?;

    if road.render_hidden {
        return Ok(r#"{"vertices":[],"count":0}"#.to_string());
    }

    let ref_pts = sample_road_reference_line(&road, sample_step);
    if ref_pts.len() < 2 {
        return Ok(r#"{"vertices":[],"count":0}"#.to_string());
    }

    // Generate a simple ribbon mesh (same as gen_default_ribbon)
    let half_width = 3.5;
    let color = [0.35_f32, 0.35, 0.38, 1.0];
    let mut vertices: Vec<[f64; 7]> = Vec::new();

    for i in 0..ref_pts.len() - 1 {
        let pt0 = &ref_pts[i];
        let pt1 = &ref_pts[i + 1];
        let z0 = evaluate_elevation(&road.elevation_profile, pt0.s);
        let z1 = evaluate_elevation(&road.elevation_profile, pt1.s);
        let (lx0, ly0, _) = offset_point(pt0, half_width, 0.0);
        let (rx0, ry0, _) = offset_point(pt0, -half_width, 0.0);
        let (lx1, ly1, _) = offset_point(pt1, half_width, 0.0);
        let (rx1, ry1, _) = offset_point(pt1, -half_width, 0.0);

        for v in &[
            [lx0, ly0, z0],
            [rx0, ry0, z0],
            [lx1, ly1, z1],
            [rx0, ry0, z0],
            [rx1, ry1, z1],
            [lx1, ly1, z1],
        ] {
            vertices.push([
                v[0],
                v[1],
                v[2],
                color[0] as f64,
                color[1] as f64,
                color[2] as f64,
                color[3] as f64,
            ]);
        }
    }

    let result = serde_json::json!({
        "vertices": vertices,
        "count": vertices.len()
    });
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_single_road_json(right_lane_widths: &[f64]) -> String {
        let right_lanes = right_lane_widths
            .iter()
            .enumerate()
            .map(|(index, width)| {
                let lane_id = -((index as i32) + 1);
                format!(
                    r#"{{
                        "id":{lane_id},
                        "lane_type":"Driving",
                        "level":0,
                        "link":null,
                        "width":[{{"s_offset":0.0,"a":{width},"b":0.0,"c":0.0,"d":0.0}}],
                        "borders":[],
                        "road_marks":[],
                        "render_hidden":false
                    }}"#
                )
            })
            .collect::<Vec<_>>()
            .join(",");

        format!(
            r#"{{
                "id":"road-1",
                "name":"",
                "length":20.0,
                "junction_id":null,
                "link":{{"predecessor":null,"successor":null}},
                "plan_view":[{{"s":0.0,"x":0.0,"y":0.0,"hdg":0.0,"length":20.0,"geo_type":"Line"}}],
                "elevation_profile":[{{"s":0.0,"a":0.0,"b":0.0,"c":0.0,"d":0.0}}],
                "lane_offsets":[],
                "lane_sections":[{{
                    "s":0.0,
                    "single_side":false,
                    "left":[],
                    "center":[{{"id":0,"lane_type":"None","level":0,"link":null,"width":[],"borders":[],"road_marks":[],"render_hidden":false}}],
                    "right":[{right_lanes}],
                    "render_hidden":false
                }}],
                "signals":[],
                "objects":[],
                "render_hidden":false
            }}"#
        )
    }

    fn mesh_width(vertices: &[f32]) -> f32 {
        let min_y = vertices
            .chunks(7)
            .map(|vertex| vertex[1])
            .fold(f32::INFINITY, f32::min);
        let max_y = vertices
            .chunks(7)
            .map(|vertex| vertex[1])
            .fold(f32::NEG_INFINITY, f32::max);
        max_y - min_y
    }

    #[test]
    fn test_generate_single_road_vertices_respects_single_lane_width() {
        let road_json = make_single_road_json(&[3.5]);
        let road: we_core::model::Road =
            serde_json::from_str(&road_json).expect("test road json should parse");

        let vertices = build_single_road_preview_vertices(&road, 2.0, [0.2, 0.5, 1.0, 0.8]);

        assert!(
            !vertices.is_empty(),
            "Expected preview vertices for single-lane road"
        );
        assert!(
            (mesh_width(&vertices) - 3.5).abs() < 0.05,
            "Single-lane preview should stay 3.5m wide, got {}",
            mesh_width(&vertices)
        );
    }

    /// The cached single-road surface generator must produce output identical to
    /// that road's slice in the full-project mesh, so the frontend can splice it
    /// in place for incremental single-road updates.
    #[test]
    fn test_single_road_surface_cached_matches_full_project_slice() {
        use we_core::model::{Geometry, GeometryType, Project, Road};

        let make_road = |id: &str, y: f64| {
            Road::from_centerline(
                id,
                vec![Geometry {
                    s: 0.0,
                    x: 0.0,
                    y,
                    hdg: 0.0,
                    length: 20.0,
                    geo_type: GeometryType::Line,
                }],
            )
        };
        let project = Project {
            roads: vec![make_road("road-0", 0.0), make_road("road-1", 50.0)],
            ..Project::default()
        };
        let json = serde_json::to_string(&project).unwrap();

        let full = generate_road_vertices(&json, 2.0, "byLaneType").unwrap();

        crate::picking::set_project_cache(&json).unwrap();
        let r0 = generate_single_road_surface_vertices_cached("road-0", 2.0, "byLaneType").unwrap();
        let r1 = generate_single_road_surface_vertices_cached("road-1", 2.0, "byLaneType").unwrap();

        // Roads concatenate in project order, so r0 ++ r1 == full project mesh.
        let mut spliced = r0.clone();
        spliced.extend_from_slice(&r1);
        assert_eq!(full, spliced);
        assert!(!r0.is_empty() && !r1.is_empty());
    }

    #[test]
    fn test_single_road_surface_cached_unknown_id_returns_empty() {
        use we_core::model::{Geometry, GeometryType, Project, Road};

        let project = Project {
            roads: vec![Road::from_centerline(
                "road-0",
                vec![Geometry {
                    s: 0.0,
                    x: 0.0,
                    y: 0.0,
                    hdg: 0.0,
                    length: 20.0,
                    geo_type: GeometryType::Line,
                }],
            )],
            ..Project::default()
        };
        let json = serde_json::to_string(&project).unwrap();
        crate::picking::set_project_cache(&json).unwrap();

        let verts = generate_single_road_surface_vertices_cached("nope", 2.0, "byLaneType").unwrap();
        assert!(verts.is_empty());
    }
}
