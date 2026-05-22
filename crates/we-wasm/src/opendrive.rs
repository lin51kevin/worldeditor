use wasm_bindgen::prelude::*;

/// Parse an OpenDRIVE XML string and return the project as JSON.
// TODO: [Phase 3] 待实现 — expand the WASM OpenDRIVE import bridge for the full parsing pipeline
#[wasm_bindgen]
pub fn parse_opendrive(xml: &str) -> Result<JsValue, JsError> {
    let project = we_core::opendrive::parse_xodr(xml).map_err(|e| JsError::new(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&project).map_err(|e| JsError::new(&e.to_string()))
}

/// Serialize a project (as JSON) to OpenDRIVE XML.
// TODO: [Phase 3] 待实现 — expand the WASM OpenDRIVE export bridge for full round-trip support
#[wasm_bindgen]
pub fn write_opendrive(project_json: &str) -> Result<String, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    we_core::opendrive::write_xodr(&project).map_err(|e| JsError::new(&e.to_string()))
}

/// Get the core library version.
#[wasm_bindgen]
pub fn version() -> String {
    we_core::VERSION.to_string()
}

#[cfg(test)]
mod tests {
    use super::{version, write_opendrive};
    use we_core::model::Project;

    #[test]
    fn test_version_matches_core_version() {
        assert_eq!(version(), we_core::VERSION);
    }

    #[test]
    fn test_write_opendrive_serializes_project_json() {
        let json = serde_json::to_string(&Project::default()).unwrap();
        let xml = write_opendrive(&json).unwrap();

        assert!(xml.contains("<OpenDRIVE"));
    }
}
