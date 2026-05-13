//! Straight line geometry evaluation helpers.

/// Evaluate straight line geometry in its local frame at offset `ds`.
pub fn evaluate_line(ds: f64) -> (f64, f64, f64) {
    (ds, 0.0, 0.0)
}
