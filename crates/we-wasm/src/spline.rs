use wasm_bindgen::prelude::*;
use we_service::editor::Command;

/// Parse a string mode into `SplineOutputMode`.
fn parse_spline_output_mode(mode: &str) -> we_core::spline::SplineOutputMode {
    match mode {
        "parampoly3" => we_core::spline::SplineOutputMode::ParamPoly3Only,
        _ => we_core::spline::SplineOutputMode::Classify,
    }
}

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
///
/// `mode`: `"classify"` (default — picks optimal geometry types) or
///         `"parampoly3"` (always emit ParamPoly3, except straight Lines).
#[wasm_bindgen]
pub fn spline_to_geometries(spline_json: &str, mode: &str) -> Result<String, JsError> {
    let spline: we_core::spline::EditableSpline =
        serde_json::from_str(spline_json).map_err(|e| JsError::new(&e.to_string()))?;
    let output_mode = parse_spline_output_mode(mode);
    let geos = we_core::spline::spline_to_geometries_with_mode(&spline, output_mode);
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
/// - `mode`: `"classify"` or `"parampoly3"` (geometry output mode)
#[wasm_bindgen]
pub fn create_road_from_spline(
    project_json: &str,
    road_id: &str,
    spline_json: &str,
    template_id: &str,
    mode: &str,
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

    let output_mode = parse_spline_output_mode(mode);
    let cmd = we_service::commands::CreateRoadFromSpline::new(road_id, spline, template, output_mode);
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

#[cfg(not(target_arch = "wasm32"))]
#[cfg(test)]
mod tests {
    use super::parse_spline_output_mode;
    use we_core::spline::SplineOutputMode;
    use we_core::model::{Road, Geometry, GeometryType};
    use we_service::editor::Command;

    fn simple_road(length: f64) -> Road {
        Road::from_centerline("r1", vec![Geometry {
            s: 0.0, x: 0.0, y: 0.0, hdg: 0.0, length,
            geo_type: GeometryType::Line,
        }])
    }

    #[test]
    fn test_parse_spline_output_mode_parampoly3() {
        assert!(matches!(
            parse_spline_output_mode("parampoly3"),
            SplineOutputMode::ParamPoly3Only
        ));
    }

    #[test]
    fn test_parse_spline_output_mode_classify_default() {
        assert!(matches!(
            parse_spline_output_mode("classify"),
            SplineOutputMode::Classify
        ));
    }

    #[test]
    fn test_parse_spline_output_mode_unknown_defaults_to_classify() {
        assert!(matches!(
            parse_spline_output_mode("something_else"),
            SplineOutputMode::Classify
        ));
    }

    #[test]
    fn test_road_to_spline_roundtrip_via_serde() {
        let road = simple_road(10.0);
        let spline = we_core::spline::road_to_spline(&road, 5.0);
        let json = serde_json::to_string(&spline).unwrap();
        let back: we_core::spline::EditableSpline = serde_json::from_str(&json).unwrap();
        assert_eq!(spline.knots.len(), back.knots.len());
    }

    #[test]
    fn test_create_road_from_spline_command() {
        let road = simple_road(10.0);
        let spline = we_core::spline::road_to_spline(&road, 20.0);
        let mut project = we_core::model::Project::default();
        let template = we_core::model::RoadTemplate::single_lane();
        let cmd = we_service::commands::CreateRoadFromSpline::new(
            "new_road",
            spline,
            template,
            SplineOutputMode::Classify,
        );
        let new_project = cmd.execute(&project).unwrap();
        assert!(new_project.roads.iter().any(|r| r.id == "new_road"));
    }
}
