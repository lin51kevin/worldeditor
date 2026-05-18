//! Topology validation and repair — WASM exports.

use wasm_bindgen::prelude::*;

/// Validate the topology of a project and return a JSON report.
///
/// The report contains issues with severity, kind, message, and element_id.
#[wasm_bindgen]
pub fn validate_topology(project_json: &str) -> Result<JsValue, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    let report = we_core::topology::validate_topology(&project);
    serde_wasm_bindgen::to_value(&report).map_err(|e| JsError::new(&e.to_string()))
}

/// Repair topology issues in a project and return the repaired project JSON
/// along with a list of actions taken.
///
/// Returns `{ project: string, actions: string[] }`.
#[wasm_bindgen]
pub fn repair_topology(project_json: &str) -> Result<JsValue, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    let (repaired, actions) = we_core::topology::repair_topology(&project);

    #[derive(serde::Serialize)]
    struct RepairResult {
        project: String,
        actions: Vec<String>,
    }

    let result = RepairResult {
        project: serde_json::to_string(&repaired).map_err(|e| JsError::new(&e.to_string()))?,
        actions,
    };
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Optimize a junction's connections based on actual road topology.
///
/// Returns the new connections as JSON, or null if the junction was not found.
#[wasm_bindgen]
pub fn optimize_junction(project_json: &str, junction_id: &str) -> Result<JsValue, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    match we_core::topology::optimize_junction(&project, junction_id) {
        Some(connections) => {
            serde_wasm_bindgen::to_value(&connections).map_err(|e| JsError::new(&e.to_string()))
        }
        None => Ok(JsValue::NULL),
    }
}
