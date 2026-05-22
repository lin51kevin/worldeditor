//! Snapping system for the road network editor.
//!
//! Provides grid snapping, endpoint snapping, and perpendicular snapping
//! for precise editing operations. Pure Rust, WASM compatible.

use crate::geometry::eval::{evaluate_road_at_s, sample_road_reference_line};
use crate::model::{Project, Road};
use crate::spatial_index::{ProjectCache, SpatialIndex};
use serde::{Deserialize, Serialize};

/// Snap configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapConfig {
    /// Enable grid snapping.
    pub grid_enabled: bool,
    /// Grid cell size in world units.
    pub grid_size: f64,
    /// Enable endpoint snapping (road start/end).
    pub endpoint_enabled: bool,
    /// Snap distance threshold for endpoints.
    pub endpoint_threshold: f64,
    /// Enable midpoint snapping.
    pub midpoint_enabled: bool,
    /// Enable perpendicular snapping.
    pub perpendicular_enabled: bool,
}

impl Default for SnapConfig {
    fn default() -> Self {
        Self {
            grid_enabled: true,
            grid_size: 1.0,
            endpoint_enabled: true,
            endpoint_threshold: 5.0,
            midpoint_enabled: false,
            perpendicular_enabled: false,
        }
    }
}

/// Result of a snap operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapResult {
    /// Snapped X coordinate.
    pub x: f64,
    /// Snapped Y coordinate.
    pub y: f64,
    /// Whether snapping was applied.
    pub snapped: bool,
    /// Type of snap that was applied.
    pub snap_type: SnapType,
    /// ID of the element snapped to (for endpoint/midpoint).
    pub target_id: Option<String>,
    /// Which end of the target road was snapped to (only for Endpoint snap).
    pub contact_point: Option<String>,
}

/// The type of snap that was applied.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SnapType {
    None,
    Grid,
    Endpoint,
    Midpoint,
    Perpendicular,
}

/// Cached version of [`snap_point`].
///
/// Uses [`ProjectCache`] to avoid rebuilding the spatial index on every call.
pub fn snap_point_cached(
    x: f64,
    y: f64,
    config: &SnapConfig,
    cache: &mut ProjectCache,
    exclude_road_id: Option<&str>,
) -> SnapResult {
    // 1. Try endpoint snap
    if config.endpoint_enabled
        && let Some(result) =
            snap_to_endpoint_cached(x, y, config.endpoint_threshold, cache, exclude_road_id)
    {
        return result;
    }

    // 2. Try midpoint snap
    if config.midpoint_enabled
        && let Some(result) =
            snap_to_midpoint_cached(x, y, config.endpoint_threshold, cache, exclude_road_id)
    {
        return result;
    }

    // 3. Try perpendicular snap
    if config.perpendicular_enabled
        && let Some(result) =
            snap_to_perpendicular_cached(x, y, config.endpoint_threshold, cache, exclude_road_id)
    {
        return result;
    }

    // 4. Grid snap (fallback)
    if config.grid_enabled {
        return snap_to_grid(x, y, config.grid_size);
    }

    SnapResult {
        x,
        y,
        snapped: false,
        snap_type: SnapType::None,
        target_id: None,
        contact_point: None,
    }
}

/// Snap a point to the nearest grid/endpoint/etc.
///
/// Tries each enabled snap type in priority order:
/// 1. Endpoint (highest priority — exact connections)
/// 2. Midpoint
/// 3. Perpendicular
/// 4. Grid (lowest priority — always available)
pub fn snap_point(
    x: f64,
    y: f64,
    config: &SnapConfig,
    project: &Project,
    exclude_road_id: Option<&str>,
) -> SnapResult {
    // 1. Try endpoint snap
    if config.endpoint_enabled
        && let Some(result) =
            snap_to_endpoint(x, y, config.endpoint_threshold, project, exclude_road_id)
    {
        return result;
    }

    // 2. Try midpoint snap
    if config.midpoint_enabled
        && let Some(result) =
            snap_to_midpoint(x, y, config.endpoint_threshold, project, exclude_road_id)
    {
        return result;
    }

    // 3. Try perpendicular snap
    if config.perpendicular_enabled
        && let Some(result) =
            snap_to_perpendicular(x, y, config.endpoint_threshold, project, exclude_road_id)
    {
        return result;
    }

    // 4. Grid snap (fallback)
    if config.grid_enabled {
        return snap_to_grid(x, y, config.grid_size);
    }

    SnapResult {
        x,
        y,
        snapped: false,
        snap_type: SnapType::None,
        target_id: None,
        contact_point: None,
    }
}

/// Snap to the nearest grid intersection.
pub fn snap_to_grid(x: f64, y: f64, grid_size: f64) -> SnapResult {
    let gs = grid_size.max(0.01);
    SnapResult {
        x: (x / gs).round() * gs,
        y: (y / gs).round() * gs,
        snapped: true,
        snap_type: SnapType::Grid,
        target_id: None,
        contact_point: None,
    }
}

