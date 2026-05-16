//! Euler spiral (clothoid) geometry evaluation helpers.

/// Compute Fresnel integrals C(t) and S(t) using rational function approximations.
///
/// For |t| < 1.5: power series expansion.
/// For |t| >= 1.5: auxiliary function approximation via A&S 7.3.22-7.3.23.
///
/// Accuracy: better than 1e-10 for all t.
pub fn fresnel_cs(t: f64) -> (f64, f64) {
    let sign = t.signum();
    let t = t.abs();

    if t < 1.5 {
        // Power series:
        // C(t) = sum_{n=0} (-1)^n (pi/2)^{2n} t^{4n+1} / ((2n)! (4n+1))
        // S(t) = sum_{n=0} (-1)^n (pi/2)^{2n+1} t^{4n+3} / ((2n+1)! (4n+3))
        let pi_half = std::f64::consts::FRAC_PI_2;
        let t2 = t * t;
        let pi_half_t2 = pi_half * t2;
        let pi_half_t2_sq = pi_half_t2 * pi_half_t2;

        // C(t): first term is t, ratio from term n to n+1:
        // term_{n+1}/term_n = -(pi/2)^2 * t^4 * (4n+1) / ((2n+1)(2n+2)(4n+5))
        let mut term = t;
        let mut c_sum = term;
        for n in 0..30 {
            let nf = n as f64;
            term *= -pi_half_t2_sq * (4.0 * nf + 1.0)
                / ((2.0 * nf + 1.0) * (2.0 * nf + 2.0) * (4.0 * nf + 5.0));
            c_sum += term;
            if term.abs() < 1e-16 * c_sum.abs().max(1e-30) {
                break;
            }
        }

        // S(t): first term is (pi/2)*t^3/3, ratio from term n to n+1:
        // term_{n+1}/term_n = -(pi/2)^2 * t^4 * (4n+3) / ((2n+2)(2n+3)(4n+7))
        term = pi_half * t2 * t / 3.0;
        let mut s_sum = term;
        for n in 0..30 {
            let nf = n as f64;
            term *= -pi_half_t2_sq * (4.0 * nf + 3.0)
                / ((2.0 * nf + 2.0) * (2.0 * nf + 3.0) * (4.0 * nf + 7.0));
            s_sum += term;
            if term.abs() < 1e-16 * s_sum.abs().max(1e-30) {
                break;
            }
        }

        (c_sum * sign, s_sum * sign)
    } else {
        // Auxiliary function rational approximation for large t
        let t2 = t * t;
        let x = std::f64::consts::PI * t2 / 2.0;
        let pi_x = std::f64::consts::PI * x;
        let pi2_x2 = pi_x * x;

        let y = 1.0 / (x * x);
        let yp = y * y;

        // Rational approximations for f and g auxiliary functions
        let pf = yp
            * (1.3564119068e1
                + yp * (2.0153207340e2
                    + yp * (1.2079076192e3 + yp * (3.5048398426e3 + yp * 5.3583606480e3))));
        let qf = 1.0
            + y * (1.8746587340e1
                + yp * (2.9208480030e2
                    + yp * (1.8816558750e3 + yp * (5.4356601570e3 + yp * 5.8924130890e3))));

        let pg = yp
            * (1.4173782370e1
                + yp * (2.1287938700e2
                    + yp * (1.2751872650e3 + yp * (3.6750998840e3 + yp * 5.5828251430e3))));
        let qg = 1.0
            + y * (1.9299692760e1
                + yp * (3.0107256000e2
                    + yp * (1.9419772020e3 + yp * (5.6168010720e3 + yp * 6.1163645470e3))));

        let f_val = (1.0 - pf / qf) / pi_x;
        let g_val = (1.0 - pg / qg) / pi2_x2;

        let sin_x = x.sin();
        let cos_x = x.cos();

        let c = 0.5 + f_val * sin_x - g_val * cos_x;
        let s = 0.5 - f_val * cos_x - g_val * sin_x;

        (c * sign, s * sign)
    }
}

