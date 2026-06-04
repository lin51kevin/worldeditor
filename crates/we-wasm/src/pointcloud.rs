//! WASM bindings for the point cloud → vector pipeline.
//!
//! Point clouds can be large, so rather than serializing the full cloud across
//! the JS boundary on every call, loaded clouds are kept in a WASM-side
//! registry keyed by an opaque `handle`. JavaScript loads a cloud once, then
//! passes the handle to subsequent operations (render buffer, ground/marking
//! extraction, vectorization).

use std::cell::RefCell;
use std::collections::HashMap;

use wasm_bindgen::prelude::*;

use we_core::pointcloud::{
    ColorMode, GroundConfig, Heightmap, MarkingConfig, PointCloud, VectorizeConfig,
    build_render_buffer, extract_ground, extract_markings, pcd, ply, polylines_to_roads, xyz,
};

/// A registered cloud plus any derived ground heightmap.
struct Entry {
    cloud: PointCloud,
    heightmap: Option<Heightmap>,
}

thread_local! {
    static REGISTRY: RefCell<HashMap<u32, Entry>> = RefCell::new(HashMap::new());
    static NEXT_HANDLE: RefCell<u32> = const { RefCell::new(1) };
}

fn store(cloud: PointCloud) -> u32 {
    let handle = NEXT_HANDLE.with(|n| {
        let mut n = n.borrow_mut();
        let h = *n;
        *n = n.wrapping_add(1).max(1);
        h
    });
    REGISTRY.with(|r| {
        r.borrow_mut().insert(
            handle,
            Entry {
                cloud,
                heightmap: None,
            },
        )
    });
    handle
}

/// Parse a point cloud file and register it, returning an opaque handle.
///
/// `format` is one of `pcd`, `ply`, `xyz` (case-insensitive). LAS/LAZ are
/// desktop-only and handled natively.
#[wasm_bindgen]
pub fn load_point_cloud(bytes: &[u8], format: &str) -> Result<u32, JsError> {
    let cloud = parse_by_format(bytes, format).map_err(|e| JsError::new(&e))?;
    Ok(store(cloud))
}

/// Dispatch parsing by format name. Returns a plain `String` error so it can be
/// unit-tested on native targets (where `JsError` cannot be constructed).
fn parse_by_format(bytes: &[u8], format: &str) -> Result<PointCloud, String> {
    match format.to_ascii_lowercase().as_str() {
        "pcd" => pcd::parse_pcd(bytes).map_err(|e| e.to_string()),
        "ply" => ply::parse_ply(bytes).map_err(|e| e.to_string()),
        "xyz" | "txt" | "asc" => xyz::parse_xyz(bytes).map_err(|e| e.to_string()),
        other => Err(format!(
            "unsupported point cloud format '{other}' (use pcd/ply/xyz)"
        )),
    }
}

/// Free a registered cloud and any derived data.
#[wasm_bindgen]
pub fn free_point_cloud(handle: u32) {
    REGISTRY.with(|r| r.borrow_mut().remove(&handle));
}

/// Return a JSON summary `{ count, origin, min, max, has_intensity, has_rgb }`.
#[wasm_bindgen]
pub fn point_cloud_summary(handle: u32) -> Result<JsValue, JsError> {
    REGISTRY.with(|r| {
        let map = r.borrow();
        let entry = map
            .get(&handle)
            .ok_or_else(|| JsError::new("invalid point cloud handle"))?;
        let b = entry.cloud.bounds();
        let summary = serde_json::json!({
            "count": entry.cloud.len(),
            "origin": entry.cloud.origin(),
            "min": b.min,
            "max": b.max,
            "has_intensity": entry.cloud.has_intensity(),
            "has_rgb": entry.cloud.has_rgb(),
            "has_heightmap": entry.heightmap.is_some(),
        });
        serde_wasm_bindgen::to_value(&summary).map_err(|e| JsError::new(&e.to_string()))
    })
}

/// Build an interleaved render buffer `[x, y, z, r, g, b, ...]` (local coords,
/// colors `0..1`), decimated to at most `max_points` via stride sampling.
#[wasm_bindgen]
pub fn point_cloud_render_buffer(
    handle: u32,
    color_mode: &str,
    max_points: u32,
) -> Result<Vec<f32>, JsError> {
    REGISTRY.with(|r| {
        let map = r.borrow();
        let entry = map
            .get(&handle)
            .ok_or_else(|| JsError::new("invalid point cloud handle"))?;
        let mode = ColorMode::from_str_or_elevation(color_mode);
        Ok(build_render_buffer(&entry.cloud, mode, max_points as usize))
    })
}

