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
    use we_core::geometry::eval::{
        TessellationParams, evaluate_lane_width, sample_road_reference_line_adaptive,
    };
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut all_floats = Vec::new();

    for road in &project.roads {
        if road.render_hidden {
            continue;
        }

        let ref_pts = sample_road_reference_line_adaptive(
            road,
            &TessellationParams::with_max_step(sample_step),
        );
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
            if let Some(center_lane) = section.center.first()
                && !center_lane.render_hidden
            {
                emit_lane_marks(
                    road,
                    section.s,
                    section_end_s,
                    &section_pts,
                    &center_lane.road_marks,
                    |_| 0.0,
                    &mut all_floats,
                );
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
                        road,
                        section.s,
                        section_end_s,
                        &section_pts,
                        &lane.road_marks,
                        |ds| -sum_widths_at_ds(&boundary_widths, ds, &evaluate_lane_width),
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
                        road,
                        section.s,
                        section_end_s,
                        &section_pts,
                        &lane.road_marks,
                        |ds| sum_widths_at_ds(&boundary_widths, ds, &evaluate_lane_width),
                        &mut all_floats,
                    );
                }
                left_prev_widths.push(&lane.width);
            }
        }
    }

    Ok(all_floats)
}

/// Emit all road marks for a single lane boundary, each mark covering its
/// `s_offset` sub-range. Marks are processed in ascending `s_offset` order;
/// each covers from its `s_offset` to the next mark's `s_offset` (or to
/// `section_end_s` for the last).
///
/// `lateral_fn` maps an `s`-distance from the section start to the boundary's
/// lateral offset. It is a generic parameter so each call site is monomorphized
/// (no `dyn Fn` dispatch in the per-vertex hot loop).
#[allow(clippy::too_many_arguments)]
fn emit_lane_marks<F: Fn(f64) -> f64>(
    road: &we_core::model::Road,
    section_s: f64,
    section_end_s: f64,
    section_pts: &[&we_core::geometry::eval::RefLinePoint],
    road_marks: &[we_core::model::RoadMark],
    lateral_fn: F,
    out: &mut Vec<f32>,
) {
    use we_core::model::RoadMarkType;

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
        let abs_start = section_s + rm.s_offset;
        let abs_end = sorted
            .get(idx + 1)
            .map(|next| section_s + next.s_offset)
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
            section_s,
            &road.lane_offsets,
            &lateral_fn,
            out,
        );
    }
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
    use we_core::geometry::eval::{
        TessellationParams, evaluate_elevation, offset_point, sample_road_reference_line_adaptive,
    };
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut all_floats = Vec::new();
    let line_half_w = 0.10f64; // 0.2m wide ribbon
    let z_lift = 0.02f32;

    for road in &project.roads {
        let ref_pts = sample_road_reference_line_adaptive(
            road,
            &TessellationParams::with_max_step(sample_step),
        );
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
        TessellationParams, evaluate_elevation, evaluate_lane_width, offset_point,
        sample_road_reference_line_adaptive,
    };
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut all_floats = Vec::new();
    let line_half_w = 0.08f64; // ~0.16 m thin ribbon
    let z_lift = 0.04f32;
    let [r, g, b, a]: [f32; 4] = [0.45, 0.45, 0.50, 0.85]; // mid-gray, visible on both dark & light themes

    // Emit a thin ribbon at a given lateral offset for the segment pt0→pt1.
    let emit_boundary_segment = |pt0: &we_core::geometry::eval::RefLinePoint,
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

        let ref_pts = sample_road_reference_line_adaptive(
            road,
            &TessellationParams::with_max_step(sample_step),
        );
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
                        let z0 = evaluate_elevation(&road.elevation_profile, pt0.s) as f32 + z_lift;
                        let z1 = evaluate_elevation(&road.elevation_profile, pt1.s) as f32 + z_lift;
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
                let offset = -sum_widths_at_ds(&all_widths, ds_mid, &evaluate_lane_width);
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

#[cfg(test)]
mod tests {
    use super::{
        generate_center_line_vertices, generate_lane_boundary_vertices, generate_lane_line_vertices,
    };
    use we_core::model::{
        Geometry, GeometryType, Project, Road, RoadMark, RoadMarkColor, RoadMarkType,
        RoadMarkWeight,
    };

