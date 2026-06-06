use super::helpers::sum_widths_at_ds;

/// Generate a colored triangle strip for one lane.
#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub(crate) fn gen_lane_strip(
    ref_pts: &[&we_core::geometry::eval::RefLinePoint],
    widths: &[we_core::model::LaneWidth],
    section_s: f64,
    elevations: &[we_core::model::Elevation],
    lane_offsets: &[we_core::model::LaneOffset],
    prev_widths: &[&[we_core::model::LaneWidth]],
    is_left: bool,
    color: [f32; 4],
    eval_elev: &impl Fn(&[we_core::model::Elevation], f64) -> f64,
    eval_width: &impl Fn(&[we_core::model::LaneWidth], f64) -> f64,
    eval_lane_off: &impl Fn(&[we_core::model::LaneOffset], f64) -> f64,
    offset_pt: &impl Fn(&we_core::geometry::eval::RefLinePoint, f64, f64) -> (f64, f64, f64),
) -> Vec<[f32; 7]> {
    let mut verts = Vec::new();
    let [r, g, b, a] = color;

    for i in 0..ref_pts.len() - 1 {
        let pt0 = ref_pts[i];
        let pt1 = ref_pts[i + 1];

        let ds0 = (pt0.s - section_s).max(0.0);
        let ds1 = (pt1.s - section_s).max(0.0);

        let w0 = eval_width(widths, ds0);
        let w1 = eval_width(widths, ds1);
        if w0 <= 0.0 && w1 <= 0.0 {
            continue;
        }
        let inner0 = sum_widths_at_ds(prev_widths, ds0, eval_width);
        let inner1 = sum_widths_at_ds(prev_widths, ds1, eval_width);

        let z0 = eval_elev(elevations, pt0.s) as f32;
        let z1 = eval_elev(elevations, pt1.s) as f32;

        let lo0 = eval_lane_off(lane_offsets, pt0.s);
        let lo1 = eval_lane_off(lane_offsets, pt1.s);

        let (in0, out0) = if is_left {
            (lo0 + inner0, lo0 + inner0 + w0)
        } else {
            (lo0 - inner0, lo0 - (inner0 + w0))
        };
        let (in1, out1) = if is_left {
            (lo1 + inner1, lo1 + inner1 + w1)
        } else {
            (lo1 - inner1, lo1 - (inner1 + w1))
        };

        let (ix0, iy0, _) = offset_pt(pt0, in0, 0.0);
        let (ox0, oy0, _) = offset_pt(pt0, out0, 0.0);
        let (ix1, iy1, _) = offset_pt(pt1, in1, 0.0);
        let (ox1, oy1, _) = offset_pt(pt1, out1, 0.0);

        verts.push([ix0 as f32, iy0 as f32, z0, r, g, b, a]);
        verts.push([ox0 as f32, oy0 as f32, z0, r, g, b, a]);
        verts.push([ix1 as f32, iy1 as f32, z1, r, g, b, a]);
        verts.push([ox0 as f32, oy0 as f32, z0, r, g, b, a]);
        verts.push([ox1 as f32, oy1 as f32, z1, r, g, b, a]);
        verts.push([ix1 as f32, iy1 as f32, z1, r, g, b, a]);
    }

    verts
}

/// Generate a default ribbon when no lane section data is available.
pub(crate) fn gen_default_ribbon(
    ref_pts: &[we_core::geometry::eval::RefLinePoint],
    elevations: &[we_core::model::Elevation],
    half_width: f64,
    color: [f32; 4],
) -> Vec<[f32; 7]> {
    use we_core::geometry::eval::{evaluate_elevation, offset_point};

    let mut verts = Vec::new();
    let [r, g, b, a] = color;

    for i in 0..ref_pts.len() - 1 {
        let pt0 = &ref_pts[i];
        let pt1 = &ref_pts[i + 1];

        let z0 = evaluate_elevation(elevations, pt0.s) as f32;
        let z1 = evaluate_elevation(elevations, pt1.s) as f32;

        let (lx0, ly0, _) = offset_point(pt0, half_width, 0.0);
        let (rx0, ry0, _) = offset_point(pt0, -half_width, 0.0);
        let (lx1, ly1, _) = offset_point(pt1, half_width, 0.0);
        let (rx1, ry1, _) = offset_point(pt1, -half_width, 0.0);

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
    use super::{gen_default_ribbon, gen_lane_strip};
    use we_core::geometry::eval::RefLinePoint;
    use we_core::model::{Elevation, LaneOffset, LaneWidth};

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
        ]
    }

    fn width(a: f64) -> LaneWidth {
        LaneWidth {
            s_offset: 0.0,
            a,
            b: 0.0,
            c: 0.0,
            d: 0.0,
        }
    }

    #[test]
    fn test_gen_lane_strip_left_lane_applies_lane_offset_and_inner_widths() {
        let ref_pts = ref_points();
        let ref_refs = vec![&ref_pts[0], &ref_pts[1]];
        let prev_widths = [width(2.0)];
        let verts = gen_lane_strip(
            &ref_refs,
            &[width(3.0)],
            0.0,
            &[Elevation {
                s: 0.0,
                a: 0.5,
                b: 0.0,
                c: 0.0,
                d: 0.0,
            }],
            &[LaneOffset {
                s: 0.0,
                a: 1.0,
                b: 0.0,
                c: 0.0,
                d: 0.0,
            }],
            &[&prev_widths],
            true,
            [0.2, 0.3, 0.4, 0.5],
            &|elevs: &[Elevation], _| elevs[0].a,
            &|widths: &[LaneWidth], _| widths[0].a,
            &|offsets: &[LaneOffset], _| offsets[0].a,
            &|pt: &RefLinePoint, t, _| (pt.x, pt.y + t, 0.0),
        );

        assert_eq!(verts.len(), 6);
        assert_eq!(verts[0], [0.0, 3.0, 0.5, 0.2, 0.3, 0.4, 0.5]);
        assert_eq!(verts[1], [0.0, 6.0, 0.5, 0.2, 0.3, 0.4, 0.5]);
        assert_eq!(verts[4], [5.0, 6.0, 0.5, 0.2, 0.3, 0.4, 0.5]);
    }

    #[test]
    fn test_gen_lane_strip_skips_segments_with_zero_width() {
        let ref_pts = ref_points();
        let ref_refs = vec![&ref_pts[0], &ref_pts[1]];
        let verts = gen_lane_strip(
            &ref_refs,
            &[width(0.0)],
            0.0,
            &[],
            &[],
            &[],
            false,
            [1.0, 1.0, 1.0, 1.0],
            &|_, _| 0.0,
            &|widths: &[LaneWidth], _| widths[0].a,
            &|_, _| 0.0,
            &|pt: &RefLinePoint, t, _| (pt.x, pt.y + t, 0.0),
        );

        assert!(verts.is_empty());
    }

    #[test]
    fn test_gen_default_ribbon_generates_two_triangles_per_segment() {
        let verts = gen_default_ribbon(
            &ref_points(),
            &[Elevation {
                s: 0.0,
                a: 1.25,
                b: 0.0,
                c: 0.0,
                d: 0.0,
            }],
            2.0,
            [0.9, 0.8, 0.7, 0.6],
        );

        assert_eq!(verts.len(), 6);
        assert_eq!(verts[0], [0.0, 2.0, 1.25, 0.9, 0.8, 0.7, 0.6]);
        assert_eq!(verts[1], [0.0, -2.0, 1.25, 0.9, 0.8, 0.7, 0.6]);
        assert_eq!(verts[5], [5.0, 2.0, 1.25, 0.9, 0.8, 0.7, 0.6]);
    }
}
