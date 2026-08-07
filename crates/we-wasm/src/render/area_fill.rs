//! World-space polygon construction and surface-fill patterns for area road
//! objects (crosswalks, cross-hatch/woven areas, waiting areas, parking spaces).
//!
//! All area objects share one geometry pipeline: build a world-space polygon
//! from whichever data the object carries (`cornerLocal`, `cornerRoad`, or just
//! `width`/`length`), then fill it with a stripe/arrow pattern and stroke a thin
//! outline on top.

use we_core::geometry::eval::{RefLinePoint, offset_point};
use we_core::model::{CornerType, Geometry, ObjectType, Point3D, RoadObject};

use super::helpers::road_point_at_s;
use super::signal_arrows::arrow_triangles;

/// Outline is lifted slightly above the fill so it stays visible on top of it.
pub(crate) const AREA_OUTLINE_Z_LIFT: f32 = 0.005;

/// Stripe defaults, overridable per object via the `Angle` / `LineWidth` /
/// `LineGap` userData keys. Values mirror the legacy C# `ExtendedProperties*`
/// classes so imported and template-placed objects look identical there.
pub(crate) const STRIPE_LINE_WIDTH: f64 = 0.45;
pub(crate) const STRIPE_LINE_GAP: f64 = 0.60;
/// `ExtendedPropertiesSimpleCrossHatch` widens the gap to 3 m.
pub(crate) const SIMPLE_HATCH_LINE_GAP: f64 = 3.0;
/// Cross-hatch stripes run at 45°; crosswalk and woven stripes run at 0°.
pub(crate) const HATCH_ANGLE_DEG: f64 = 45.0;

/// Fallback footprint `(length, width)` in metres for area objects placed from
/// a template, which carry neither corner data nor explicit dimensions.
///
/// Returning `Some` also identifies an object type as an *area* object, i.e. one
/// that renders as a filled polygon rather than a marker.
pub(crate) fn area_default_size(object_type: &ObjectType) -> Option<(f64, f64)> {
    match object_type {
        ObjectType::Crosswalk => Some((4.0, 3.5)),
        ObjectType::ParkingSpace => Some((5.0, 2.5)),
        ObjectType::CrossHatchArea | ObjectType::SimpleCrossHatch => Some((5.0, 3.0)),
        ObjectType::WovenArea => Some((5.0, 3.5)),
        ObjectType::ForwardWaitingArea | ObjectType::TurnLeftWaitingArea => Some((4.0, 3.5)),
        _ => None,
    }
}

/// Map an object's corner list into world space, honouring the `cornerLocal` /
/// `cornerRoad` convention. Returns an empty vector when the object has fewer
/// than two corners.
pub(crate) fn corner_world_points(
    obj: &RoadObject,
    ref_pt: &RefLinePoint,
    plan_view: &[Geometry],
) -> Vec<(f64, f64)> {
    if obj.corners.len() < 2 {
        return Vec::new();
    }
    match obj.corner_type {
        CornerType::Road => road_corners_world_polygon(&obj.corners, plan_view),
        CornerType::Local => {
            let apply_hdg = if obj.object_type == ObjectType::Crosswalk {
                super::signal_mesh::detect_crosswalk_apply_hdg(
                    &obj.corners,
                    obj.hdg,
                    obj.length,
                    obj.width,
                )
            } else {
                obj.length > 0.0 && obj.width > 0.0
            };
            local_corners_world_polygon(&obj.corners, ref_pt, obj.position.y, obj.hdg, apply_hdg)
        }
    }
}

/// Build the world-space polygon for an area object, regardless of how its
/// footprint is described.
///
/// Priority: `cornerRoad` / `cornerLocal` outline when present, otherwise an
/// oriented rectangle synthesised from `length` / `width` — the case that all
/// template-placed objects hit, since templates never carry corner data.
pub(crate) fn area_world_polygon(
    obj: &RoadObject,
    ref_pt: &RefLinePoint,
    plan_view: &[Geometry],
) -> Vec<(f64, f64)> {
    if obj.corners.len() >= 3 {
        return corner_world_points(obj, ref_pt, plan_view);
    }

    let (default_length, default_width) = area_default_size(&obj.object_type).unwrap_or((4.0, 3.5));
    let length = if obj.length > 0.0 {
        obj.length
    } else {
        default_length
    };
    let width = if obj.width > 0.0 {
        obj.width
    } else {
        default_width
    };
    oriented_rect_world_polygon(ref_pt, obj.position.y, obj.hdg, length, width)
}