    fn straight_road(id: &str, y: f64, junction_id: Option<&str>) -> Road {
        let mut road = Road::from_centerline(
            id,
            vec![Geometry {
                s: 0.0,
                x: 0.0,
                y,
                hdg: 0.0,
                length: 10.0,
                geo_type: GeometryType::Line,
            }],
        );
        road.junction_id = junction_id.map(str::to_string);
        road
    }

    fn road_mark(mark_type: RoadMarkType) -> RoadMark {
        RoadMark {
            s_offset: 0.0,
            mark_type,
            weight: RoadMarkWeight::Standard,
            color: RoadMarkColor::Yellow,
            material: String::new(),
            width: 0.2,
            lane_change: String::new(),
            height: 0.0,
        }
    }

    #[test]
    fn test_generate_center_line_vertices_uses_different_colors_for_junction_roads() {
        let project = Project {
            roads: vec![
                straight_road("road", 0.0, None),
                straight_road("connector", 10.0, Some("j1")),
            ],
            ..Project::default()
        };
        let json = serde_json::to_string(&project).unwrap();

        let verts = generate_center_line_vertices(&json, 10.0).unwrap();

        assert_eq!(verts.len(), 2 * 6 * 7);
        assert_eq!(&verts[3..7], &[0.0, 0.55, 1.0, 0.90]);
        assert_eq!(&verts[45..49], &[1.0, 0.6, 0.0, 0.85]);
    }

    #[test]
    fn test_generate_lane_boundary_vertices_emits_outer_edges_for_left_and_right_lanes() {
        let project = Project {
            roads: vec![straight_road("road", 0.0, None)],
            ..Project::default()
        };
        let json = serde_json::to_string(&project).unwrap();

        let verts = generate_lane_boundary_vertices(&json, 10.0).unwrap();

        assert_eq!(verts.len(), 2 * 6 * 7);
        assert!(verts.chunks(7).any(|v| v[1] < -3.4));
        assert!(verts.chunks(7).any(|v| v[1] > 3.4));
    }

    #[test]
    fn test_generate_lane_line_vertices_emits_mark_geometry_for_center_lane() {
        let mut road = straight_road("road", 0.0, None);
        road.lane_sections[0].center[0]
            .road_marks
            .push(road_mark(RoadMarkType::Solid));
        let project = Project {
            roads: vec![road],
            ..Project::default()
        };
        let json = serde_json::to_string(&project).unwrap();

        let verts = generate_lane_line_vertices(&json, 10.0).unwrap();

        assert_eq!(verts.len(), 6 * 7);
        assert_eq!(&verts[3..7], &[0.976, 0.827, 0.137, 1.0]);
        assert!(verts.chunks(7).any(|v| (v[1] - 0.1).abs() < 0.01));
        assert!(verts.chunks(7).any(|v| (v[1] + 0.1).abs() < 0.01));
    }

    /// Characterization test guarding the lateral-offset refactor (dyn Fn → generics).
    /// Captures exact vertex output for a road with marks on center, a right lane,
    /// and a left lane so the monomorphized code path stays behavior-identical.
    #[test]
    fn test_generate_lane_line_vertices_marks_on_all_sides_is_stable() {
        let mut road = straight_road("road", 0.0, None);
        road.lane_sections[0].center[0]
            .road_marks
            .push(road_mark(RoadMarkType::Solid));
        // Right + left lanes already exist via from_centerline default section;
        // attach a solid mark to the first right and first left lane.
        road.lane_sections[0].right[0]
            .road_marks
            .push(road_mark(RoadMarkType::Solid));
        road.lane_sections[0].left[0]
            .road_marks
            .push(road_mark(RoadMarkType::Solid));
        let project = Project {
            roads: vec![road],
            ..Project::default()
        };
        let json = serde_json::to_string(&project).unwrap();

        let verts = generate_lane_line_vertices(&json, 10.0).unwrap();

        // 3 marks (center, right, left) × 6 verts × 7 floats.
        assert_eq!(verts.len(), 3 * 6 * 7);
        // Stable fingerprint of the geometry (sum of all floats, rounded).
        let sum: f64 = verts.iter().map(|f| *f as f64).sum();
        assert!(
            (sum - 143.1900).abs() < 0.01,
            "geometry fingerprint drifted: {sum}"
        );
    }
}
