//! Semi-automatic lane-marking extraction.
//!
//! Lane markings are highly retroreflective, so they appear as high-intensity
//! returns. This module filters points above an intensity threshold, clusters
//! them spatially with a grid-based union-find, orders each cluster into a
//! polyline along its principal axis, and simplifies the result with
//! Douglas–Peucker. The output polylines are candidate road centerlines that
//! the user reviews before committing.

use serde::{Deserialize, Serialize};

use super::model::PointCloud;
use crate::geometry::simplify::simplify_polyline_3d;

/// Tunable parameters for marking extraction.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct MarkingConfig {
    /// Minimum intensity (inclusive) for a point to be considered a marking.
    pub intensity_threshold: f32,
    /// Grid cell size used for spatial clustering, in meters.
    pub cluster_cell_size: f64,
    /// Minimum number of points for a cluster to be kept.
    pub min_cluster_size: usize,
    /// Douglas–Peucker tolerance applied to each ordered polyline.
    pub simplify_epsilon: f64,
}

impl Default for MarkingConfig {
    fn default() -> Self {
        Self {
            intensity_threshold: 0.7,
            cluster_cell_size: 0.5,
            min_cluster_size: 8,
            simplify_epsilon: 0.1,
        }
    }
}

/// Extract candidate marking polylines (local coordinates) from `cloud`.
///
/// Returns an empty vector if the cloud has no intensity channel.
pub fn extract_markings(cloud: &PointCloud, config: &MarkingConfig) -> Vec<Vec<[f64; 3]>> {
    if !cloud.has_intensity() {
        return Vec::new();
    }

    // 1. Intensity threshold filter.
    let mut points: Vec<[f64; 3]> = Vec::new();
    for i in 0..cloud.len() {
        let Some(intensity) = cloud.intensity(i) else {
            continue;
        };
        if intensity >= config.intensity_threshold
            && let Some(p) = cloud.point(i)
        {
            points.push(p);
        }
    }
    if points.len() < config.min_cluster_size {
        return Vec::new();
    }

    // 2. Grid-based clustering (8-connected occupied cells, union-find).
    let clusters = cluster_points(&points, config.cluster_cell_size);

    // 3. Order each cluster into a polyline and simplify.
    let mut polylines = Vec::new();
    for cluster in clusters {
        if cluster.len() < config.min_cluster_size {
            continue;
        }
        let ordered = order_cluster(&points, &cluster);
        let simplified = simplify_polyline_3d(&ordered, config.simplify_epsilon);
        if simplified.len() >= 2 {
            polylines.push(simplified);
        }
    }
    polylines
}

/// Cluster point indices via a grid + union-find over occupied cells.
fn cluster_points(points: &[[f64; 3]], cell_size: f64) -> Vec<Vec<usize>> {
    use std::collections::HashMap;

    let cell = cell_size.max(f64::MIN_POSITIVE);
    let key = |p: &[f64; 3]| -> (i64, i64) {
        ((p[0] / cell).floor() as i64, (p[1] / cell).floor() as i64)
    };

    // Map each occupied cell to a dense node id.
    let mut cell_id: HashMap<(i64, i64), usize> = HashMap::new();
    let mut cell_points: Vec<Vec<usize>> = Vec::new();
    for (i, p) in points.iter().enumerate() {
        let k = key(p);
        let id = *cell_id.entry(k).or_insert_with(|| {
            cell_points.push(Vec::new());
            cell_points.len() - 1
        });
        cell_points[id].push(i);
    }

    // Union-find over occupied cells.
    let mut parent: Vec<usize> = (0..cell_points.len()).collect();
    fn find(parent: &mut [usize], x: usize) -> usize {
        let mut root = x;
        while parent[root] != root {
            root = parent[root];
        }
        let mut cur = x;
        while parent[cur] != root {
            let next = parent[cur];
            parent[cur] = root;
            cur = next;
        }
        root
    }
    let union = |parent: &mut Vec<usize>, a: usize, b: usize| {
        let ra = find(parent, a);
        let rb = find(parent, b);
        if ra != rb {
            parent[ra] = rb;
        }
    };

    for (&(cx, cy), &id) in &cell_id {
        for dy in -1i64..=1 {
            for dx in -1i64..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                if let Some(&nid) = cell_id.get(&(cx + dx, cy + dy)) {
                    union(&mut parent, id, nid);
                }
            }
        }
    }

    // Group point indices by cluster root.
    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for (cid, pts) in cell_points.iter().enumerate() {
        let root = find(&mut parent, cid);
        groups.entry(root).or_default().extend_from_slice(pts);
    }
    groups.into_values().collect()
}

