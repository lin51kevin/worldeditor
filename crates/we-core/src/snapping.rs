//! Snapping system for the road network editor.
//!
//! Provides grid snapping, road and lane endpoint snapping, midpoint snapping,
//! and perpendicular snapping for precise editing operations. Pure Rust, WASM compatible.

use crate::geometry::eval::{evaluate_road_at_s, offset_point, sample_road_reference_line};
use crate::lane_ops::compute_lane_outer_offset;
use crate::model::{LaneSection, Project, Road};
use crate::spatial_index::ProjectCache;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
    /// Enable lane endpoint snapping at lane section boundaries.
    #[serde(default)]
    pub snap_to_lane_endpoints: bool,
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
            snap_to_lane_endpoints: false,
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
    /// ID of the element snapped to (for endpoint/midpoint/lane endpoint).
    pub target_id: Option<String>,
    /// Which end of the target road or lane boundary was snapped to.
    pub contact_point: Option<String>,
}

/// The type of snap that was applied.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum SnapType {
    None,
    Grid,
    Endpoint,
    LaneEndpoint,
    Midpoint,
    Perpendicular,
}

const SNAP_CACHE_CELL_SIZE: f64 = 10.0;
const PERPENDICULAR_SAMPLE_STEP: f64 = 2.0;

/// Additional metadata associated with a snap candidate.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SnapMetadata {
    /// Which end of the source feature produced the candidate.
    pub contact_point: Option<String>,
    /// Lane identifier for lane-boundary snap candidates.
    pub lane_id: Option<i32>,
    /// Heading at the snap point, when available.
    pub heading: Option<f64>,
}

/// A single precomputed snap candidate stored in [`SnapCache`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapCandidate {
    pub x: f64,
    pub y: f64,
    pub snap_type: SnapType,
    pub road_id: String,
    pub metadata: SnapMetadata,
}

/// Hash-grid cache for fast repeated snap queries.
///
/// Rebuild this cache whenever the road network changes.
#[derive(Debug, Clone)]
pub struct SnapCache {
    /// Road start and end points.
    pub endpoints: Vec<SnapCandidate>,
    /// Lane boundary start and end points.
    pub lane_endpoints: Vec<SnapCandidate>,
    /// Reference-line midpoint candidates.
    pub midpoints: Vec<SnapCandidate>,
    /// Reference-line samples used for perpendicular snapping.
    pub perpendicular_samples: Vec<SnapCandidate>,
    /// Spatial hash grid keyed by cell coordinate.
    pub grid: HashMap<(i32, i32), Vec<usize>>,
    /// World-space size of each spatial hash cell.
    pub cell_size: f64,
}

impl Default for SnapCache {
    fn default() -> Self {
        Self {
            endpoints: Vec::new(),
            lane_endpoints: Vec::new(),
            midpoints: Vec::new(),
            perpendicular_samples: Vec::new(),
            grid: HashMap::new(),
            cell_size: SNAP_CACHE_CELL_SIZE,
        }
    }
}

/// Cached version of [`snap_point`].
///
/// Uses [`ProjectCache`] to reuse the precomputed snap candidate hash grid.
/// Call [`ProjectCache::invalidate()`] after mutating the project so the cache
/// is rebuilt on the next query.
pub fn snap_point_cached(
    x: f64,
    y: f64,
    config: &SnapConfig,
    cache: &mut ProjectCache,
    exclude_road_id: Option<&str>,
) -> SnapResult {
    let snap_cache = cache.get_snap_cache();
    snap_with_cache(x, y, snap_cache, config, exclude_road_id)
}

/// Snap a point to the nearest grid/endpoint/etc.
///
/// Tries each enabled snap type in priority order:
/// 1. Endpoint (highest priority — exact connections)
/// 2. Lane endpoint
/// 3. Midpoint
/// 4. Perpendicular
/// 5. Grid (lowest priority — always available)
pub fn snap_point(
    x: f64,
    y: f64,
    config: &SnapConfig,
    project: &Project,
    exclude_road_id: Option<&str>,
) -> SnapResult {
    let snap_cache = SnapCache::build(&project.roads);
    snap_with_cache(x, y, &snap_cache, config, exclude_road_id)
}

