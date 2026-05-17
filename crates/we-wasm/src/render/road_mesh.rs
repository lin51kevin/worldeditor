use super::helpers::sum_widths_at_ds;

/// Generate a colored triangle strip for one lane.
#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub(super) fn gen_lane_strip(
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
pub(super) fn gen_default_ribbon(
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
