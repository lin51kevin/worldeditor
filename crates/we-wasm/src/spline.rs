use wasm_bindgen::prelude::*;
use we_service::editor::Command;

/// Convert a road (as JSON) to an editable spline (as JSON).
///
/// `sample_step`: distance between intermediate sample points (0 = no intermediates).
#[wasm_bindgen]
pub fn road_to_spline(road_json: &str, sample_step: f64) -> Result<String, JsError> {
    let road: we_core::model::Road =
        serde_json::from_str(road_json).map_err(|e| JsError::new(&e.to_string()))?;
    let spline = we_core::spline::road_to_spline(&road, sample_step);
    serde_json::to_string(&spline).map_err(|e| JsError::new(&e.to_string()))
}

/// Convert an editable spline (as JSON) back to OpenDRIVE geometry segments (as JSON).
#[wasm_bindgen]
pub fn spline_to_geometries(spline_json: &str) -> Result<String, JsError> {
    let spline: we_core::spline::EditableSpline =
        serde_json::from_str(spline_json).map_err(|e| JsError::new(&e.to_string()))?;
    let geos = we_core::spline::spline_to_geometries(&spline);
    serde_json::to_string(&geos).map_err(|e| JsError::new(&e.to_string()))
}

/// Move a knot in a spline and return the updated spline as JSON.
///
/// `spline_json`: the current spline state.
/// `knot_index`: index of the knot to move.
/// `new_x, new_y, new_z`: new position for the knot.
#[wasm_bindgen]
pub fn move_spline_knot(
    spline_json: &str,
    knot_index: usize,
    new_x: f64,
    new_y: f64,
    new_z: f64,
) -> Result<String, JsError> {
    let mut spline: we_core::spline::EditableSpline =
        serde_json::from_str(spline_json).map_err(|e| JsError::new(&e.to_string()))?;
    if knot_index >= spline.knots.len() {
        return Err(JsError::new(&format!(
            "Knot index {} out of range ({})",
            knot_index,
            spline.knots.len()
        )));
    }
    spline.move_knot(knot_index, [new_x, new_y, new_z]);
    serde_json::to_string(&spline).map_err(|e| JsError::new(&e.to_string()))
}

/// Compute soft selection factors for a given knot.
///
/// Returns JSON array of `[index, factor]` pairs.
#[wasm_bindgen]
pub fn compute_soft_selection(
    spline_json: &str,
    selected_index: usize,
    radius: f64,
    falloff_type: &str,
) -> Result<String, JsError> {
    let spline: we_core::spline::EditableSpline =
        serde_json::from_str(spline_json).map_err(|e| JsError::new(&e.to_string()))?;
    let falloff = match falloff_type {
        "linear" => we_core::spline::FalloffType::Linear,
        "smooth" => we_core::spline::FalloffType::Smooth,
        _ => we_core::spline::FalloffType::Gaussian,
    };
    let config = we_core::spline::SoftSelectionConfig {
        radius,
        falloff,
        gaussian_k: 3.0,
    };
    let factors = we_core::spline::collect_soft_selection(&spline, selected_index, &config);
    serde_json::to_string(&factors).map_err(|e| JsError::new(&e.to_string()))
}

/// Create a road from a spline and lane template, returning the modified project.
///
/// - `spline_json`: JSON representation of EditableSpline
/// - `template_id`: Template ID (e.g., "single", "dual2", "dual4", "dual6")
/// - `road_id`: Unique ID for the new road
#[wasm_bindgen]
pub fn create_road_from_spline(
    project_json: &str,
    road_id: &str,
    spline_json: &str,
    template_id: &str,
) -> Result<String, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    let spline: we_core::spline::EditableSpline =
        serde_json::from_str(spline_json).map_err(|e| JsError::new(&e.to_string()))?;

    let template = match template_id {
        "single" => we_core::model::RoadTemplate::single_lane(),
        "dual2" => we_core::model::RoadTemplate::dual_two_lane(),
        "dual4" => we_core::model::RoadTemplate::dual_four_lane(),
        "dual6" => we_core::model::RoadTemplate::dual_six_lane(),
        _ => {
            return Err(JsError::new(&format!(
                "Unknown template ID: {}",
                template_id
            )));
        }
    };

    let cmd = we_service::commands::CreateRoadFromSpline::new(road_id, spline, template);
    let result = cmd
        .execute(&project)
        .map_err(|e| JsError::new(&e.to_string()))?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// List built-in road templates available for spline-based road creation.
#[wasm_bindgen]
pub fn get_road_templates() -> Result<JsValue, JsError> {
    let templates = vec![
        we_core::model::RoadTemplate::single_lane(),
        we_core::model::RoadTemplate::dual_two_lane(),
        we_core::model::RoadTemplate::dual_four_lane(),
        we_core::model::RoadTemplate::dual_six_lane(),
    ];
    serde_wasm_bindgen::to_value(&templates).map_err(|e| JsError::new(&e.to_string()))
}

/// Translate a road by (dx, dy, dz) and return the modified project JSON.
#[wasm_bindgen]
pub fn translate_road(
    project_json: &str,
    road_id: &str,
    dx: f64,
    dy: f64,
    dz: f64,
) -> Result<String, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    let cmd = we_service::commands::TranslateRoad::new(road_id, dx, dy, dz);
    let result = cmd
        .execute(&project)
        .map_err(|e| JsError::new(&e.to_string()))?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Rotate a road around a pivot point and return the modified project JSON.
#[wasm_bindgen]
pub fn rotate_road(
    project_json: &str,
    road_id: &str,
    pivot_x: f64,
    pivot_y: f64,
    angle_rad: f64,
) -> Result<String, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    let cmd = we_service::commands::RotateRoad::new(road_id, [pivot_x, pivot_y], angle_rad);
    let result = cmd
        .execute(&project)
        .map_err(|e| JsError::new(&e.to_string()))?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}