/// Map `cornerLocal` (u, v) corners into world space.
///
/// `apply_hdg` selects the coordinate convention: `true` rotates the corners by
/// the object heading first (spec-compliant object-local frame), `false` treats
/// (u, v) as already being road-frame (along-road, lateral).
pub(crate) fn local_corners_world_polygon(
    corners: &[Point3D],
    ref_pt: &RefLinePoint,
    obj_t: f64,
    obj_hdg: f64,
    apply_hdg: bool,
) -> Vec<(f64, f64)> {
    let (ox, oy, _) = offset_point(ref_pt, obj_t, 0.0);
    let (cos_road, sin_road) = (ref_pt.hdg.cos(), ref_pt.hdg.sin());
    let (cos_h, sin_h) = if apply_hdg {
        (obj_hdg.cos(), obj_hdg.sin())
    } else {
        (1.0, 0.0)
    };
    corners
        .iter()
        .map(|c| {
            let alpha = c.x * cos_h - c.y * sin_h;
            let beta = c.x * sin_h + c.y * cos_h;
            (
                ox + alpha * cos_road - beta * sin_road,
                oy + alpha * sin_road + beta * cos_road,
            )
        })
        .collect()
}

/// Map `cornerRoad` (s, t) corners into world space by evaluating each corner
/// independently on the road reference line.
pub(crate) fn road_corners_world_polygon(
    corners: &[Point3D],
    plan_view: &[Geometry],
) -> Vec<(f64, f64)> {
    corners
        .iter()
        .filter_map(|c| {
            let rp = road_point_at_s(plan_view, c.x)?;
            let (wx, wy, _) = offset_point(&rp, c.y, 0.0);
            Some((wx, wy))
        })
        .collect()
}

/// Build an oriented rectangle centred at `(ref_pt, obj_t)`, `length` along the
/// road heading rotated by `obj_hdg` and `width` across it.
pub(crate) fn oriented_rect_world_polygon(
    ref_pt: &RefLinePoint,
    obj_t: f64,
    obj_hdg: f64,
    length: f64,
    width: f64,
) -> Vec<(f64, f64)> {
    let (cx, cy, _) = offset_point(ref_pt, obj_t, 0.0);
    let hdg = ref_pt.hdg + obj_hdg;
    let (cos_h, sin_h) = (hdg.cos(), hdg.sin());
    let (half_l, half_w) = (length / 2.0, width / 2.0);
    vec![
        (
            cx + cos_h * half_l - sin_h * half_w,
            cy + sin_h * half_l + cos_h * half_w,
        ),
        (
            cx + cos_h * half_l + sin_h * half_w,
            cy + sin_h * half_l - cos_h * half_w,
        ),
        (
            cx - cos_h * half_l + sin_h * half_w,
            cy - sin_h * half_l - cos_h * half_w,
        ),
        (
            cx - cos_h * half_l - sin_h * half_w,
            cy - sin_h * half_l + cos_h * half_w,
        ),
    ]
}

