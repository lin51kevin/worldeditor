//! OpenDRIVE reference line evaluator.
//!
//! Samples points along a road's reference line (plan view) by evaluating
//! each geometry element (Line, Arc, Spiral, Poly3, ParamPoly3).
//! Pure Rust, WASM compatible.

use crate::model::{Elevation, Geometry, GeometryType, LaneWidth, ParamPoly3Range, Road};

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
        GeometryType::Line => {
            // Straight line: advance along heading
            (ds, 0.0, 0.0)
        }

        GeometryType::Arc { curvature } => {
            // Circular arc: constant curvature
            if curvature.abs() < 1e-15 {
                return (ds, 0.0, 0.0); // degenerate to line
            }
            let r = 1.0 / curvature;
            let theta = ds * curvature;
            let x = r * theta.sin();
            let y = r * (1.0 - theta.cos());
            (x, y, theta)
        }

        GeometryType::Spiral {
            curv_start,
            curv_end,
        } => {
            // Euler spiral (clothoid): linearly varying curvature
            evaluate_spiral(*curv_start, *curv_end, geo.length, ds)
        }

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
pub fn local_to_world(geo: &Geometry, local_x: f64, local_y: f64, local_hdg: f64, ds: f64) -> RefLinePoint {
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

/// Sample the entire road reference line at a given step interval.
///
/// Returns points along the centerline in world coordinates.
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

// --- Euler Spiral (Clothoid) ---

/// Evaluate an Euler spiral (clothoid) using Fresnel integrals.
///
/// Curvature varies linearly from `curv_start` to `curv_end` over `length`.
fn evaluate_spiral(curv_start: f64, curv_end: f64, length: f64, ds: f64) -> (f64, f64, f64) {
    if length < 1e-15 {
        return (0.0, 0.0, 0.0);
    }

    // Curvature rate
    let c_dot = (curv_end - curv_start) / length;

    // Numerical integration using Simpson's rule with enough steps
    let n = ((ds / 0.5).ceil() as usize).max(10);
    let h = ds / n as f64;

    let mut x = 0.0;
    let mut y = 0.0;

    for i in 0..=n {
        let t = i as f64 * h;
        let _curvature = curv_start + c_dot * t;
        let theta = curv_start * t + 0.5 * c_dot * t * t;

        let w = if i == 0 || i == n {
            1.0
        } else if i % 2 == 1 {
            4.0
        } else {
            2.0
        };

        x += w * theta.cos();
        y += w * theta.sin();
    }

    x *= h / 3.0;
    y *= h / 3.0;

    let theta_end = curv_start * ds + 0.5 * c_dot * ds * ds;
    (x, y, theta_end)
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
        assert!((pt.x - 50.0).abs() < 0.1); // numerical integration tolerance
        assert!((pt.y).abs() < 0.1);
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
        assert!((pt.s - 60.0).abs() < 1e-9, "s should be geo.s + ds = 60.0, got {}", pt.s);
    }

    #[test]
    fn test_local_to_world_arc_s_is_arc_length() {
        let r = 100.0;
        let length = std::f64::consts::FRAC_PI_2 * r;
        let geo = arc_geometry(5.0, 0.0, 0.0, 0.0, length, 1.0 / r);
        let ds = length / 2.0;
        let (lx, ly, lh) = evaluate_geometry_local(&geo, ds);
        let pt = local_to_world(&geo, lx, ly, lh, ds);
        assert!((pt.s - (5.0 + ds)).abs() < 1e-9,
            "s should be geo.s + ds, got {}", pt.s);
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
}
