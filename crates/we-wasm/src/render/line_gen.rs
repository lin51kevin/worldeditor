use wasm_bindgen::prelude::*;

use super::helpers::sum_widths_at_ds;
use super::marking_mesh::emit_road_mark;

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
    use we_core::geometry::eval::{evaluate_lane_width, sample_road_reference_line};
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

            // Helper: emit all road marks for a lane, each covering its s_offset sub-range.
            // Marks are processed in ascending sOffset order; each mark covers from its
            // sOffset to the next mark's sOffset (or to section_end_s for the last).
            let emit_lane_marks = |road_marks: &[we_core::model::RoadMark],
                                   lateral_fn: &dyn Fn(f64) -> f64,
                                   out: &mut Vec<f32>| {
                let mut sorted: Vec<&we_core::model::RoadMark> = road_marks.iter().collect();
                sorted.sort_by(|a, b| {
                    a.s_offset
                        .partial_cmp(&b.s_offset)
                        .unwrap_or(std::cmp::Ordering::Equal)
                });

                for (idx, rm) in sorted.iter().enumerate() {
                    if rm.mark_type == RoadMarkType::None {
                        continue;
                    }
                    let abs_start = section.s + rm.s_offset;
                    let abs_end = sorted
                        .get(idx + 1)
                        .map(|next| section.s + next.s_offset)
                        .unwrap_or(section_end_s);

                    let mark_pts: Vec<_> = section_pts
                        .iter()
                        .filter(|p| p.s >= abs_start - 1e-9 && p.s <= abs_end + 1e-9)
                        .copied()
                        .collect();

                    if mark_pts.len() < 2 {
                        continue;
                    }
                    emit_road_mark(
                        rm,
                        &mark_pts,
                        &road.elevation_profile,
                        section.s,
                        &road.lane_offsets,
                        lateral_fn,
                        out,
                    );
                }
            };

            // Center lane road mark at offset 0 (the center dividing line)
            if let Some(center_lane) = section.center.first()
                && !center_lane.render_hidden
            {
                emit_lane_marks(&center_lane.road_marks, &|_| 0.0, &mut all_floats);
            }

            // Right lane outer boundaries (inner → outer, accumulating offset)
            let mut right_sorted: Vec<_> = section.right.iter().collect();
            right_sorted.sort_by_key(|l| l.id.abs());
            let mut right_prev_widths: Vec<&[we_core::model::LaneWidth]> = Vec::new();
            for lane in &right_sorted {
                if !lane.render_hidden {
                    let boundary_widths: Vec<&[we_core::model::LaneWidth]> = {
                        let mut bw = right_prev_widths.clone();
                        bw.push(&lane.width);
                        bw
                    };
                    emit_lane_marks(
                        &lane.road_marks,
                        &|ds| -sum_widths_at_ds(&boundary_widths, ds, &evaluate_lane_width),
                        &mut all_floats,
                    );
                }
                right_prev_widths.push(&lane.width);
            }

            // Left lane outer boundaries
            let mut left_sorted: Vec<_> = section.left.iter().collect();
            left_sorted.sort_by_key(|l| l.id);
            let mut left_prev_widths: Vec<&[we_core::model::LaneWidth]> = Vec::new();
            for lane in &left_sorted {
                if !lane.render_hidden {
                    let boundary_widths: Vec<&[we_core::model::LaneWidth]> = {
                        let mut bw = left_prev_widths.clone();
                        bw.push(&lane.width);
                        bw
                    };
                    emit_lane_marks(
                        &lane.road_marks,
                        &|ds| sum_widths_at_ds(&boundary_widths, ds, &evaluate_lane_width),
                        &mut all_floats,
                    );
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
            [0.0, 0.55, 1.0, 0.90]
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

/// Generate geometric lane boundary line vertices from a project JSON.
///
/// Unlike `generate_lane_line_vertices` (which requires `road_marks` data),
/// this function emits a thin ribbon at **every** lane edge boundary based
/// solely on the geometric lane widths. Useful for draw-mode previews where
/// template-based roads have no road_marks populated.
///
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
/// Color: dark gray `[0.15, 0.15, 0.15, 0.9]`.
#[wasm_bindgen]
pub fn generate_lane_boundary_vertices(
    project_json: &str,
    sample_step: f64,
) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::{
        evaluate_elevation, evaluate_lane_width, offset_point, sample_road_reference_line,
    };
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut all_floats = Vec::new();
    let line_half_w = 0.08f64; // ~0.16 m thin ribbon
    let z_lift = 0.04f32;
    let [r, g, b, a]: [f32; 4] = [0.45, 0.45, 0.50, 0.85]; // mid-gray, visible on both dark & light themes

    // Emit a thin ribbon at a given lateral offset for the segment pt0→pt1.
    let emit_boundary_segment =
        |pt0: &we_core::geometry::eval::RefLinePoint,
         pt1: &we_core::geometry::eval::RefLinePoint,
         elev0: f32,
         elev1: f32,
         lat: f64,
         out: &mut Vec<f32>| {
            let (lx0, ly0, _) = offset_point(pt0, lat + line_half_w, 0.0);
            let (rx0, ry0, _) = offset_point(pt0, lat - line_half_w, 0.0);
            let (lx1, ly1, _) = offset_point(pt1, lat + line_half_w, 0.0);
            let (rx1, ry1, _) = offset_point(pt1, lat - line_half_w, 0.0);
            out.extend_from_slice(&[lx0 as f32, ly0 as f32, elev0, r, g, b, a]);
            out.extend_from_slice(&[rx0 as f32, ry0 as f32, elev0, r, g, b, a]);
            out.extend_from_slice(&[lx1 as f32, ly1 as f32, elev1, r, g, b, a]);
            out.extend_from_slice(&[rx0 as f32, ry0 as f32, elev0, r, g, b, a]);
            out.extend_from_slice(&[rx1 as f32, ry1 as f32, elev1, r, g, b, a]);
            out.extend_from_slice(&[lx1 as f32, ly1 as f32, elev1, r, g, b, a]);
        };

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

            // Emit boundary lines at a list of lateral offsets for the full section.
            let emit_for_offsets = |lateral_offsets: &[f64], out: &mut Vec<f32>| {
                for &lat in lateral_offsets {
                    for i in 0..section_pts.len() - 1 {
                        let pt0 = section_pts[i];
                        let pt1 = section_pts[i + 1];
                        let z0 =
                            evaluate_elevation(&road.elevation_profile, pt0.s) as f32 + z_lift;
                        let z1 =
                            evaluate_elevation(&road.elevation_profile, pt1.s) as f32 + z_lift;
                        emit_boundary_segment(pt0, pt1, z0, z1, lat, out);
                    }
                }
            };

            // Right lanes: compute cumulative negative offsets (inner → outer)
            let mut right_sorted: Vec<_> = section.right.iter().collect();
            right_sorted.sort_by_key(|l| l.id.abs());
            let mut right_prev_widths: Vec<&[we_core::model::LaneWidth]> = Vec::new();
            let mut right_offsets: Vec<f64> = Vec::new();
            for lane in &right_sorted {
                let all_widths: Vec<&[we_core::model::LaneWidth]> = {
                    let mut bw = right_prev_widths.clone();
                    bw.push(&lane.width);
                    bw
                };
                // Use midpoint of section to sample the cumulative width
                let ds_mid = (section_end_s - section.s) * 0.5;
                let offset =
                    -sum_widths_at_ds(&all_widths, ds_mid, &evaluate_lane_width);
                right_offsets.push(offset);
                right_prev_widths.push(&lane.width);
            }
            emit_for_offsets(&right_offsets, &mut all_floats);

            // Left lanes: compute cumulative positive offsets (inner → outer)
            let mut left_sorted: Vec<_> = section.left.iter().collect();
            left_sorted.sort_by_key(|l| l.id);
            let mut left_prev_widths: Vec<&[we_core::model::LaneWidth]> = Vec::new();
            let mut left_offsets: Vec<f64> = Vec::new();
            for lane in &left_sorted {
                let all_widths: Vec<&[we_core::model::LaneWidth]> = {
                    let mut bw = left_prev_widths.clone();
                    bw.push(&lane.width);
                    bw
                };
                let ds_mid = (section_end_s - section.s) * 0.5;
                let offset = sum_widths_at_ds(&all_widths, ds_mid, &evaluate_lane_width);
                left_offsets.push(offset);
                left_prev_widths.push(&lane.width);
            }
            emit_for_offsets(&left_offsets, &mut all_floats);
        }
    }

    Ok(all_floats)
}
