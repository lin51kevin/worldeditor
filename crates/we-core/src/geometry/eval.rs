//! OpenDRIVE reference line evaluator.
//!
//! Samples points along a road's reference line (plan view) by evaluating
//! each geometry element (Line, Arc, Spiral, Poly3, ParamPoly3).
//! Pure Rust, WASM compatible.

use crate::model::{Elevation, Geometry, GeometryType, LaneWidth, ParamPoly3Range, Road};

#[path = "arc_eval.rs"]
mod arc_eval;
#[path = "line_eval.rs"]
mod line_eval;
#[path = "spiral_eval.rs"]
mod spiral_eval;

pub use arc_eval::*;
pub use line_eval::*;
pub use spiral_eval::*;

/// A sampled point on the reference line.
#[derive(Debug, Clone, Copy)]
pub struct RefLinePoint {
    /// World X coordinate.
    pub x: f64,
    /// World Y coordinate.
    pub y: f64,
    /// Heading (tangent angle in radians).
    pub hdg: f64,
    /// Station (s coordinate along road).
    pub s: f64,
}

/// Evaluate a geometry element at a local offset `ds` from its start.
///
/// Returns `(local_x, local_y, local_hdg)` in the geometry's local frame.
pub fn evaluate_geometry_local(geo: &Geometry, ds: f64) -> (f64, f64, f64) {
    let ds = ds.clamp(0.0, geo.length);

    match &geo.geo_type {
        GeometryType::Line => evaluate_line(ds),

        GeometryType::Arc { curvature } => evaluate_arc(*curvature, ds),

        GeometryType::Spiral {
            curv_start,
            curv_end,
        } => evaluate_spiral(*curv_start, *curv_end, geo.length, ds),

        GeometryType::Poly3 { a, b, c, d } => {
            // Cubic polynomial: v = a + b*u + c*u² + d*u³
            // u is along the reference line direction, v is lateral
            let v = a + b * ds + c * ds * ds + d * ds * ds * ds;
            let dv = b + 2.0 * c * ds + 3.0 * d * ds * ds;
            let hdg = dv.atan();
            (ds, v, hdg)
        }

        GeometryType::ParamPoly3 {
            a_u,
            b_u,
            c_u,
            d_u,
            a_v,
            b_v,
            c_v,
            d_v,
            p_range,
        } => {
            // Parametric cubic: u(p), v(p)
            let p = match p_range {
                ParamPoly3Range::ArcLength => ds,
                ParamPoly3Range::Normalized => {
                    if geo.length > 0.0 {
                        ds / geo.length
                    } else {
                        0.0
                    }
                }
            };

            let u = a_u + b_u * p + c_u * p * p + d_u * p * p * p;
            let v = a_v + b_v * p + c_v * p * p + d_v * p * p * p;
            let du = b_u + 2.0 * c_u * p + 3.0 * d_u * p * p;
            let dv = b_v + 2.0 * c_v * p + 3.0 * d_v * p * p;
            let hdg = dv.atan2(du);
            (u, v, hdg)
        }
    }
}

/// Transform local coordinates to world coordinates using the geometry's origin and heading.
///
/// `ds` is the arc-length offset along the reference line from the geometry start.
/// This should be the true along-path distance, not the Euclidean distance.
pub fn local_to_world(
    geo: &Geometry,
    local_x: f64,
    local_y: f64,
    local_hdg: f64,
    ds: f64,
) -> RefLinePoint {
    let cos_h = geo.hdg.cos();
    let sin_h = geo.hdg.sin();
    RefLinePoint {
        x: geo.x + local_x * cos_h - local_y * sin_h,
        y: geo.y + local_x * sin_h + local_y * cos_h,
        hdg: geo.hdg + local_hdg,
        s: geo.s + ds,
    }
}

/// Evaluate a geometry element at station `ds` and return a world-space point.
pub fn evaluate_geometry(geo: &Geometry, ds: f64) -> RefLinePoint {
    let (lx, ly, lh) = evaluate_geometry_local(geo, ds);
    let cos_h = geo.hdg.cos();
    let sin_h = geo.hdg.sin();
    RefLinePoint {
        x: geo.x + lx * cos_h - ly * sin_h,
        y: geo.y + lx * sin_h + ly * cos_h,
        hdg: geo.hdg + lh,
        s: geo.s + ds,
    }
}

