use super::{eval_lane_offset, mark_color, mark_line_width};

/// Emit all road-mark line vertices for a single `RoadMark` into `out`.
///
/// Handles:
/// - Single-line types (`Solid`, `Broken`, `BottsDots`, `Curb`, `Grass`, `Custom`, `StopLine`)
/// - Double-line types (`SolidSolid`, `SolidBroken`, `BrokenSolid`, `BrokenBroken`):
///   generates two parallel lines separated by `DOUBLE_LINE_SPACING` (0.1 m).
#[allow(clippy::too_many_arguments)]
pub(super) fn emit_road_mark(
    rm: &we_core::model::RoadMark,
    section_pts: &[&we_core::geometry::eval::RefLinePoint],
    elevations: &[we_core::model::Elevation],
    section_s: f64,
    lane_offsets: &[we_core::model::LaneOffset],
    lateral_offset_at_ds: &dyn Fn(f64) -> f64,
    out: &mut Vec<f32>,
) {
    use we_core::geometry::eval::{evaluate_elevation, offset_point};
    use we_core::model::RoadMarkType;

    let lc = mark_color(rm.color);
    let lw = mark_line_width(rm);

    const DOUBLE_SPACING: f64 = 0.05; // half of 0.1m gap → each line offset ±0.05m

    match rm.mark_type {
        // Double-line: left line is solid, right line is solid
        RoadMarkType::SolidSolid => {
            let verts = gen_road_mark_line(
                section_pts,
                elevations,
                section_s,
                lane_offsets,
                &|ds| lateral_offset_at_ds(ds) + DOUBLE_SPACING,
                lw,
                lc,
                false,
                &evaluate_elevation,
                &eval_lane_offset,
                &offset_point,
            );
            for v in &verts {
                out.extend_from_slice(v);
            }
            let verts = gen_road_mark_line(
                section_pts,
                elevations,
                section_s,
                lane_offsets,
                &|ds| lateral_offset_at_ds(ds) - DOUBLE_SPACING,
                lw,
                lc,
                false,
                &evaluate_elevation,
                &eval_lane_offset,
                &offset_point,
            );
            for v in &verts {
                out.extend_from_slice(v);
            }
        }
        // Double-line: left solid, right broken
        RoadMarkType::SolidBroken => {
            let verts = gen_road_mark_line(
                section_pts,
                elevations,
                section_s,
                lane_offsets,
                &|ds| lateral_offset_at_ds(ds) + DOUBLE_SPACING,
                lw,
                lc,
                false,
                &evaluate_elevation,
                &eval_lane_offset,
                &offset_point,
            );
            for v in &verts {
                out.extend_from_slice(v);
            }
            let verts = gen_road_mark_line(
                section_pts,
                elevations,
                section_s,
                lane_offsets,
                &|ds| lateral_offset_at_ds(ds) - DOUBLE_SPACING,
                lw,
                lc,
                true,
                &evaluate_elevation,
                &eval_lane_offset,
                &offset_point,
            );
            for v in &verts {
                out.extend_from_slice(v);
            }
        }
        // Double-line: left broken, right solid
        RoadMarkType::BrokenSolid => {
            let verts = gen_road_mark_line(
                section_pts,
                elevations,
                section_s,
                lane_offsets,
                &|ds| lateral_offset_at_ds(ds) + DOUBLE_SPACING,
                lw,
                lc,
                true,
                &evaluate_elevation,
                &eval_lane_offset,
                &offset_point,
            );
            for v in &verts {
                out.extend_from_slice(v);
            }
            let verts = gen_road_mark_line(
                section_pts,
                elevations,
                section_s,
                lane_offsets,
                &|ds| lateral_offset_at_ds(ds) - DOUBLE_SPACING,
                lw,
                lc,
                false,
                &evaluate_elevation,
                &eval_lane_offset,
                &offset_point,
            );
            for v in &verts {
                out.extend_from_slice(v);
            }
        }
        // Single-line types (Solid, Broken, BottsDots, Curb, Grass, StopLine, Custom, None ignored)
        _ => {
            let dashed = matches!(rm.mark_type, RoadMarkType::Broken);
            let verts = gen_road_mark_line(
                section_pts,
                elevations,
                section_s,
                lane_offsets,
                lateral_offset_at_ds,
                lw,
                lc,
                dashed,
                &evaluate_elevation,
                &eval_lane_offset,
                &offset_point,
            );
            for v in &verts {
                out.extend_from_slice(v);
            }
        }
    }
}

/// Generate a road marking line as a thin triangle strip at a lateral offset.
///
/// For dashed marks, segments are skipped every `dash_len + gap_len` meters.
#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub(super) fn gen_road_mark_line(
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
    let z_lift = 0.015f32; // 15mm above road surface (matches C# RoadMarkConfig)
    let half_w = (line_width * 0.5) as f64;
    let dash_len = 4.0f64; // 4m solid segment (C# standard)
    let cycle = 10.0f64; // 4m dash + 6m gap = 10m period
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
