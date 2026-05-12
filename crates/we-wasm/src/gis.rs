use wasm_bindgen::prelude::*;

/// Convert WGS84 coordinates to GCJ-02.
#[wasm_bindgen]
pub fn wgs84_to_gcj02(lat: f64, lon: f64, alt: f64) -> JsValue {
    let coord = we_core::gis::GeoCoord::new(lat, lon, alt);
    let result = we_core::gis::wgs84_to_gcj02(&coord);
    serde_wasm_bindgen::to_value(&serde_json::json!({
        "lat": result.lat, "lon": result.lon, "alt": result.alt
    }))
    .unwrap_or(JsValue::NULL)
}

/// Convert GCJ-02 coordinates to WGS84.
#[wasm_bindgen]
pub fn gcj02_to_wgs84(lat: f64, lon: f64, alt: f64) -> JsValue {
    let coord = we_core::gis::GeoCoord::new(lat, lon, alt);
    let result = we_core::gis::gcj02_to_wgs84(&coord);
    serde_wasm_bindgen::to_value(&serde_json::json!({
        "lat": result.lat, "lon": result.lon, "alt": result.alt
    }))
    .unwrap_or(JsValue::NULL)
}

/// Convert WGS84 to UTM.
#[wasm_bindgen]
pub fn geo_to_utm(lat: f64, lon: f64, alt: f64) -> JsValue {
    let coord = we_core::gis::GeoCoord::new(lat, lon, alt);
    let utm = we_core::gis::geo_to_utm(&coord);
    serde_wasm_bindgen::to_value(&serde_json::json!({
        "easting": utm.easting,
        "northing": utm.northing,
        "zone": utm.zone,
        "is_northern": utm.is_northern,
        "alt": utm.alt,
    }))
    .unwrap_or(JsValue::NULL)
}

/// Convert UTM to WGS84.
#[wasm_bindgen]
pub fn utm_to_geo(easting: f64, northing: f64, zone: u8, is_northern: bool, alt: f64) -> JsValue {
    let utm = we_core::gis::UtmCoord::new(easting, northing, zone, is_northern, alt);
    let coord = we_core::gis::utm_to_geo(&utm);
    serde_wasm_bindgen::to_value(&serde_json::json!({
        "lat": coord.lat, "lon": coord.lon, "alt": coord.alt
    }))
    .unwrap_or(JsValue::NULL)
}
