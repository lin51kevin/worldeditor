//! Point cloud domain model.
//!
//! A platform-agnostic, WASM-compatible container for 3D point cloud data with
//! optional per-point intensity (reflectivity) and RGB color. Positions are
//! stored relative to an `origin` shift so that large global coordinates keep
//! full `f64` precision after the offset is removed.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Axis-aligned bounding box in local point cloud coordinates.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Aabb {
    /// Minimum corner `[x, y, z]`.
    pub min: [f64; 3],
    /// Maximum corner `[x, y, z]`.
    pub max: [f64; 3],
}

impl Default for Aabb {
    fn default() -> Self {
        Self::empty()
    }
}

impl Aabb {
    /// Create an empty box (min = +inf, max = -inf) that grows on `expand`.
    pub fn empty() -> Self {
        Self {
            min: [f64::INFINITY; 3],
            max: [f64::NEG_INFINITY; 3],
        }
    }

    /// Grow the box to include point `p`.
    pub fn expand(&mut self, p: [f64; 3]) {
        for (axis, &v) in p.iter().enumerate() {
            if v < self.min[axis] {
                self.min[axis] = v;
            }
            if v > self.max[axis] {
                self.max[axis] = v;
            }
        }
    }

    /// Whether the box contains no points (never expanded).
    pub fn is_empty(&self) -> bool {
        self.min[0] > self.max[0]
    }

    /// Center of the box. Returns the origin for an empty box.
    pub fn center(&self) -> [f64; 3] {
        if self.is_empty() {
            return [0.0; 3];
        }
        [
            0.5 * (self.min[0] + self.max[0]),
            0.5 * (self.min[1] + self.max[1]),
            0.5 * (self.min[2] + self.max[2]),
        ]
    }

    /// Size (extent) of the box. Returns zeros for an empty box.
    pub fn size(&self) -> [f64; 3] {
        if self.is_empty() {
            return [0.0; 3];
        }
        [
            self.max[0] - self.min[0],
            self.max[1] - self.min[1],
            self.max[2] - self.min[2],
        ]
    }
}

/// A 3D point cloud with optional intensity and RGB attributes.
///
/// Positions are stored as a flat `[x0, y0, z0, x1, y1, z1, ...]` array in
/// local coordinates relative to [`PointCloud::origin`].
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PointCloud {
    /// Flattened local coordinates, 3 values per point.
    positions: Vec<f64>,
    /// Optional per-point intensity (one value per point) if present.
    intensity: Option<Vec<f32>>,
    /// Optional per-point RGB color (3 bytes per point) if present.
    rgb: Option<Vec<u8>>,
    /// Global origin subtracted from every stored position.
    origin: [f64; 3],
    /// Cached axis-aligned bounds in local coordinates.
    bounds: Aabb,
}

impl PointCloud {
    /// Create an empty point cloud with a zero origin.
    pub fn new() -> Self {
        Self::default()
    }

    /// Create an empty point cloud whose stored positions are relative to `origin`.
    pub fn with_origin(origin: [f64; 3]) -> Self {
        Self {
            origin,
            ..Self::default()
        }
    }

    /// Number of points.
    pub fn len(&self) -> usize {
        self.positions.len() / 3
    }

    /// Whether the cloud has no points.
    pub fn is_empty(&self) -> bool {
        self.positions.is_empty()
    }

    /// The global origin subtracted from stored positions.
    pub fn origin(&self) -> [f64; 3] {
        self.origin
    }

    /// Local bounds of the cloud.
    pub fn bounds(&self) -> Aabb {
        self.bounds
    }

    /// Whether intensity values are present.
    pub fn has_intensity(&self) -> bool {
        self.intensity.is_some()
    }

    /// Whether RGB colors are present.
    pub fn has_rgb(&self) -> bool {
        self.rgb.is_some()
    }

    /// Raw flat positions slice `[x, y, z, ...]` in local coordinates.
    pub fn positions(&self) -> &[f64] {
        &self.positions
    }