/// Snap to the nearest road endpoint (start or end).
fn snap_to_endpoint(
    x: f64,
    y: f64,
    threshold: f64,
    project: &Project,
    exclude_road_id: Option<&str>,
) -> Option<SnapResult> {
    let index = SpatialIndex::build(project, 100.0);
    snap_to_endpoint_with_index(x, y, threshold, project, &index, exclude_road_id)
}

fn snap_to_endpoint_cached(
    x: f64,
    y: f64,
    threshold: f64,
    cache: &mut ProjectCache,
    exclude_road_id: Option<&str>,
) -> Option<SnapResult> {
    cache.get_index()?;
    let index = cache.spatial_index.as_ref().unwrap();
    snap_to_endpoint_with_index(x, y, threshold, &cache.project, index, exclude_road_id)
}

fn snap_to_endpoint_with_index(
    x: f64,
    y: f64,
    threshold: f64,
    project: &Project,
    index: &SpatialIndex,
    exclude_road_id: Option<&str>,
) -> Option<SnapResult> {
    let candidates = index.query_point(x, y, threshold);

    let mut best_dist = threshold;
    let mut best: Option<SnapResult> = None;

    for candidate in &candidates {
        if exclude_road_id == Some(candidate.id.as_str()) {
            continue;
        }
        let road = match project.roads.iter().find(|r| r.id == candidate.id) {
            Some(r) => r,
            None => continue,
        };
        let endpoints = get_road_endpoints(road);
        for (i, (ex, ey)) in endpoints.iter().enumerate() {
            let dx = x - ex;
            let dy = y - ey;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist < best_dist {
                best_dist = dist;
                let cp = if i == 0 { "Start" } else { "End" };
                best = Some(SnapResult {
                    x: *ex,
                    y: *ey,
                    snapped: true,
                    snap_type: SnapType::Endpoint,
                    target_id: Some(road.id.clone()),
                    contact_point: Some(cp.to_string()),
                });
            }
        }
    }

    best
}

/// Snap to the midpoint of the nearest road.
fn snap_to_midpoint(
    x: f64,
    y: f64,
    threshold: f64,
    project: &Project,
    exclude_road_id: Option<&str>,
) -> Option<SnapResult> {
    let index = SpatialIndex::build(project, 100.0);
    snap_to_midpoint_with_index(x, y, threshold, project, &index, exclude_road_id)
}

fn snap_to_midpoint_cached(
    x: f64,
    y: f64,
    threshold: f64,
    cache: &mut ProjectCache,
    exclude_road_id: Option<&str>,
) -> Option<SnapResult> {
    cache.get_index()?;
    let index = cache.spatial_index.as_ref().unwrap();
    snap_to_midpoint_with_index(x, y, threshold, &cache.project, index, exclude_road_id)
}

fn snap_to_midpoint_with_index(
    x: f64,
    y: f64,
    threshold: f64,
    project: &Project,
    index: &SpatialIndex,
    exclude_road_id: Option<&str>,
) -> Option<SnapResult> {
    let candidates = index.query_point(x, y, threshold);

    let mut best_dist = threshold;
    let mut best: Option<SnapResult> = None;

    for candidate in &candidates {
        if exclude_road_id == Some(candidate.id.as_str()) {
            continue;
        }
        let road = match project.roads.iter().find(|r| r.id == candidate.id) {
            Some(r) => r,
            None => continue,
        };
        if let Some((mx, my)) = get_road_midpoint(road) {
            let dx = x - mx;
            let dy = y - my;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist < best_dist {
                best_dist = dist;
                best = Some(SnapResult {
                    x: mx,
                    y: my,
                    snapped: true,
                    snap_type: SnapType::Midpoint,
                    target_id: Some(road.id.clone()),
                    contact_point: None,
                });
            }
        }
    }

    best
}

/// Snap to the nearest perpendicular projection onto a road's reference line.
fn snap_to_perpendicular(
    x: f64,
    y: f64,
    threshold: f64,
    project: &Project,
    exclude_road_id: Option<&str>,
) -> Option<SnapResult> {
    let index = SpatialIndex::build(project, 100.0);
    snap_to_perpendicular_with_index(x, y, threshold, project, &index, exclude_road_id)
}

fn snap_to_perpendicular_cached(
    x: f64,
    y: f64,
    threshold: f64,
    cache: &mut ProjectCache,
    exclude_road_id: Option<&str>,
) -> Option<SnapResult> {
    cache.get_index()?;
    let index = cache.spatial_index.as_ref().unwrap();
    snap_to_perpendicular_with_index(x, y, threshold, &cache.project, index, exclude_road_id)
}

