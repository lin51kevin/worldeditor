//! Heightmap grid built from ground points, with smoothing and bilinear sampling.
//!
//! Coordinates are in the point cloud's **local** frame (relative to its
//! origin). A cell stores the representative ground elevation (`z`); empty
//! cells hold `f32::NAN`.

use serde::{Deserialize, Serialize};

/// A regular 2D grid of ground elevations over the XY plane.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Heightmap {
    /// Local XY coordinate of the grid corner at cell `(0, 0)`.
    origin: [f64; 2],
    /// Edge length of each square cell, in meters.
    cell_size: f64,
    /// Number of columns (X direction).
    nx: usize,
    /// Number of rows (Y direction).
    ny: usize,
    /// Row-major elevations (`y * nx + x`); `NAN` marks an empty cell.
    z: Vec<f32>,
}

impl Heightmap {
    /// Create an empty heightmap (all cells `NAN`).
    pub fn new(origin: [f64; 2], cell_size: f64, nx: usize, ny: usize) -> Self {
        Self {
            origin,
            cell_size: cell_size.max(f64::MIN_POSITIVE),
            nx,
            ny,
            z: vec![f32::NAN; nx * ny],
        }
    }

    /// Local XY of the grid corner at cell `(0, 0)`.
    pub fn origin(&self) -> [f64; 2] {
        self.origin
    }

    /// Edge length of each cell.
    pub fn cell_size(&self) -> f64 {
        self.cell_size
    }

    /// Grid width in cells.
    pub fn nx(&self) -> usize {
        self.nx
    }

    /// Grid height in cells.
    pub fn ny(&self) -> usize {
        self.ny
    }

    /// Raw row-major elevation slice (`NAN` = empty).
    pub fn values(&self) -> &[f32] {
        &self.z
    }

    /// Elevation at cell `(ix, iy)`, or `None` if out of range or empty.
    pub fn cell(&self, ix: usize, iy: usize) -> Option<f32> {
        if ix >= self.nx || iy >= self.ny {
            return None;
        }
        let v = self.z[iy * self.nx + ix];
        if v.is_nan() { None } else { Some(v) }
    }

    /// Set the elevation at cell `(ix, iy)`. Out-of-range indices are ignored.
    pub fn set_cell(&mut self, ix: usize, iy: usize, value: f32) {
        if ix < self.nx && iy < self.ny {
            self.z[iy * self.nx + ix] = value;
        }
    }

    /// Map a local XY position to fractional cell coordinates.
    fn to_grid(&self, x: f64, y: f64) -> (f64, f64) {
        (
            (x - self.origin[0]) / self.cell_size,
            (y - self.origin[1]) / self.cell_size,
        )
    }

    /// Fill empty cells by averaging filled neighbors, iterating up to
    /// `max_iters` times. Helps close small holes before smoothing/sampling.
    pub fn fill_holes(&mut self, max_iters: usize) {
        for _ in 0..max_iters {
            let mut changed = false;
            let mut next = self.z.clone();
            for iy in 0..self.ny {
                for ix in 0..self.nx {
                    let idx = iy * self.nx + ix;
                    if !self.z[idx].is_nan() {
                        continue;
                    }
                    let mut sum = 0.0f32;
                    let mut count = 0u32;
                    for dy in -1i64..=1 {
                        for dx in -1i64..=1 {
                            let nxp = ix as i64 + dx;
                            let nyp = iy as i64 + dy;
                            if nxp < 0 || nyp < 0 || nxp >= self.nx as i64 || nyp >= self.ny as i64
                            {
                                continue;
                            }
                            let v = self.z[nyp as usize * self.nx + nxp as usize];
                            if !v.is_nan() {
                                sum += v;
                                count += 1;
                            }
                        }
                    }
                    if count > 0 {
                        next[idx] = sum / count as f32;
                        changed = true;
                    }
                }
            }
            self.z = next;
            if !changed {
                break;
            }
        }
    }

    /// Apply a separable Gaussian blur (`radius` cells, `sigma` in cells).
    /// `NAN` cells are treated as missing and excluded from the weighting.
    pub fn gaussian_smooth(&mut self, radius: usize, sigma: f64) {
        if radius == 0 || self.z.is_empty() {
            return;
        }
        let sigma = if sigma <= 0.0 {
            radius as f64 / 2.0
        } else {
            sigma
        };
        let kernel: Vec<f32> = (0..=radius)
            .map(|k| {
                let d = k as f64;
                (-(d * d) / (2.0 * sigma * sigma)).exp() as f32
            })
            .collect();

        // Horizontal pass.
        let mut tmp = self.z.clone();
        for iy in 0..self.ny {
            for ix in 0..self.nx {
                if self.z[iy * self.nx + ix].is_nan() {
                    continue;
                }
                let (acc, wsum) = self.weighted_line(ix, iy, true, radius, &kernel);
                if wsum > 0.0 {
                    tmp[iy * self.nx + ix] = acc / wsum;
                }
            }
        }
        self.z = tmp;

        // Vertical pass.
        let mut out = self.z.clone();
        for iy in 0..self.ny {
            for ix in 0..self.nx {
                if self.z[iy * self.nx + ix].is_nan() {
                    continue;
                }
                let (acc, wsum) = self.weighted_line(ix, iy, false, radius, &kernel);
                if wsum > 0.0 {
                    out[iy * self.nx + ix] = acc / wsum;
                }
            }
        }
        self.z = out;
    }