/// Extract ground points + heightmap. Caches the heightmap on the handle for
/// later vectorization/elevation snapping. Returns the [`GroundResult`] as JSON.
#[wasm_bindgen]
pub fn point_cloud_extract_ground(handle: u32, config_json: &str) -> Result<JsValue, JsError> {
    let config: GroundConfig = parse_config(config_json)?;
    REGISTRY.with(|r| {
        let mut map = r.borrow_mut();
        let entry = map
            .get_mut(&handle)
            .ok_or_else(|| JsError::new("invalid point cloud handle"))?;
        let result = extract_ground(&entry.cloud, &config);
        entry.heightmap = Some(result.heightmap.clone());
        serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
    })
}

/// Extract candidate marking polylines (local coords) as JSON `[[ [x,y,z],.. ],..]`.
#[wasm_bindgen]
pub fn point_cloud_extract_markings(handle: u32, config_json: &str) -> Result<JsValue, JsError> {
    let config: MarkingConfig = parse_config(config_json)?;
    REGISTRY.with(|r| {
        let map = r.borrow();
        let entry = map
            .get(&handle)
            .ok_or_else(|| JsError::new("invalid point cloud handle"))?;
        let lines = extract_markings(&entry.cloud, &config);
        serde_wasm_bindgen::to_value(&lines).map_err(|e| JsError::new(&e.to_string()))
    })
}

/// Convert polylines (JSON `[[ [x,y,z],.. ],..]`, local coords) into roads.
///
/// When `use_ground` is true and a ground heightmap was extracted, elevations
/// are snapped to the surface. Returns `Vec<Road>` as JSON.
#[wasm_bindgen]
pub fn point_cloud_vectorize(
    handle: u32,
    polylines_json: &str,
    config_json: &str,
    use_ground: bool,
) -> Result<JsValue, JsError> {
    let polylines: Vec<Vec<[f64; 3]>> =
        serde_json::from_str(polylines_json).map_err(|e| JsError::new(&e.to_string()))?;
    let config: VectorizeConfig = parse_config(config_json)?;
    REGISTRY.with(|r| {
        let map = r.borrow();
        let entry = map
            .get(&handle)
            .ok_or_else(|| JsError::new("invalid point cloud handle"))?;
        let heightmap = if use_ground {
            entry.heightmap.as_ref()
        } else {
            None
        };
        let roads = polylines_to_roads("pc_road_", &polylines, &config, heightmap);
        serde_wasm_bindgen::to_value(&roads).map_err(|e| JsError::new(&e.to_string()))
    })
}

/// Sample the cached ground heightmap at local XY, returning the elevation or
/// `null` when outside the grid / no heightmap available.
#[wasm_bindgen]
pub fn point_cloud_sample_ground(handle: u32, x: f64, y: f64) -> Option<f64> {
    REGISTRY.with(|r| {
        let map = r.borrow();
        let entry = map.get(&handle)?;
        entry.heightmap.as_ref()?.sample(x, y).map(|z| z as f64)
    })
}

/// Parse a JSON config, defaulting to `Default` when the string is empty.
fn parse_config<T>(json: &str) -> Result<T, JsError>
where
    T: serde::de::DeserializeOwned + Default,
{
    if json.trim().is_empty() {
        Ok(T::default())
    } else {
        serde_json::from_str(json).map_err(|e| JsError::new(&e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_and_summary_roundtrip() {
        let pcd = "\
# .PCD v0.7
VERSION 0.7
FIELDS x y z
SIZE 4 4 4
TYPE F F F
COUNT 1 1 1
WIDTH 2
HEIGHT 1
POINTS 2
DATA ascii
0 0 0
1 2 3
";
        let handle = load_point_cloud(pcd.as_bytes(), "pcd").unwrap();
        assert!(handle >= 1);
        let buf = point_cloud_render_buffer(handle, "elevation", 100).unwrap();
        assert_eq!(buf.len(), 12); // 2 points * 6 floats
        free_point_cloud(handle);
    }

    #[test]
    fn test_unsupported_format_errors() {
        assert!(parse_by_format(b"x", "las").is_err());
    }
}
