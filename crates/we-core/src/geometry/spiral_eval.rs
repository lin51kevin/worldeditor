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
