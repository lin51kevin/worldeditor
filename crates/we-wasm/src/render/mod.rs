use wasm_bindgen::prelude::*;

mod bridge_mesh;
mod colors;
mod helpers;
mod junction_mesh;
mod line_gen;
mod marking_mesh;
mod object_gen;
mod road_mesh;
mod signal_mesh;

pub(crate) use helpers::{eval_lane_offset, road_point_at_s};
pub(crate) use junction_mesh::{build_junction_polygon_points, point_in_polygon};

use colors::{road_hue_color, select_lane_color};
use junction_mesh::append_junction_triangles;
use road_mesh::{gen_default_ribbon, gen_lane_strip};
use signal_mesh::{arrow_triangles, sign_marker_color};

// Re-export submodule wasm_bindgen functions for tests
#[cfg(test)]
use object_gen::generate_object_vertices;
// ── Public wasm_bindgen functions ─────────────────────────────────────────────

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
    use we_core::geometry::eval::{
        evaluate_elevation, evaluate_lane_width, offset_point, sample_road_reference_line,
    };
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut all_floats = Vec::new();

    for (road_idx, road) in project.roads.iter().enumerate() {
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

        for v in &road_verts {
            all_floats.extend_from_slice(v);
        }
    }

    Ok(all_floats)
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
fn generate_road_vertices_from_project(
    project: &we_core::model::Project,
    sample_step: f64,
    color_mode: &str,
) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::{
        evaluate_elevation, evaluate_lane_width, offset_point, sample_road_reference_line,
    };

    let mut all_floats = Vec::new();

    for (road_idx, road) in project.roads.iter().enumerate() {
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

fn build_single_road_preview_vertices(
    road: &we_core::model::Road,
    sample_step: f64,
    color: [f32; 4],
) -> Vec<f32> {
    use we_core::geometry::eval::{
        evaluate_elevation, evaluate_lane_width, offset_point, sample_road_reference_line,
    };

    let ref_pts = sample_road_reference_line(road, sample_step);
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
///
/// # TODO: [Phase 3] Rendering enhancement — replace flat diamond markers with sprite-based
/// traffic sign icons (similar to worldeditoronline SpriteSignalRenderer). Currently rendered
/// as colored point markers; sign types are color-coded (green=traffic lights, red=speed limit,
/// yellow=generic). Lane colors already match the reference (verified against RoadTessellator.ts).
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
                // Paint arrow on the road surface.
                // hOffset in OpenDRIVE encodes the signal's facing direction relative
                // to the road s direction (0 = forward/+s, π = backward/-s).
                // Using hOffset directly follows the spec and handles roads where
                // arrows on right lanes (t < 0) intentionally face -s (e.g. when the
                // road is an outgoing leg from a junction and hOffset≈π is set by the
                // authoring tool).
                let (cx, cy, _) = offset_point(&ref_pt, signal.t, 0.0);
                let heading = ref_pt.hdg + signal.h_offset;
                let scale = if signal.width > 0.0 {
                    signal.width
                } else {
                    3.0
                };
                let z = z_road + 0.02; // 2 cm above road surface

                let tris = arrow_triangles(
                    &signal.signal_subtype,
                    cx as f32,
                    cy as f32,
                    z,
                    heading as f32,
                    scale as f32,
                );
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

/// Generate a default lane section as JSON.
///
/// Creates symmetric layout with `n_lanes` per side at `lane_width` meters.
#[wasm_bindgen]
pub fn generate_default_lane_section(
    s: f64,
    n_lanes_per_side: u32,
    lane_width: f64,
    with_shoulder: bool,
) -> Result<String, JsError> {
    let section = we_core::lane_ops::generate_default_lane_section(
        s,
        n_lanes_per_side,
        lane_width,
        with_shoulder,
    );
    serde_json::to_string(&section).map_err(|e| JsError::new(&e.to_string()))
}

/// Generate highlight vertices for a single signal.
///
/// Looks up the signal by road_id + signal_id, evaluates its world position,
/// and returns a diamond marker mesh tinted with the given colour.
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
#[wasm_bindgen]
pub fn generate_single_signal_vertices(
    project_json: &str,
    road_id: &str,
    signal_id: &str,
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
    let signal = road.and_then(|rd| rd.signals.iter().find(|s| s.id == signal_id));

    let (road, signal) = match (road, signal) {
        (Some(road), Some(signal)) => (road, signal),
        _ => return Ok(Vec::new()),
    };

    let Some(ref_pt) = road_point_at_s(&road.plan_view, signal.s) else {
        return Ok(Vec::new());
    };

    let (mx, my, _) = offset_point(&ref_pt, signal.t, 0.0);
    let z_road = evaluate_elevation(&road.elevation_profile, signal.s) as f32;
    let mx = mx as f32;
    let my = my as f32;
    let sz = 0.6f32; // slightly larger than the normal 0.4 marker
    let z = z_road + 0.55;

    // Diamond: 6 vertices (2 triangles)
    let top = [mx, my - sz, z + sz];
    let bot = [mx, my + sz, z - sz];
    let lft = [mx - sz, my, z];
    let rgt = [mx + sz, my, z];

    let mut floats = Vec::with_capacity(6 * 7);
    for p in &[top, lft, bot, top, bot, rgt] {
        floats.extend_from_slice(&[p[0], p[1], p[2], r, g, b, a]);
    }
    Ok(floats)
}

/// Cached version of `generate_single_signal_vertices` — reads from PROJECT_CACHE
/// to avoid JSON re-serialization (~1.3s savings on large maps).
#[wasm_bindgen]
pub fn generate_single_signal_vertices_cached(
    road_id: &str,
    signal_id: &str,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::{evaluate_elevation, offset_point};

    crate::picking::with_project_cache(|cache| {
        let project = cache.project();
        let road = project.roads.iter().find(|rd| rd.id == road_id);
        let signal = road.and_then(|rd| rd.signals.iter().find(|s| s.id == signal_id));

        let (road, signal) = match (road, signal) {
            (Some(road), Some(signal)) => (road, signal),
            _ => return Ok(Vec::new()),
        };

        let Some(ref_pt) = road_point_at_s(&road.plan_view, signal.s) else {
            return Ok(Vec::new());
        };

        let (mx, my, _) = offset_point(&ref_pt, signal.t, 0.0);
        let z_road = evaluate_elevation(&road.elevation_profile, signal.s) as f32;
        let mx = mx as f32;
        let my = my as f32;
        let sz = 0.6f32;
        let z = z_road + 0.55;

        let top = [mx, my - sz, z + sz];
        let bot = [mx, my + sz, z - sz];
        let lft = [mx - sz, my, z];
        let rgt = [mx + sz, my, z];

        let mut floats = Vec::with_capacity(6 * 7);
        for p in &[top, lft, bot, top, bot, rgt] {
            floats.extend_from_slice(&[p[0], p[1], p[2], r, g, b, a]);
        }
        Ok(floats)
    })
}

/// Cached version of `generate_single_object_vertices` — reads from PROJECT_CACHE
/// to avoid JSON re-serialization (~1.3s savings on large maps).
#[wasm_bindgen]
pub fn generate_single_object_vertices_cached(
    road_id: &str,
    object_id: &str,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::{evaluate_elevation, offset_point};

    crate::picking::with_project_cache(|cache| {
        let project = cache.project();
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

        let tl = [mx - sz, my - sz, z];
        let tr = [mx + sz, my - sz, z];
        let bl = [mx - sz, my + sz, z];
        let br = [mx + sz, my + sz, z];

        let mut floats = Vec::with_capacity(6 * 7);
        for p in &[tl, tr, br, tl, br, bl] {
            floats.extend_from_slice(&[p[0], p[1], p[2], r, g, b, a]);
        }
        Ok(floats)
    })
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
}
