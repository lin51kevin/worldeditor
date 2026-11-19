use super::colors::{mark_color, mark_line_width};
use super::helpers::eval_lane_offset;
use super::min_width::min_line_width_m;
use we_core::geometry::eval::RefLinePoint;
use we_core::model::LaneOffset;

/// Vertex layout produced by [`gen_road_mark_line`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum MarkVertexFormat {
    /// 7 floats `[x, y, z, r, g, b, a]`, widened to `min_line_width_m()`.
    Triangles,
    /// 11 floats `[edge x, y, z, r, g, b, a, center x, y, z, side]` at native
    /// width; the renderer widens sub-pixel ribbons in screen space.
    Ribbon,
}

pub(super) const TRIANGLE_FLOATS: usize = 7;
pub(super) const RIBBON_FLOATS: usize = 11;

const Z_LIFT: f64 = 0.015; // 15mm above road surface (matches C# RoadMarkConfig)
const DASH_LEN: f64 = 4.0; // C# standard: 4m dash + 6m gap
const DASH_CYCLE: f64 = 10.0;

/// Emit all road-mark line vertices for a single `RoadMark` into `out`.
///
/// Handles:
/// - Single-line types (`Solid`, `Broken`, `BottsDots`, `Curb`, `Grass`, `Custom`, `StopLine`)
/// - Double-line types (`SolidSolid`, `SolidBroken`, `BrokenSolid`):
///   generates two parallel lines with a ~8cm gap between their inner edges.
#[allow(clippy::too_many_arguments)]
pub(super) fn emit_road_mark(
    rm: &we_core::model::RoadMark,
    section_pts: &[&RefLinePoint],
    elevations: &[we_core::model::Elevation],
    superelevations: &[we_core::model::Superelevation],
    crossfalls: &[we_core::model::Crossfall],
    section_s: f64,
    lane_offsets: &[LaneOffset],
    lateral_offset_at_ds: &impl Fn(f64) -> f64,
    format: MarkVertexFormat,
    out: &mut Vec<f32>,
) {
    use we_core::geometry::eval::{evaluate_elevation, lateral_z_offset, offset_point};
    use we_core::model::RoadMarkType;

    let lc = mark_color(rm.color);
    let lw = mark_line_width(rm);
    // OpenDRIVE: the dash pattern restarts at each roadMark's sOffset.
    let dash_origin = section_s + rm.s_offset;
    let surface_z = |s: f64, t: f64| {
        evaluate_elevation(elevations, s) + lateral_z_offset(superelevations, crossfalls, s, t)
    };

    // Half the center-to-center distance between two parallel lines.
    // Gap between inner edges = 2*double_spacing - lw; we target a visible ~8cm gap.
    let double_spacing: f64 = (lw as f64 / 2.0) + 0.04;

    let mut line = |shift: f64, dashed: bool| {
        gen_road_mark_line(
            section_pts,
            section_s,
            lane_offsets,
            &|ds| lateral_offset_at_ds(ds) + shift,
            lw,
            lc,
            dashed.then_some(dash_origin),
            format,
            &surface_z,
            &eval_lane_offset,
            &offset_point,
            out,
        );
    };

    match rm.mark_type {
        RoadMarkType::SolidSolid => {
            line(double_spacing, false);
            line(-double_spacing, false);
        }
        RoadMarkType::SolidBroken => {
            line(double_spacing, false);
            line(-double_spacing, true);
        }
        RoadMarkType::BrokenSolid => {
            line(double_spacing, true);
            line(-double_spacing, false);
        }
        // Single-line types (Solid, Broken, BottsDots, Curb, Grass, StopLine, Custom, None ignored)
        _ => line(0.0, matches!(rm.mark_type, RoadMarkType::Broken)),
    }
}

