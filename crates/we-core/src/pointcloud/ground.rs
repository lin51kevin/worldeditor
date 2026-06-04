//! Semi-automatic ground extraction.
//!
//! Uses a voxel-grid lowest-point heuristic: the XY plane is divided into
//! square cells, the lowest point in each cell seeds a ground heightmap, the
//! heightmap is hole-filled and Gaussian-smoothed, and finally every point
//! within `ground_threshold` above the sampled ground surface is classified as
//! ground. This is robust for gently sloped terrain and avoids native
//! dependencies, keeping it WASM-compatible.

use serde::{Deserialize, Serialize};

use super::heightmap::Heightmap;
use super::model::PointCloud;

/// Tunable parameters for ground extraction.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct GroundConfig {
    /// Heightmap cell size in meters.
    pub cell_size: f64,
    /// Max height above the ground surface for a point to count as ground.
    pub ground_threshold: f64,
    /// Hole-filling iterations applied to the seed heightmap.
    pub fill_iters: usize,
    /// Gaussian smoothing radius in cells (`0` disables smoothing).
    pub smooth_radius: usize,
    /// Gaussian smoothing sigma in cells.
    pub smooth_sigma: f64,
}

impl Default for GroundConfig {
    fn default() -> Self {
        Self {
            cell_size: 1.0,
            ground_threshold: 0.3,
            fill_iters: 4,
            smooth_radius: 2,
            smooth_sigma: 1.0,
        }
    }
}

/// Result of ground extraction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroundResult {
    /// Indices (into the source cloud) classified as ground.
    pub ground_indices: Vec<usize>,
    /// Smoothed ground heightmap in the cloud's local frame.
    pub heightmap: Heightmap,
}

/// Extract ground points and build a ground heightmap from `cloud`.
pub fn extract_ground(cloud: &PointCloud, config: &GroundConfig) -> GroundResult {
    let bounds = cloud.bounds();
    if cloud.is_empty() || bounds.is_empty() {
        return GroundResult {
            ground_indices: Vec::new(),
            heightmap: Heightmap::new([0.0, 0.0], config.cell_size.max(f64::MIN_POSITIVE), 0, 0),
        };
    }

    let cell = config.cell_size.max(f64::MIN_POSITIVE);
    let origin = [bounds.min[0], bounds.min[1]];
    let span_x = bounds.max[0] - bounds.min[0];
    let span_y = bounds.max[1] - bounds.min[1];
    let nx = ((span_x / cell).ceil() as usize + 1).max(1);
    let ny = ((span_y / cell).ceil() as usize + 1).max(1);

    // Seed: lowest z per cell.
    let mut heightmap = Heightmap::new(origin, cell, nx, ny);
    for i in 0..cloud.len() {
        let Some(p) = cloud.point(i) else { continue };
        let ix = (((p[0] - origin[0]) / cell) as usize).min(nx - 1);
        let iy = (((p[1] - origin[1]) / cell) as usize).min(ny - 1);
        let z = p[2] as f32;
        match heightmap.cell(ix, iy) {
            Some(existing) if existing <= z => {}
            _ => heightmap.set_cell(ix, iy, z),
        }
    }

    heightmap.fill_holes(config.fill_iters);
    if config.smooth_radius > 0 {
        heightmap.gaussian_smooth(config.smooth_radius, config.smooth_sigma);
    }

    // Classify ground points relative to the smoothed surface.
    let mut ground_indices = Vec::new();
    for i in 0..cloud.len() {
        let Some(p) = cloud.point(i) else { continue };
        if let Some(surface) = heightmap.sample(p[0], p[1]) {
            let dz = p[2] as f32 - surface;
            if dz >= -config.ground_threshold as f32 && dz <= config.ground_threshold as f32 {
                ground_indices.push(i);
            }
        }
    }

    GroundResult {
        ground_indices,
        heightmap,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synthetic_cloud() -> PointCloud {
        // Flat ground at z=0 plus a few elevated "object" points.
        let mut cloud = PointCloud::new();
        for gy in 0..10 {
            for gx in 0..10 {
                cloud.push([gx as f64, gy as f64, 0.0], None, None);
            }
        }
        // Elevated points (e.g. a building / tree) at z=5.
        for gy in 3..6 {
            for gx in 3..6 {
                cloud.push([gx as f64, gy as f64, 5.0], None, None);
            }
        }
        cloud
    }

    #[test]
    fn test_extract_ground_separates_elevated_points() {
        let cloud = synthetic_cloud();
        let cfg = GroundConfig {
            cell_size: 1.0,
            ground_threshold: 0.5,
            ..Default::default()
        };
        let result = extract_ground(&cloud, &cfg);
        // 100 ground points, 9 elevated ones excluded.
        assert_eq!(result.ground_indices.len(), 100);
        // Heightmap should report ~0 elevation on the ground.
        let s = result.heightmap.sample(1.0, 1.0).unwrap();
        assert!(s.abs() < 1.0, "ground surface near zero, got {s}");
    }

    #[test]
    fn test_extract_ground_empty_cloud() {
        let cloud = PointCloud::new();
        let result = extract_ground(&cloud, &GroundConfig::default());
        assert!(result.ground_indices.is_empty());
    }

    #[test]
    fn test_extract_ground_sloped_surface() {
        // Ramp: z increases with x. All points are ground.
        let mut cloud = PointCloud::new();
        for gy in 0..10 {
            for gx in 0..20 {
                cloud.push([gx as f64, gy as f64, gx as f64 * 0.1], None, None);
            }
        }
        let cfg = GroundConfig {
            cell_size: 1.0,
            ground_threshold: 0.3,
            ..Default::default()
        };
        let result = extract_ground(&cloud, &cfg);
        // The vast majority of ramp points should be classified as ground.
        assert!(result.ground_indices.len() >= 190);
    }
}
