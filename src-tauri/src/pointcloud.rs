//! Tauri IPC commands for the point cloud → vector pipeline.
//!
//! Loaded clouds can be large, so rather than serialising the full cloud across
//! the IPC boundary, clouds are kept in a backend store keyed by an opaque
//! `handle`. The frontend loads a cloud once, then passes the handle to
//! subsequent operations (render buffer, ground/marking extraction, vectorize).

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use serde_json::Value;
use tauri::State;
use we_core::pointcloud::{
    ColorMode, GroundConfig, Heightmap, MarkingConfig, PointCloud, VectorizeConfig,
    build_render_buffer, extract_ground, extract_markings, polylines_to_roads,
};
use we_native::pointcloud::load_point_cloud as native_load;

/// A registered cloud plus any derived ground heightmap.
struct Entry {
    cloud: PointCloud,
    heightmap: Option<Heightmap>,
}

/// Backend store of loaded point clouds, shared as Tauri managed state.
#[derive(Default)]
pub struct PointCloudStore {
    inner: Mutex<StoreInner>,
}

#[derive(Default)]
struct StoreInner {
    entries: HashMap<u32, Entry>,
    next_handle: u32,
}

impl PointCloudStore {
    fn insert(&self, cloud: PointCloud) -> u32 {
        let mut inner = self.inner.lock().expect("point cloud store poisoned");
        inner.next_handle = inner.next_handle.wrapping_add(1).max(1);
        let handle = inner.next_handle;
        inner.entries.insert(
            handle,
            Entry {
                cloud,
                heightmap: None,
            },
        );
        handle
    }
}

/// Parse a JSON config string, defaulting to `Default` when empty.
fn parse_config<T>(json: &str) -> Result<T, String>
where
    T: serde::de::DeserializeOwned + Default,
{
    if json.trim().is_empty() {
        Ok(T::default())
    } else {
        serde_json::from_str(json).map_err(|e| e.to_string())
    }
}

/// Build the `{ handle, summary }` JSON returned after loading.
fn load_response(store: &PointCloudStore, cloud: PointCloud) -> Value {
    let b = cloud.bounds();
    let summary = serde_json::json!({
        "count": cloud.len(),
        "origin": cloud.origin(),
        "min": b.min,
        "max": b.max,
        "has_intensity": cloud.has_intensity(),
        "has_rgb": cloud.has_rgb(),
        "has_heightmap": false,
    });
    let handle = store.insert(cloud);
    serde_json::json!({ "handle": handle, "summary": summary })
}

/// Load a single point cloud file (PCD/PLY/XYZ/LAS/LAZ) from disk.
///
/// `voxel_size` (> 0) voxel-downsamples the cloud to bound memory. Returns
/// `{ handle, summary }`.
#[tauri::command]
pub fn point_cloud_load(
    path: String,
    voxel_size: Option<f64>,
    store: State<'_, PointCloudStore>,
) -> Result<Value, String> {
    let cloud = native_load(Path::new(&path), voxel_size).map_err(|e| e.to_string())?;
    Ok(load_response(&store, cloud))
}

/// Load and merge every supported point cloud in a directory (tiled datasets).
#[tauri::command]
pub fn point_cloud_load_dir(
    path: String,
    voxel_size: Option<f64>,
    store: State<'_, PointCloudStore>,
) -> Result<Value, String> {
    let cloud = we_native::pointcloud::load_point_cloud_dir(Path::new(&path), voxel_size)
        .map_err(|e| e.to_string())?;
    Ok(load_response(&store, cloud))
}

/// Free a registered cloud and any derived data.
#[tauri::command]
pub fn point_cloud_free(handle: u32, store: State<'_, PointCloudStore>) {
    let mut inner = store.inner.lock().expect("point cloud store poisoned");
    inner.entries.remove(&handle);
}

