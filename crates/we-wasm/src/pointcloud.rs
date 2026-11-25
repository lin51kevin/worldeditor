//! WASM bindings for the point cloud → vector pipeline.
//!
//! Point clouds can be large, so rather than serializing the full cloud across
//! the JS boundary on every call, loaded clouds are kept in a WASM-side
//! registry keyed by an opaque `handle`. JavaScript loads a cloud once, then
//! passes the handle to subsequent operations (render buffer, ground/marking
//! extraction, vectorization).

use std::cell::RefCell;
use std::collections::HashMap;

use serde::Serialize;
use wasm_bindgen::prelude::*;

use we_core::pointcloud::{
    ColorMode, GroundConfig, Heightmap, MarkingConfig, PACKED_GAUSSIAN_LAYOUT_NAME,
    PackedGaussians, PointCloud, SogImage, SogMeta, VectorizeConfig, build_render_buffer,
    decode_sog_packed, decode_webp_rgba, extract_ground, extract_markings, gaussian, pcd, ply,
    polylines_to_roads, xyz,
};

/// A SOG dataset waiting for its images: parsed `meta.json` plus decoded pixels by file name.
struct PendingSog {
    meta: SogMeta,
    images: HashMap<String, SogImage>,
}

/// A registered cloud plus any derived ground heightmap.
struct Entry {
    cloud: PointCloud,
    heightmap: Option<Heightmap>,
}