/// Evaluate the road reference line at a specific absolute station `s`.
///
/// Finds the geometry element that contains `s` and evaluates it exactly,
/// using the curve equations rather than linear interpolation.
/// Returns `None` if the road has no geometry or `s` is out of range.
pub fn evaluate_road_at_s(road: &Road, s: f64) -> Option<RefLinePoint> {
    for geo in road.plan_view.iter().rev() {
        if s >= geo.s - 1e-9 {
            let ds = (s - geo.s).clamp(0.0, geo.length);
            return Some(evaluate_geometry(geo, ds));
        }
    }
    None
}

/// Sample the entire road reference line at a given step interval.
///
/// Returns points along the centerline in world coordinates.
/// Lane section boundaries are always included as exact evaluation points,
/// preventing mesh gaps when a boundary falls between two sample positions.
pub fn sample_road_reference_line(road: &Road, step: f64) -> Vec<RefLinePoint> {
    let mut points = Vec::new();

    for geo in &road.plan_view {
        let n = ((geo.length / step).ceil() as usize).max(1);
        let actual_step = geo.length / n as f64;

        for i in 0..=n {
            let ds = (i as f64 * actual_step).min(geo.length);
            points.push(evaluate_geometry(geo, ds));
        }
    }

    // Deduplicate consecutive near-identical points (geometry boundaries)
    points.dedup_by(|a, b| (a.s - b.s).abs() < 1e-9);

    // Insert exact evaluation points at lane section boundaries.
    //
    // When a lane section boundary (section.s) does not coincide with a
    // geometry-derived sample point, the two adjacent sections each lose
    // their shared edge vertex: section N ends one sample *before* the
    // boundary and section N+1 starts one sample *after* it, leaving a
    // visible strip of unrendered road surface.
    //
    // Mirroring the C# approach (CurveLaneLine knots placed at every section
    // boundary), we insert geometry-accurate points here so both sections
    // share the exact boundary coordinate.
    for section in &road.lane_sections {
        let s = section.s;
        if s <= 1e-9 || s >= road.length - 1e-9 {
            continue; // first section (s=0) and road end are already covered
        }
        if points.iter().any(|p| (p.s - s).abs() < 1e-9) {
            continue; // already present
        }
        let idx = points.partition_point(|p| p.s < s);
        if idx == 0 || idx >= points.len() {
            continue;
        }
        if let Some(pt) = evaluate_road_at_s(road, s) {
            points.insert(idx, pt);
        }
    }

    points
}

/// Evaluate lane width polynomial at a given ds offset.
pub fn evaluate_lane_width(widths: &[LaneWidth], ds: f64) -> f64 {
    // Find the applicable width entry (last one with s_offset <= ds)
    let entry = widths
        .iter()
        .rev()
        .find(|w| w.s_offset <= ds + 1e-9)
        .or_else(|| widths.first());

    match entry {
        Some(w) => {
            let t = ds - w.s_offset;
            (w.a + w.b * t + w.c * t * t + w.d * t * t * t).max(0.0)
        }
        None => 0.0,
    }
}

/// Evaluate elevation at a given road station s.
pub fn evaluate_elevation(elevations: &[Elevation], s: f64) -> f64 {
    if elevations.is_empty() {
        return 0.0;
    }
    // Find the applicable elevation entry
    let entry = elevations
        .iter()
        .rev()
        .find(|e| e.s <= s + 1e-9)
        .unwrap_or(&elevations[0]);

    entry.evaluate(s - entry.s)
}