/// Fill a world-space polygon with parallel stripes.
///
/// Stripes are laid out along `sweep_theta` (each stripe bar runs perpendicular
/// to it) and clipped to the polygon with a scan line, so concave outlines stay
/// correct without triangulating the polygon.
#[allow(clippy::too_many_arguments)]
pub(crate) fn fill_polygon_stripes(
    world_poly: &[(f64, f64)],
    sweep_theta: f64,
    stripe_width: f64,
    stripe_period: f64,
    z: f32,
    color: [f32; 4],
    out: &mut Vec<f32>,
) {
    if world_poly.len() < 3 || stripe_width <= 0.0 {
        return;
    }
    // Clamp the period so malformed userData cannot spin the sweep loop.
    let stripe_period = stripe_period.max(stripe_width).max(0.05);

    let (ox, oy) = world_poly[0];
    let (cos_sw, sin_sw) = (sweep_theta.cos(), sweep_theta.sin());

    let mut s_min = f64::INFINITY;
    let mut s_max = f64::NEG_INFINITY;
    let mut l_min = f64::INFINITY;
    let mut l_max = f64::NEG_INFINITY;
    for &(wx, wy) in world_poly {
        let (dx, dy) = (wx - ox, wy - oy);
        let s_coord = dx * cos_sw + dy * sin_sw;
        let l_coord = -dx * sin_sw + dy * cos_sw;
        s_min = s_min.min(s_coord);
        s_max = s_max.max(s_coord);
        l_min = l_min.min(l_coord);
        l_max = l_max.max(l_coord);
    }
    if s_max <= s_min || l_max <= l_min {
        return;
    }

    let world_from_sweep = |s: f64, l: f64| -> (f64, f64) {
        (ox + s * cos_sw - l * sin_sw, oy + s * sin_sw + l * cos_sw)
    };
    let [r, g, b, a] = color;

    let mut s_pos = s_min;
    while s_pos < s_max {
        let s_end = (s_pos + stripe_width).min(s_max);
        // Clip at *both* ends of the band and join them into a trapezoid.  Using
        // a single mid-band scan line would make the quad overshoot the polygon
        // wherever the outline is oblique to the sweep (a 45° hatch on a
        // rectangle leaks half a stripe width past every edge).
        let inset = ((s_end - s_pos) * 1e-3).min(1e-6);
        let hits_a = clip_scanline_lateral(
            world_poly,
            ox,
            oy,
            cos_sw,
            sin_sw,
            l_min,
            l_max,
            s_pos + inset,
        );
        let hits_b = clip_scanline_lateral(
            world_poly,
            ox,
            oy,
            cos_sw,
            sin_sw,
            l_min,
            l_max,
            s_end - inset,
        );

        let mut pair_idx = 0;
        while pair_idx + 1 < hits_a.len() && pair_idx + 1 < hits_b.len() {
            let a_start = hits_a[pair_idx].max(l_min);
            let a_end = hits_a[pair_idx + 1].min(l_max);
            let b_start = hits_b[pair_idx].max(l_min);
            let b_end = hits_b[pair_idx + 1].min(l_max);
            pair_idx += 2;

            if a_end - a_start < 1e-6 && b_end - b_start < 1e-6 {
                continue;
            }

            let p00 = world_from_sweep(s_pos, a_start);
            let p10 = world_from_sweep(s_pos, a_end);
            let p11 = world_from_sweep(s_end, b_end);
            let p01 = world_from_sweep(s_end, b_start);

            out.extend_from_slice(&[p00.0 as f32, p00.1 as f32, z, r, g, b, a]);
            out.extend_from_slice(&[p10.0 as f32, p10.1 as f32, z, r, g, b, a]);
            out.extend_from_slice(&[p11.0 as f32, p11.1 as f32, z, r, g, b, a]);

            out.extend_from_slice(&[p00.0 as f32, p00.1 as f32, z, r, g, b, a]);
            out.extend_from_slice(&[p11.0 as f32, p11.1 as f32, z, r, g, b, a]);
            out.extend_from_slice(&[p01.0 as f32, p01.1 as f32, z, r, g, b, a]);
        }

        s_pos += stripe_period;
    }
}

/// Fill a polygon with one set of parallel stripes at `angle_deg` to the road
/// tangent (C# `ObjectTessellator.FillBoldLine`).
///
/// `line_width` / `line_gap` fall back to the C# defaults when non-positive.
#[allow(clippy::too_many_arguments)]
pub(crate) fn fill_angled_stripes(
    world_poly: &[(f64, f64)],
    road_hdg: f64,
    angle_deg: f64,
    line_width: f64,
    line_gap: f64,
    z: f32,
    color: [f32; 4],
    out: &mut Vec<f32>,
) {
    let stripe_width = if line_width > 0.0 {
        line_width
    } else {
        STRIPE_LINE_WIDTH
    };
    let gap = if line_gap > 0.0 {
        line_gap
    } else {
        STRIPE_LINE_GAP
    };
    // The stripe bars run at `road_hdg - angle`; the sweep advances across them.
    let sweep_theta = road_hdg - angle_deg.to_radians() + std::f64::consts::FRAC_PI_2;
    fill_polygon_stripes(
        world_poly,
        sweep_theta,
        stripe_width,
        stripe_width + gap,
        z,
        color,
        out,
    );
}