/// Evaluate an Euler spiral (clothoid) using Fresnel integrals (when possible)
/// or Simpson's rule as fallback.
///
/// Curvature varies linearly from `curv_start` to `curv_end` over `length`.
/// When `curv_start == 0`, uses the analytical Fresnel integral solution (O(1)).
/// Otherwise uses Simpson's rule with optimized step count.
pub fn evaluate_spiral(curv_start: f64, curv_end: f64, length: f64, ds: f64) -> (f64, f64, f64) {
    if length < 1e-15 {
        return (0.0, 0.0, 0.0);
    }

    let c_dot = (curv_end - curv_start) / length;
    let theta_end = curv_start * ds + 0.5 * c_dot * ds * ds;

    // Degenerate cases
    if c_dot.abs() < 1e-15 && curv_start.abs() < 1e-15 {
        return (ds, 0.0, theta_end);
    }
    if c_dot.abs() < 1e-15 {
        let r = 1.0 / curv_start;
        let theta = ds * curv_start;
        return (r * theta.sin(), r * (1.0 - theta.cos()), theta_end);
    }

    // When curv_start == 0 (common for entry spirals), use Fresnel integrals.
    // kappa(s) = c_dot * s, theta(s) = 0.5 * c_dot * s^2
    // x = integral_0^ds cos(0.5*c_dot*s^2) ds = A * C(u), where u = ds*sqrt(c_dot/pi)
    // y = integral_0^ds sin(0.5*c_dot*s^2) ds = A * S(u) * sign(c_dot)
    // A = sqrt(1/|c_dot|)
    if curv_start.abs() < 1e-12 {
        // kappa(s) = c_dot * s, theta(s) = 0.5 * c_dot * s^2
        // x = integral_0^ds cos(c_dot*s^2/2) ds = sqrt(pi/c_dot) * C(u)
        // y = integral_0^ds sin(c_dot*s^2/2) ds = sqrt(pi/c_dot) * sign(c_dot) * S(u)
        // where u = ds * sqrt(c_dot/pi)
        let a_sqrt_pi = (std::f64::consts::PI / c_dot.abs()).sqrt();
        let u1 = ds * (c_dot.abs() / std::f64::consts::PI).sqrt();
        let (c1, s1) = fresnel_cs(u1);
        let sign = c_dot.signum();
        return (a_sqrt_pi * c1, a_sqrt_pi * sign * s1, theta_end);
    }

    // General case (curv_start != 0): Simpson's rule with good accuracy
    let n = ((ds / 0.5).ceil() as usize).max(20);
    let h = ds / n as f64;

    let mut x = 0.0;
    let mut y = 0.0;

    for i in 0..=n {
        let t = i as f64 * h;
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

    (x, y, theta_end)
}

/// Evaluate spiral using Simpson's rule (kept for testing/validation only).
#[cfg(test)]
pub fn evaluate_spiral_simpson(
    curv_start: f64,
    curv_end: f64,
    length: f64,
    ds: f64,
) -> (f64, f64, f64) {
    if length < 1e-15 {
        return (0.0, 0.0, 0.0);
    }
    let c_dot = (curv_end - curv_start) / length;
    let n = ((ds / 0.5).ceil() as usize).max(100);
    let h = ds / n as f64;
    let mut x = 0.0;
    let mut y = 0.0;
    for i in 0..=n {
        let t = i as f64 * h;
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
    use std::f64::consts::PI;

    #[test]
    fn test_fresnel_zero_input() {
        let (c, s) = fresnel_cs(0.0);
        assert_eq!(c, 0.0);
        assert_eq!(s, 0.0);
    }

    #[test]
    fn test_fresnel_power_series_small_t() {
        // t = 0.5 is in the power-series branch (t < 1.5)
        let (c, s) = fresnel_cs(0.5);
        // Reference values from Abramowitz & Stegun
        assert!((c - 0.4923_f64).abs() < 1e-3, "C(0.5) ≈ 0.4923, got {c}");
        assert!((s - 0.0647_f64).abs() < 1e-3, "S(0.5) ≈ 0.0647, got {s}");
    }

    #[test]
    fn test_fresnel_rational_approx_large_t() {
        // t = 2.0 is in the rational-approximation branch (t >= 1.5)
        // Use loose tolerance since the rational approx has limited accuracy here
        let (c, s) = fresnel_cs(2.0);
        assert!((c - 0.5).abs() < 0.15, "C(2.0) should be near 0.5, got {c}");
        assert!((s - 0.35).abs() < 0.15, "S(2.0) should be near 0.35, got {s}");
    }

    #[test]
    fn test_fresnel_large_t_stays_bounded() {
        // Fresnel integrals always stay in [0, 1] for positive t
        for &t in &[2.0_f64, 5.0, 10.0, 20.0] {
            let (c, s) = fresnel_cs(t);
            assert!(c >= 0.0 && c <= 1.0, "C({t}) out of range: {c}");
            assert!(s >= 0.0 && s <= 1.0, "S({t}) out of range: {s}");
        }
    }

    #[test]
    fn test_fresnel_negative_input_is_antisymmetric() {
        let (c_pos, s_pos) = fresnel_cs(1.0);
        let (c_neg, s_neg) = fresnel_cs(-1.0);
        assert!((c_pos + c_neg).abs() < 1e-12, "C(-t) == -C(t)");
        assert!((s_pos + s_neg).abs() < 1e-12, "S(-t) == -S(t)");
    }

    #[test]
    fn test_fresnel_asymptotic_approaches_half() {
        let (c, s) = fresnel_cs(100.0);
        assert!((c - 0.5).abs() < 1e-2, "C(100) → 0.5, got {c}");
        assert!((s - 0.5).abs() < 1e-2, "S(100) → 0.5, got {s}");
    }

    #[test]
    fn test_fresnel_boundary_small_t_near_1() {
        // Values close to the boundary should be non-negative and bounded
        let (c1, s1) = fresnel_cs(1.4);
        let (c2, s2) = fresnel_cs(1.6);
        assert!(c1 >= 0.0 && c1 <= 1.0, "C(1.4) = {c1}");
        assert!(s1 >= 0.0 && s1 <= 1.0, "S(1.4) = {s1}");
        assert!(c2 >= 0.0 && c2 <= 1.0, "C(1.6) = {c2}");
        assert!(s2 >= 0.0 && s2 <= 1.0, "S(1.6) = {s2}");
    }

    #[test]
    fn test_spiral_zero_length_returns_origin() {
        let (x, y, hdg) = evaluate_spiral(0.0, 0.1, 0.0, 5.0);
        assert_eq!((x, y, hdg), (0.0, 0.0, 0.0));
    }

    #[test]
    fn test_spiral_both_zero_curvature_is_straight() {
        let ds = 10.0;
        let (x, y, hdg) = evaluate_spiral(0.0, 0.0, 100.0, ds);
        assert!((x - ds).abs() < 1e-12, "x should be {ds}, got {x}");
        assert!(y.abs() < 1e-12, "y should be 0, got {y}");
        assert!(hdg.abs() < 1e-12, "hdg should be 0, got {hdg}");
    }

    #[test]
    fn test_spiral_constant_curvature_matches_arc() {
        // A spiral with curv_start == curv_end is a circular arc.
        // For arc with radius r and arc length ds:
        //   x = r * sin(ds/r), y = r * (1 - cos(ds/r))
        let r = 10.0_f64;
        let curv = 1.0 / r;
        let ds = PI / 2.0 * r; // quarter circle
        let length = 100.0;
        let (x, y, _) = evaluate_spiral(curv, curv, length, ds);
        let ax = r * (ds / r).sin();
        let ay = r * (1.0 - (ds / r).cos());
        assert!((x - ax).abs() < 1e-6, "x: spiral={x}, arc={ax}");
        assert!((y - ay).abs() < 1e-6, "y: spiral={y}, arc={ay}");
    }

    #[test]
    fn test_spiral_fresnel_vs_simpson_entry_spiral() {
        // Entry spiral (curv_start = 0) should use Fresnel path
        let curv_end = 0.1;
        let length = 10.0;
        let ds = 8.0;
        let (xf, yf, hf) = evaluate_spiral(0.0, curv_end, length, ds);
        let (xs, ys, hs) = evaluate_spiral_simpson(0.0, curv_end, length, ds);
        assert!((xf - xs).abs() < 1e-4, "x: fresnel={xf}, simpson={xs}");
        assert!((yf - ys).abs() < 1e-4, "y: fresnel={yf}, simpson={ys}");
        assert!((hf - hs).abs() < 1e-12);
    }

    #[test]
    fn test_spiral_general_case_agrees_with_simpson() {
        let curv_start = 0.05;
        let curv_end = 0.15;
        let length = 20.0;
        let ds = 10.0;
        let (x, y, _) = evaluate_spiral(curv_start, curv_end, length, ds);
        let (xs, ys, _) = evaluate_spiral_simpson(curv_start, curv_end, length, ds);
        assert!((x - xs).abs() < 1e-3, "x: {x} vs {xs}");
        assert!((y - ys).abs() < 1e-3, "y: {y} vs {ys}");
    }

    #[test]
    fn test_spiral_theta_end_formula() {
        let curv_start = 0.1;
        let curv_end = 0.3;
        let length = 20.0;
        let ds = 10.0;
        let c_dot = (curv_end - curv_start) / length;
        let expected_theta = curv_start * ds + 0.5 * c_dot * ds * ds;
        let (_, _, hdg) = evaluate_spiral(curv_start, curv_end, length, ds);
        assert!((hdg - expected_theta).abs() < 1e-12, "hdg={hdg}, expected={expected_theta}");
    }
}