    /// Raw intensity slice, if present.
    pub fn intensities(&self) -> Option<&[f32]> {
        self.intensity.as_deref()
    }

    /// Raw RGB slice (3 bytes per point), if present.
    pub fn colors(&self) -> Option<&[u8]> {
        self.rgb.as_deref()
    }

    /// Local position of point `i`, or `None` if out of range.
    pub fn point(&self, i: usize) -> Option<[f64; 3]> {
        let base = i * 3;
        if base + 2 >= self.positions.len() {
            return None;
        }
        Some([
            self.positions[base],
            self.positions[base + 1],
            self.positions[base + 2],
        ])
    }

    /// Intensity of point `i`, or `None` if absent / out of range.
    pub fn intensity(&self, i: usize) -> Option<f32> {
        self.intensity.as_ref().and_then(|v| v.get(i).copied())
    }

    /// RGB color of point `i`, or `None` if absent / out of range.
    pub fn color(&self, i: usize) -> Option<[u8; 3]> {
        let rgb = self.rgb.as_ref()?;
        let base = i * 3;
        if base + 2 >= rgb.len() {
            return None;
        }
        Some([rgb[base], rgb[base + 1], rgb[base + 2]])
    }

    /// Append a point with optional intensity and color.
    ///
    /// The first attribute pushed determines whether the cloud tracks intensity
    /// or color; later inconsistent pushes are ignored for that attribute.
    pub fn push(&mut self, local: [f64; 3], intensity: Option<f32>, color: Option<[u8; 3]>) {
        let idx = self.len();
        self.positions.extend_from_slice(&local);
        self.bounds.expand(local);

        if let Some(value) = intensity {
            let buf = self.intensity.get_or_insert_with(|| vec![0.0; idx]);
            if buf.len() == idx {
                buf.push(value);
            }
        } else if let Some(buf) = self.intensity.as_mut()
            && buf.len() == idx
        {
            buf.push(0.0);
        }

        if let Some(c) = color {
            let buf = self.rgb.get_or_insert_with(|| vec![0u8; idx * 3]);
            if buf.len() == idx * 3 {
                buf.extend_from_slice(&c);
            }
        } else if let Some(buf) = self.rgb.as_mut()
            && buf.len() == idx * 3
        {
            buf.extend_from_slice(&[0, 0, 0]);
        }
    }

    /// Reserve capacity for at least `additional` more points.
    pub fn reserve(&mut self, additional: usize) {
        self.positions.reserve(additional * 3);
    }