/// Build an interleaved render buffer `[x, y, z, r, g, b, ...]` (local coords).
/// Returns raw bytes (transmuted from `Vec<f32>`) to avoid JSON-serialising
/// millions of floats through Tauri IPC — binary transfer is ~100× faster.
#[tauri::command]
pub fn point_cloud_render_buffer(
    handle: u32,
    color_mode: String,
    max_points: u32,
    store: State<'_, PointCloudStore>,
) -> Result<Vec<u8>, String> {
    let inner = store.inner.lock().expect("point cloud store poisoned");
    let entry = inner
        .entries
        .get(&handle)
        .ok_or("invalid point cloud handle")?;
    let mode = ColorMode::from_str_or_elevation(&color_mode);
    let floats = build_render_buffer(&entry.cloud, mode, max_points as usize);
    // SAFETY: Vec<f32> → Vec<u8> reinterpretation. f32 is 4 bytes, no alignment issues
    // since u8 has alignment 1. We consume the original Vec to avoid double-free.
    let bytes = unsafe {
        let len = floats.len() * 4;
        let cap = floats.capacity() * 4;
        let ptr = floats.as_ptr() as *mut u8;
        std::mem::forget(floats);
        Vec::from_raw_parts(ptr, len, cap)
    };
    Ok(bytes)
}

/// Extract ground points + heightmap, caching the heightmap on the handle.
#[tauri::command]
pub fn point_cloud_extract_ground(
    handle: u32,
    config_json: String,
    store: State<'_, PointCloudStore>,
) -> Result<Value, String> {
    let config: GroundConfig = parse_config(&config_json)?;
    let mut inner = store.inner.lock().expect("point cloud store poisoned");
    let entry = inner
        .entries
        .get_mut(&handle)
        .ok_or("invalid point cloud handle")?;
    let result = extract_ground(&entry.cloud, &config);
    entry.heightmap = Some(result.heightmap.clone());
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

/// Extract candidate marking polylines (local coords).
#[tauri::command]
pub fn point_cloud_extract_markings(
    handle: u32,
    config_json: String,
    store: State<'_, PointCloudStore>,
) -> Result<Value, String> {
    let config: MarkingConfig = parse_config(&config_json)?;
    let inner = store.inner.lock().expect("point cloud store poisoned");
    let entry = inner
        .entries
        .get(&handle)
        .ok_or("invalid point cloud handle")?;
    let lines = extract_markings(&entry.cloud, &config);
    serde_json::to_value(&lines).map_err(|e| e.to_string())
}

/// Convert polylines (local coords) into roads, optionally snapping elevation
/// to the cached ground heightmap.
#[tauri::command]
pub fn point_cloud_vectorize(
    handle: u32,
    polylines_json: String,
    config_json: String,
    use_ground: bool,
    store: State<'_, PointCloudStore>,
) -> Result<Value, String> {
    let polylines: Vec<Vec<[f64; 3]>> =
        serde_json::from_str(&polylines_json).map_err(|e| e.to_string())?;
    let config: VectorizeConfig = parse_config(&config_json)?;
    let inner = store.inner.lock().expect("point cloud store poisoned");
    let entry = inner
        .entries
        .get(&handle)
        .ok_or("invalid point cloud handle")?;
    let heightmap = if use_ground {
        entry.heightmap.as_ref()
    } else {
        None
    };
    let roads = polylines_to_roads("pc_road_", &polylines, &config, heightmap);
    serde_json::to_value(&roads).map_err(|e| e.to_string())
}

/// Sample the cached ground heightmap at local XY (or `null`).
#[tauri::command]
pub fn point_cloud_sample_ground(
    handle: u32,
    x: f64,
    y: f64,
    store: State<'_, PointCloudStore>,
) -> Option<f64> {
    let inner = store.inner.lock().ok()?;
    let entry = inner.entries.get(&handle)?;
    entry.heightmap.as_ref()?.sample(x, y).map(|z| z as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_store_insert_assigns_unique_handles() {
        let store = PointCloudStore::default();
        let h1 = store.insert(PointCloud::new());
        let h2 = store.insert(PointCloud::new());
        assert_ne!(h1, h2);
        assert!(h1 >= 1 && h2 >= 1);
    }

    #[test]
    fn test_parse_config_empty_returns_default() {
        let cfg: VectorizeConfig = parse_config("").unwrap();
        assert_eq!(cfg.lane_width, VectorizeConfig::default().lane_width);
    }

    #[test]
    fn test_parse_config_invalid_errors() {
        let r: Result<GroundConfig, String> = parse_config("{ not json");
        assert!(r.is_err());
    }

    #[test]
    fn test_load_response_shape() {
        let store = PointCloudStore::default();
        let mut cloud = PointCloud::new();
        cloud.push([0.0, 0.0, 0.0], None, None);
        let resp = load_response(&store, cloud);
        assert!(resp.get("handle").is_some());
        assert_eq!(resp["summary"]["count"], 1);
    }
}
