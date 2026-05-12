//! Ground Control Points (GCP) — affine transformation fitting.
//!
//! Fits a 2-D affine transform from image coordinates to world coordinates
//! using a least-squares approach with 3+ point pairs.

use serde::{Deserialize, Serialize};

/// A ground control point mapping image (pixel) coords → world coords.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Gcp {
    /// Image column (pixel X).
    pub px: f64,
    /// Image row (pixel Y).
    pub py: f64,
    /// World X (easting / longitude).
    pub wx: f64,
    /// World Y (northing / latitude).
    pub wy: f64,
}

impl Gcp {
    pub fn new(px: f64, py: f64, wx: f64, wy: f64) -> Self {
        Self { px, py, wx, wy }
    }
}

/// A 2-D affine transformation: world = A * pixel + b.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AffineTransform {
    pub a00: f64, pub a01: f64, pub b0: f64,
    pub a10: f64, pub a11: f64, pub b1: f64,
}

impl AffineTransform {
    /// Apply this transform to an image coordinate.
    pub fn apply(&self, px: f64, py: f64) -> (f64, f64) {
        (self.a00 * px + self.a01 * py + self.b0,
         self.a10 * px + self.a11 * py + self.b1)
    }
}

/// Fit an affine transform from ≥3 GCPs using least squares.
///
/// Returns `Err` if fewer than 3 points are provided or the system is degenerate.
pub fn fit_affine(gcps: &[Gcp]) -> Result<AffineTransform, String> {
    if gcps.len() < 3 {
        return Err(format!("Need ≥3 GCPs, got {}", gcps.len()));
    }
    // Solve: [wx]   [px py 1 0  0  0] [a00]
    //        [wy] = [0  0  0 px py 1] [a01]
    //                                 [b0 ]
    //                                 [a10]
    //                                 [a11]
    //                                 [b1 ]
    // Using normal equations on 2×3 independent systems.
    // System 1: wx = a00*px + a01*py + b0
    // System 2: wy = a10*px + a11*py + b1
    let (a00, a01, b0) = solve_least_squares(
        &gcps.iter().map(|g| (g.px, g.py, g.wx)).collect::<Vec<_>>()
    )?;
    let (a10, a11, b1) = solve_least_squares(
        &gcps.iter().map(|g| (g.px, g.py, g.wy)).collect::<Vec<_>>()
    )?;
    Ok(AffineTransform { a00, a01, b0, a10, a11, b1 })
}

/// Solve x = a*p + b*q + c by least squares over a slice of (p, q, x) triples.
fn solve_least_squares(points: &[(f64, f64, f64)]) -> Result<(f64, f64, f64), String> {
    let n = points.len() as f64;
    let (mut sp, mut sq, mut sx) = (0.0_f64, 0.0_f64, 0.0_f64);
    let (mut sp2, mut sq2, mut spq) = (0.0_f64, 0.0_f64, 0.0_f64);
    let (mut spx, mut sqx) = (0.0_f64, 0.0_f64);
    for &(p, q, x) in points {
        sp += p; sq += q; sx += x;
        sp2 += p * p; sq2 += q * q; spq += p * q;
        spx += p * x; sqx += q * x;
    }
    // Normal equations: [sp2 spq sp] [a]   [spx]
    //                   [spq sq2 sq] [b] = [sqx]
    //                   [sp  sq  n ] [c]   [sx ]
    // Solve 3x3 via Cramer's rule
    let mat = [[sp2, spq, sp], [spq, sq2, sq], [sp, sq, n]];
    let rhs = [spx, sqx, sx];
    let d = det3(&mat);
    if d.abs() < 1e-12 {
        return Err("Degenerate GCP system (collinear points?)".into());
    }
    let a = det3(&replace_col(&mat, 0, &rhs)) / d;
    let b = det3(&replace_col(&mat, 1, &rhs)) / d;
    let c = det3(&replace_col(&mat, 2, &rhs)) / d;
    Ok((a, b, c))
}

fn det3(m: &[[f64; 3]; 3]) -> f64 {
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
  - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
  + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
}

fn replace_col(m: &[[f64; 3]; 3], col: usize, v: &[f64; 3]) -> [[f64; 3]; 3] {
    let mut r = *m;
    for i in 0..3 { r[i][col] = v[i]; }
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fit_affine_exact() {
        // Pure translation: world = pixel + (100, 200)
        let gcps = vec![
            Gcp::new(0.0, 0.0, 100.0, 200.0),
            Gcp::new(1.0, 0.0, 101.0, 200.0),
            Gcp::new(0.0, 1.0, 100.0, 201.0),
        ];
        let t = fit_affine(&gcps).unwrap();
        let (wx, wy) = t.apply(5.0, 10.0);
        assert!((wx - 105.0).abs() < 1e-9, "wx={wx}");
        assert!((wy - 210.0).abs() < 1e-9, "wy={wy}");
    }

    #[test]
    fn test_fit_affine_scale() {
        // Uniform scale 2x
        let gcps = vec![
            Gcp::new(0.0, 0.0, 0.0, 0.0),
            Gcp::new(1.0, 0.0, 2.0, 0.0),
            Gcp::new(0.0, 1.0, 0.0, 2.0),
        ];
        let t = fit_affine(&gcps).unwrap();
        let (wx, wy) = t.apply(3.0, 4.0);
        assert!((wx - 6.0).abs() < 1e-9);
        assert!((wy - 8.0).abs() < 1e-9);
    }

    #[test]
    fn test_fit_affine_too_few() {
        let gcps = vec![Gcp::new(0.0, 0.0, 0.0, 0.0), Gcp::new(1.0, 0.0, 1.0, 0.0)];
        assert!(fit_affine(&gcps).is_err());
    }

    #[test]
    fn test_gcp_new() {
        let g = Gcp::new(10.0, 20.0, 100.0, 200.0);
        assert_eq!(g.px, 10.0);
        assert_eq!(g.wy, 200.0);
    }

    #[test]
    fn test_fit_affine_overdetermined() {
        // 4 points (overdetermined, should still solve)
        let gcps = vec![
            Gcp::new(0.0, 0.0, 10.0, 20.0),
            Gcp::new(1.0, 0.0, 11.0, 20.0),
            Gcp::new(0.0, 1.0, 10.0, 21.0),
            Gcp::new(1.0, 1.0, 11.0, 21.0),
        ];
        let t = fit_affine(&gcps).unwrap();
        let (wx, wy) = t.apply(0.0, 0.0);
        assert!((wx - 10.0).abs() < 1e-6);
        assert!((wy - 20.0).abs() < 1e-6);
    }
}
