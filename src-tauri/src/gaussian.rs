//! Tauri IPC commands for native 3D Gaussian Splatting (3DGS) loading.
//!
//! Large `.ply` splat clouds (often > 1 GB) must NOT be routed through the WASM
//! worker on desktop: that path reads the whole file into JS and copies it again
//! into the wasm32 linear memory, exhausting the 4 GB address space and crashing
//! on load. Instead these commands parse the file natively (64-bit, no wasm
//! limit), uniformly stride-sampling to a splat budget, and hand the frontend
//! only the compact SH instance buffer as raw binary.
//!
//! Flow: `gaussian_splat_load` (path → handle + meta) → `gaussian_splat_buffer`
//! (handle → raw `ArrayBuffer` of the packed SH buffer) → `gaussian_splat_free`.

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::sync::Mutex;

use serde_json::Value;
use tauri::State;
use tauri::ipc::Response;
use we_core::pointcloud::parse_gaussian_ply_capped;

/// Backend store of parsed splat clouds' packed SH buffers, keyed by handle.
#[derive(Default)]
pub struct GaussianSplatStore {
    inner: Mutex<StoreInner>,
}

#[derive(Default)]
struct StoreInner {
    /// Packed SH instance buffers as raw bytes (`Vec<f32>` reinterpreted).
    entries: HashMap<u32, Vec<u8>>,
    next_handle: u32,
}

impl GaussianSplatStore {
    fn insert(&self, buffer: Vec<u8>) -> u32 {
        let mut inner = self.inner.lock().expect("gaussian splat store poisoned");
        inner.next_handle = inner.next_handle.wrapping_add(1).max(1);
        let handle = inner.next_handle;
        inner.entries.insert(handle, buffer);
        handle
    }
}

/// Whether a PLY header region declares the 3D Gaussian Splatting properties.
fn header_has_gaussian_props(head: &[u8]) -> bool {
    let text = String::from_utf8_lossy(head);
    let scan = match text.find("end_header") {
        Some(i) => &text[..i],
        None => &text[..],
    };
    ["f_dc_0", "scale_0", "rot_0", "opacity"]
        .iter()
        .all(|name| scan.contains(name))
}

/// Reinterpret a `Vec<f32>` as `Vec<u8>` without copying (little-endian bytes).
fn floats_to_bytes(floats: Vec<f32>) -> Vec<u8> {
    // SAFETY: f32 is 4 bytes; u8 has alignment 1 so no alignment issue. The
    // original Vec is forgotten so its buffer is not double-freed.
    unsafe {
        let len = floats.len() * 4;
        let cap = floats.capacity() * 4;
        let ptr = floats.as_ptr() as *mut u8;
        std::mem::forget(floats);
        Vec::from_raw_parts(ptr, len, cap)
    }
}

/// Cheaply test whether a `.ply` on disk is a 3D Gaussian Splatting cloud by
/// reading only its header (up to 64 KiB), without loading the whole file.
#[tauri::command]
pub fn ply_is_gaussian(path: String) -> Result<bool, String> {
    let mut file = std::fs::File::open(Path::new(&path)).map_err(|e| e.to_string())?;
    let mut head = vec![0u8; 64 * 1024];
    let n = file.read(&mut head).map_err(|e| e.to_string())?;
    head.truncate(n);
    Ok(header_has_gaussian_props(&head))
}

/// Load a 3D Gaussian Splatting `.ply` from disk, returning `{ handle, meta }`.
///
/// `max_splats` (when set) uniformly stride-samples the cloud during parsing so
/// both the intermediate cloud and the returned buffer stay bounded — essential
/// for multi-million-splat clouds. The packed SH buffer is retrieved separately
/// via [`gaussian_splat_buffer`] to keep this response small.
#[tauri::command]
pub fn gaussian_splat_load(
    path: String,
    max_splats: Option<u32>,
    store: State<'_, GaussianSplatStore>,
) -> Result<Value, String> {
    let bytes = std::fs::read(Path::new(&path)).map_err(|e| e.to_string())?;
    let cloud = parse_gaussian_ply_capped(&bytes, max_splats.map(|m| m as usize))
        .map_err(|e| e.to_string())?;
    // Release the (large) source bytes before building the output buffer.
    drop(bytes);

    let b = cloud.bounds();
    let meta = serde_json::json!({
        "count": cloud.len(),
        "shDegree": cloud.sh_degree(),
        "shStride": cloud.sh_buffer_stride(),
        "origin": cloud.origin(),
        "min": b.min,
        "max": b.max,
    });
    let buffer = floats_to_bytes(cloud.build_splat_buffer_sh());
    let handle = store.insert(buffer);
    Ok(serde_json::json!({ "handle": handle, "meta": meta }))
}

/// Return the packed SH instance buffer for `handle` as a raw binary
/// `ArrayBuffer` (avoids the JSON number-array blow-up for large buffers).
#[tauri::command]
pub fn gaussian_splat_buffer(
    handle: u32,
    store: State<'_, GaussianSplatStore>,
) -> Result<Response, String> {
    let inner = store.inner.lock().expect("gaussian splat store poisoned");
    let buffer = inner
        .entries
        .get(&handle)
        .ok_or("invalid gaussian splat handle")?;
    Ok(Response::new(buffer.clone()))
}

/// Free a parsed splat cloud and its buffer.
#[tauri::command]
pub fn gaussian_splat_free(handle: u32, store: State<'_, GaussianSplatStore>) {
    let mut inner = store.inner.lock().expect("gaussian splat store poisoned");
    inner.entries.remove(&handle);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_floats_to_bytes_roundtrip() {
        let floats = vec![1.0f32, 2.0, 3.0];
        let bytes = floats_to_bytes(floats);
        assert_eq!(bytes.len(), 12);
        let back = f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        assert_eq!(back, 1.0);
    }

    #[test]
    fn test_store_insert_unique_handles() {
        let store = GaussianSplatStore::default();
        let h1 = store.insert(vec![]);
        let h2 = store.insert(vec![]);
        assert_ne!(h1, h2);
        assert!(h1 >= 1 && h2 >= 1);
    }

    #[test]
    fn test_header_detects_gaussian_props() {
        let header = b"ply\nproperty float f_dc_0\nproperty float scale_0\nproperty float rot_0\nproperty float opacity\nend_header\n";
        assert!(header_has_gaussian_props(header));
    }

    #[test]
    fn test_header_rejects_plain_ply() {
        let header = b"ply\nproperty float x\nproperty float y\nproperty float z\nend_header\n";
        assert!(!header_has_gaussian_props(header));
    }

    #[test]
    fn test_header_ignores_props_after_end_header() {
        // Signature words appearing only after end_header must not count.
        let header = b"ply\nproperty float x\nend_header\nf_dc_0 scale_0 rot_0 opacity";
        assert!(!header_has_gaussian_props(header));
    }
}
