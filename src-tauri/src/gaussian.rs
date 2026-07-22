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
use we_core::pointcloud::{PACKED_GAUSSIAN_LAYOUT_NAME, parse_gaussian_ply_packed};

/// Backend store of parsed splat clouds' packed SH buffers, keyed by handle.
#[derive(Default)]
pub struct GaussianSplatStore {
    inner: Mutex<StoreInner>,
}

#[derive(Default)]
struct StoreInner {
    /// Packed transform/SH instance buffers as raw bytes (`Vec<u32>` reinterpreted).
    entries: HashMap<u32, Vec<u8>>,
    next_handle: u32,
}

impl GaussianSplatStore {
    fn insert(&self, buffer: Vec<u8>) -> Result<u32, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "gaussian splat store poisoned".to_string())?;
        inner.next_handle = inner.next_handle.wrapping_add(1).max(1);
        let handle = inner.next_handle;
        inner.entries.insert(handle, buffer);
        Ok(handle)
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

/// Reinterpret a `Vec<u32>` as `Vec<u8>` without copying (little-endian bytes).
fn u32s_to_bytes(words: Vec<u32>) -> Vec<u8> {
    // SAFETY: u32 is 4 bytes; u8 has alignment 1 so no alignment issue. The
    // original Vec is forgotten so its buffer is not double-freed.
    unsafe {
        let len = words.len() * 4;
        let cap = words.capacity() * 4;
        let ptr = words.as_ptr() as *mut u8;
        std::mem::forget(words);
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
    // Memory-map the (often > 1 GB) file instead of reading it into the heap:
    // the binary PLY reader works directly on the byte slice, and the streaming
    // parser writes each splat straight into the packed GPU buffer — so the peak
    // resident memory is roughly just the output buffer, not file + full cloud.
    let file = std::fs::File::open(Path::new(&path)).map_err(|e| e.to_string())?;
    // SAFETY: the map is read-only and dropped before this function returns; the
    // file is not mutated elsewhere for the lifetime of the mapping.
    let mmap = unsafe { memmap2::Mmap::map(&file).map_err(|e| e.to_string())? };
    let packed = parse_gaussian_ply_packed(&mmap, max_splats.map(|m| m as usize))
        .map_err(|e| e.to_string())?;
    // Release the mapping before publishing the buffer.
    drop(mmap);

    let meta = serde_json::json!({
        "count": packed.count,
        "sourceCount": packed.source_count,
        "shDegree": packed.sh_degree,
        "shStride": packed.stride,
        "layoutVersion": packed.layout_version,
        "layoutName": PACKED_GAUSSIAN_LAYOUT_NAME,
        "origin": packed.origin,
        "min": packed.bounds.min,
        "max": packed.bounds.max,
    });
    let buffer = u32s_to_bytes(packed.buffer);
    let handle = store.insert(buffer)?;
    Ok(serde_json::json!({ "handle": handle, "meta": meta }))
}

/// Return the packed SH instance buffer for `handle` as a raw binary
/// `ArrayBuffer` (avoids the JSON number-array blow-up for large buffers).
///
/// The buffer is **moved** out of the store (not cloned): a multi-hundred-MiB
/// splat buffer is consumed by exactly one retrieval, so cloning it would double
/// peak memory for no benefit. [`gaussian_splat_free`] afterwards is a harmless
/// no-op. Returns an error if the handle was already retrieved or freed.
#[tauri::command]
pub fn gaussian_splat_buffer(
    handle: u32,
    store: State<'_, GaussianSplatStore>,
) -> Result<Response, String> {
    let mut inner = store
        .inner
        .lock()
        .map_err(|_| "gaussian splat store poisoned".to_string())?;
    let buffer = inner
        .entries
        .remove(&handle)
        .ok_or("invalid gaussian splat handle")?;
    Ok(Response::new(buffer))
}

/// Free a parsed splat cloud and its buffer.
#[tauri::command]
pub fn gaussian_splat_free(handle: u32, store: State<'_, GaussianSplatStore>) {
    if let Ok(mut inner) = store.inner.lock() {
        inner.entries.remove(&handle);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_u32s_to_bytes_roundtrip() {
        let words = vec![0x3f80_0000u32, 0x4000_0000, 0x4040_0000];
        let bytes = u32s_to_bytes(words);
        assert_eq!(bytes.len(), 12);
        let back = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        assert_eq!(back, 0x3f80_0000);
        assert_eq!(f32::from_bits(back), 1.0);
    }

    #[test]
    fn test_store_insert_unique_handles() {
        let store = GaussianSplatStore::default();
        let h1 = store.insert(vec![]).unwrap();
        let h2 = store.insert(vec![]).unwrap();
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
