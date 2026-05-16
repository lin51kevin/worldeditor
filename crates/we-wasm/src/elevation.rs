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

#[cfg(not(target_arch = "wasm32"))]
#[cfg(test)]
mod tests {
    use we_service::editor::Command;

    fn make_road_with_elevation() -> we_core::model::Road {
        let geo = we_core::model::Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 100.0,
            geo_type: we_core::model::GeometryType::Line,
        };
        let mut road = we_core::model::Road::from_centerline("r1", vec![geo]);
        road.elevation_profile.push(we_core::model::Elevation { s: 0.0, a: 0.0, b: 0.0, c: 0.0, d: 0.0 });
        road.elevation_profile.push(we_core::model::Elevation { s: 50.0, a: 5.0, b: 0.0, c: 0.0, d: 0.0 });
        road.elevation_profile.push(we_core::model::Elevation { s: 100.0, a: 10.0, b: 0.0, c: 0.0, d: 0.0 });
        road
    }

    fn make_empty_project_with_road() -> we_core::model::Project {
        let road = make_road_with_elevation();
        let mut project = we_core::model::Project::default();
        project.roads.push(road);
        project
    }

    #[test]
    fn test_elevation_query_at_zero_returns_zero() {
        let road = make_road_with_elevation();
        let result = we_core::elevation::query_elevation_at(&road, 0.0);
        assert!(result.elevation.abs() < 1e-9);
    }

    #[test]
    fn test_elevation_query_midpoint() {
        let road = make_road_with_elevation();
        let result = we_core::elevation::query_elevation_at(&road, 50.0);
        assert!((result.elevation - 5.0).abs() < 1e-9);
    }

    #[test]
    fn test_add_elevation_point_via_command() {
        let project = make_empty_project_with_road();
        let old_profile = project.roads[0].elevation_profile.clone();
        let cmd = we_service::commands::AddElevationPoint::new("r1", 25.0, 2.5, old_profile);
        let new_project = cmd.execute(&project).unwrap();
        let road = new_project.roads.iter().find(|r| r.id == "r1").unwrap();
        assert!(road.elevation_profile.iter().any(|ep| (ep.s - 25.0).abs() < 1e-9));
    }

    #[test]
    fn test_project_roundtrip_via_json() {
        let project = make_empty_project_with_road();
        let json = serde_json::to_string(&project).unwrap();
        let project2: we_core::model::Project = serde_json::from_str(&json).unwrap();
        assert_eq!(project.roads.len(), project2.roads.len());
    }
}