/// Snap a point using a prebuilt [`SnapCache`].
pub fn snap_with_cache(
    x: f64,
    y: f64,
    cache: &SnapCache,
    config: &SnapConfig,
    exclude_road_id: Option<&str>,
) -> SnapResult {
    if let Some(result) =
        cache.query_internal((x, y), config.endpoint_threshold, config, exclude_road_id)
    {
        return result;
    }

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

impl SnapCache {
    /// Build a snap cache from the current road set.
    pub fn build(roads: &[Road]) -> Self {
        let mut cache = Self {
            cell_size: SNAP_CACHE_CELL_SIZE,
            ..Self::default()
        };

        for road in roads.iter().filter(|road| !road.render_hidden) {
            for (index, (x, y)) in get_road_endpoints(road).into_iter().enumerate() {
                let contact_point = if index == 0 { "Start" } else { "End" };
                cache.endpoints.push(SnapCandidate {
                    x,
                    y,
                    snap_type: SnapType::Endpoint,
                    road_id: road.id.clone(),
                    metadata: SnapMetadata {
                        contact_point: Some(contact_point.to_string()),
                        heading: get_road_endpoint_tangent(road, contact_point).map(|tangent| tangent.hdg),
                        ..SnapMetadata::default()
                    },
                });
            }

            for endpoint in get_lane_boundary_endpoints(road) {
                cache.lane_endpoints.push(SnapCandidate {
                    x: endpoint.x,
                    y: endpoint.y,
                    snap_type: SnapType::LaneEndpoint,
                    road_id: road.id.clone(),
                    metadata: SnapMetadata {
                        contact_point: Some(endpoint.contact_point.to_string()),
                        lane_id: Some(endpoint.lane_id),
                        ..SnapMetadata::default()
                    },
                });
            }

            if let Some((x, y)) = get_road_midpoint(road) {
                cache.midpoints.push(SnapCandidate {
                    x,
                    y,
                    snap_type: SnapType::Midpoint,
                    road_id: road.id.clone(),
                    metadata: SnapMetadata::default(),
                });
            }

            for sample in sample_road_reference_line(road, PERPENDICULAR_SAMPLE_STEP) {
                cache.perpendicular_samples.push(SnapCandidate {
                    x: sample.x,
                    y: sample.y,
                    snap_type: SnapType::Perpendicular,
                    road_id: road.id.clone(),
                    metadata: SnapMetadata {
                        heading: Some(sample.hdg),
                        ..SnapMetadata::default()
                    },
                });
            }
        }

        cache.rebuild_grid();
        cache
    }

    /// Query nearby cached snap candidates and return the best enabled hit.
    pub fn query(
        &self,
        pos: (f64, f64),
        threshold: f64,
        config: &SnapConfig,
    ) -> Option<SnapResult> {
        self.query_internal(pos, threshold, config, None)
    }

    fn query_internal(
        &self,
        pos: (f64, f64),
        threshold: f64,
        config: &SnapConfig,
        exclude_road_id: Option<&str>,
    ) -> Option<SnapResult> {
        let nearby = self.nearby_indices(pos, threshold);

        if config.endpoint_enabled
            && let Some(result) =
                self.find_best_candidate(&nearby, pos, threshold, SnapType::Endpoint, exclude_road_id)
        {
            return Some(result);
        }

        if config.snap_to_lane_endpoints
            && let Some(result) = self.find_best_candidate(
                &nearby,
                pos,
                threshold,
                SnapType::LaneEndpoint,
                exclude_road_id,
            )
        {
            return Some(result);
        }

        if config.midpoint_enabled
            && let Some(result) =
                self.find_best_candidate(&nearby, pos, threshold, SnapType::Midpoint, exclude_road_id)
        {
            return Some(result);
        }

        if config.perpendicular_enabled
            && let Some(result) = self.find_best_candidate(
                &nearby,
                pos,
                threshold,
                SnapType::Perpendicular,
                exclude_road_id,
            )
        {
            return Some(result);
        }

        None
    }

    fn find_best_candidate(
        &self,
        indices: &[usize],
        pos: (f64, f64),
        threshold: f64,
        snap_type: SnapType,
        exclude_road_id: Option<&str>,
    ) -> Option<SnapResult> {
        let mut best_dist_sq = threshold * threshold;
        let mut best: Option<SnapResult> = None;

        for &index in indices {
            let Some(candidate) = self.candidate_by_index(index) else {
                continue;
            };
            if candidate.snap_type != snap_type || exclude_road_id == Some(candidate.road_id.as_str()) {
                continue;
            }

            let dx = pos.0 - candidate.x;
            let dy = pos.1 - candidate.y;
            let dist_sq = dx * dx + dy * dy;
            if dist_sq < best_dist_sq {
                best_dist_sq = dist_sq;
                best = Some(SnapResult {
                    x: candidate.x,
                    y: candidate.y,
                    snapped: true,
                    snap_type,
                    target_id: Some(candidate.road_id.clone()),
                    contact_point: candidate.metadata.contact_point.clone(),
                });
            }
        }

        best
    }

    fn rebuild_grid(&mut self) {
        self.grid.clear();

        let mut next_index = 0;
        next_index = Self::insert_group(
            &mut self.grid,
            self.cell_size,
            next_index,
            &self.endpoints,
        );
        next_index = Self::insert_group(
            &mut self.grid,
            self.cell_size,
            next_index,
            &self.lane_endpoints,
        );
        next_index = Self::insert_group(
            &mut self.grid,
            self.cell_size,
            next_index,
            &self.midpoints,
        );
        let _ = Self::insert_group(
            &mut self.grid,
            self.cell_size,
            next_index,
            &self.perpendicular_samples,
        );
    }

    fn insert_group(
        grid: &mut HashMap<(i32, i32), Vec<usize>>,
        cell_size: f64,
        start_index: usize,
        candidates: &[SnapCandidate],
    ) -> usize {
        for (offset, candidate) in candidates.iter().enumerate() {
            let key = Self::cell_key(candidate.x, candidate.y, cell_size);
            grid.entry(key).or_default().push(start_index + offset);
        }
        start_index + candidates.len()
    }

    fn nearby_indices(&self, pos: (f64, f64), threshold: f64) -> Vec<usize> {
        let (cx, cy) = Self::cell_key(pos.0, pos.1, self.cell_size);
        let search_radius = (threshold.max(0.0) / self.cell_size).ceil() as i32;
        let mut indices = Vec::new();

        for dx in -search_radius..=search_radius {
            for dy in -search_radius..=search_radius {
                if let Some(bucket) = self.grid.get(&(cx + dx, cy + dy)) {
                    indices.extend(bucket.iter().copied());
                }
            }
        }

        indices
    }

    fn candidate_by_index(&self, index: usize) -> Option<&SnapCandidate> {
        if index < self.endpoints.len() {
            return self.endpoints.get(index);
        }
        let index = index - self.endpoints.len();

        if index < self.lane_endpoints.len() {
            return self.lane_endpoints.get(index);
        }
        let index = index - self.lane_endpoints.len();

        if index < self.midpoints.len() {
            return self.midpoints.get(index);
        }
        self.perpendicular_samples
            .get(index - self.midpoints.len())
    }

    fn cell_key(x: f64, y: f64, cell_size: f64) -> (i32, i32) {
        (
            (x / cell_size).floor() as i32,
            (y / cell_size).floor() as i32,
        )
    }
}

struct LaneEndpointCandidate {
    x: f64,
    y: f64,
    lane_id: i32,
    contact_point: &'static str,
}

fn get_lane_boundary_endpoints(road: &Road) -> Vec<LaneEndpointCandidate> {
    let mut endpoints = Vec::new();

    for (section_index, section) in road.lane_sections.iter().enumerate() {
        if section.render_hidden {
            continue;
        }

        let section_end = road
            .lane_sections
            .get(section_index + 1)
            .map(|next| next.s)
            .unwrap_or(road.length);
        let section_len = (section_end - section.s).max(0.0);

        for lane in section.left.iter().chain(section.right.iter()) {
            if lane.render_hidden {
                continue;
            }

            if let Some(endpoint) = lane_boundary_endpoint_at(road, section, lane.id, 0.0, "Start") {
                endpoints.push(endpoint);
            }

            if section_len > 1e-9
                && let Some(endpoint) =
                    lane_boundary_endpoint_at(road, section, lane.id, section_len, "End")
            {
                endpoints.push(endpoint);
            }
        }
    }

    endpoints
}

fn lane_boundary_endpoint_at(
    road: &Road,
    section: &LaneSection,
    lane_id: i32,
    ds: f64,
    contact_point: &'static str,
) -> Option<LaneEndpointCandidate> {
    let s = (section.s + ds).clamp(0.0, road.length);
    let ref_pt = evaluate_road_at_s(road, s)?;
    let t = compute_lane_outer_offset(section, lane_id, ds);
    let (x, y, _) = offset_point(&ref_pt, t, 0.0);

    Some(LaneEndpointCandidate {
        x,
        y,
        lane_id,
        contact_point,
    })
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
    use crate::lane_ops::generate_default_lane_section;
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

    fn make_multisection_road(id: &str) -> Road {
        let mut road = make_road_at(id, 0.0, 0.0, 100.0);
        road.lane_sections = vec![
            generate_default_lane_section(0.0, 1, 3.5, false),
            generate_default_lane_section(50.0, 1, 5.0, false),
        ];
        road
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
        assert!(!config.snap_to_lane_endpoints);
        assert_eq!(config.grid_size, 1.0);
    }

    #[test]
    fn test_snap_cache_builds_expected_candidates() {
        let mut project = Project::default();
        project.roads.push(make_multisection_road("r1"));
        let cache = SnapCache::build(&project.roads);

        assert_eq!(cache.endpoints.len(), 2);
        assert!(!cache.lane_endpoints.is_empty());
        assert_eq!(cache.midpoints.len(), 1);
        assert!(!cache.perpendicular_samples.is_empty());
        assert!(!cache.grid.is_empty());
    }

    #[test]
    fn test_snap_with_cache_respects_exclusion() {
        let mut project = Project::default();
        project.roads.push(make_road_at("r1", 0.0, 0.0, 50.0));
        let cache = SnapCache::build(&project.roads);
        let config = SnapConfig {
            endpoint_enabled: true,
            endpoint_threshold: 5.0,
            grid_enabled: false,
            ..Default::default()
        };

        let result = snap_with_cache(1.0, 0.5, &cache, &config, Some("r1"));
        assert!(!result.snapped);
        assert_eq!(result.snap_type, SnapType::None);
    }

    #[test]
    fn test_snap_to_lane_endpoint() {
        let mut project = Project::default();
        project.roads.push(make_multisection_road("r1"));
        let config = SnapConfig {
            endpoint_enabled: false,
            snap_to_lane_endpoints: true,
            endpoint_threshold: 2.0,
            grid_enabled: false,
            ..Default::default()
        };

        let result = snap_point(50.2, 4.8, &config, &project, None);
        assert!(result.snapped);
        assert_eq!(result.snap_type, SnapType::LaneEndpoint);
        assert!((result.x - 50.0).abs() < 1e-6);
        assert!((result.y - 5.0).abs() < 1e-6);
        assert_eq!(result.target_id.as_deref(), Some("r1"));
        assert_eq!(result.contact_point.as_deref(), Some("Start"));
    }

    #[test]
    fn test_snap_lane_endpoint_priority_over_midpoint() {
        let mut project = Project::default();
        project.roads.push(make_multisection_road("r1"));
        let config = SnapConfig {
            endpoint_enabled: false,
            snap_to_lane_endpoints: true,
            midpoint_enabled: true,
            endpoint_threshold: 6.0,
            grid_enabled: false,
            ..Default::default()
        };

        let result = snap_point(50.1, 4.9, &config, &project, None);
        assert!(result.snapped);
        assert_eq!(result.snap_type, SnapType::LaneEndpoint);
        assert_eq!(result.contact_point.as_deref(), Some("Start"));
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
