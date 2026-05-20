//! Tauri IPC command handlers.
//!
//! These functions bridge the frontend TypeScript calls to Rust backend logic.

use serde_json::Value;
use tauri::State;
use we_core::model::Project;
use we_plugin_core::{PluginStatus, SharedPluginRegistry};

// ─── OpenDRIVE / Core commands ───────────────────────────────────────────────

/// Parse an OpenDRIVE XML string into a Project.
#[tauri::command]
pub fn parse_opendrive(xml: &str) -> Result<Value, String> {
    let project = we_core::opendrive::parse_xodr(xml).map_err(|e| e.to_string())?;
    serde_json::to_value(&project).map_err(|e| e.to_string())
}

/// Serialize a Project to OpenDRIVE XML.
#[tauri::command]
pub fn write_opendrive(project: Value) -> Result<String, String> {
    let project: Project = serde_json::from_value(project).map_err(|e| e.to_string())?;
    we_core::opendrive::write_xodr(&project).map_err(|e| e.to_string())
}

/// Return the core library version.
#[tauri::command]
pub fn get_version() -> String {
    we_core::VERSION.to_string()
}

/// Convert WGS84 coordinates to GCJ-02.
#[tauri::command]
pub fn wgs84_to_gcj02(lat: f64, lon: f64, alt: f64) -> Value {
    let coord = we_core::gis::GeoCoord::new(lat, lon, alt);
    let result = we_core::gis::wgs84_to_gcj02(&coord);
    geo_coord_to_json(&result)
}

/// Convert GCJ-02 coordinates to WGS84.
#[tauri::command]
pub fn gcj02_to_wgs84(lat: f64, lon: f64, alt: f64) -> Value {
    let coord = we_core::gis::GeoCoord::new(lat, lon, alt);
    let result = we_core::gis::gcj02_to_wgs84(&coord);
    geo_coord_to_json(&result)
}

/// Convert WGS84 to UTM.
#[tauri::command]
pub fn geo_to_utm(lat: f64, lon: f64, alt: f64) -> Value {
    let coord = we_core::gis::GeoCoord::new(lat, lon, alt);
    let utm = we_core::gis::geo_to_utm(&coord);
    serde_json::json!({
        "easting": utm.easting,
        "northing": utm.northing,
        "zone": utm.zone,
        "is_northern": utm.is_northern,
        "alt": utm.alt,
    })
}

/// Convert UTM to WGS84.
#[tauri::command]
pub fn utm_to_geo(easting: f64, northing: f64, zone: u8, is_northern: bool, alt: f64) -> Value {
    let utm = we_core::gis::UtmCoord::new(easting, northing, zone, is_northern, alt);
    let coord = we_core::gis::utm_to_geo(&utm);
    geo_coord_to_json(&coord)
}

/// Helper to serialize a GeoCoord to JSON.
fn geo_coord_to_json(coord: &we_core::gis::GeoCoord) -> Value {
    serde_json::json!({ "lat": coord.lat, "lon": coord.lon, "alt": coord.alt })
}

// ─── Plugin commands ─────────────────────────────────────────────────────────

/// JSON-serialisable plugin info sent to the frontend.
#[derive(serde::Serialize, Debug)]
pub struct PluginInfoDto {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub dependencies: Vec<String>,
    pub permissions: Vec<String>,
    /// "available" | "loaded" | "disabled"
    pub status: String,
    pub disabled_reason: Option<String>,
}

/// List all plugins discovered in the plugins directory with their current status.
#[tauri::command]
pub fn plugin_list(registry: State<'_, SharedPluginRegistry>) -> Vec<PluginInfoDto> {
    let inner = registry.read();

    let ids: Vec<String> = inner
        .list_discovered()
        .iter()
        .map(|m| m.id.clone())
        .collect();
    ids.iter()
        .filter_map(|id| inner.plugin_info(id))
        .map(|info| {
            let (status, disabled_reason) = match &info.status {
                PluginStatus::Available => ("available".to_string(), None),
                PluginStatus::Loaded => ("loaded".to_string(), None),
                PluginStatus::Disabled(r) => ("disabled".to_string(), Some(r.clone())),
            };
            PluginInfoDto {
                id: info.id,
                name: info.name,
                version: info.version,
                description: info.description,
                dependencies: info.dependencies,
                permissions: info.permissions,
                status,
                disabled_reason,
            }
        })
        .collect()
}

