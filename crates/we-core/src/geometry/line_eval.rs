//! Straight line geometry evaluation helpers.

/// Evaluate straight line geometry in its local frame at offset `ds`.
pub fn evaluate_line(ds: f64) -> (f64, f64, f64) {
    (ds, 0.0, 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_line_eval_zero_ds() {
        assert_eq!(evaluate_line(0.0), (0.0, 0.0, 0.0));
    }

    #[test]
    fn test_line_eval_positive_ds() {
        assert_eq!(evaluate_line(5.0), (5.0, 0.0, 0.0));
    }

    #[test]
    fn test_line_eval_large_ds() {
        let ds = 1000.0;
        assert_eq!(evaluate_line(ds), (ds, 0.0, 0.0));
    }

    #[test]
    fn test_line_eval_y_always_zero() {
        for &ds in &[0.0_f64, 1.0, 100.0, 999.9] {
            let (_, y, _) = evaluate_line(ds);
            assert_eq!(y, 0.0, "y should be 0 at ds={ds}");
        }
    }

    #[test]
    fn test_line_eval_heading_always_zero() {
        for &ds in &[0.0_f64, 1.0, 100.0, 999.9] {
            let (_, _, hdg) = evaluate_line(ds);
            assert_eq!(hdg, 0.0, "heading should be 0 at ds={ds}");
        }
    }

    #[test]
    fn test_line_eval_x_equals_ds() {
        let ds = 42.0;
        let (x, _, _) = evaluate_line(ds);
        assert_eq!(x, ds);
    }
}
