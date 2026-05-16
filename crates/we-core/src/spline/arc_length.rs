//! Arc length parameterization helpers for spline conversion.

/// Compute the arc length of a ParamPoly3 segment with normalized parameter range.
///
/// Uses Gauss-Legendre quadrature for speed integral ∫₀¹ √(u'² + v'²) dp.
pub(super) fn param_poly3_arc_length(
    b_u: f64,
    c_u: f64,
    d_u: f64,
    b_v: f64,
    c_v: f64,
    d_v: f64,
) -> f64 {
    // 5-point Gauss-Legendre nodes/weights on [0, 1]
    const NODES: [(f64, f64); 5] = [
        (0.04691007703067, 0.11846344252810),
        (0.23076534494716, 0.23931433524968),
        (0.50000000000000, 0.28444444444444),
        (0.76923465505284, 0.23931433524968),
        (0.95308992296933, 0.11846344252810),
    ];

    let mut length = 0.0;
    for &(p, w) in &NODES {
        let du = b_u + 2.0 * c_u * p + 3.0 * d_u * p * p;
        let dv = b_v + 2.0 * c_v * p + 3.0 * d_v * p * p;
        length += w * (du * du + dv * dv).sqrt();
    }
    length
}

#[cfg(test)]
mod tests {
    use super::param_poly3_arc_length;

    #[test]
    fn test_arc_length_unit_line_along_u() {
        // u(p) = p, v(p) = 0 → b_u=1, all else 0 → arc length = 1.0
        let len = param_poly3_arc_length(1.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        assert!((len - 1.0).abs() < 1e-10, "len={len}");
    }

    #[test]
    fn test_arc_length_unit_line_along_v() {
        // u(p) = 0, v(p) = p → b_v=1, all else 0 → arc length = 1.0
        let len = param_poly3_arc_length(0.0, 0.0, 0.0, 1.0, 0.0, 0.0);
        assert!((len - 1.0).abs() < 1e-10, "len={len}");
    }

    #[test]
    fn test_arc_length_scaled_line() {
        // u(p) = 5*p → arc length = 5.0
        let len = param_poly3_arc_length(5.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        assert!((len - 5.0).abs() < 1e-10, "len={len}");
    }

    #[test]
    fn test_arc_length_diagonal_3_4_5() {
        // u(p) = 3p, v(p) = 4p → speed = 5 → arc length = 5.0
        let len = param_poly3_arc_length(3.0, 0.0, 0.0, 4.0, 0.0, 0.0);
        assert!((len - 5.0).abs() < 1e-10, "len={len}");
    }

    #[test]
    fn test_arc_length_zero_curve_is_zero() {
        let len = param_poly3_arc_length(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        assert_eq!(len, 0.0);
    }

    #[test]
    fn test_arc_length_positive_for_nontrivial_curve() {
        let len = param_poly3_arc_length(0.8, -0.2, 0.1, 0.2, 0.5, -0.1);
        assert!(len > 0.0, "arc length must be positive, got {len}");
    }

    #[test]
    fn test_arc_length_symmetric_uv() {
        // Swapping b_u/c_u/d_u with b_v/c_v/d_v should give the same length
        // since sqrt is symmetric
        let len_uv = param_poly3_arc_length(1.0, 0.2, -0.1, 0.5, 0.3, 0.1);
        let len_vu = param_poly3_arc_length(0.5, 0.3, 0.1, 1.0, 0.2, -0.1);
        assert!((len_uv - len_vu).abs() < 1e-10, "len_uv={len_uv}, len_vu={len_vu}");
    }
}