thread_local! {
    static REGISTRY: RefCell<HashMap<u32, Entry>> = RefCell::new(HashMap::new());
    static NEXT_HANDLE: RefCell<u32> = const { RefCell::new(1) };
    static GAUSSIAN_REGISTRY: RefCell<HashMap<u32, PackedGaussians>> = RefCell::new(HashMap::new());
    static NEXT_GAUSSIAN_HANDLE: RefCell<u32> = const { RefCell::new(1) };
    static SOG_REGISTRY: RefCell<HashMap<u32, PendingSog>> = RefCell::new(HashMap::new());
    static NEXT_SOG_HANDLE: RefCell<u32> = const { RefCell::new(1) };
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
        // Serialize maps as plain JS objects (not ES `Map`s) so callers can read
        // fields via property access (`summary.count`) rather than `.get()`.
        summary
            .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
            .map_err(|e| JsError::new(&e.to_string()))
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

// ---------------------------------------------------------------------------
// 3D Gaussian Splatting bindings
// ---------------------------------------------------------------------------

fn store_gaussian(cloud: PackedGaussians) -> u32 {
    let handle = NEXT_GAUSSIAN_HANDLE.with(|n| {
        let mut n = n.borrow_mut();
        let h = *n;
        *n = n.wrapping_add(1).max(1);
        h
    });
    GAUSSIAN_REGISTRY.with(|r| r.borrow_mut().insert(handle, cloud));
    handle
}

/// Parse a 3D Gaussian Splatting PLY and register it, returning an opaque handle.
///
/// Native-testable error variant returns a plain `String`.
fn parse_gaussian(bytes: &[u8], max_splats: Option<usize>) -> Result<PackedGaussians, String> {
    gaussian::parse_gaussian_ply_packed(bytes, max_splats).map_err(|e| e.to_string())
}

/// Load a 3D Gaussian Splatting PLY, returning an opaque handle.
///
/// `max_splats` (when set) caps the parsed splat count via uniform stride
/// sampling, bounding heap use for very large clouds. Pass `undefined`/`null`
/// to keep every splat.
#[wasm_bindgen]
pub fn load_gaussian_splats(bytes: &[u8], max_splats: Option<u32>) -> Result<u32, JsError> {
    let cloud =
        parse_gaussian(bytes, max_splats.map(|m| m as usize)).map_err(|e| JsError::new(&e))?;
    Ok(store_gaussian(cloud))
}

/// Free a registered Gaussian splat cloud.
#[wasm_bindgen]
pub fn free_gaussian_splats(handle: u32) {
    GAUSSIAN_REGISTRY.with(|r| r.borrow_mut().remove(&handle));
}

// ---------------------------------------------------------------------------
// SOG (Spatially Ordered Gaussians) bindings
//
// JavaScript fetches `meta.json` and its WebP images, hands them over one by
// one, then decodes to packed layout v2. The result is registered as an
// ordinary Gaussian handle, so `gaussian_splat_meta`, `gaussian_splat_buffer_sh`
// and `free_gaussian_splats` work on it unchanged.
// ---------------------------------------------------------------------------

fn sog_open_inner(meta_json: &str) -> Result<u32, String> {
    let meta = SogMeta::parse(meta_json).map_err(|e| e.to_string())?;
    let handle = NEXT_SOG_HANDLE.with(|n| {
        let mut n = n.borrow_mut();
        let h = *n;
        *n = n.wrapping_add(1).max(1);
        h
    });
    SOG_REGISTRY.with(|r| {
        r.borrow_mut().insert(
            handle,
            PendingSog {
                meta,
                images: HashMap::new(),
            },
        )
    });
    Ok(handle)
}

fn sog_add_image_inner(handle: u32, name: &str, bytes: &[u8]) -> Result<(), String> {
    let image = decode_webp_rgba(bytes).map_err(|e| format!("{name}: {e}"))?;
    SOG_REGISTRY.with(|r| {
        let mut map = r.borrow_mut();
        let pending = map.get_mut(&handle).ok_or("invalid SOG handle")?;
        pending.images.insert(name.to_string(), image);
        Ok(())
    })
}

fn sog_decode_inner(handle: u32, origin: Option<Vec<f64>>) -> Result<u32, String> {
    let origin = match origin {
        None => None,
        Some(v) if v.len() == 3 => Some([v[0], v[1], v[2]]),
        Some(_) => return Err("origin must have 3 components".to_string()),
    };
    // Taking the entry out releases the decoded images as soon as decoding ends.
    let pending = SOG_REGISTRY
        .with(|r| r.borrow_mut().remove(&handle))
        .ok_or("invalid SOG handle")?;
    let packed =
        decode_sog_packed(&pending.meta, &pending.images, origin).map_err(|e| e.to_string())?;
    Ok(store_gaussian(packed))
}

/// Parse a SOG `meta.json` and open a decode session, returning its handle.
#[wasm_bindgen]
pub fn sog_open(meta_json: &str) -> Result<u32, JsError> {
    sog_open_inner(meta_json).map_err(|e| JsError::new(&e))
}

/// Names of the image files the session still needs, as a JS string array.
#[wasm_bindgen]
pub fn sog_required_files(handle: u32) -> Result<JsValue, JsError> {
    SOG_REGISTRY.with(|r| {
        let map = r.borrow();
        let pending = map
            .get(&handle)
            .ok_or_else(|| JsError::new("invalid SOG handle"))?;
        serde_wasm_bindgen::to_value(&pending.meta.required_files())
            .map_err(|e| JsError::new(&e.to_string()))
    })
}

/// Decode one lossless WebP image of the dataset and keep its pixels.
#[wasm_bindgen]
pub fn sog_add_image(handle: u32, name: &str, bytes: &[u8]) -> Result<(), JsError> {
    sog_add_image_inner(handle, name, bytes).map_err(|e| JsError::new(&e))
}

/// Decode the session into packed layout v2 and return a Gaussian handle.
///
/// `origin` (3 numbers) is subtracted from positions; omit it to use the first
/// Gaussian. The session is consumed. Streamed scenes pass the first chunk's
/// origin to every later chunk so all chunks share one frame.
#[wasm_bindgen]
pub fn sog_decode(handle: u32, origin: Option<Vec<f64>>) -> Result<u32, JsError> {
    sog_decode_inner(handle, origin).map_err(|e| JsError::new(&e))
}

/// Discard a decode session without decoding it.
#[wasm_bindgen]
pub fn sog_free(handle: u32) {
    SOG_REGISTRY.with(|r| r.borrow_mut().remove(&handle));
}

/// Return packed layout version 2 for view-dependent SH rendering.
///
/// Each record is `position_f32[3], activated_scale_f32[3],
/// normalized_quaternion_f32[4]`, followed by packed `f16` opacity and SH.
#[wasm_bindgen]
pub fn gaussian_splat_buffer_sh(handle: u32) -> Result<Vec<u32>, JsError> {
    GAUSSIAN_REGISTRY.with(|r| {
        let map = r.borrow();
        let cloud = map
            .get(&handle)
            .ok_or_else(|| JsError::new("invalid gaussian splat handle"))?;
        Ok(cloud.buffer.clone())
    })
}

/// Return `{ count, sourceCount, shDegree, shStride, layoutVersion, ... }`.
///
/// The frontend uploads the view-dependent SH buffer
/// ([`gaussian_splat_buffer_sh`]); local splat positions for the depth sort are
/// extracted JS-side from that buffer's leading `xyz`, so no separate positions
/// export is needed.
///
/// Uses a `#[derive(Serialize)]` struct (not a `serde_json` map) so
/// `serde_wasm_bindgen` yields a plain JS **object** whose fields are directly
/// accessible (`meta.shDegree`), rather than a `Map`.
#[wasm_bindgen]
pub fn gaussian_splat_meta(handle: u32) -> Result<JsValue, JsError> {
    #[derive(serde::Serialize)]
    struct GaussianMeta {
        count: usize,
        #[serde(rename = "sourceCount")]
        source_count: usize,
        #[serde(rename = "shDegree")]
        sh_degree: u32,
        #[serde(rename = "shStride")]
        sh_stride: usize,
        #[serde(rename = "layoutVersion")]
        layout_version: u32,
        #[serde(rename = "layoutName")]
        layout_name: &'static str,
        origin: [f64; 3],
        min: [f64; 3],
        max: [f64; 3],
    }
    GAUSSIAN_REGISTRY.with(|r| {
        let map = r.borrow();
        let cloud = map
            .get(&handle)
            .ok_or_else(|| JsError::new("invalid gaussian splat handle"))?;
        let meta = GaussianMeta {
            count: cloud.count,
            source_count: cloud.source_count,
            sh_degree: cloud.sh_degree,
            sh_stride: cloud.stride,
            layout_version: cloud.layout_version,
            layout_name: PACKED_GAUSSIAN_LAYOUT_NAME,
            origin: cloud.origin,
            min: cloud.bounds.min,
            max: cloud.bounds.max,
        };
        serde_wasm_bindgen::to_value(&meta).map_err(|e| JsError::new(&e.to_string()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> std::path::PathBuf {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("we-core")
            .join("tests")
            .join("fixtures")
            .join("sog")
            .join(name)
    }

    #[test]
    fn test_sog_session_decodes_into_gaussian_registry() {
        let dir = fixture("sh1");
        let json = std::fs::read_to_string(dir.join("meta.json")).unwrap();
        let session = sog_open_inner(&json).unwrap();
        let required = SOG_REGISTRY.with(|r| r.borrow()[&session].meta.required_files());
        for name in required {
            let bytes = std::fs::read(dir.join(&name)).unwrap();
            sog_add_image_inner(session, &name, &bytes).unwrap();
        }
        let handle = sog_decode_inner(session, None).unwrap();
        GAUSSIAN_REGISTRY.with(|r| {
            let map = r.borrow();
            let cloud = &map[&handle];
            assert_eq!(cloud.count, 3000);
            assert_eq!(cloud.sh_degree, 1);
            assert_eq!(cloud.buffer.len(), 3000 * cloud.stride);
        });
        // The session is consumed by decoding.
        assert!(sog_decode_inner(session, None).is_err());
        free_gaussian_splats(handle);
    }

    #[test]
    fn test_sog_decode_rejects_bad_origin_length() {
        let json = std::fs::read_to_string(fixture("sh0").join("meta.json")).unwrap();
        let session = sog_open_inner(&json).unwrap();
        assert!(sog_decode_inner(session, Some(vec![1.0, 2.0])).is_err());
        sog_free(session);
    }

    #[test]
    fn test_sog_add_image_rejects_unknown_session_and_bad_webp() {
        assert!(sog_add_image_inner(u32::MAX, "x.webp", b"junk").is_err());
        let json = std::fs::read_to_string(fixture("sh0").join("meta.json")).unwrap();
        let session = sog_open_inner(&json).unwrap();
        assert!(sog_add_image_inner(session, "means_l.webp", b"junk").is_err());
        sog_free(session);
    }

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

    const GAUSSIAN_ASCII: &str = "\
ply
format ascii 1.0
element vertex 2
property float x
property float y
property float z
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
0 0 0 0 0 0 0 0 0 0 1 0 0 0
1 2 3 0 0 0 0 0 0 0 1 0 0 0
";

    #[test]
    fn test_parse_gaussian_ok() {
        let cloud = parse_gaussian(GAUSSIAN_ASCII.as_bytes(), None).unwrap();
        assert_eq!(cloud.count, 2);
        assert_eq!(cloud.sh_degree, 0);
        assert_eq!(cloud.stride, 12);
        assert_eq!(cloud.layout_version, 2);
        assert_eq!(cloud.buffer.len(), cloud.count * cloud.stride);
    }

    #[test]
    fn test_parse_gaussian_caps_splat_count() {
        // A budget of 1 stride-samples the 2-splat cloud down to a single splat.
        let cloud = parse_gaussian(GAUSSIAN_ASCII.as_bytes(), Some(1)).unwrap();
        assert_eq!(cloud.count, 1);
        assert_eq!(cloud.source_count, 2);
    }

    #[test]
    fn test_parse_gaussian_rejects_plain_ply() {
        let plain = "\
ply
format ascii 1.0
element vertex 1
property float x
property float y
property float z
end_header
0 0 0
";
        assert!(parse_gaussian(plain.as_bytes(), None).is_err());
    }
}
