//! Tauri IPC command handlers.
//!
//! These functions bridge the frontend TypeScript calls to Rust backend logic.

use serde_json::Value;
use we_core::model::Project;

/// Parse an OpenDRIVE XML string into a Project.
#[tauri::command]
pub fn parse_opendrive(xml: &str) -> Result<Value, String> {
    let project = we_core::opendrive::parse_xodr(xml).map_err(|e| e.to_string())?;
    serde_json::to_value(&project).map_err(|e| e.to_string())
}

/// Serialize a Project to OpenDRIVE XML.
#[tauri::command]
pub fn write_opendrive(project: Value) -> Result<String, String> {
    let project: Project = serde_json::from_value(project).map_err(|e| e.to_string())?;
    we_core::opendrive::write_xodr(&project).map_err(|e| e.to_string())
}

/// Return the core library version.
#[tauri::command]
pub fn get_version() -> String {
    we_core::VERSION.to_string()
}

/// Convert WGS84 coordinates to GCJ-02.
#[tauri::command]
pub fn wgs84_to_gcj02(lat: f64, lon: f64, alt: f64) -> Value {
    let coord = we_core::gis::GeoCoord::new(lat, lon, alt);
    let result = we_core::gis::wgs84_to_gcj02(&coord);
    serde_json::json!({ "lat": result.lat, "lon": result.lon, "alt": result.alt })
}

/// Convert GCJ-02 coordinates to WGS84.
#[tauri::command]
pub fn gcj02_to_wgs84(lat: f64, lon: f64, alt: f64) -> Value {
    let coord = we_core::gis::GeoCoord::new(lat, lon, alt);
    let result = we_core::gis::gcj02_to_wgs84(&coord);
    serde_json::json!({ "lat": result.lat, "lon": result.lon, "alt": result.alt })
}

/// Convert WGS84 to UTM.
#[tauri::command]
pub fn geo_to_utm(lat: f64, lon: f64, alt: f64) -> Value {
    let coord = we_core::gis::GeoCoord::new(lat, lon, alt);
    let utm = we_core::gis::geo_to_utm(&coord);
    serde_json::json!({
        "easting": utm.easting,
        "northing": utm.northing,
        "zone": utm.zone,
        "is_northern": utm.is_northern,
        "alt": utm.alt,
    })
}

/// Convert UTM to WGS84.
#[tauri::command]
pub fn utm_to_geo(easting: f64, northing: f64, zone: u8, is_northern: bool, alt: f64) -> Value {
    let utm = we_core::gis::UtmCoord::new(easting, northing, zone, is_northern, alt);
    let coord = we_core::gis::utm_to_geo(&utm);
    serde_json::json!({ "lat": coord.lat, "lon": coord.lon, "alt": coord.alt })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_opendrive_command() {
        let xml =
            r#"<?xml version="1.0"?><OpenDRIVE><header revMajor="1" revMinor="6"/></OpenDRIVE>"#;
        let result = parse_opendrive(xml);
        assert!(result.is_ok());
    }

    #[test]
    fn test_write_opendrive_command() {
        let project = serde_json::json!({
            "name": "test",
            "header": {
                "rev_major": 1,
                "rev_minor": 6,
                "name": "",
                "date": "",
                "north": 0.0,
                "south": 0.0,
                "east": 0.0,
                "west": 0.0,
                "geo_reference": null
            },
            "roads": [],
            "junctions": []
        });
        let result = write_opendrive(project);
        assert!(result.is_ok());
        assert!(result.unwrap().contains("OpenDRIVE"));
    }

    #[test]
    fn test_get_version() {
        let version = get_version();
        assert!(!version.is_empty());
    }

    #[test]
    fn test_wgs84_gcj02_roundtrip() {
        let gcj = wgs84_to_gcj02(39.9042, 116.4074, 0.0);
        let lat = gcj["lat"].as_f64().unwrap();
        let lon = gcj["lon"].as_f64().unwrap();
        let wgs = gcj02_to_wgs84(lat, lon, 0.0);
        assert!((wgs["lat"].as_f64().unwrap() - 39.9042).abs() < 1e-6);
        assert!((wgs["lon"].as_f64().unwrap() - 116.4074).abs() < 1e-6);
    }

    #[test]
    fn test_utm_roundtrip() {
        let utm = geo_to_utm(39.9042, 116.4074, 50.0);
        let e = utm["easting"].as_f64().unwrap();
        let n = utm["northing"].as_f64().unwrap();
        let z = utm["zone"].as_u64().unwrap() as u8;
        let is_n = utm["is_northern"].as_bool().unwrap();
        let a = utm["alt"].as_f64().unwrap();
        let geo = utm_to_geo(e, n, z, is_n, a);
        assert!((geo["lat"].as_f64().unwrap() - 39.9042).abs() < 1e-6);
        assert!((geo["lon"].as_f64().unwrap() - 116.4074).abs() < 1e-6);
    }
}
