//! Cubic curve fitting and curvature analysis helpers for spline conversion.

use super::SplineKnot;

/// Curvature analysis result for a ParamPoly3 segment.
///
/// By sampling curvature along a parametric cubic curve, we can classify
/// the curve as a Line, Arc (constant curvature), Spiral (linearly varying
/// curvature), or general ParamPoly3.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum CurveClassification {
    /// Nearly zero curvature everywhere → Line
    Line,
    /// Constant non-zero curvature → Arc { curvature }
    Arc { curvature: f64 },
    /// Linearly varying curvature → Spiral { curv_start, curv_end }
    Spiral { curv_start: f64, curv_end: f64 },
    /// General parametric cubic — keep as ParamPoly3
    ParamPoly3,
}

/// Compute signed curvature of a parametric cubic at parameter `p`.
///
/// For a curve (u(p), v(p)), curvature κ = (u'·v'' - v'·u'') / (u'² + v'²)^(3/2)
pub(super) fn param_poly3_curvature(
    b_u: f64,
    c_u: f64,
    d_u: f64,
    b_v: f64,
    c_v: f64,
    d_v: f64,
    p: f64,
) -> f64 {
    let du = b_u + 2.0 * c_u * p + 3.0 * d_u * p * p;
    let dv = b_v + 2.0 * c_v * p + 3.0 * d_v * p * p;
    let ddu = 2.0 * c_u + 6.0 * d_u * p;
    let ddv = 2.0 * c_v + 6.0 * d_v * p;

    let speed_sq = du * du + dv * dv;
    if speed_sq < 1e-30 {
        return 0.0;
    }
    (du * ddv - dv * ddu) / speed_sq.powf(1.5)
}

/// Number of curvature samples for classification analysis.
const CURVATURE_SAMPLES: usize = 16;

/// Classify a ParamPoly3 segment by analyzing its curvature profile.
///
/// Samples curvature at evenly spaced parameter values and checks:
/// 1. If all curvatures ≈ 0 → Line
/// 2. If curvature is approximately constant → Arc
/// 3. If curvature varies linearly → Spiral (clothoid)
/// 4. Otherwise → keep as ParamPoly3
pub(super) fn classify_param_poly3(
    b_u: f64,
    c_u: f64,
    d_u: f64,
    b_v: f64,
    c_v: f64,
    d_v: f64,
    chord_len: f64,
) -> CurveClassification {
    // Curvature threshold scaled by segment length.
    // Shorter segments need looser tolerance; longer segments can be tighter.
    let kappa_tol = 0.002 / chord_len.max(1.0);
    // Maximum relative residual for linear-curvature (Spiral) fit.
    let linear_fit_tol = 0.01;

    let mut curvatures = [0.0f64; CURVATURE_SAMPLES + 1];
    for (i, kappa) in curvatures.iter_mut().enumerate() {
        let p = i as f64 / CURVATURE_SAMPLES as f64;
        *kappa = param_poly3_curvature(b_u, c_u, d_u, b_v, c_v, d_v, p);
    }

    let kappa_min = curvatures.iter().cloned().fold(f64::INFINITY, f64::min);
    let kappa_max = curvatures.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let kappa_range = kappa_max - kappa_min;

    // 1) Nearly zero curvature everywhere → Line
    if kappa_max.abs() < kappa_tol && kappa_min.abs() < kappa_tol {
        return CurveClassification::Line;
    }

    // 2) Constant curvature → Arc
    if kappa_range < kappa_tol {
        let mean_kappa = curvatures.iter().sum::<f64>() / curvatures.len() as f64;
        return CurveClassification::Arc {
            curvature: mean_kappa,
        };
    }

    // 3) Linear curvature variation → Spiral
    // Fit κ(s) = κ_start + (κ_end - κ_start) · t using endpoint values.
    let curv_start = curvatures[0];
    let curv_end = curvatures[CURVATURE_SAMPLES];

    // Check if all samples lie on the line κ(t) = κ_start + (κ_end - κ_start)·t
    let mut max_residual = 0.0f64;
    for (i, &kappa) in curvatures.iter().enumerate() {
        let t = i as f64 / CURVATURE_SAMPLES as f64;
        let expected = curv_start + (curv_end - curv_start) * t;
        let residual = (kappa - expected).abs();
        max_residual = max_residual.max(residual);
    }

    let ref_scale = kappa_range.max(kappa_max.abs()).max(1e-10);
    if max_residual / ref_scale < linear_fit_tol {
        // Make sure the curvature actually changes (not just noise)
        if kappa_range > kappa_tol * 2.0 {
            return CurveClassification::Spiral {
                curv_start,
                curv_end,
            };
        }
        // Tiny range but passed linear test: constant curvature
        let mean_kappa = (curv_start + curv_end) * 0.5;
        return CurveClassification::Arc {
            curvature: mean_kappa,
        };
    }

    CurveClassification::ParamPoly3
}