fn snap_to_perpendicular_with_index(
    x: f64,
    y: f64,
    threshold: f64,
    project: &Project,
    index: &SpatialIndex,
    exclude_road_id: Option<&str>,
) -> Option<SnapResult> {
    let candidates = index.query_point(x, y, threshold);

    let mut best_dist = threshold;
    let mut best: Option<SnapResult> = None;

    for candidate in &candidates {
        if exclude_road_id == Some(candidate.id.as_str()) {
            continue;
        }
        let road = match project.roads.iter().find(|r| r.id == candidate.id) {
            Some(r) => r,
            None => continue,
        };
        let pts = sample_road_reference_line(road, 2.0);
        for pt in &pts {
            let dx = x - pt.x;
            let dy = y - pt.y;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist < best_dist {
                best_dist = dist;
                best = Some(SnapResult {
                    x: pt.x,
                    y: pt.y,
                    snapped: true,
                    snap_type: SnapType::Perpendicular,
                    target_id: Some(road.id.clone()),
                    contact_point: None,
                });
            }
        }
    }

    best
}

/// Get the start and end points of a road.
///
/// Uses direct curve evaluation at s=0 and s=length instead of
/// sampling the entire reference line.
fn get_road_endpoints(road: &Road) -> Vec<(f64, f64)> {
    let mut endpoints = Vec::with_capacity(2);
    if let Some(pt) = evaluate_road_at_s(road, 0.0) {
        endpoints.push((pt.x, pt.y));
    }
    if road.length > 1e-9 {
        if let Some(pt) = evaluate_road_at_s(road, road.length) {
            endpoints.push((pt.x, pt.y));
        }
    }
    endpoints
}

/// Result of querying a road endpoint's position and heading.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EndpointTangent {
    /// World X coordinate of the endpoint.
    pub x: f64,
    /// World Y coordinate of the endpoint.
    pub y: f64,
    /// Heading (tangent angle in radians) at the endpoint.
    pub hdg: f64,
}

/// Get the position and heading at a road endpoint.
///
/// `contact_point` should be `"Start"` or `"End"`.
/// For `"End"`, the heading is flipped by π so the tangent points *away*
/// from the road (i.e. the direction the next road should continue).
pub fn get_road_endpoint_tangent(road: &Road, contact_point: &str) -> Option<EndpointTangent> {
    let s = match contact_point {
        "Start" => 0.0,
        "End" => road.length,
        _ => return None,
    };
    evaluate_road_at_s(road, s).map(|pt| {
        let hdg = if contact_point == "End" {
            // Heading at the end already points in the road's forward direction.
            // No flip needed — this IS the continuation direction.
            pt.hdg
        } else {
            // At the start, the road's heading points forward (away from start).
            // Flip by π so the tangent points *into* the road for a predecessor connection.
            pt.hdg + std::f64::consts::PI
        };
        EndpointTangent {
            x: pt.x,
            y: pt.y,
            hdg,
        }
    })
}

