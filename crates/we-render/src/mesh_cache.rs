//! Incremental scene mesh cache.
//!
//! [`generate_road_mesh`] rebuilds a single road's surface from scratch. For
//! large projects, regenerating *every* road on each edit is wasteful — only a
//! handful of roads actually change between frames. [`SceneMeshCache`] keeps a
//! per-road mesh keyed by a content hash and rebuilds only the roads whose
//! mesh-relevant data changed, leaving the rest untouched.
//!
//! The cache is platform-agnostic and fully headless-testable: callers can use
//! [`MeshUpdate`] to learn exactly which roads were rebuilt and upload only the
//! affected GPU buffers.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};

use crate::render_config::RoadRenderConfig;
use crate::road_mesh::generate_road_mesh;
use crate::vertex::ColorVertex;
use we_core::model::{Project, Road};

/// A cached mesh for a single road together with its content hash.
struct RoadMeshEntry {
    hash: u64,
    vertices: Vec<ColorVertex>,
}

/// Report describing what changed during a [`SceneMeshCache::update`].
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct MeshUpdate {
    /// Road ids whose mesh was regenerated (new or changed).
    pub rebuilt: Vec<String>,
    /// Road ids that were reused unchanged from the cache.
    pub unchanged: Vec<String>,
    /// Road ids that were dropped because they left the project.
    pub removed: Vec<String>,
}

impl MeshUpdate {
    /// Total number of roads touched (rebuilt + unchanged).
    pub fn present_count(&self) -> usize {
        self.rebuilt.len() + self.unchanged.len()
    }

    /// Whether anything actually changed (a rebuild or removal occurred).
    pub fn is_dirty(&self) -> bool {
        !self.rebuilt.is_empty() || !self.removed.is_empty()
    }
}

/// Per-road incremental mesh cache.
///
/// Roads are identified by their `id`. A `style_version` guards against
/// configuration changes (colors, alpha, z-offset): when it differs from the
/// cached value the entire cache is invalidated and every road is rebuilt.
#[derive(Default)]
pub struct SceneMeshCache {
    style_version: u64,
    sample_step_bits: u64,
    entries: HashMap<String, RoadMeshEntry>,
    /// Road ids in project order, for deterministic [`SceneMeshCache::combined`].
    order: Vec<String>,
}

impl SceneMeshCache {
    /// Create an empty cache.
    pub fn new() -> Self {
        Self::default()
    }

    /// Synchronize the cache with `project`, rebuilding only changed roads.
    ///
    /// `style_version` should be bumped by the caller whenever `config` changes
    /// in a way that affects mesh output; `sample_step` is the tessellation step
    /// in metres. Both participate in invalidation.
    pub fn update(
        &mut self,
        project: &Project,
        sample_step: f64,
        style_version: u64,
        config: &RoadRenderConfig,
    ) -> MeshUpdate {
        let step_bits = sample_step.to_bits();
        if style_version != self.style_version || step_bits != self.sample_step_bits {
            self.entries.clear();
            self.style_version = style_version;
            self.sample_step_bits = step_bits;
        }

        let mut update = MeshUpdate::default();
        self.order = project.roads.iter().map(|r| r.id.clone()).collect();

        for road in &project.roads {
            let hash = road_mesh_hash(road, sample_step);
            match self.entries.get(&road.id) {
                Some(entry) if entry.hash == hash => {
                    update.unchanged.push(road.id.clone());
                }
                _ => {
                    let vertices = generate_road_mesh(road, sample_step, config);
                    self.entries
                        .insert(road.id.clone(), RoadMeshEntry { hash, vertices });
                    update.rebuilt.push(road.id.clone());
                }
            }
        }

        // Drop roads that are no longer present.
        let present: std::collections::HashSet<&String> =
            project.roads.iter().map(|r| &r.id).collect();
        let stale: Vec<String> = self
            .entries
            .keys()
            .filter(|id| !present.contains(id))
            .cloned()
            .collect();
        for id in stale {
            self.entries.remove(&id);
            update.removed.push(id);
        }
        update.removed.sort();

        update
    }

    /// Cached vertices for a single road, if present.
    pub fn vertices_for(&self, road_id: &str) -> Option<&[ColorVertex]> {
        self.entries.get(road_id).map(|e| e.vertices.as_slice())
    }

    /// Concatenate all cached road meshes in project order.
    pub fn combined(&self) -> Vec<ColorVertex> {
        let mut out = Vec::new();
        for id in &self.order {
            if let Some(entry) = self.entries.get(id) {
                out.extend_from_slice(&entry.vertices);
            }
        }
        out
    }

    /// Number of roads currently cached.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the cache holds no roads.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

/// Compute a stable content hash over the mesh-relevant fields of a road.
///
/// Only geometry, lane layout, elevation, lateral profile and visibility affect
/// the surface mesh; signals, objects and links are deliberately ignored so
/// that editing those does not invalidate the cached surface.
fn road_mesh_hash(road: &Road, sample_step: f64) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    sample_step.to_bits().hash(&mut hasher);
    road.length.to_bits().hash(&mut hasher);
    road.render_hidden.hash(&mut hasher);

    // Serialize the mesh-relevant fields to a canonical byte form. These all
    // derive Serialize in we-core; serializing a tuple of references avoids any
    // allocation of intermediate model copies.
    let view = (
        &road.plan_view,
        &road.lane_offsets,
        &road.lane_sections,
        &road.elevation_profile,
        &road.lateral_profile,
    );
    if let Ok(bytes) = serde_json::to_vec(&view) {
        bytes.hash(&mut hasher);
    }
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use we_core::model::{Geometry, GeometryType, Road};