    fn weighted_line(
        &self,
        ix: usize,
        iy: usize,
        horizontal: bool,
        radius: usize,
        kernel: &[f32],
    ) -> (f32, f32) {
        let mut acc = 0.0f32;
        let mut wsum = 0.0f32;
        let r = radius as i64;
        for k in -r..=r {
            let (sx, sy) = if horizontal {
                (ix as i64 + k, iy as i64)
            } else {
                (ix as i64, iy as i64 + k)
            };
            if sx < 0 || sy < 0 || sx >= self.nx as i64 || sy >= self.ny as i64 {
                continue;
            }
            let v = self.z[sy as usize * self.nx + sx as usize];
            if v.is_nan() {
                continue;
            }
            let w = kernel[k.unsigned_abs() as usize];
            acc += v * w;
            wsum += w;
        }
        (acc, wsum)
    }

    /// Bilinearly sample the elevation at local XY, returning `None` if the
    /// position lies outside the grid or near only empty cells.
    pub fn sample(&self, x: f64, y: f64) -> Option<f32> {
        if self.nx == 0 || self.ny == 0 {
            return None;
        }
        let (gx, gy) = self.to_grid(x, y);
        if gx < 0.0 || gy < 0.0 || gx > (self.nx - 1) as f64 || gy > (self.ny - 1) as f64 {
            return None;
        }
        let x0 = gx.floor() as usize;
        let y0 = gy.floor() as usize;
        let x1 = (x0 + 1).min(self.nx - 1);
        let y1 = (y0 + 1).min(self.ny - 1);
        let tx = (gx - x0 as f64) as f32;
        let ty = (gy - y0 as f64) as f32;

        let c00 = self.z[y0 * self.nx + x0];
        let c10 = self.z[y0 * self.nx + x1];
        let c01 = self.z[y1 * self.nx + x0];
        let c11 = self.z[y1 * self.nx + x1];

        // Weighted average over the valid (non-NAN) corners.
        let corners = [
            (c00, (1.0 - tx) * (1.0 - ty)),
            (c10, tx * (1.0 - ty)),
            (c01, (1.0 - tx) * ty),
            (c11, tx * ty),
        ];
        let mut acc = 0.0f32;
        let mut wsum = 0.0f32;
        for (v, w) in corners {
            if !v.is_nan() && w > 0.0 {
                acc += v * w;
                wsum += w;
            }
        }
        if wsum > 0.0 { Some(acc / wsum) } else { None }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_set_and_cell() {
        let mut h = Heightmap::new([0.0, 0.0], 1.0, 3, 3);
        assert_eq!(h.cell(0, 0), None);
        h.set_cell(1, 1, 5.0);
        assert_eq!(h.cell(1, 1), Some(5.0));
        assert_eq!(h.cell(5, 5), None);
    }

    #[test]
    fn test_sample_flat() {
        let mut h = Heightmap::new([0.0, 0.0], 1.0, 2, 2);
        for iy in 0..2 {
            for ix in 0..2 {
                h.set_cell(ix, iy, 10.0);
            }
        }
        let s = h.sample(0.5, 0.5).unwrap();
        assert!((s - 10.0).abs() < 1e-5);
    }

    #[test]
    fn test_sample_interpolates() {
        let mut h = Heightmap::new([0.0, 0.0], 1.0, 2, 1);
        h.set_cell(0, 0, 0.0);
        h.set_cell(1, 0, 10.0);
        let s = h.sample(0.5, 0.0).unwrap();
        assert!((s - 5.0).abs() < 1e-5);
    }

    #[test]
    fn test_sample_out_of_range() {
        let h = Heightmap::new([0.0, 0.0], 1.0, 2, 2);
        assert_eq!(h.sample(-1.0, 0.0), None);
        assert_eq!(h.sample(100.0, 0.0), None);
    }

    #[test]
    fn test_fill_holes() {
        let mut h = Heightmap::new([0.0, 0.0], 1.0, 3, 3);
        // Ring of value 4 around an empty center.
        for (ix, iy) in [
            (0, 0),
            (1, 0),
            (2, 0),
            (0, 1),
            (2, 1),
            (0, 2),
            (1, 2),
            (2, 2),
        ] {
            h.set_cell(ix, iy, 4.0);
        }
        assert_eq!(h.cell(1, 1), None);
        h.fill_holes(2);
        assert_eq!(h.cell(1, 1), Some(4.0));
    }

    #[test]
    fn test_gaussian_smooth_preserves_constant() {
        let mut h = Heightmap::new([0.0, 0.0], 1.0, 5, 5);
        for iy in 0..5 {
            for ix in 0..5 {
                h.set_cell(ix, iy, 7.0);
            }
        }
        h.gaussian_smooth(2, 1.0);
        assert!((h.cell(2, 2).unwrap() - 7.0).abs() < 1e-4);
    }
}
