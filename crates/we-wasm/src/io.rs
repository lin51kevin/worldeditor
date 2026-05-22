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

// ── MIF ───────────────────────────────────────────────────────────────────────

/// Import a DXF string and return the project as JSON.
#[wasm_bindgen]
pub fn import_from_dxf(dxf: &str) -> Result<JsValue, JsError> {
    let project = we_io::dxf_io::import_from_dxf(dxf).map_err(|e| JsError::new(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&project).map_err(|e| JsError::new(&e.to_string()))
}

/// Export a project as DXF text.
#[wasm_bindgen]
pub fn export_to_dxf(project_json: &str) -> Result<String, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    we_io::dxf_io::export_to_dxf(&project).map_err(|e| JsError::new(&e.to_string()))
}

/// Import a Shapefile bundle and return the project as JSON.
#[wasm_bindgen]
pub fn import_from_shapefile(bytes: &[u8]) -> Result<JsValue, JsError> {
    let project = we_io::shapefile_io::import_from_shapefile(bytes)
        .map_err(|e| JsError::new(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&project).map_err(|e| JsError::new(&e.to_string()))
}

/// Export a project as a Shapefile bundle.
#[wasm_bindgen]
pub fn export_to_shapefile(project_json: &str) -> Result<Vec<u8>, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    we_io::shapefile_io::export_to_shapefile(&project).map_err(|e| JsError::new(&e.to_string()))
}

// ── MIF ───────────────────────────────────────────────────────────────────────

/// Import a MapInfo MIF string and return the project as JSON.
#[wasm_bindgen]
pub fn import_from_mif(mif: &str) -> Result<JsValue, JsError> {
    let project = we_io::mif_io::import_from_mif(mif).map_err(|e| JsError::new(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&project).map_err(|e| JsError::new(&e.to_string()))
}

/// Export a project as MapInfo MIF text.
#[wasm_bindgen]
pub fn export_to_mif(project_json: &str) -> Result<String, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    we_io::mif_io::export_to_mif(&project).map_err(|e| JsError::new(&e.to_string()))
}

// ── NIO ───────────────────────────────────────────────────────────────────────

/// Import NIO bytes and return the project as JSON.
#[wasm_bindgen]
pub fn import_from_nio(bytes: &[u8]) -> Result<JsValue, JsError> {
    let project =
        we_io::nio_proto::import_from_nio(bytes).map_err(|e| JsError::new(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&project).map_err(|e| JsError::new(&e.to_string()))
}

/// Export a project as NIO bytes.
#[wasm_bindgen]
pub fn export_to_nio(project_json: &str) -> Result<Vec<u8>, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    we_io::nio_proto::export_to_nio(&project).map_err(|e| JsError::new(&e.to_string()))
}

// ── Lanelet2 ──────────────────────────────────────────────────────────────────

/// Import a Lanelet2 OSM-XML string and return the project as JSON.
#[wasm_bindgen]
pub fn import_from_lanelet2(xml: &str) -> Result<JsValue, JsError> {
    let project = we_core::lanelet2::parser::import_from_lanelet2(xml)
        .map_err(|e| JsError::new(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&project).map_err(|e| JsError::new(&e.to_string()))
}

/// Export a project (as JSON) to Lanelet2 OSM-XML.
#[wasm_bindgen]
pub fn export_to_lanelet2(project_json: &str) -> Result<String, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(we_core::lanelet2::writer::export_to_lanelet2(&project))
}

#[cfg(test)]
mod tests {
    use super::{
        export_project_to_obj, export_roads_to_csv, export_to_hdmap_xml, import_roads_from_csv,
        import_signals_from_json,
    };
    use we_core::model::{Geometry, GeometryType, Project, Road};
    use we_io::signal_json::SignalEntry;

    fn project_json() -> String {
        let road = Road::from_centerline(
            "road-1",
            vec![Geometry {
                s: 0.0,
                x: 1.0,
                y: 2.0,
                hdg: 0.0,
                length: 10.0,
                geo_type: GeometryType::Line,
            }],
        );
        serde_json::to_string(&Project {
            roads: vec![road],
            ..Project::default()
        })
        .unwrap()
    }

    #[test]
    fn test_import_roads_from_csv_bridge_parses_rows() {
        let csv = "x,y,hdg\n1.0,2.0,0.5\n";
        let options = serde_json::json!({
            "delimiter": ",",
            "has_header": true,
            "x_col": 0,
            "y_col": 1,
            "hdg_col": 2,
            "id_col": null
        });

        let roads_json = import_roads_from_csv(csv, &options.to_string()).unwrap();
        let roads: Vec<Road> = serde_json::from_str(&roads_json).unwrap();

        assert_eq!(roads.len(), 1);
        assert_eq!(roads[0].plan_view[0].x, 1.0);
        assert_eq!(roads[0].plan_view[0].y, 2.0);
    }

    #[test]
    fn test_export_roads_to_csv_bridge_serializes_project() {
        let csv = export_roads_to_csv(&project_json()).unwrap();
        assert!(csv.contains("id,x,y,hdg,length"));
        assert!(csv.contains("road-1,1,2,0,10"));
    }

    #[test]
    fn test_export_project_to_obj_bridge_contains_vertices() {
        let obj = export_project_to_obj(&project_json()).unwrap();
        assert!(obj.contains("# WorldEditor Next — OBJ Export"));
        assert!(obj.lines().any(|line| line.starts_with("v ")));
    }

    #[test]
    fn test_import_signals_from_json_bridge_round_trips_signal_entries() {
        let json = r#"[{"id":"s1","road_id":"r1","s":10.0,"t":1.5,"signal_type":"stop"}]"#;
        let signals_json = import_signals_from_json(json).unwrap();
        let signals: Vec<SignalEntry> = serde_json::from_str(&signals_json).unwrap();

        assert_eq!(signals.len(), 1);
        assert_eq!(signals[0].road_id, "r1");
    }

    #[test]
    fn test_export_to_hdmap_xml_bridge_contains_road_elements() {
        let xml = export_to_hdmap_xml(&project_json()).unwrap();
        assert!(xml.contains("<hdmap>"));
        assert!(xml.contains("<road id=\"road-1\" length=\"10\"/>"));
    }
}
