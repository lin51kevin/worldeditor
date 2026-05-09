//! Lightweight spatial index for fast road/junction lookup.
//!
//! Uses a simple grid (uniform spatial hash) for O(1) average
//! lookups by position. No external dependencies — fully WASM compatible.

use crate::geometry::eval::sample_road_reference_line;
use crate::model::Project;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Axis-aligned bounding box.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Aabb {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

impl Aabb {
    pub fn new(min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> Self {
        Self {
            min_x,
            min_y,
            max_x,
            max_y,
        }
    }

    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.min_x && x <= self.max_x && y >= self.min_y && y <= self.max_y
    }

    pub fn intersects(&self, other: &Aabb) -> bool {
        self.min_x <= other.max_x
            && self.max_x >= other.min_x
            && self.min_y <= other.max_y
            && self.max_y >= other.min_y
    }

    pub fn expand(&self, margin: f64) -> Aabb {
        Aabb {
            min_x: self.min_x - margin,
            min_y: self.min_y - margin,
            max_x: self.max_x + margin,
            max_y: self.max_y + margin,
        }
    }
}

/// An indexed element with its bounding box.
#[derive(Debug, Clone)]
struct SpatialEntry {
    /// Element ID (road or junction).
    id: String,
    /// Element kind.
    kind: ElementKind,
    /// Axis-aligned bounding box.
    aabb: Aabb,
}

/// Kind of spatial element.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ElementKind {
    Road,
    Junction,
}

/// Grid cell key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct CellKey {
    cx: i64,
    cy: i64,
}

/// Spatial query result.
#[derive(Debug, Clone)]
pub struct SpatialQueryResult {
    pub id: String,
    pub kind: ElementKind,
    pub aabb: Aabb,
}

/// Grid-based spatial index for the road network.
///
/// Divides the world into uniform cells. Each cell stores references to
/// elements whose bounding boxes overlap the cell. This gives O(1) average
/// lookup for point queries and O(k) for range queries (k = cells covered).
pub struct SpatialIndex {
    cell_size: f64,
    grid: HashMap<CellKey, Vec<usize>>,
    entries: Vec<SpatialEntry>,
}

impl SpatialIndex {
    /// Build a spatial index from a project.
    ///
    /// `cell_size` controls the grid resolution. A typical value is 50–200 meters.
    pub fn build(project: &Project, cell_size: f64) -> Self {
        let cell_size = cell_size.max(1.0); // prevent degenerate cells
        let mut entries = Vec::new();
        let mut grid: HashMap<CellKey, Vec<usize>> = HashMap::new();

        // Index roads
        for road in &project.roads {
            if let Some(aabb) = compute_road_aabb(road) {
                let idx = entries.len();
                entries.push(SpatialEntry {
                    id: road.id.clone(),
                    kind: ElementKind::Road,
                    aabb,
                });
                insert_into_grid(&mut grid, idx, &aabb, cell_size);
            }
        }

        // Index junctions (using connecting roads' positions)
        for junction in &project.junctions {
            if let Some(aabb) = compute_junction_aabb(project, junction) {
                let idx = entries.len();
                entries.push(SpatialEntry {
                    id: junction.id.clone(),
                    kind: ElementKind::Junction,
                    aabb,
                });
                insert_into_grid(&mut grid, idx, &aabb, cell_size);
            }
        }

        Self {
            cell_size,
            grid,
            entries,
        }
    }

    /// Query elements near a point within a given radius.
    pub fn query_point(&self, x: f64, y: f64, radius: f64) -> Vec<SpatialQueryResult> {
        let search = Aabb::new(x - radius, y - radius, x + radius, y + radius);
        self.query_range(&search)
    }

    /// Query elements whose bounding boxes intersect the given region.
    pub fn query_range(&self, region: &Aabb) -> Vec<SpatialQueryResult> {
        let min_cx = (region.min_x / self.cell_size).floor() as i64;
        let max_cx = (region.max_x / self.cell_size).floor() as i64;
        let min_cy = (region.min_y / self.cell_size).floor() as i64;
        let max_cy = (region.max_y / self.cell_size).floor() as i64;

        let mut seen = Vec::new();
        let mut results = Vec::new();

        for cx in min_cx..=max_cx {
            for cy in min_cy..=max_cy {
                let key = CellKey { cx, cy };
                if let Some(indices) = self.grid.get(&key) {
                    for &idx in indices {
                        if seen.contains(&idx) {
                            continue;
                        }
                        let entry = &self.entries[idx];
                        if entry.aabb.intersects(region) {
                            seen.push(idx);
                            results.push(SpatialQueryResult {
                                id: entry.id.clone(),
                                kind: entry.kind,
                                aabb: entry.aabb,
                            });
                        }
                    }
                }
            }
        }

        results
    }

    /// Get the bounding box of a specific element.
    pub fn get_aabb(&self, id: &str) -> Option<Aabb> {
        self.entries.iter().find(|e| e.id == id).map(|e| e.aabb)
    }

