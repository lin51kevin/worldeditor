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