    fn line_road(id: &str, x: f64, length: f64) -> Road {
        let geo = Geometry {
            s: 0.0,
            x,
            y: 0.0,
            hdg: 0.0,
            length,
            geo_type: GeometryType::Line,
        };
        Road::from_centerline(id, vec![geo])
    }

    fn project_with(roads: Vec<Road>) -> Project {
        Project {
            roads,
            ..Default::default()
        }
    }

    fn cfg() -> RoadRenderConfig {
        RoadRenderConfig::default()
    }

    #[test]
    fn first_update_rebuilds_all_roads() {
        let mut cache = SceneMeshCache::new();
        let project = project_with(vec![line_road("a", 0.0, 50.0), line_road("b", 0.0, 50.0)]);

        let update = cache.update(&project, 10.0, 1, &cfg());

        assert_eq!(update.rebuilt.len(), 2);
        assert!(update.unchanged.is_empty());
        assert!(update.removed.is_empty());
        assert_eq!(cache.len(), 2);
        assert!(!cache.combined().is_empty());
    }

    #[test]
    fn unchanged_project_rebuilds_nothing() {
        let mut cache = SceneMeshCache::new();
        let project = project_with(vec![line_road("a", 0.0, 50.0), line_road("b", 0.0, 50.0)]);

        cache.update(&project, 10.0, 1, &cfg());
        let first = cache.combined();
        let update = cache.update(&project, 10.0, 1, &cfg());

        assert!(update.rebuilt.is_empty(), "nothing should be rebuilt");
        assert_eq!(update.unchanged.len(), 2);
        assert!(!update.is_dirty());
        assert_eq!(first.len(), cache.combined().len());
    }

    #[test]
    fn editing_one_road_rebuilds_only_that_road() {
        let mut cache = SceneMeshCache::new();
        let project = project_with(vec![line_road("a", 0.0, 50.0), line_road("b", 0.0, 50.0)]);
        cache.update(&project, 10.0, 1, &cfg());

        // Change only road "b"'s geometry length.
        let edited = project_with(vec![line_road("a", 0.0, 50.0), line_road("b", 0.0, 80.0)]);
        let update = cache.update(&edited, 10.0, 1, &cfg());

        assert_eq!(update.rebuilt, vec!["b".to_string()]);
        assert_eq!(update.unchanged, vec!["a".to_string()]);
        assert!(update.is_dirty());
    }

    #[test]
    fn removing_a_road_drops_it_from_cache() {
        let mut cache = SceneMeshCache::new();
        let project = project_with(vec![line_road("a", 0.0, 50.0), line_road("b", 0.0, 50.0)]);
        cache.update(&project, 10.0, 1, &cfg());

        let smaller = project_with(vec![line_road("a", 0.0, 50.0)]);
        let update = cache.update(&smaller, 10.0, 1, &cfg());

        assert_eq!(update.removed, vec!["b".to_string()]);
        assert_eq!(update.unchanged, vec!["a".to_string()]);
        assert!(cache.vertices_for("b").is_none());
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn adding_a_road_rebuilds_only_the_new_one() {
        let mut cache = SceneMeshCache::new();
        let project = project_with(vec![line_road("a", 0.0, 50.0)]);
        cache.update(&project, 10.0, 1, &cfg());

        let bigger = project_with(vec![line_road("a", 0.0, 50.0), line_road("c", 0.0, 50.0)]);
        let update = cache.update(&bigger, 10.0, 1, &cfg());

        assert_eq!(update.rebuilt, vec!["c".to_string()]);
        assert_eq!(update.unchanged, vec!["a".to_string()]);
        assert_eq!(cache.len(), 2);
    }

    #[test]
    fn bumping_style_version_rebuilds_everything() {
        let mut cache = SceneMeshCache::new();
        let project = project_with(vec![line_road("a", 0.0, 50.0), line_road("b", 0.0, 50.0)]);
        cache.update(&project, 10.0, 1, &cfg());

        let update = cache.update(&project, 10.0, 2, &cfg());

        assert_eq!(update.rebuilt.len(), 2);
        assert!(update.unchanged.is_empty());
    }

    #[test]
    fn changing_sample_step_rebuilds_everything() {
        let mut cache = SceneMeshCache::new();
        let project = project_with(vec![line_road("a", 0.0, 50.0)]);
        cache.update(&project, 10.0, 1, &cfg());

        let update = cache.update(&project, 5.0, 1, &cfg());
        assert_eq!(update.rebuilt, vec!["a".to_string()]);
    }

    #[test]
    fn combined_preserves_project_order() {
        let mut cache = SceneMeshCache::new();
        let project = project_with(vec![line_road("a", 0.0, 50.0), line_road("b", 100.0, 50.0)]);
        cache.update(&project, 10.0, 1, &cfg());

        let a = cache.vertices_for("a").unwrap().len();
        let combined = cache.combined();
        // Combined must start with road "a"'s vertices.
        let head_positions: Vec<[f32; 3]> = combined[..a].iter().map(|v| v.position).collect();
        let a_positions: Vec<[f32; 3]> = cache
            .vertices_for("a")
            .unwrap()
            .iter()
            .map(|v| v.position)
            .collect();
        assert_eq!(head_positions, a_positions);
    }
}