/// Fit a Hermite interpolation as ParamPoly3 coefficients.
///
/// Given two knots with position and tangent, compute the cubic polynomial
/// coefficients in the local frame of the first knot.
///
/// The local frame has:
/// - Origin at k0.position
/// - U-axis along the **tangent direction** at k0 (matching `geo.hdg`)
/// - V-axis perpendicular to the tangent
///
/// This frame must match what `evaluate_geometry` uses (`geo.hdg = tangent heading`),
/// so that the local (u, v) coordinates are correctly transformed to world space.
///
/// Returns (a_u, b_u, c_u, d_u, a_v, b_v, c_v, d_v) for normalized parameter range [0, 1].
pub(super) fn fit_hermite_param_poly3(
    k0: &SplineKnot,
    k1: &SplineKnot,
    chord_len: f64,
) -> (f64, f64, f64, f64, f64, f64, f64, f64) {
    let dx = k1.position[0] - k0.position[0];
    let dy = k1.position[1] - k0.position[1];

    // Local frame rotation — use k0's tangent heading to match geo.hdg
    let t_len = (k0.tangent_out[0].powi(2) + k0.tangent_out[1].powi(2)).sqrt();
    let (cos_h, sin_h) = if t_len > 1e-12 {
        (k0.tangent_out[0] / t_len, k0.tangent_out[1] / t_len)
    } else {
        // Degenerate tangent — fall back to chord direction
        (dx / chord_len, dy / chord_len)
    };

    // Transform endpoint to local frame
    let end_u = dx * cos_h + dy * sin_h;
    let end_v = -dx * sin_h + dy * cos_h;

    // Transform tangents to local frame and scale by chord length
    let t0_u = (k0.tangent_out[0] * cos_h + k0.tangent_out[1] * sin_h) * chord_len;
    let t0_v = (-k0.tangent_out[0] * sin_h + k0.tangent_out[1] * cos_h) * chord_len;
    let t1_u = (k1.tangent_in[0] * cos_h + k1.tangent_in[1] * sin_h) * chord_len;
    let t1_v = (-k1.tangent_in[0] * sin_h + k1.tangent_in[1] * cos_h) * chord_len;

    // Hermite basis: p(t) = a + b*t + c*t^2 + d*t^3
    // p(0) = start_pos, p(1) = end_pos, p'(0) = start_tangent, p'(1) = end_tangent
    //
    // a = p(0)
    // b = p'(0)
    // c = 3*(p(1) - p(0)) - 2*p'(0) - p'(1)
    // d = 2*(p(0) - p(1)) + p'(0) + p'(1)

    let a_u = 0.0; // start at origin in local frame
    let b_u = t0_u;
    let c_u = 3.0 * end_u - 2.0 * t0_u - t1_u;
    let d_u = -2.0 * end_u + t0_u + t1_u;

    let a_v = 0.0;
    let b_v = t0_v;
    let c_v = 3.0 * end_v - 2.0 * t0_v - t1_v;
    let d_v = -2.0 * end_v + t0_v + t1_v;

    (a_u, b_u, c_u, d_u, a_v, b_v, c_v, d_v)
}