/// Compute an offset point perpendicular to the reference line.
///
/// `t` is the lateral offset (positive = left, negative = right in OpenDRIVE convention).
pub fn offset_point(ref_pt: &RefLinePoint, t: f64, z: f64) -> (f64, f64, f64) {
    let normal_x = -(ref_pt.hdg.sin());
    let normal_y = ref_pt.hdg.cos();
    (ref_pt.x + t * normal_x, ref_pt.y + t * normal_y, z)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Geometry;

    fn line_geometry(s: f64, x: f64, y: f64, hdg: f64, length: f64) -> Geometry {
        Geometry {
            s,
            x,
            y,
            hdg,
            length,
            geo_type: GeometryType::Line,
        }
    }

    fn arc_geometry(s: f64, x: f64, y: f64, hdg: f64, length: f64, curv: f64) -> Geometry {
        Geometry {
            s,
            x,
            y,
            hdg,
            length,
            geo_type: GeometryType::Arc { curvature: curv },
        }
    }

    // --- Line tests ---

    #[test]
    fn test_line_start() {
        let geo = line_geometry(0.0, 10.0, 20.0, 0.0, 100.0);
        let pt = evaluate_geometry(&geo, 0.0);
        assert!((pt.x - 10.0).abs() < 1e-9);
        assert!((pt.y - 20.0).abs() < 1e-9);
        assert!((pt.hdg).abs() < 1e-9);
    }

    #[test]
    fn test_line_end_east() {
        let geo = line_geometry(0.0, 0.0, 0.0, 0.0, 50.0);
        let pt = evaluate_geometry(&geo, 50.0);
        assert!((pt.x - 50.0).abs() < 1e-9);
        assert!((pt.y).abs() < 1e-9);
    }

    #[test]
    fn test_line_heading_45deg() {
        let hdg = std::f64::consts::FRAC_PI_4;
        let geo = line_geometry(0.0, 0.0, 0.0, hdg, 100.0);
        let pt = evaluate_geometry(&geo, 100.0);
        let expected = 100.0 / std::f64::consts::SQRT_2;
        assert!((pt.x - expected).abs() < 1e-6);
        assert!((pt.y - expected).abs() < 1e-6);
    }

    #[test]
    fn test_line_heading_90deg() {
        let hdg = std::f64::consts::FRAC_PI_2;
        let geo = line_geometry(0.0, 0.0, 0.0, hdg, 50.0);
        let pt = evaluate_geometry(&geo, 50.0);
        assert!((pt.x).abs() < 1e-9);
        assert!((pt.y - 50.0).abs() < 1e-9);
    }

    // --- Arc tests ---

    #[test]
    fn test_arc_quarter_circle() {
        // Curvature = 1/R, R = 100. Quarter circle => length = pi*R/2
        let r = 100.0;
        let length = std::f64::consts::FRAC_PI_2 * r;
        let geo = arc_geometry(0.0, 0.0, 0.0, 0.0, length, 1.0 / r);
        let pt = evaluate_geometry(&geo, length);
        // End of quarter circle: x≈R, y≈R
        assert!((pt.x - r).abs() < 1e-6);
        assert!((pt.y - r).abs() < 1e-6);
    }

    #[test]
    fn test_arc_negative_curvature() {
        let r = 50.0;
        let length = std::f64::consts::FRAC_PI_2 * r;
        let geo = arc_geometry(0.0, 0.0, 0.0, 0.0, length, -1.0 / r);
        let pt = evaluate_geometry(&geo, length);
        assert!((pt.x - r).abs() < 1e-6);
        assert!((pt.y + r).abs() < 1e-6); // curves to the right
    }

    // --- Spiral tests ---

    #[test]
    fn test_spiral_zero_curvature_is_line() {
        let geo = Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 50.0,
            geo_type: GeometryType::Spiral {
                curv_start: 0.0,
                curv_end: 0.0,
            },
        };
        let pt = evaluate_geometry(&geo, 50.0);
        assert!((pt.x - 50.0).abs() < 1e-6);
        assert!((pt.y).abs() < 1e-6);
    }

    #[test]
    fn test_fresnel_vs_simpson_spiral() {
        // Compare Fresnel analytical solution (entry spirals with curv_start=0)
        // and Simpson fallback against high-resolution Simpson
        let cases: Vec<(f64, f64, f64)> = vec![
            (0.0, 0.01, 100.0),  // entry spiral (Fresnel path)
            (0.01, 0.0, 100.0),  // exit spiral (Simpson path)
            (0.0, 0.005, 50.0),  // short entry (Fresnel path)
            (-0.02, 0.02, 80.0), // S-curve through zero (Simpson path)
            (0.001, 0.003, 60.0),
        ];

        for (cs, ce, len) in &cases {
            for ds_frac in &[0.25, 0.5, 0.75, 1.0] {
                let ds = len * ds_frac;
                let (opt_x, opt_y, _) = evaluate_spiral(*cs, *ce, *len, ds);
                let (sim_x, sim_y, _) = evaluate_spiral_simpson(*cs, *ce, *len, ds);

                let err_x = (opt_x - sim_x).abs();
                let err_y = (opt_y - sim_y).abs();

                // Allow larger tolerance for Simpson-based general cases
                let tol = if *cs == 0.0 { 1e-3 } else { 5e-3 };
                assert!(
                    err_x < tol && err_y < tol,
                    "Spiral({},{},len={},ds={}): Optimized({},{}) vs Simpson({},{}), err=({},{})",
                    cs,
                    ce,
                    len,
                    ds,
                    opt_x,
                    opt_y,
                    sim_x,
                    sim_y,
                    err_x,
                    err_y
                );
            }
        }
    }

    #[test]
    fn test_fresnel_known_values() {
        // Known Fresnel integral values for validation
        let (c, s) = fresnel_cs(1.0);
        // C(1.0) ≈ 0.779893, S(1.0) ≈ 0.438259
        assert!(
            (c - 0.779893).abs() < 1e-5,
            "C(1) = {}, expected ~0.779893",
            c
        );
        assert!(
            (s - 0.438259).abs() < 1e-5,
            "S(1) = {}, expected ~0.438259",
            s
        );

        let (c, s) = fresnel_cs(0.5);
        // C(0.5) ≈ 0.492344, S(0.5) ≈ 0.064732
        assert!((c - 0.492344).abs() < 1e-5, "C(0.5) = {}", c);
        assert!((s - 0.064732).abs() < 1e-5, "S(0.5) = {}", s);
    }

    // --- ParamPoly3 tests ---

    #[test]
    fn test_parampoly3_straight_line() {
        let geo = Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 100.0,
            geo_type: GeometryType::ParamPoly3 {
                a_u: 0.0,
                b_u: 1.0,
                c_u: 0.0,
                d_u: 0.0,
                a_v: 0.0,
                b_v: 0.0,
                c_v: 0.0,
                d_v: 0.0,
                p_range: ParamPoly3Range::ArcLength,
            },
        };
        let pt = evaluate_geometry(&geo, 100.0);
        assert!((pt.x - 100.0).abs() < 1e-9);
        assert!((pt.y).abs() < 1e-9);
    }

    #[test]
    fn test_parampoly3_normalized() {
        let geo = Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 200.0,
            geo_type: GeometryType::ParamPoly3 {
                a_u: 0.0,
                b_u: 200.0, // b_u * 1.0 = 200 when p=1 (normalized)
                c_u: 0.0,
                d_u: 0.0,
                a_v: 0.0,
                b_v: 0.0,
                c_v: 0.0,
                d_v: 0.0,
                p_range: ParamPoly3Range::Normalized,
            },
        };
        let pt = evaluate_geometry(&geo, 200.0);
        assert!((pt.x - 200.0).abs() < 1e-6);
    }

    // --- Road sampling tests ---

    #[test]
    fn test_sample_road_single_line() {
        let mut road = Road::new("1", 100.0);
        road.plan_view
            .push(line_geometry(0.0, 0.0, 0.0, 0.0, 100.0));

        let pts = sample_road_reference_line(&road, 10.0);
        assert_eq!(pts.len(), 11); // 0,10,20,...,100
        assert!((pts[0].x).abs() < 1e-9);
        assert!((pts[10].x - 100.0).abs() < 1e-9);
    }

    #[test]
    fn test_sample_road_two_segments() {
        let mut road = Road::new("1", 200.0);
        road.plan_view
            .push(line_geometry(0.0, 0.0, 0.0, 0.0, 100.0));
        road.plan_view.push(line_geometry(
            100.0,
            100.0,
            0.0,
            std::f64::consts::FRAC_PI_2,
            100.0,
        ));

        let pts = sample_road_reference_line(&road, 50.0);
        // First segment: 0,50,100 → 3 pts; Second: 0,50,100 → 3 pts
        // After dedup at boundary: should have 5 unique points
        assert!(pts.len() >= 5);
        // Last point should be at (100, 100)
        let last = pts.last().unwrap();
        assert!((last.x - 100.0).abs() < 1e-6);
        assert!((last.y - 100.0).abs() < 1e-6);
    }

    // --- Utility tests ---

    #[test]
    fn test_evaluate_lane_width() {
        let widths = vec![LaneWidth {
            s_offset: 0.0,
            a: 3.5,
            b: 0.0,
            c: 0.0,
            d: 0.0,
        }];
        let w = evaluate_lane_width(&widths, 50.0);
        assert!((w - 3.5).abs() < 1e-9);
    }

    #[test]
    fn test_evaluate_lane_width_polynomial() {
        let widths = vec![LaneWidth {
            s_offset: 0.0,
            a: 3.0,
            b: 0.01,
            c: 0.0,
            d: 0.0,
        }];
        let w = evaluate_lane_width(&widths, 100.0);
        assert!((w - 4.0).abs() < 1e-9); // 3 + 0.01*100
    }

    #[test]
    fn test_evaluate_elevation() {
        let elevations = vec![Elevation {
            s: 0.0,
            a: 10.0,
            b: 0.1,
            c: 0.0,
            d: 0.0,
        }];
        let z = evaluate_elevation(&elevations, 50.0);
        assert!((z - 15.0).abs() < 1e-9); // 10 + 0.1*50
    }

    // --- local_to_world s tests ---

    #[test]
    fn test_local_to_world_line_s_is_exact() {
        let geo = line_geometry(10.0, 0.0, 0.0, 0.0, 100.0);
        let (lx, ly, lh) = evaluate_geometry_local(&geo, 50.0);
        let pt = local_to_world(&geo, lx, ly, lh, 50.0);
        assert!(
            (pt.s - 60.0).abs() < 1e-9,
            "s should be geo.s + ds = 60.0, got {}",
            pt.s
        );
    }

    #[test]
    fn test_local_to_world_arc_s_is_arc_length() {
        let r = 100.0;
        let length = std::f64::consts::FRAC_PI_2 * r;
        let geo = arc_geometry(5.0, 0.0, 0.0, 0.0, length, 1.0 / r);
        let ds = length / 2.0;
        let (lx, ly, lh) = evaluate_geometry_local(&geo, ds);
        let pt = local_to_world(&geo, lx, ly, lh, ds);
        assert!(
            (pt.s - (5.0 + ds)).abs() < 1e-9,
            "s should be geo.s + ds, got {}",
            pt.s
        );
    }

    #[test]
    fn test_offset_point() {
        let pt = RefLinePoint {
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            s: 0.0,
        };
        let (ox, oy, oz) = offset_point(&pt, 3.5, 0.0);
        assert!((ox).abs() < 1e-9); // offset is perpendicular
        assert!((oy - 3.5).abs() < 1e-9); // to the left
        assert!((oz).abs() < 1e-9);
    }

    #[test]
    fn test_offset_point_heading_90() {
        let pt = RefLinePoint {
            x: 0.0,
            y: 0.0,
            hdg: std::f64::consts::FRAC_PI_2,
            s: 0.0,
        };
        let (ox, oy, _) = offset_point(&pt, 3.5, 0.0);
        assert!((ox + 3.5).abs() < 1e-9); // left of northbound = west
        assert!((oy).abs() < 1e-9);
    }

    /// When a lane section boundary falls between two geometry-derived sample
    /// points, `sample_road_reference_line` must insert an exact point at that
    /// boundary so that adjacent lane section meshes share a common edge and
    /// produce no visible rendering gap.
    #[test]
    fn test_section_boundary_inserted_when_not_on_sample_grid() {
        use crate::model::{Lane, LaneSection, LaneType, LaneWidth};

        // 100 m straight road, two geometries: 0-60 m and 60-100 m.
        let mut road = Road::new("test", 100.0);
        road.plan_view.push(line_geometry(0.0, 0.0, 0.0, 0.0, 60.0));
        road.plan_view
            .push(line_geometry(60.0, 60.0, 0.0, 0.0, 40.0));

        // Lane section boundary at s=51.0 — midway between sample points 50 and 52.
        let mut sec0 = LaneSection {
            s: 0.0,
            single_side: false,
            left: vec![],
            center: vec![],
            right: vec![],
            render_hidden: false,
        };
        sec0.right.push(Lane {
            id: -1,
            lane_type: LaneType::Driving,
            level: 0,
            link: None,
            width: vec![LaneWidth {
                s_offset: 0.0,
                a: 3.5,
                b: 0.0,
                c: 0.0,
                d: 0.0,
            }],
            borders: vec![],
            road_marks: vec![],
            render_hidden: false,
        });
        let mut sec1 = LaneSection {
            s: 51.0, // does NOT coincide with any sample at step=2.0
            single_side: false,
            left: vec![],
            center: vec![],
            right: vec![],
            render_hidden: false,
        };
        sec1.right.push(sec0.right[0].clone());
        road.lane_sections.push(sec0);
        road.lane_sections.push(sec1);

        let pts = sample_road_reference_line(&road, 2.0);

        // There must be a point with s exactly at the section boundary.
        let has_boundary = pts.iter().any(|p| (p.s - 51.0).abs() < 1e-9);
        assert!(
            has_boundary,
            "expected a sample point at s=51.0 (section boundary), got: {:?}",
            pts.iter().map(|p| p.s).collect::<Vec<_>>()
        );

        // The boundary point's x should match the straight-line geometry.
        let boundary_pt = pts.iter().find(|p| (p.s - 51.0).abs() < 1e-9).unwrap();
        assert!(
            (boundary_pt.x - 51.0).abs() < 1e-6,
            "boundary point x should be 51.0 (straight road), got {}",
            boundary_pt.x
        );
    }
}