/// Read the plugin's compiled JS bundle (`dist/plugin.js`) and return its content.
#[tauri::command]
pub fn plugin_get_script(
    id: String,
    registry: State<'_, SharedPluginRegistry>,
) -> Result<String, String> {
    // Reject any id that looks like a path traversal attempt.
    if id.contains('/') || id.contains('\\') || id.contains("..") || id.is_empty() {
        return Err("Invalid plugin id".to_string());
    }
    let inner = registry.read();
    let script_path = inner.plugins_dir().join(&id).join("dist").join("plugin.js");
    std::fs::read_to_string(&script_path)
        .map_err(|e| format!("Cannot read plugin script for '{}': {}", id, e))
}

/// Enable a previously-disabled plugin (makes it available again).
#[tauri::command]
pub fn plugin_enable(id: String, registry: State<'_, SharedPluginRegistry>) -> Result<(), String> {
    registry
        .write()
        .enable(&id)
        .map_err(|e| e.to_string())
}

/// Disable a plugin (will be skipped on next load).
#[tauri::command]
pub fn plugin_disable(
    id: String,
    reason: String,
    registry: State<'_, SharedPluginRegistry>,
) -> Result<(), String> {
    registry
        .write()
        .disable(&id, &reason)
        .map_err(|e| e.to_string())
}

/// Copy a plugin directory into the managed plugins folder and re-discover.
///
/// Uses an atomic "copy to temp then rename" strategy to prevent data loss
/// if the copy fails mid-way.
///
/// `src_path` must be the path to a plugin directory containing a `manifest.json`.
#[tauri::command]
pub fn plugin_install(
    src_path: String,
    registry: State<'_, SharedPluginRegistry>,
) -> Result<(), String> {
    let src = std::path::Path::new(&src_path);
    if !src.is_dir() {
        return Err(format!("'{}' is not a directory", src_path));
    }

    // Resolve canonical path to prevent traversal attacks (e.g. /path/to/../../etc)
    let canonical = src
        .canonicalize()
        .map_err(|e| format!("Cannot resolve path '{}': {}", src_path, e))?;

    // Reject paths containing null bytes
    if canonical.to_string_lossy().contains('\0') {
        return Err("Invalid path: null byte detected".to_string());
    }

    // Validate that the source contains a well-formed manifest before copying.
    let manifest_path = canonical.join("manifest.json");
    let manifest = we_plugin_core::manifest::PluginManifest::from_path(&manifest_path)
        .map_err(|e| format!("Invalid plugin manifest: {}", e))?;
    manifest.validate().map_err(|e| e.to_string())?;

    let dest = {
        let inner = registry.read();
        let dir_name = canonical
            .file_name()
            .ok_or("Invalid source path: no directory name")?;
        inner.plugins_dir().join(dir_name)
    };

    // Atomic install: copy to a temporary directory first, then rename.
    // This prevents data loss if the copy fails mid-way.
    let temp_dest = dest.with_extension("_installing");
    if temp_dest.exists() {
        std::fs::remove_dir_all(&temp_dest)
            .map_err(|e| format!("Cannot clean up temp install dir: {}", e))?;
    }
    copy_dir_all(&canonical, &temp_dest)
        .map_err(|e| {
            // Clean up partial temp on failure
            let _ = std::fs::remove_dir_all(&temp_dest);
            format!("Cannot copy plugin files: {}", e)
        })?;

    // Now atomically replace the old directory
    if dest.exists() {
        let backup = dest.with_extension("_backup");
        if backup.exists() {
            let _ = std::fs::remove_dir_all(&backup);
        }
        std::fs::rename(&dest, &backup)
            .map_err(|e| format!("Cannot backup existing plugin: {}", e))?;
        if let Err(e) = std::fs::rename(&temp_dest, &dest) {
            // Restore backup on failure
            let _ = std::fs::rename(&backup, &dest);
            return Err(format!("Cannot install plugin: {}", e));
        }
        let _ = std::fs::remove_dir_all(&backup);
    } else {
        std::fs::rename(&temp_dest, &dest)
            .map_err(|e| format!("Cannot install plugin: {}", e))?;
    }

    registry.write().discover();
    log::info!("Installed plugin from: {}", src_path);
    Ok(())
}

fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        // Skip symbolic links to prevent copying files outside the plugin directory
        if entry.file_type()?.is_symlink() {
            log::warn!("Skipping symlink during plugin install: {:?}", entry.path());
            continue;
        }
        let dest = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_all(&entry.path(), &dest)?;
        } else {
            std::fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

/// Set the native window theme (title bar colour) from the frontend.
///
/// Calling `window.setTheme()` via the JS API can silently fail on Windows in
/// production builds because the call must originate from the main thread.
/// Routing it through a Tauri command runs on the correct thread reliably.
#[tauri::command]
pub fn set_window_theme(window: tauri::WebviewWindow, theme: String) -> Result<(), String> {
    let tauri_theme = match theme.as_str() {
        "light" => Some(tauri::Theme::Light),
        _ => Some(tauri::Theme::Dark),
    };
    window.set_theme(tauri_theme).map_err(|e| e.to_string())
}

/// Notify the backend that a plugin has been unloaded from the frontend JS context.
/// (Best-effort; the registry marks it as available again.)
#[tauri::command]
pub fn plugin_unload(id: String, _registry: State<'_, SharedPluginRegistry>) -> Result<(), String> {
    // JS plugins are unloaded purely on the frontend side; nothing to do in the registry.
    log::info!("plugin_unload: {} acknowledged", id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_opendrive_command() {
        let xml =
            r#"<?xml version="1.0"?><OpenDRIVE><header revMajor="1" revMinor="6"/></OpenDRIVE>"#;
        let result = parse_opendrive(xml);
        assert!(result.is_ok());
    }

    #[test]
    fn test_write_opendrive_command() {
        let project = serde_json::json!({
            "name": "test",
            "header": {
                "rev_major": 1,
                "rev_minor": 6,
                "name": "",
                "date": "",
                "north": 0.0,
                "south": 0.0,
                "east": 0.0,
                "west": 0.0,
                "geo_reference": null
            },
            "roads": [],
            "junctions": []
        });
        let result = write_opendrive(project);
        assert!(result.is_ok());
        assert!(result.unwrap().contains("OpenDRIVE"));
    }

    #[test]
    fn test_get_version() {
        let version = get_version();
        assert!(!version.is_empty());
    }

    #[test]
    fn test_wgs84_gcj02_roundtrip() {
        let gcj = wgs84_to_gcj02(39.9042, 116.4074, 0.0);
        let lat = gcj["lat"].as_f64().unwrap();
        let lon = gcj["lon"].as_f64().unwrap();
        let wgs = gcj02_to_wgs84(lat, lon, 0.0);
        assert!((wgs["lat"].as_f64().unwrap() - 39.9042).abs() < 1e-6);
        assert!((wgs["lon"].as_f64().unwrap() - 116.4074).abs() < 1e-6);
    }

    #[test]
    fn test_utm_roundtrip() {
        let utm = geo_to_utm(39.9042, 116.4074, 50.0);
        let e = utm["easting"].as_f64().unwrap();
        let n = utm["northing"].as_f64().unwrap();
        let z = utm["zone"].as_u64().unwrap() as u8;
        let is_n = utm["is_northern"].as_bool().unwrap();
        let a = utm["alt"].as_f64().unwrap();
        let geo = utm_to_geo(e, n, z, is_n, a);
        assert!((geo["lat"].as_f64().unwrap() - 39.9042).abs() < 1e-6);
        assert!((geo["lon"].as_f64().unwrap() - 116.4074).abs() < 1e-6);
    }

    // ── plugin_get_script path-traversal guards ───────────────────────────────

    #[test]
    fn test_plugin_get_script_rejects_path_traversal_ids() {
        // Validate the guard logic used in plugin_get_script
        let reject = |id: &str| -> bool {
            id.contains('/') || id.contains('\\') || id.contains("..") || id.is_empty()
        };
        assert!(reject("../secret"), "dotdot prefix must be rejected");
        assert!(reject("../../etc/passwd"), "double dotdot must be rejected");
        assert!(reject("foo/bar"), "slash in id must be rejected");
        assert!(reject("foo\\bar"), "backslash in id must be rejected");
        assert!(reject(""), "empty id must be rejected");
        assert!(!reject("my-plugin-v1"), "clean id must pass");
        assert!(!reject("my_plugin_123"), "underscore id must pass");
    }
}