    /// Voxel-grid downsample: collapse all points in each `voxel_size` cube to
    /// their centroid, averaging intensity and color. Preserves the origin.
    ///
    /// Returns a copy of `self` when `voxel_size <= 0` or the cloud is empty.
    pub fn voxel_downsample(&self, voxel_size: f64) -> PointCloud {
        if voxel_size <= 0.0 || self.is_empty() {
            return self.clone();
        }

        struct Acc {
            sum: [f64; 3],
            intensity: f64,
            rgb: [f64; 3],
            count: u64,
        }

        let inv = 1.0 / voxel_size;
        let mut cells: HashMap<(i64, i64, i64), Acc> = HashMap::new();
        let mut order: Vec<(i64, i64, i64)> = Vec::new();

        for i in 0..self.len() {
            let p = self.point(i).expect("index in range");
            let key = (
                (p[0] * inv).floor() as i64,
                (p[1] * inv).floor() as i64,
                (p[2] * inv).floor() as i64,
            );
            let intensity = self.intensity(i).unwrap_or(0.0) as f64;
            let color = self.color(i).unwrap_or([0, 0, 0]);
            let entry = cells.entry(key).or_insert_with(|| {
                order.push(key);
                Acc {
                    sum: [0.0; 3],
                    intensity: 0.0,
                    rgb: [0.0; 3],
                    count: 0,
                }
            });
            entry.sum[0] += p[0];
            entry.sum[1] += p[1];
            entry.sum[2] += p[2];
            entry.intensity += intensity;
            entry.rgb[0] += color[0] as f64;
            entry.rgb[1] += color[1] as f64;
            entry.rgb[2] += color[2] as f64;
            entry.count += 1;
        }

        let mut out = PointCloud::with_origin(self.origin);
        out.reserve(order.len());
        for key in order {
            let acc = &cells[&key];
            let n = acc.count as f64;
            let centroid = [acc.sum[0] / n, acc.sum[1] / n, acc.sum[2] / n];
            let intensity = self.has_intensity().then(|| (acc.intensity / n) as f32);
            let color = self.has_rgb().then(|| {
                [
                    (acc.rgb[0] / n).round() as u8,
                    (acc.rgb[1] / n).round() as u8,
                    (acc.rgb[2] / n).round() as u8,
                ]
            });
            out.push(centroid, intensity, color);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_cloud_defaults() {
        let pc = PointCloud::new();
        assert_eq!(pc.len(), 0);
        assert!(pc.is_empty());
        assert!(pc.bounds().is_empty());
        assert!(!pc.has_intensity());
        assert!(!pc.has_rgb());
    }

    #[test]
    fn test_push_updates_bounds_and_len() {
        let mut pc = PointCloud::new();
        pc.push([0.0, 0.0, 0.0], None, None);
        pc.push([2.0, 4.0, -1.0], None, None);
        assert_eq!(pc.len(), 2);
        let b = pc.bounds();
        assert_eq!(b.min, [0.0, 0.0, -1.0]);
        assert_eq!(b.max, [2.0, 4.0, 0.0]);
        assert_eq!(b.center(), [1.0, 2.0, -0.5]);
        assert_eq!(b.size(), [2.0, 4.0, 1.0]);
    }

    #[test]
    fn test_push_with_intensity_and_color() {
        let mut pc = PointCloud::new();
        pc.push([1.0, 2.0, 3.0], Some(0.5), Some([10, 20, 30]));
        assert!(pc.has_intensity());
        assert!(pc.has_rgb());
        assert_eq!(pc.point(0), Some([1.0, 2.0, 3.0]));
        assert_eq!(pc.intensity(0), Some(0.5));
        assert_eq!(pc.color(0), Some([10, 20, 30]));
        assert_eq!(pc.point(1), None);
    }

    #[test]
    fn test_voxel_downsample_collapses_close_points() {
        let mut pc = PointCloud::new();
        // Four points inside a single 1.0 voxel near origin.
        pc.push([0.1, 0.1, 0.0], Some(1.0), None);
        pc.push([0.2, 0.2, 0.0], Some(3.0), None);
        pc.push([0.3, 0.1, 0.0], Some(2.0), None);
        // One point far away in another voxel.
        pc.push([10.0, 10.0, 0.0], Some(0.0), None);

        let down = pc.voxel_downsample(1.0);
        assert_eq!(down.len(), 2);
        // Centroid of the three close points.
        let p0 = down.point(0).unwrap();
        assert!((p0[0] - 0.2).abs() < 1e-9);
        assert!((p0[1] - (0.4 / 3.0)).abs() < 1e-9);
        assert!((down.intensity(0).unwrap() - 2.0).abs() < 1e-6);
    }

    #[test]
    fn test_voxel_downsample_noop_on_invalid_size() {
        let mut pc = PointCloud::new();
        pc.push([0.0, 0.0, 0.0], None, None);
        let down = pc.voxel_downsample(0.0);
        assert_eq!(down.len(), 1);
    }

    #[test]
    fn test_with_origin_preserved_through_downsample() {
        let mut pc = PointCloud::with_origin([100.0, 200.0, 0.0]);
        pc.push([0.0, 0.0, 0.0], None, None);
        let down = pc.voxel_downsample(1.0);
        assert_eq!(down.origin(), [100.0, 200.0, 0.0]);
    }
}
