use super::colors::{mark_color, mark_line_width};
use super::helpers::eval_lane_offset;

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
    lateral_offset_at_ds: &(impl Fn(f64) -> f64 + ?Sized),
    out: &mut Vec<f32>,
) {
    use we_core::geometry::eval::{evaluate_elevation, offset_point};
    use we_core::model::RoadMarkType;

    let lc = mark_color(rm.color);
    let lw = mark_line_width(rm);

    // Half the center-to-center distance between two parallel lines.
    // Each line is offset ±double_spacing from the nominal lateral position.
    // Gap between inner edges = 2*double_spacing - lw; we target a visible ~8cm gap.
    let double_spacing: f64 = (lw as f64 / 2.0) + 0.04;

    match rm.mark_type {
        // Double-line: left line is solid, right line is solid
        RoadMarkType::SolidSolid => {
            let verts = gen_road_mark_line(
                section_pts,
                elevations,
                section_s,
                lane_offsets,
                &|ds| lateral_offset_at_ds(ds) + double_spacing,
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
                &|ds| lateral_offset_at_ds(ds) - double_spacing,
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
                &|ds| lateral_offset_at_ds(ds) + double_spacing,
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
                &|ds| lateral_offset_at_ds(ds) - double_spacing,
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
                &|ds| lateral_offset_at_ds(ds) + double_spacing,
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
                &|ds| lateral_offset_at_ds(ds) - double_spacing,
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
    lateral_offset_at_ds: &(impl Fn(f64) -> f64 + ?Sized),
    line_width: f32,
    color: [f32; 4],
    is_dashed: bool,
    eval_elev: &impl Fn(&[we_core::model::Elevation], f64) -> f64,
    eval_lane_off: &impl Fn(&[we_core::model::LaneOffset], f64) -> f64,
    offset_pt: &impl Fn(&we_core::geometry::eval::RefLinePoint, f64, f64) -> (f64, f64, f64),
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

#[cfg(test)]
mod tests {
    use super::{emit_road_mark, gen_road_mark_line};
    use we_core::geometry::eval::RefLinePoint;
    use we_core::model::{
        Elevation, LaneOffset, RoadMark, RoadMarkColor, RoadMarkType, RoadMarkWeight,
    };

    fn ref_points() -> Vec<RefLinePoint> {
        vec![
            RefLinePoint {
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                s: 0.0,
            },
            RefLinePoint {
                x: 5.0,
                y: 0.0,
                hdg: 0.0,
                s: 5.0,
            },
            RefLinePoint {
                x: 10.0,
                y: 0.0,
                hdg: 0.0,
                s: 10.0,
            },
        ]
    }

    fn sample_mark(mark_type: RoadMarkType) -> RoadMark {
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
    fn test_gen_road_mark_line_solid_emits_triangles_for_each_segment() {
        let ref_pts = ref_points();
        let ref_refs = vec![&ref_pts[0], &ref_pts[1], &ref_pts[2]];
        let verts = gen_road_mark_line(
            &ref_refs,
            &[Elevation {
                s: 0.0,
                a: 1.0,
                b: 0.0,
                c: 0.0,
                d: 0.0,
            }],
            0.0,
            &[LaneOffset {
                s: 0.0,
                a: 1.0,
                b: 0.0,
                c: 0.0,
                d: 0.0,
            }],
            &|_| 0.0,
            0.2,
            [0.8, 0.7, 0.6, 0.5],
            false,
            &|elevs: &[Elevation], _| elevs[0].a,
            &|offsets: &[LaneOffset], _| offsets[0].a,
            &|pt: &RefLinePoint, t, _| (pt.x, pt.y + t, 0.0),
        );

        assert_eq!(verts.len(), 12);
        assert_eq!(verts[0], [0.0, 1.1, 1.015, 0.8, 0.7, 0.6, 0.5]);
        assert_eq!(verts[1], [0.0, 0.9, 1.015, 0.8, 0.7, 0.6, 0.5]);
        assert_eq!(verts[11], [10.0, 1.1, 1.015, 0.8, 0.7, 0.6, 0.5]);
    }

    #[test]
    fn test_gen_road_mark_line_dashed_skips_gap_segments() {
        let ref_pts = ref_points();
        let ref_refs = vec![&ref_pts[0], &ref_pts[1], &ref_pts[2]];
        let verts = gen_road_mark_line(
            &ref_refs,
            &[],
            0.0,
            &[],
            &|_| 0.0,
            0.2,
            [1.0, 1.0, 1.0, 1.0],
            true,
            &|_, _| 0.0,
            &|_, _| 0.0,
            &|pt: &RefLinePoint, t, _| (pt.x, pt.y + t, 0.0),
        );

        assert_eq!(verts.len(), 6);
        assert!(verts.iter().all(|v| v[0] <= 5.0));
    }

    #[test]
    fn test_emit_road_mark_double_line_appends_two_parallel_lines() {
        let ref_pts = ref_points();
        let ref_refs = vec![&ref_pts[0], &ref_pts[1], &ref_pts[2]];
        let mut out = Vec::new();

        emit_road_mark(
            &sample_mark(RoadMarkType::SolidSolid),
            &ref_refs,
            &[],
            0.0,
            &[],
            &|_| 0.0,
            &mut out,
        );

        assert_eq!(out.len(), 24 * 7);
        assert_eq!(&out[3..7], &[0.976, 0.827, 0.137, 1.0]);
    }
}
