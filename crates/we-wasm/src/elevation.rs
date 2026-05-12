use wasm_bindgen::prelude::*;
use we_service::editor::Command;

/// Query the elevation and grade at a station on a road.
///
/// Returns JSON `{ elevation, grade, grade_pct }`.
#[wasm_bindgen]
pub fn query_elevation(road_json: &str, s: f64) -> Result<JsValue, JsError> {
    let road: we_core::model::Road =
        serde_json::from_str(road_json).map_err(|e| JsError::new(&e.to_string()))?;
    let result = we_core::elevation::query_elevation_at(&road, s);
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Add an elevation point to a road and return the modified project.
#[wasm_bindgen]
pub fn add_elevation_point(
    project_json: &str,
    road_id: &str,
    s: f64,
    height: f64,
) -> Result<String, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    let old_profile = project
        .roads
        .iter()
        .find(|r| r.id == road_id)
        .map(|r| r.elevation_profile.clone())
        .unwrap_or_default();
    let cmd = we_service::commands::AddElevationPoint::new(road_id, s, height, old_profile);
    let result = cmd
        .execute(&project)
        .map_err(|e| JsError::new(&e.to_string()))?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Delete an elevation point from a road and return the modified project.
#[wasm_bindgen]
pub fn delete_elevation_point(
    project_json: &str,
    road_id: &str,
    s: f64,
    tolerance: f64,
) -> Result<String, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    let old_profile = project
        .roads
        .iter()
        .find(|r| r.id == road_id)
        .map(|r| r.elevation_profile.clone())
        .unwrap_or_default();
    let cmd = we_service::commands::DeleteElevationPoint::new(road_id, s, tolerance, old_profile);
    let result = cmd
        .execute(&project)
        .map_err(|e| JsError::new(&e.to_string()))?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Smooth a road's elevation profile.
#[wasm_bindgen]
pub fn smooth_elevation(
    project_json: &str,
    road_id: &str,
    iterations: u32,
) -> Result<String, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    let old_profile = project
        .roads
        .iter()
        .find(|r| r.id == road_id)
        .map(|r| r.elevation_profile.clone())
        .unwrap_or_default();
    let cmd = we_service::commands::SmoothElevation::new(road_id, iterations, old_profile);
    let result = cmd
        .execute(&project)
        .map_err(|e| JsError::new(&e.to_string()))?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}