/// Fill a polygon with two perpendicular stripe sets, forming a hatch grid.
///
/// C# draws the second set at `Angle + 90°`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn fill_cross_hatch(
    world_poly: &[(f64, f64)],
    road_hdg: f64,
    angle_deg: f64,
    line_width: f64,
    line_gap: f64,
    z: f32,
    color: [f32; 4],
    out: &mut Vec<f32>,
) {
    fill_angled_stripes(
        world_poly, road_hdg, angle_deg, line_width, line_gap, z, color, out,
    );
    fill_angled_stripes(
        world_poly,
        road_hdg,
        angle_deg + 90.0,
        line_width,
        line_gap,
        z,
        color,
        out,
    );
}

/// Emit directional paint arrows inside a waiting-area polygon.
///
/// Long areas get a second arrow so the marking stays readable end to end.
pub(crate) fn emit_area_arrows(
    world_poly: &[(f64, f64)],
    heading: f64,
    subtype: &str,
    z: f32,
    color: [f32; 4],
    out: &mut Vec<f32>,
) {
    if world_poly.len() < 3 {
        return;
    }
    let (cx, cy) = polygon_centroid(world_poly);
    let (along, across) = polygon_extents(world_poly, heading);
    if along <= 0.0 || across <= 0.0 {
        return;
    }

    let arrow_count = if along > 8.0 { 2 } else { 1 };
    // Fit the arrow inside the polygon: it is as long as it is wide (the
    // templates are normalised to a unit square).
    let scale = (along / arrow_count as f64).min(across) * 0.7;
    let (cos_h, sin_h) = (heading.cos(), heading.sin());

    for i in 0..arrow_count {
        // Spread arrows evenly along the polygon's longitudinal axis.
        let frac = (i as f64 + 0.5) / arrow_count as f64 - 0.5;
        let shift = frac * along;
        let ax = cx + cos_h * shift;
        let ay = cy + sin_h * shift;
        let tris = arrow_triangles(
            subtype,
            ax as f32,
            ay as f32,
            z,
            heading as f32,
            scale as f32,
        );
        append_recolored(&tris, color, out);
    }
}

/// Copy arrow triangles while overriding their vertex colour.
fn append_recolored(tris: &[f32], color: [f32; 4], out: &mut Vec<f32>) {
    let [r, g, b, a] = color;
    for v in tris.chunks_exact(7) {
        out.extend_from_slice(&[v[0], v[1], v[2], r, g, b, a]);
    }
}

/// Arithmetic mean of the polygon vertices.
pub(crate) fn polygon_centroid(world_poly: &[(f64, f64)]) -> (f64, f64) {
    let n = world_poly.len() as f64;
    let (sx, sy) = world_poly
        .iter()
        .fold((0.0, 0.0), |(sx, sy), &(x, y)| (sx + x, sy + y));
    (sx / n, sy / n)
}

/// Polygon size measured along `theta` and perpendicular to it.
pub(crate) fn polygon_extents(world_poly: &[(f64, f64)], theta: f64) -> (f64, f64) {
    let (cos_t, sin_t) = (theta.cos(), theta.sin());
    let (mut a_min, mut a_max) = (f64::INFINITY, f64::NEG_INFINITY);
    let (mut b_min, mut b_max) = (f64::INFINITY, f64::NEG_INFINITY);
    for &(x, y) in world_poly {
        let a = x * cos_t + y * sin_t;
        let b = -x * sin_t + y * cos_t;
        a_min = a_min.min(a);
        a_max = a_max.max(a);
        b_min = b_min.min(b);
        b_max = b_max.max(b);
    }
    (a_max - a_min, b_max - b_min)
}