/// Generate a road marking line as a thin ribbon at a lateral offset.
///
/// `dash_origin` is `Some(s)` for dashed marks: each ref-line segment is
/// clipped to the `[s + k*cycle, s + k*cycle + dash_len]` intervals, so dash
/// length doesn't depend on where the adaptive sampler placed its points.
/// `surface_z(s, t)` is the road surface height (elevation + banking) at
/// lateral offset `t`.
#[allow(clippy::too_many_arguments)]
pub(super) fn gen_road_mark_line(
    ref_pts: &[&RefLinePoint],
    section_s: f64,
    lane_offsets: &[LaneOffset],
    lateral_offset_at_ds: &impl Fn(f64) -> f64,
    line_width: f32,
    color: [f32; 4],
    dash_origin: Option<f64>,
    format: MarkVertexFormat,
    surface_z: &impl Fn(f64, f64) -> f64,
    eval_lane_off: &impl Fn(&[LaneOffset], f64) -> f64,
    offset_pt: &impl Fn(&RefLinePoint, f64, f64) -> (f64, f64, f64),
    out: &mut Vec<f32>,
) {
    let half_w = match format {
        MarkVertexFormat::Triangles => (line_width.max(min_line_width_m() as f32) * 0.5) as f64,
        MarkVertexFormat::Ribbon => line_width as f64 * 0.5,
    };

    let edges = |pt: &RefLinePoint| -> Edges {
        let t = eval_lane_off(lane_offsets, pt.s)
            + lateral_offset_at_ds((pt.s - section_s).max(0.0));
        let edge = |tt: f64| {
            let (x, y, _) = offset_pt(pt, tt, 0.0);
            [x, y, surface_z(pt.s, tt) + Z_LIFT]
        };
        [edge(t + half_w), edge(t - half_w)]
    };

    for pair in ref_pts.windows(2) {
        let (pt0, pt1) = (pair[0], pair[1]);
        let e0 = edges(pt0);
        let e1 = edges(pt1);

        let Some(origin) = dash_origin else {
            emit_quad(&e0, &e1, color, format, out);
            continue;
        };
        let len = pt1.s - pt0.s;
        if len <= 1e-9 {
            continue;
        }
        let first = ((pt0.s - origin) / DASH_CYCLE).floor() as i64;
        let last = ((pt1.s - origin) / DASH_CYCLE).floor() as i64;
        for k in first..=last {
            let dash_start = origin + k as f64 * DASH_CYCLE;
            let a = dash_start.max(pt0.s);
            let b = (dash_start + DASH_LEN).min(pt1.s);
            if b - a <= 1e-6 {
                continue;
            }
            let ea = lerp_edges(&e0, &e1, (a - pt0.s) / len);
            let eb = lerp_edges(&e0, &e1, (b - pt0.s) / len);
            emit_quad(&ea, &eb, color, format, out);
        }
    }
}

/// `[left edge, right edge]`, each `[x, y, z]`.
type Edges = [[f64; 3]; 2];