/// Get the midpoint of a road's reference line.
///
/// Uses direct curve evaluation at s=length/2.
fn get_road_midpoint(road: &Road) -> Option<(f64, f64)> {
    let mid_s = road.length / 2.0;
    evaluate_road_at_s(road, mid_s).map(|p| (p.x, p.y))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;

    fn make_road_at(id: &str, x: f64, y: f64, length: f64) -> Road {
        Road::from_centerline(
            id,
            vec![Geometry {
                s: 0.0,
                x,
                y,
                hdg: 0.0,
                length,
                geo_type: GeometryType::Line,
            }],
        )
    }

    #[test]
    fn test_snap_to_grid() {
        let result = snap_to_grid(3.3, 7.8, 1.0);
        assert!(result.snapped);
        assert!((result.x - 3.0).abs() < 1e-9);
        assert!((result.y - 8.0).abs() < 1e-9);
        assert_eq!(result.snap_type, SnapType::Grid);
    }

    #[test]
    fn test_snap_to_grid_large() {
        let result = snap_to_grid(14.0, 27.0, 10.0);
        assert!((result.x - 10.0).abs() < 1e-9);
        assert!((result.y - 30.0).abs() < 1e-9);
    }

    #[test]
    fn test_snap_to_endpoint() {
        let mut project = Project::default();
        project.roads.push(make_road_at("r1", 100.0, 0.0, 50.0));
        let config = SnapConfig {
            endpoint_enabled: true,
            endpoint_threshold: 10.0,
            grid_enabled: false,
            ..Default::default()
        };
        // Near the start point of r1 at (100, 0)
        let result = snap_point(102.0, 1.0, &config, &project, None);
        assert!(result.snapped);
        assert_eq!(result.snap_type, SnapType::Endpoint);
        assert!((result.x - 100.0).abs() < 1e-6);
        assert_eq!(result.target_id.as_deref(), Some("r1"));
    }

    #[test]
    fn test_snap_to_endpoint_excludes_self() {
        let mut project = Project::default();
        project.roads.push(make_road_at("r1", 0.0, 0.0, 50.0));
        let config = SnapConfig {
            endpoint_enabled: true,
            endpoint_threshold: 10.0,
            grid_enabled: false,
            ..Default::default()
        };
        let result = snap_point(1.0, 1.0, &config, &project, Some("r1"));
        assert!(!result.snapped);
    }

    #[test]
    fn test_snap_fallback_to_grid() {
        let project = Project::default();
        let config = SnapConfig {
            endpoint_enabled: true,
            endpoint_threshold: 5.0,
            grid_enabled: true,
            grid_size: 5.0,
            ..Default::default()
        };
        // No roads → endpoint fails → falls back to grid
        let result = snap_point(12.0, 18.0, &config, &project, None);
        assert!(result.snapped);
        assert_eq!(result.snap_type, SnapType::Grid);
        assert!((result.x - 10.0).abs() < 1e-9);
        assert!((result.y - 20.0).abs() < 1e-9);
    }

    #[test]
    fn test_snap_disabled() {
        let project = Project::default();
        let config = SnapConfig {
            grid_enabled: false,
            endpoint_enabled: false,
            midpoint_enabled: false,
            perpendicular_enabled: false,
            ..Default::default()
        };
        let result = snap_point(3.3, 7.8, &config, &project, None);
        assert!(!result.snapped);
        assert_eq!(result.snap_type, SnapType::None);
    }

    #[test]
    fn test_snap_endpoint_priority_over_grid() {
        let mut project = Project::default();
        project.roads.push(make_road_at("r1", 10.1, 10.1, 50.0));
        let config = SnapConfig {
            endpoint_enabled: true,
            endpoint_threshold: 5.0,
            grid_enabled: true,
            grid_size: 10.0,
            ..Default::default()
        };
        // Point near (10.1, 10.1) — endpoint should win over grid (10,10)
        let result = snap_point(10.5, 10.5, &config, &project, None);
        assert_eq!(result.snap_type, SnapType::Endpoint);
    }

    #[test]
    fn test_default_config() {
        let config = SnapConfig::default();
        assert!(config.grid_enabled);
        assert!(config.endpoint_enabled);
        assert_eq!(config.grid_size, 1.0);
    }

    #[test]
    fn test_endpoint_snap_returns_contact_point() {
        let mut project = Project::default();
        project.roads.push(make_road_at("r1", 0.0, 0.0, 100.0));
        let config = SnapConfig {
            endpoint_enabled: true,
            endpoint_threshold: 5.0,
            grid_enabled: false,
            ..Default::default()
        };
        // Near start (0, 0)
        let result = snap_point(1.0, 0.5, &config, &project, None);
        assert!(result.snapped);
        assert_eq!(result.snap_type, SnapType::Endpoint);
        assert_eq!(result.contact_point.as_deref(), Some("Start"));

        // Near end (100, 0)
        let result = snap_point(99.5, 0.5, &config, &project, None);
        assert!(result.snapped);
        assert_eq!(result.snap_type, SnapType::Endpoint);
        assert_eq!(result.contact_point.as_deref(), Some("End"));
    }

    #[test]
    fn test_get_road_endpoint_tangent_start() {
        let road = make_road_at("r1", 10.0, 20.0, 50.0);
        let result = get_road_endpoint_tangent(&road, "Start").unwrap();
        assert!((result.x - 10.0).abs() < 1e-6);
        assert!((result.y - 20.0).abs() < 1e-6);
        // At start, heading is flipped by π from the road's forward direction (hdg=0)
        assert!((result.hdg - std::f64::consts::PI).abs() < 1e-6);
    }

    #[test]
    fn test_get_road_endpoint_tangent_end() {
        let road = make_road_at("r1", 10.0, 20.0, 50.0);
        let result = get_road_endpoint_tangent(&road, "End").unwrap();
        // End of a horizontal line road: x = 10 + 50 = 60, y = 20
        assert!((result.x - 60.0).abs() < 1e-6);
        assert!((result.y - 20.0).abs() < 1e-6);
        // At end, heading is the road's forward direction (hdg=0)
        assert!((result.hdg).abs() < 1e-6);
    }

    #[test]
    fn test_get_road_endpoint_tangent_invalid() {
        let road = make_road_at("r1", 0.0, 0.0, 50.0);
        assert!(get_road_endpoint_tangent(&road, "Invalid").is_none());
    }

    #[test]
    fn test_grid_snap_has_no_contact_point() {
        let result = snap_to_grid(3.3, 7.8, 1.0);
        assert!(result.contact_point.is_none());
    }
}
