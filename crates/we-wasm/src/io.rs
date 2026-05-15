//! WASM bridge for we-io format modules.
//!
//! Exposes CSV, OBJ, and Signal JSON import/export to JavaScript
//! so that frontend plugins can delegate to the Rust implementation
//! instead of maintaining separate TypeScript parsers.

use wasm_bindgen::prelude::*;

// ── CSV ───────────────────────────────────────────────────────────────────────

/// Import roads from CSV text.
///
/// Returns a JSON string representing the imported `Road[]` array.
#[wasm_bindgen]
pub fn import_roads_from_csv(csv: &str, options_json: &str) -> Result<String, JsError> {
    let opts: we_io::csv_io::CsvImportOptions =
        serde_json::from_str(options_json).map_err(|e| JsError::new(&e.to_string()))?;
    let roads = we_io::csv_io::import_roads_from_csv(csv, &opts)
        .map_err(|e| JsError::new(&e.to_string()))?;
    serde_json::to_string(&roads).map_err(|e| JsError::new(&e.to_string()))
}

/// Export the project's roads to CSV text.
#[wasm_bindgen]
pub fn export_roads_to_csv(project_json: &str) -> Result<String, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(we_io::csv_io::export_roads_to_csv(&project))
}

// ── OBJ 3D ────────────────────────────────────────────────────────────────────

/// Export the project to Wavefront OBJ text.
#[wasm_bindgen]
pub fn export_project_to_obj(project_json: &str) -> Result<String, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(we_io::obj_export::export_project_to_obj(&project))
}

// ── Signal JSON ───────────────────────────────────────────────────────────────

/// Import signals from a JSON string.
///
/// Returns a JSON string representing the imported `SignalEntry[]` array.
#[wasm_bindgen]
pub fn import_signals_from_json(json: &str) -> Result<String, JsError> {
    let signals = we_io::signal_json::import_signals_from_json(json)
        .map_err(|e| JsError::new(&e.to_string()))?;
    serde_json::to_string(&signals).map_err(|e| JsError::new(&e.to_string()))
}

/// Export the project's signals to JSON text.
#[wasm_bindgen]
pub fn export_signals_to_json(project_json: &str) -> Result<String, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(we_io::signal_json::export_signals_to_json(&project))
}

/// Export the project to HD Map XML format.
#[wasm_bindgen]
pub fn export_to_hdmap_xml(project_json: &str) -> Result<String, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(we_io::signal_json::export_to_hdmap_xml(&project))
}