fn lerp_edges(e0: &Edges, e1: &Edges, f: f64) -> Edges {
    let lerp = |a: &[f64; 3], b: &[f64; 3]| {
        [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
    };
    [lerp(&e0[0], &e1[0]), lerp(&e0[1], &e1[1])]
}

fn emit_quad(e0: &Edges, e1: &Edges, color: [f32; 4], format: MarkVertexFormat, out: &mut Vec<f32>) {
    let mid = |e: &Edges| {
        [(e[0][0] + e[1][0]) * 0.5, (e[0][1] + e[1][1]) * 0.5, (e[0][2] + e[1][2]) * 0.5]
    };
    let (c0, c1) = (mid(e0), mid(e1));
    let stride = match format {
        MarkVertexFormat::Triangles => TRIANGLE_FLOATS,
        MarkVertexFormat::Ribbon => RIBBON_FLOATS,
    };
    out.reserve(6 * stride);
    // Two triangles: l0 r0 l1, r0 r1 l1.
    let corners = [
        (&e0[0], &c0, 1.0f32),
        (&e0[1], &c0, -1.0),
        (&e1[0], &c1, 1.0),
        (&e0[1], &c0, -1.0),
        (&e1[1], &c1, -1.0),
        (&e1[0], &c1, 1.0),
    ];
    for (p, c, side) in corners {
        out.extend_from_slice(&[p[0] as f32, p[1] as f32, p[2] as f32]);
        out.extend_from_slice(&color);
        if format == MarkVertexFormat::Ribbon {
            out.extend_from_slice(&[c[0] as f32, c[1] as f32, c[2] as f32, side]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        MarkVertexFormat, RIBBON_FLOATS, TRIANGLE_FLOATS, emit_road_mark, gen_road_mark_line,
    };
    use we_core::geometry::eval::RefLinePoint;
    use we_core::model::{
        LaneOffset, RoadMark, RoadMarkColor, RoadMarkType, RoadMarkWeight, Superelevation,
    };

    fn straight_points(start_s: f64, step: f64, count: usize) -> Vec<RefLinePoint> {
        (0..count)
            .map(|i| {
                let s = start_s + step * i as f64;
                RefLinePoint {
                    x: s,
                    y: 0.0,
                    hdg: 0.0,
                    s,
                }
            })
            .collect()
    }

    fn ref_points() -> Vec<RefLinePoint> {
        straight_points(0.0, 5.0, 3)
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

    fn gen_flat(
        pts: &[RefLinePoint],
        dash_origin: Option<f64>,
        format: MarkVertexFormat,
    ) -> Vec<f32> {
        let refs: Vec<_> = pts.iter().collect();
        let mut out = Vec::new();
        gen_road_mark_line(
            &refs,
            0.0,
            &[],
            &|_| 0.0,
            0.2,
            [1.0, 1.0, 1.0, 1.0],
            dash_origin,
            format,
            &|_, _| 0.0,
            &|_, _| 0.0,
            &|pt: &RefLinePoint, t, _| (pt.x, pt.y + t, 0.0),
            &mut out,
        );
        out
    }

    /// Total s-length covered by emitted dashes (each quad = 6 vertices; x == s here).
    fn dash_lengths(verts: &[f32], stride: usize) -> Vec<f32> {
        verts
            .chunks(stride * 6)
            .map(|quad| quad[stride * 2] - quad[0])
            .collect()
    }

    #[test]
    fn test_gen_road_mark_line_solid_emits_triangles_for_each_segment() {
        let ref_pts = ref_points();
        let ref_refs = vec![&ref_pts[0], &ref_pts[1], &ref_pts[2]];
        let mut out = Vec::new();
        gen_road_mark_line(
            &ref_refs,
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
            None,
            MarkVertexFormat::Triangles,
            &|_, _| 1.0,
            &|offsets: &[LaneOffset], _| offsets[0].a,
            &|pt: &RefLinePoint, t, _| (pt.x, pt.y + t, 0.0),
            &mut out,
        );

        let verts: Vec<_> = out.chunks(TRIANGLE_FLOATS).collect();
        assert_eq!(verts.len(), 12);
        assert_eq!(verts[0], [0.0, 1.1, 1.015, 0.8, 0.7, 0.6, 0.5]);
        assert_eq!(verts[1], [0.0, 0.9, 1.015, 0.8, 0.7, 0.6, 0.5]);
        assert_eq!(verts[11], [10.0, 1.1, 1.015, 0.8, 0.7, 0.6, 0.5]);
    }

    #[test]
    fn test_gen_road_mark_line_dashed_clips_to_dash_interval() {
        let out = gen_flat(&ref_points(), Some(0.0), MarkVertexFormat::Triangles);

        assert_eq!(out.len(), 6 * TRIANGLE_FLOATS);
        assert_eq!(dash_lengths(&out, TRIANGLE_FLOATS), vec![4.0]);
    }

    #[test]
    fn test_gen_road_mark_line_dashed_survives_misaligned_5m_sampling() {
        // Midpoint phases 4.5 / 9.5: the old midpoint test dropped every segment.
        let pts = straight_points(2.0, 5.0, 9);
        let out = gen_flat(&pts, Some(0.0), MarkVertexFormat::Triangles);

        let total: f32 = dash_lengths(&out, TRIANGLE_FLOATS).iter().sum();
        // s ∈ [2, 42]: dashes [2,4] [10,14] [20,24] [30,34] [40,42].
        assert!((total - 16.0).abs() < 1e-4, "total dash length {total}");
    }

    #[test]
    fn test_gen_road_mark_line_dashed_splits_dash_across_sample_points() {
        let pts = straight_points(0.0, 1.5, 3);
        let out = gen_flat(&pts, Some(0.0), MarkVertexFormat::Triangles);

        assert_eq!(dash_lengths(&out, TRIANGLE_FLOATS), vec![1.5, 1.5]);
    }

    #[test]
    fn test_gen_road_mark_line_ribbon_keeps_native_width_and_center() {
        super::super::min_width::set_min_line_width_m(0.4);
        let out = gen_flat(&ref_points(), None, MarkVertexFormat::Ribbon);
        super::super::min_width::set_min_line_width_m(0.0);

        let verts: Vec<_> = out.chunks(RIBBON_FLOATS).collect();
        assert_eq!(verts.len(), 12);
        // Left edge at native half width 0.1, center on the line, side = +1.
        assert!((verts[0][1] - 0.1).abs() < 1e-6);
        assert_eq!(&verts[0][7..11], &[0.0, 0.0, 0.015, 1.0]);
        assert!((verts[1][1] + 0.1).abs() < 1e-6);
        assert_eq!(verts[1][10], -1.0);
    }

    #[test]
    fn test_emit_road_mark_follows_banked_surface() {
        let ref_pts = ref_points();
        let ref_refs = vec![&ref_pts[0], &ref_pts[1], &ref_pts[2]];
        let bank = [Superelevation {
            s: 0.0,
            a: 0.1,
            b: 0.0,
            c: 0.0,
            d: 0.0,
        }];
        let mut out = Vec::new();

        emit_road_mark(
            &sample_mark(RoadMarkType::Solid),
            &ref_refs,
            &[],
            &bank,
            &[],
            0.0,
            &[],
            &|_| 3.5,
            MarkVertexFormat::Triangles,
            &mut out,
        );

        let left = &out[0..TRIANGLE_FLOATS];
        let expected = 3.6f64 * 0.1f64.sin() + 0.015;
        assert!((left[2] as f64 - expected).abs() < 1e-5, "z {}", left[2]);
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
            &[],
            &[],
            0.0,
            &[],
            &|_| 0.0,
            MarkVertexFormat::Triangles,
            &mut out,
        );

        assert_eq!(out.len(), 24 * 7);
        assert_eq!(&out[3..7], &[0.976, 0.827, 0.137, 1.0]);
    }
}