/// Find the lateral intersection points of a scan line at position `s_coord`
/// along the sweep direction with a world-space polygon.
///
/// Returns sorted lateral values where the scan line enters/exits the polygon;
/// callers process pairs `[l0, l1], [l2, l3], ...` as inside segments.
#[allow(clippy::too_many_arguments)]
fn clip_scanline_lateral(
    world_poly: &[(f64, f64)],
    ox: f64,
    oy: f64,
    cos_sw: f64,
    sin_sw: f64,
    l_min: f64,
    l_max: f64,
    s_coord: f64,
) -> Vec<f64> {
    let n = world_poly.len();
    if n < 3 {
        return vec![];
    }
    let world_from_sweep = |s: f64, l: f64| -> (f64, f64) {
        (ox + s * cos_sw - l * sin_sw, oy + s * sin_sw + l * cos_sw)
    };
    // Extend 1 m past the AABB so the line fully spans the polygon regardless
    // of floating-point boundary touches.
    let (sx0, sy0) = world_from_sweep(s_coord, l_min - 1.0);
    let (sx1, sy1) = world_from_sweep(s_coord, l_max + 1.0);
    let dx_line = sx1 - sx0;
    let dy_line = sy1 - sy0;

    let mut hits = Vec::new();
    for i in 0..n {
        let j = (i + 1) % n;
        let (ax, ay) = world_poly[i];
        let (bx, by) = world_poly[j];
        let dx_edge = bx - ax;
        let dy_edge = by - ay;
        let denom = dx_line * dy_edge - dy_line * dx_edge;
        if denom.abs() < 1e-12 {
            continue;
        }
        let t_line = ((ax - sx0) * dy_edge - (ay - sy0) * dx_edge) / denom;
        let t_edge = ((ax - sx0) * dy_line - (ay - sy0) * dx_line) / denom;
        if (-1e-9..=1.0 + 1e-9).contains(&t_edge) {
            let hit_l = l_min - 1.0 + t_line * (l_max - l_min + 2.0);
            hits.push(hit_l);
        }
    }
    hits.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    hits
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ref_pt_at(x: f64, hdg: f64) -> RefLinePoint {
        RefLinePoint {
            s: x,
            x,
            y: 0.0,
            hdg,
        }
    }

    /// A 4 m × 2 m rectangle on an east-pointing road, centred at (5, 0).
    fn unit_rect() -> Vec<(f64, f64)> {
        oriented_rect_world_polygon(&ref_pt_at(5.0, 0.0), 0.0, 0.0, 4.0, 2.0)
    }

    #[test]
    fn test_oriented_rect_world_polygon_aligns_length_with_heading() {
        let poly = unit_rect();
        assert_eq!(poly.len(), 4);
        let (along, across) = polygon_extents(&poly, 0.0);
        assert!((along - 4.0).abs() < 1e-9, "along={along}");
        assert!((across - 2.0).abs() < 1e-9, "across={across}");
        let (cx, cy) = polygon_centroid(&poly);
        assert!((cx - 5.0).abs() < 1e-9 && cy.abs() < 1e-9);
    }

    #[test]
    fn test_oriented_rect_world_polygon_applies_object_heading() {
        // hdg = π/2 swaps the along/across extents relative to the road.
        let poly = oriented_rect_world_polygon(
            &ref_pt_at(5.0, 0.0),
            0.0,
            std::f64::consts::FRAC_PI_2,
            4.0,
            2.0,
        );
        let (along, across) = polygon_extents(&poly, 0.0);
        assert!((along - 2.0).abs() < 1e-9, "along={along}");
        assert!((across - 4.0).abs() < 1e-9, "across={across}");
    }

    #[test]
    fn test_fill_polygon_stripes_emits_expected_stripe_count() {
        let poly = unit_rect();
        let mut out = Vec::new();
        // Sweep along the road: 4 m span, 1 m period → 4 stripes of 6 vertices.
        fill_polygon_stripes(&poly, 0.0, 0.5, 1.0, 0.0, [1.0; 4], &mut out);
        assert_eq!(out.len() / 42, 4, "got {} floats", out.len());
    }

    #[test]
    fn test_fill_polygon_stripes_stays_inside_polygon() {
        let poly = unit_rect();
        let mut out = Vec::new();
        fill_polygon_stripes(&poly, 0.0, 0.5, 1.0, 0.0, [1.0; 4], &mut out);
        for v in out.chunks_exact(7) {
            assert!((3.0 - 1e-6..=7.0 + 1e-6).contains(&v[0]), "x={}", v[0]);
            assert!((-1.0 - 1e-6..=1.0 + 1e-6).contains(&v[1]), "y={}", v[1]);
        }
    }

    #[test]
    fn test_fill_cross_hatch_doubles_single_direction_output() {
        let poly = unit_rect();
        let mut single = Vec::new();
        fill_angled_stripes(
            &poly,
            0.0,
            HATCH_ANGLE_DEG,
            STRIPE_LINE_WIDTH,
            STRIPE_LINE_GAP,
            0.0,
            [1.0; 4],
            &mut single,
        );
        let mut crossed = Vec::new();
        fill_cross_hatch(
            &poly,
            0.0,
            HATCH_ANGLE_DEG,
            STRIPE_LINE_WIDTH,
            STRIPE_LINE_GAP,
            0.0,
            [1.0; 4],
            &mut crossed,
        );
        assert!(!single.is_empty());
        assert_eq!(crossed.len(), single.len() * 2);
    }

    #[test]
    fn test_fill_angled_stripes_falls_back_to_defaults_for_non_positive_metrics() {
        let poly = unit_rect();
        let mut explicit = Vec::new();
        fill_angled_stripes(
            &poly,
            0.0,
            0.0,
            STRIPE_LINE_WIDTH,
            STRIPE_LINE_GAP,
            0.0,
            [1.0; 4],
            &mut explicit,
        );
        let mut defaulted = Vec::new();
        fill_angled_stripes(&poly, 0.0, 0.0, 0.0, 0.0, 0.0, [1.0; 4], &mut defaulted);
        assert!(!explicit.is_empty());
        assert_eq!(explicit, defaulted);
    }

    #[test]
    fn test_wider_gap_yields_fewer_stripes() {
        let poly = unit_rect();
        let mut dense = Vec::new();
        fill_angled_stripes(
            &poly,
            0.0,
            HATCH_ANGLE_DEG,
            STRIPE_LINE_WIDTH,
            STRIPE_LINE_GAP,
            0.0,
            [1.0; 4],
            &mut dense,
        );
        let mut sparse = Vec::new();
        fill_angled_stripes(
            &poly,
            0.0,
            HATCH_ANGLE_DEG,
            STRIPE_LINE_WIDTH,
            SIMPLE_HATCH_LINE_GAP,
            0.0,
            [1.0; 4],
            &mut sparse,
        );
        assert!(
            sparse.len() < dense.len(),
            "sparse={} dense={}",
            sparse.len(),
            dense.len()
        );
    }

    #[test]
    fn test_fill_polygon_stripes_rejects_degenerate_input() {
        let mut out = Vec::new();
        fill_polygon_stripes(
            &[(0.0, 0.0), (1.0, 0.0)],
            0.0,
            0.5,
            1.0,
            0.0,
            [1.0; 4],
            &mut out,
        );
        assert!(out.is_empty());
        fill_polygon_stripes(&unit_rect(), 0.0, 0.0, 1.0, 0.0, [1.0; 4], &mut out);
        assert!(out.is_empty());
    }

    #[test]
    fn test_emit_area_arrows_produces_triangles_inside_polygon() {
        let poly = unit_rect();
        let mut out = Vec::new();
        emit_area_arrows(&poly, 0.0, "StraightAheadArrow", 0.0, [1.0; 4], &mut out);
        assert!(!out.is_empty());
        assert_eq!(out.len() % 21, 0, "expected whole triangles");
        for v in out.chunks_exact(7) {
            assert!((3.0..=7.0).contains(&v[0]), "x={}", v[0]);
            assert!((-1.0..=1.0).contains(&v[1]), "y={}", v[1]);
        }
    }

    #[test]
    fn test_emit_area_arrows_repeats_on_long_areas() {
        let short = oriented_rect_world_polygon(&ref_pt_at(0.0, 0.0), 0.0, 0.0, 5.0, 3.5);
        let long = oriented_rect_world_polygon(&ref_pt_at(0.0, 0.0), 0.0, 0.0, 12.0, 3.5);
        let mut short_out = Vec::new();
        let mut long_out = Vec::new();
        emit_area_arrows(&short, 0.0, "LeftTurnArrow", 0.0, [1.0; 4], &mut short_out);
        emit_area_arrows(&long, 0.0, "LeftTurnArrow", 0.0, [1.0; 4], &mut long_out);
        assert_eq!(long_out.len(), short_out.len() * 2);
    }
}
