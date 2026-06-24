//! Lightweight spatial index for fast road/junction lookup.
//!
//! Uses a simple grid (uniform spatial hash) for O(1) average
//! lookups by position. No external dependencies — fully WASM compatible.

use crate::geometry::eval::sample_road_reference_line;
use crate::model::Project;
use crate::snapping::SnapCache;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

const DEFAULT_CELL_SIZE: f64 = 100.0;

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
#[derive(Debug, Clone)]
pub struct SpatialIndex {
    cell_size: f64,
    grid: HashMap<CellKey, Vec<usize>>,
    entries: Vec<SpatialEntry>,
    /// O(1) ID-to-index lookup.
    id_index: HashMap<String, usize>,
}

impl SpatialIndex {
    /// Build a spatial index from a project.
    ///
    /// `cell_size` controls the grid resolution. A typical value is 50–200 meters.
    pub fn build(project: &Project, cell_size: f64) -> Self {
        let cell_size = cell_size.max(1.0); // prevent degenerate cells
        let mut entries = Vec::new();
        let mut grid: HashMap<CellKey, Vec<usize>> = HashMap::new();
        let mut id_index: HashMap<String, usize> = HashMap::new();

        // Index roads
        for road in &project.roads {
            if let Some(aabb) = compute_road_aabb(road) {
                let idx = entries.len();
                id_index.insert(road.id.clone(), idx);
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
                id_index.insert(junction.id.clone(), idx);
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
            id_index,
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

        let mut seen = HashSet::new();
        let mut results = Vec::new();

        for cx in min_cx..=max_cx {
            for cy in min_cy..=max_cy {
                let key = CellKey { cx, cy };
                if let Some(indices) = self.grid.get(&key) {
                    for &idx in indices {
                        if !seen.insert(idx) {
                            continue;
                        }
                        let entry = &self.entries[idx];
                        if entry.aabb.intersects(region) {
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
    ///
    /// Uses a HashMap lookup for O(1) average access instead of linear scan.
    pub fn get_aabb(&self, id: &str) -> Option<Aabb> {
        self.id_index.get(id).map(|&idx| self.entries[idx].aabb)
    }

    /// Incrementally move an already-indexed element to a new bounding box.
    ///
    /// Removes the element's index from every grid cell its **old** box covered
    /// and re-inserts it into the cells its **new** box covers, keeping the
    /// stable entry index (and therefore all other entries) untouched.
    ///
    /// Returns `true` if the element existed and was updated, `false` otherwise.
    /// Use a full [`Self::build`] when elements are **added** or **removed**.
    ///
    /// Cost is O(k) where k = number of grid cells the old and new boxes cover,
    /// versus O(N) for a full rebuild.
    pub fn update_entry(&mut self, id: &str, new_aabb: Aabb) -> bool {
        let Some(&idx) = self.id_index.get(id) else {
            return false;
        };
        let old_aabb = self.entries[idx].aabb;
        remove_from_grid(&mut self.grid, idx, &old_aabb, self.cell_size);
        self.entries[idx].aabb = new_aabb;
        insert_into_grid(&mut self.grid, idx, &new_aabb, self.cell_size);
        true
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

/// A wrapper around [`Project`] that caches the [`SpatialIndex`] and [`SnapCache`].
///
/// Call [`Self::invalidate()`] after mutating `project.roads` or `project.junctions`.
/// Subsequent calls to [`Self::get_index()`] and [`Self::get_snap_cache()`] will rebuild
/// only when dirty.
///
/// # WASM compatibility
/// The cache fields are **not** serialized (`#[serde(skip)]`), so this type
/// remains fully WASM / serde compatible.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProjectCache {
    pub project: Project,
    #[serde(skip)]
    pub(crate) spatial_index: Option<SpatialIndex>,
    #[serde(skip)]
    spatial_index_dirty: bool,
    #[serde(skip)]
    snap_cache: Option<SnapCache>,
    #[serde(skip)]
    snap_cache_dirty: bool,
    /// Per-road incremental-update queue. When non-empty (and a full rebuild is
    /// not already pending) [`Self::get_index`] patches just these roads.
    #[serde(skip)]
    dirty_road_ids: HashSet<String>,
}

impl ProjectCache {
    /// Create a new cache wrapping the given project.
    /// The spatial index is initially dirty and will be built on first access.
    pub fn new(project: Project) -> Self {
        Self {
            project,
            spatial_index: None,
            spatial_index_dirty: true,
            snap_cache: None,
            snap_cache_dirty: true,
            dirty_road_ids: HashSet::new(),
        }
    }

    /// Mark the cached spatial and snap indices as needing a rebuild.
    /// Call this after any mutation to `project.roads` or `project.junctions`.
    pub fn invalidate(&mut self) {
        self.spatial_index_dirty = true;
        self.snap_cache_dirty = true;
        self.dirty_road_ids.clear();
    }

    /// Signal that a single road changed in place, enabling an **incremental**
    /// spatial-index update on the next [`Self::get_index`] call.
    ///
    /// This is the fast path for drag-edit: only the moved road (and any
    /// junctions that reference it) are re-boxed, instead of rebuilding the
    /// whole index. Adding or removing a road is handled transparently by
    /// falling back to a full rebuild.
    ///
    /// The snap cache is still fully rebuilt, since it has no incremental path.
    pub fn invalidate_road(&mut self, road_id: &str) {
        self.snap_cache_dirty = true;
        // A full rebuild is already pending (or no index exists yet): the road
        // will be picked up by the next full build, so don't bother tracking.
        if self.spatial_index_dirty || self.spatial_index.is_none() {
            return;
        }
        self.dirty_road_ids.insert(road_id.to_string());
    }

    /// Get a reference to the spatial index, rebuilding it only when dirty.
    /// Returns `None` if the index could not be built (e.g. empty project).
    pub fn get_index(&mut self) -> Option<&SpatialIndex> {
        if self.spatial_index_dirty || self.spatial_index.is_none() {
            self.spatial_index = Some(SpatialIndex::build(&self.project, DEFAULT_CELL_SIZE));
            self.spatial_index_dirty = false;
            self.dirty_road_ids.clear();
        } else if !self.dirty_road_ids.is_empty() {
            self.apply_incremental_road_updates();
        }
        self.spatial_index.as_ref()
    }

    /// Apply queued per-road updates incrementally, falling back to a full
    /// rebuild if any road was added, removed, or became un-indexable.
    fn apply_incremental_road_updates(&mut self) {
        let dirty = std::mem::take(&mut self.dirty_road_ids);
        let index = match self.spatial_index.as_ref() {
            Some(idx) => idx,
            None => return,
        };

        // Collect new boxes first (immutable borrows), then apply them.
        let mut updates: Vec<(String, Aabb)> = Vec::new();
        let mut need_full = false;

        'outer: for rid in &dirty {
            match (
                self.project.roads.iter().find(|r| &r.id == rid),
                index.get_aabb(rid),
            ) {
                // Road still present and already indexed: re-box it.
                (Some(road), Some(_)) => match compute_road_aabb(road) {
                    Some(aabb) => updates.push((rid.clone(), aabb)),
                    // Became degenerate (no samples): needs structural change.
                    None => {
                        need_full = true;
                        break;
                    }
                },
                // Added (not yet indexed) or removed (still indexed): structural.
                _ => {
                    need_full = true;
                    break;
                }
            }

            // A moved road can resize any junction that references it.
            for junction in &self.project.junctions {
                let references = junction
                    .connections
                    .iter()
                    .any(|c| &c.connecting_road == rid || &c.incoming_road == rid);
                if !references {
                    continue;
                }
                match (
                    index.get_aabb(&junction.id),
                    compute_junction_aabb(&self.project, junction),
                ) {
                    (Some(_), Some(jaabb)) => updates.push((junction.id.clone(), jaabb)),
                    _ => {
                        need_full = true;
                        break 'outer;
                    }
                }
            }
        }

        if need_full {
            self.spatial_index = Some(SpatialIndex::build(&self.project, DEFAULT_CELL_SIZE));
        } else if let Some(index) = self.spatial_index.as_mut() {
            for (id, aabb) in updates {
                index.update_entry(&id, aabb);
            }
        }
    }

    /// Get a reference to the cached snap candidate grid, rebuilding it when dirty.
    pub fn get_snap_cache(&mut self) -> &SnapCache {
        if self.snap_cache_dirty || self.snap_cache.is_none() {
            self.snap_cache = Some(SnapCache::build(&self.project.roads));
            self.snap_cache_dirty = false;
        }
        match self.snap_cache.as_ref() {
            Some(cache) => cache,
            None => unreachable!("snap cache should exist after rebuild"),
        }
    }

    /// Get a reference to the underlying project.
    pub fn project(&self) -> &Project {
        &self.project
    }

    /// Get a mutable reference to the underlying project.
    /// **Important:** call [`Self::invalidate()`] after mutating roads/junctions.
    pub fn project_mut(&mut self) -> &mut Project {
        &mut self.project
    }

    /// Whether the cached spatial index needs rebuilding.
    pub fn is_dirty(&self) -> bool {
        self.spatial_index_dirty
    }

    /// Whether a cached spatial index exists.
    pub fn has_index(&self) -> bool {
        self.spatial_index.is_some() && !self.spatial_index_dirty
    }

    /// Whether a cached snap grid exists.
    pub fn has_snap_cache(&self) -> bool {
        self.snap_cache.is_some() && !self.snap_cache_dirty
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
            grid.entry(CellKey { cx, cy }).or_default().push(idx);
        }
    }
}

/// Remove an entry index from every grid cell the given box covers, dropping
/// any cell that becomes empty so the grid does not accumulate dead cells.
fn remove_from_grid(
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
            let key = CellKey { cx, cy };
            let became_empty = if let Some(v) = grid.get_mut(&key) {
                v.retain(|&i| i != idx);
                v.is_empty()
            } else {
                false
            };
            if became_empty {
                grid.remove(&key);
            }
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

fn compute_junction_aabb(project: &Project, junction: &crate::model::Junction) -> Option<Aabb> {
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
    Some(Aabb::new(
        min_x - 5.0,
        min_y - 5.0,
        max_x + 5.0,
        max_y + 5.0,
    ))
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
        project
            .roads
            .push(make_road_at("r3", 1000.0, 1000.0, 100.0));
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

    // ---- ProjectCache tests ----

    #[test]
    fn test_cache_builds_on_first_access() {
        let project = Project::default();
        let mut cache = ProjectCache::new(project);
        assert!(cache.is_dirty());
        assert!(!cache.has_index());
        let _idx = cache.get_index();
        assert!(!cache.is_dirty());
        assert!(cache.has_index());
    }

    #[test]
    fn test_snap_cache_builds_on_first_access() {
        let mut project = Project::default();
        project.roads.push(make_road_at("r1", 0.0, 0.0, 100.0));
        let mut cache = ProjectCache::new(project);
        assert!(!cache.has_snap_cache());
        let snap_cache = cache.get_snap_cache();
        assert_eq!(snap_cache.endpoints.len(), 2);
        assert!(cache.has_snap_cache());
    }

    #[test]
    fn test_cache_skips_rebuild_when_clean() {
        let mut project = Project::default();
        project.roads.push(make_road_at("r1", 0.0, 0.0, 100.0));
        let mut cache = ProjectCache::new(project);
        let first = cache.get_index().unwrap().len();
        // Access again without invalidating — should be same instance
        let second = cache.get_index().unwrap().len();
        assert_eq!(first, second);
        assert!(!cache.is_dirty());
    }

    #[test]
    fn test_cache_rebuilds_after_invalidate() {
        let mut project = Project::default();
        project.roads.push(make_road_at("r1", 0.0, 0.0, 100.0));
        let mut cache = ProjectCache::new(project);
        assert_eq!(cache.get_index().unwrap().len(), 1);
        assert_eq!(cache.get_snap_cache().endpoints.len(), 2);

        // Add a road
        cache
            .project_mut()
            .roads
            .push(make_road_at("r2", 500.0, 500.0, 100.0));
        cache.invalidate();
        assert!(cache.is_dirty());
        assert!(!cache.has_snap_cache());
        assert_eq!(cache.get_index().unwrap().len(), 2);
        assert_eq!(cache.get_snap_cache().endpoints.len(), 4);
    }

    #[test]
    fn test_cache_serde_roundtrip() {
        let mut project = Project::default();
        project.roads.push(make_road_at("r1", 0.0, 0.0, 100.0));
        let mut cache = ProjectCache::new(project);
        cache.get_index();
        cache.get_snap_cache();
        assert!(cache.has_index());
        assert!(cache.has_snap_cache());

        // Serialize and deserialize — caches should be skipped
        let json = serde_json::to_string(&cache).unwrap();
        let mut restored: ProjectCache = serde_json::from_str(&json).unwrap();
        assert!(!restored.has_index());
        assert!(!restored.has_snap_cache());
        // But the caches are still rebuildable
        assert_eq!(restored.get_index().unwrap().len(), 1);
        assert_eq!(restored.get_snap_cache().endpoints.len(), 2);
    }

    // ---- Incremental spatial index update (P1) ----

    /// Sorted (id, kind) pairs from a range query — stable for comparison.
    fn query_ids_sorted(idx: &SpatialIndex, region: &Aabb) -> Vec<String> {
        let mut ids: Vec<String> = idx.query_range(region).into_iter().map(|r| r.id).collect();
        ids.sort();
        ids
    }

    #[test]
    fn test_update_entry_moves_aabb() {
        let mut project = Project::default();
        project.roads.push(make_road_at("r1", 0.0, 0.0, 100.0));
        project.roads.push(make_road_at("r2", 500.0, 500.0, 100.0));
        let mut idx = SpatialIndex::build(&project, 100.0);

        // Move r1 far away.
        let moved = Aabb::new(1000.0, 1000.0, 1100.0, 1010.0);
        assert!(idx.update_entry("r1", moved));

        // No longer found at the old location.
        assert!(idx.query_point(50.0, 0.0, 20.0).is_empty());
        // Found at the new location.
        let hits = idx.query_point(1050.0, 1005.0, 20.0);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "r1");
        // AABB lookup reflects the new box.
        assert_eq!(idx.get_aabb("r1").unwrap().min_x, 1000.0);
    }

    #[test]
    fn test_update_entry_unknown_id_returns_false() {
        let mut project = Project::default();
        project.roads.push(make_road_at("r1", 0.0, 0.0, 100.0));
        let mut idx = SpatialIndex::build(&project, 100.0);
        assert!(!idx.update_entry("ghost", Aabb::new(0.0, 0.0, 1.0, 1.0)));
    }

    #[test]
    fn test_incremental_update_matches_full_rebuild() {
        let mut project = Project::default();
        project.roads.push(make_road_at("r1", 0.0, 0.0, 100.0));
        project.roads.push(make_road_at("r2", 300.0, 0.0, 100.0));
        project.roads.push(make_road_at("r3", 0.0, 300.0, 100.0));
        let mut cache = ProjectCache::new(project);
        // Force a full build first.
        let _ = cache.get_index();

        // Reshape r2 in place (simulate drag-edit).
        if let Some(r2) = cache.project_mut().roads.iter_mut().find(|r| r.id == "r2") {
            r2.plan_view[0].x = 700.0;
            r2.plan_view[0].y = 700.0;
        }
        cache.invalidate_road("r2");
        let incremental = cache.get_index().expect("index").clone();

        // Independent full rebuild of the SAME project.
        let full = SpatialIndex::build(cache.project(), DEFAULT_CELL_SIZE);

        // Same element count.
        assert_eq!(incremental.len(), full.len());
        // Same query results across several probe regions.
        for region in [
            Aabb::new(-50.0, -50.0, 50.0, 50.0),
            Aabb::new(250.0, -50.0, 450.0, 50.0),
            Aabb::new(600.0, 600.0, 800.0, 800.0),
            Aabb::new(-50.0, 250.0, 50.0, 450.0),
        ] {
            assert_eq!(
                query_ids_sorted(&incremental, &region),
                query_ids_sorted(&full, &region),
                "mismatch in region {region:?}"
            );
        }
    }

    #[test]
    fn test_invalidate_road_falls_back_to_full_on_add() {
        let mut project = Project::default();
        project.roads.push(make_road_at("r1", 0.0, 0.0, 100.0));
        let mut cache = ProjectCache::new(project);
        let _ = cache.get_index();

        // Add a brand-new road, then signal it via per-road invalidation.
        cache
            .project_mut()
            .roads
            .push(make_road_at("r2", 500.0, 500.0, 100.0));
        cache.invalidate_road("r2");

        // Even though r2 was not previously indexed, the index must include it.
        assert_eq!(cache.get_index().unwrap().len(), 2);
        assert!(cache.get_index().unwrap().get_aabb("r2").is_some());
    }

    #[test]
    fn test_invalidate_road_falls_back_to_full_on_remove() {
        let mut project = Project::default();
        project.roads.push(make_road_at("r1", 0.0, 0.0, 100.0));
        project.roads.push(make_road_at("r2", 500.0, 500.0, 100.0));
        let mut cache = ProjectCache::new(project);
        let _ = cache.get_index();

        cache.project_mut().roads.retain(|r| r.id != "r2");
        cache.invalidate_road("r2");

        assert_eq!(cache.get_index().unwrap().len(), 1);
        assert!(cache.get_index().unwrap().get_aabb("r2").is_none());
    }
}