/// Order a cluster's points along its principal axis (PCA) to form a polyline.
fn order_cluster(points: &[[f64; 3]], cluster: &[usize]) -> Vec<[f64; 3]> {
    let n = cluster.len() as f64;
    let mut mean = [0.0f64; 3];
    for &i in cluster {
        let p = points[i];
        mean[0] += p[0];
        mean[1] += p[1];
        mean[2] += p[2];
    }
    mean[0] /= n;
    mean[1] /= n;
    mean[2] /= n;

    // 2x2 covariance in the XY plane.
    let (mut sxx, mut sxy, mut syy) = (0.0f64, 0.0f64, 0.0f64);
    for &i in cluster {
        let dx = points[i][0] - mean[0];
        let dy = points[i][1] - mean[1];
        sxx += dx * dx;
        sxy += dx * dy;
        syy += dy * dy;
    }

    // Principal eigenvector of [[sxx, sxy], [sxy, syy]].
    let trace = sxx + syy;
    let det = sxx * syy - sxy * sxy;
    let disc = (trace * trace / 4.0 - det).max(0.0).sqrt();
    let lambda = trace / 2.0 + disc;
    let axis = if sxy.abs() > 1e-12 {
        let v = [lambda - syy, sxy];
        let len = (v[0] * v[0] + v[1] * v[1]).sqrt();
        [v[0] / len, v[1] / len]
    } else if sxx >= syy {
        [1.0, 0.0]
    } else {
        [0.0, 1.0]
    };

    // Sort points by projection onto the principal axis.
    let mut sorted: Vec<[f64; 3]> = cluster.iter().map(|&i| points[i]).collect();
    sorted.sort_by(|a, b| {
        let pa = (a[0] - mean[0]) * axis[0] + (a[1] - mean[1]) * axis[1];
        let pb = (b[0] - mean[0]) * axis[0] + (b[1] - mean[1]) * axis[1];
        pa.partial_cmp(&pb).unwrap_or(std::cmp::Ordering::Equal)
    });
    sorted
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line_cloud_with_markings() -> PointCloud {
        let mut cloud = PointCloud::new();
        // Low-intensity background scattered points.
        for i in 0..50 {
            cloud.push([i as f64 * 0.4, 2.0, 0.0], Some(0.1), None);
        }
        // High-intensity marking along x at y=0.
        for i in 0..40 {
            cloud.push([i as f64 * 0.25, 0.0, 0.0], Some(0.95), None);
        }
        cloud
    }

    #[test]
    fn test_extract_markings_finds_line() {
        let cloud = line_cloud_with_markings();
        let cfg = MarkingConfig {
            intensity_threshold: 0.7,
            cluster_cell_size: 0.5,
            min_cluster_size: 5,
            simplify_epsilon: 0.05,
        };
        let lines = extract_markings(&cloud, &cfg);
        assert_eq!(lines.len(), 1);
        let line = &lines[0];
        // A straight line simplifies to its two endpoints.
        assert_eq!(line.len(), 2);
        // Endpoints span roughly x in [0, ~9.75].
        let xs: Vec<f64> = line.iter().map(|p| p[0]).collect();
        let span = xs.iter().cloned().fold(f64::MIN, f64::max)
            - xs.iter().cloned().fold(f64::MAX, f64::min);
        assert!(span > 8.0, "line span {span}");
    }

    #[test]
    fn test_no_intensity_returns_empty() {
        let mut cloud = PointCloud::new();
        cloud.push([0.0, 0.0, 0.0], None, None);
        assert!(extract_markings(&cloud, &MarkingConfig::default()).is_empty());
    }

    #[test]
    fn test_below_threshold_returns_empty() {
        let mut cloud = PointCloud::new();
        for i in 0..20 {
            cloud.push([i as f64, 0.0, 0.0], Some(0.2), None);
        }
        let lines = extract_markings(&cloud, &MarkingConfig::default());
        assert!(lines.is_empty());
    }

    #[test]
    fn test_two_separate_markings() {
        let mut cloud = PointCloud::new();
        for i in 0..30 {
            cloud.push([i as f64 * 0.25, 0.0, 0.0], Some(0.9), None);
        }
        for i in 0..30 {
            cloud.push([i as f64 * 0.25, 20.0, 0.0], Some(0.9), None);
        }
        let cfg = MarkingConfig {
            min_cluster_size: 5,
            ..Default::default()
        };
        let lines = extract_markings(&cloud, &cfg);
        assert_eq!(lines.len(), 2);
    }
}