    /// Total number of indexed elements.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the index is empty.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

fn insert_into_grid(
    grid: &mut HashMap<CellKey, Vec<usize>>,
    idx: usize,
    aabb: &Aabb,
    cell_size: f64,
) {
    let min_cx = (aabb.min_x / cell_size).floor() as i64;
    let max_cx = (aabb.max_x / cell_size).floor() as i64;
    let min_cy = (aabb.min_y / cell_size).floor() as i64;
    let max_cy = (aabb.max_y / cell_size).floor() as i64;

    for cx in min_cx..=max_cx {
        for cy in min_cy..=max_cy {
            grid.entry(CellKey { cx, cy })
                .or_default()
                .push(idx);
        }
    }
}

fn compute_road_aabb(road: &crate::model::Road) -> Option<Aabb> {
    let pts = sample_road_reference_line(road, 5.0);
    if pts.is_empty() {
        return None;
    }
    let mut min_x = f64::MAX;
    let mut min_y = f64::MAX;
    let mut max_x = f64::MIN;
    let mut max_y = f64::MIN;
    for pt in &pts {
        min_x = min_x.min(pt.x);
        min_y = min_y.min(pt.y);
        max_x = max_x.max(pt.x);
        max_y = max_y.max(pt.y);
    }
    // Expand by approximate road half-width
    let margin = 10.0;
    Some(Aabb::new(
        min_x - margin,
        min_y - margin,
        max_x + margin,
        max_y + margin,
    ))
}

fn compute_junction_aabb(
    project: &Project,
    junction: &crate::model::Junction,
) -> Option<Aabb> {
    let mut min_x = f64::MAX;
    let mut min_y = f64::MAX;
    let mut max_x = f64::MIN;
    let mut max_y = f64::MIN;
    let mut count = 0;

    for conn in &junction.connections {
        for road_id in [&conn.connecting_road, &conn.incoming_road] {
            if let Some(road) = project.roads.iter().find(|r| r.id == *road_id) {
                let pts = sample_road_reference_line(road, road.length.max(1.0));
                for pt in &pts {
                    min_x = min_x.min(pt.x);
                    min_y = min_y.min(pt.y);
                    max_x = max_x.max(pt.x);
                    max_y = max_y.max(pt.y);
                    count += 1;
                }
            }
        }
    }

    if count == 0 {
        return None;
    }
    Some(Aabb::new(min_x - 5.0, min_y - 5.0, max_x + 5.0, max_y + 5.0))
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
    fn test_build_spatial_index() {
        let mut project = Project::default();
        project.roads.push(make_road_at("r1", 0.0, 0.0, 100.0));
        project.roads.push(make_road_at("r2", 500.0, 500.0, 100.0));
        let idx = SpatialIndex::build(&project, 100.0);
        assert_eq!(idx.len(), 2);
    }

    #[test]
    fn test_query_point_finds_nearby() {
        let mut project = Project::default();
        project.roads.push(make_road_at("r1", 0.0, 0.0, 100.0));
        project.roads.push(make_road_at("r2", 500.0, 500.0, 100.0));
        let idx = SpatialIndex::build(&project, 100.0);
        let results = idx.query_point(50.0, 0.0, 20.0);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "r1");
    }

    #[test]
    fn test_query_point_no_match() {
        let mut project = Project::default();
        project.roads.push(make_road_at("r1", 0.0, 0.0, 100.0));
        let idx = SpatialIndex::build(&project, 100.0);
        let results = idx.query_point(1000.0, 1000.0, 10.0);
        assert!(results.is_empty());
    }

    #[test]
    fn test_query_range() {
        let mut project = Project::default();
        project.roads.push(make_road_at("r1", 0.0, 0.0, 100.0));
        project.roads.push(make_road_at("r2", 200.0, 0.0, 100.0));
        project.roads.push(make_road_at("r3", 1000.0, 1000.0, 100.0));
        let idx = SpatialIndex::build(&project, 100.0);
        let region = Aabb::new(-20.0, -20.0, 320.0, 20.0);
        let results = idx.query_range(&region);
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_aabb_contains() {
        let aabb = Aabb::new(0.0, 0.0, 10.0, 10.0);
        assert!(aabb.contains(5.0, 5.0));
        assert!(!aabb.contains(15.0, 5.0));
    }

    #[test]
    fn test_aabb_intersects() {
        let a = Aabb::new(0.0, 0.0, 10.0, 10.0);
        let b = Aabb::new(5.0, 5.0, 15.0, 15.0);
        let c = Aabb::new(20.0, 20.0, 30.0, 30.0);
        assert!(a.intersects(&b));
        assert!(!a.intersects(&c));
    }

    #[test]
    fn test_get_aabb() {
        let mut project = Project::default();
        project.roads.push(make_road_at("r1", 0.0, 0.0, 100.0));
        let idx = SpatialIndex::build(&project, 100.0);
        assert!(idx.get_aabb("r1").is_some());
        assert!(idx.get_aabb("nonexistent").is_none());
    }

    #[test]
    fn test_empty_project() {
        let project = Project::default();
        let idx = SpatialIndex::build(&project, 100.0);
        assert!(idx.is_empty());
        assert_eq!(idx.len(), 0);
    }
}
