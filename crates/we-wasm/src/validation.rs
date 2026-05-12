//! WASM bindings for the validation engine (Phase 2d).

use wasm_bindgen::prelude::*;

/// Validate a project (JSON) using the built-in OpenDRIVE validator.
///
/// Returns a JSON array of issues, each with:
/// - `code`: e.g. `"E001"`, `"W001"`
/// - `severity`: `"error"` | `"warning"`
/// - `message`: human-readable description
/// - `road_id`: the affected road ID (may be null for project-level issues)
#[wasm_bindgen]
pub fn validate_project(project_json: &str) -> Result<JsValue, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    let report = we_core::opendrive::validator::validate_project(&project);

    let issues: Vec<serde_json::Value> = report
        .issues
        .iter()
        .map(|issue| {
            serde_json::json!({
                "code": issue.code,
                "severity": format!("{:?}", issue.severity).to_lowercase(),
                "message": issue.message,
                "element_id": issue.element_id,
            })
        })
        .collect();

    serde_wasm_bindgen::to_value(&issues).map_err(|e| JsError::new(&e.to_string()))
}

/// Return true if a project (JSON) passes all validation checks (no errors, warnings allowed).
#[wasm_bindgen]
pub fn project_is_valid(project_json: &str) -> Result<bool, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    let report = we_core::opendrive::validator::validate_project(&project);
    Ok(report.is_valid())
}

#[cfg(test)]
mod tests {
    use we_core::model::Project;
    use we_core::opendrive::validator::validate_project;

    #[test]
    fn test_empty_project_valid() {
        let project = Project::default();
        let report = validate_project(&project);
        assert!(report.is_valid(), "issues: {:?}", report.issues);
    }

    #[test]
    fn test_zero_length_road_produces_error() {
        let mut project = Project::default();
        let mut road = we_core::model::Road::new("r1", 10.0);
        road.length = 0.0;
        project.roads.push(road);
        let report = validate_project(&project);
        assert!(!report.is_valid());
        assert!(report.errors().any(|i| i.code == "E001"), "expected E001");
    }

    #[test]
    fn test_severity_format() {
        use we_core::opendrive::validator::Severity;
        assert_eq!(format!("{:?}", Severity::Error).to_lowercase(), "error");
        assert_eq!(format!("{:?}", Severity::Warning).to_lowercase(), "warning");
        assert_eq!(format!("{:?}", Severity::Info).to_lowercase(), "info");
    }

    #[test]
    fn test_project_is_valid_logic() {
        let project = Project::default();
        let report = validate_project(&project);
        assert!(report.is_valid());
    }
}
