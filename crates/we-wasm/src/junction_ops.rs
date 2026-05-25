//! WASM bindings for junction auto-build operations.

use wasm_bindgen::prelude::*;
use we_core::model::Project;

/// Auto-generate connector roads for every unconnected arm pair in a junction.
///
/// Returns the updated project as a JSON string.
/// On error, returns a JS Error.
#[wasm_bindgen]
pub fn auto_build_junction_connectors(
    project_json: &str,
    junction_id: &str,
) -> Result<String, JsError> {
    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let updated = we_core::junction_ops::build_junction_connectors(&project, junction_id)
        .map_err(|e| JsError::new(&e.to_string()))?;

    serde_json::to_string(&updated).map_err(|e| JsError::new(&e.to_string()))
}

/// Return JSON array of junction arms for the given junction.
///
/// Useful for frontend visualization / debugging.
#[wasm_bindgen]
pub fn get_junction_arms(project_json: &str, junction_id: &str) -> Result<String, JsError> {
    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let arms = we_core::junction_ops::detect_junction_arms(&project, junction_id);

    serde_json::to_string(&arms).map_err(|e| JsError::new(&e.to_string()))
}
