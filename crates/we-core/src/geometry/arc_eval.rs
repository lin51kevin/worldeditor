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
