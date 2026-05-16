//! Circular arc geometry evaluation helpers.

/// Evaluate circular arc geometry in its local frame at offset `ds`.
///
/// Degenerates to a straight line when `curvature` is near zero.
pub fn evaluate_arc(curvature: f64, ds: f64) -> (f64, f64, f64) {
    if curvature.abs() < 1e-15 {
        return (ds, 0.0, 0.0);
    }

    let r = 1.0 / curvature;
    let theta = ds * curvature;
    let x = r * theta.sin();
    let y = r * (1.0 - theta.cos());
    (x, y, theta)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    #[test]
    fn test_arc_zero_curvature_returns_straight_line() {
        let (x, y, hdg) = evaluate_arc(0.0, 10.0);
        assert_eq!(x, 10.0);
        assert_eq!(y, 0.0);
        assert_eq!(hdg, 0.0);
    }

    #[test]
    fn test_arc_below_threshold_curvature_returns_straight_line() {
        let (x, y, hdg) = evaluate_arc(5e-16, 5.0);
        assert_eq!(x, 5.0);
        assert_eq!(y, 0.0);
        assert_eq!(hdg, 0.0);
    }

    #[test]
    fn test_arc_quarter_circle_positive_curvature() {
        let r = 10.0;
        let curvature = 1.0 / r;
        let ds = PI / 2.0 * r;
        let (x, y, hdg) = evaluate_arc(curvature, ds);
        assert!((x - 10.0).abs() < 1e-10, "x={x}");
        assert!((y - 10.0).abs() < 1e-10, "y={y}");
        assert!((hdg - PI / 2.0).abs() < 1e-10, "hdg={hdg}");
    }

    #[test]
    fn test_arc_negative_curvature_curves_right() {
        let r = 10.0;
        let curvature = -1.0 / r;
        let ds = PI / 2.0 * r;
        let (x, y, hdg) = evaluate_arc(curvature, ds);
        assert!((x - 10.0).abs() < 1e-10, "x={x}");
        assert!((y + 10.0).abs() < 1e-10, "y={y}");
        assert!((hdg + PI / 2.0).abs() < 1e-10, "hdg={hdg}");
    }

    #[test]
    fn test_arc_heading_equals_ds_times_curvature() {
        let curvature = 0.05;
        let ds = 20.0;
        let (_, _, hdg) = evaluate_arc(curvature, ds);
        assert!((hdg - ds * curvature).abs() < 1e-12);
    }

    #[test]
    fn test_arc_zero_ds_returns_origin() {
        let (x, y, hdg) = evaluate_arc(0.1, 0.0);
        assert_eq!(x, 0.0);
        assert_eq!(y, 0.0);
        assert_eq!(hdg, 0.0);
    }

    #[test]
    fn test_arc_full_circle_returns_to_origin() {
        let r = 5.0;
        let curvature = 1.0 / r;
        let ds = 2.0 * PI * r;
        let (x, y, hdg) = evaluate_arc(curvature, ds);
        assert!(x.abs() < 1e-9, "x={x}");
        assert!(y.abs() < 1e-9, "y={y}");
        assert!((hdg - 2.0 * PI).abs() < 1e-9, "hdg={hdg}");
    }
}
