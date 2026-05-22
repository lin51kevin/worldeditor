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

#[cfg(not(target_arch = "wasm32"))]
#[cfg(test)]
mod tests {
    use we_core::gis::{GeoCoord, gcj02_to_wgs84, geo_to_utm, utm_to_geo, wgs84_to_gcj02};

    #[test]
    fn test_wgs84_gcj02_roundtrip_near_origin() {
        // Use a coordinate in China where GCJ-02 offset is non-zero
        let original = GeoCoord::new(39.9042, 116.4074, 0.0); // Beijing
        let gcj = wgs84_to_gcj02(&original);
        let back = gcj02_to_wgs84(&gcj);
        assert!(
            (back.lat - original.lat).abs() < 1e-4,
            "lat diff = {}",
            (back.lat - original.lat).abs()
        );
        assert!(
            (back.lon - original.lon).abs() < 1e-4,
            "lon diff = {}",
            (back.lon - original.lon).abs()
        );
    }

    #[test]
    fn test_gcj02_differs_from_wgs84_in_china() {
        let coord = GeoCoord::new(39.9042, 116.4074, 0.0);
        let gcj = wgs84_to_gcj02(&coord);
        // In China, GCJ-02 offset should be non-zero
        let delta = ((gcj.lat - coord.lat).powi(2) + (gcj.lon - coord.lon).powi(2)).sqrt();
        assert!(delta > 1e-5, "Expected GCJ-02 offset, got delta={delta}");
    }

    #[test]
    fn test_utm_roundtrip() {
        let coord = GeoCoord::new(39.9042, 116.4074, 10.0);
        let utm = geo_to_utm(&coord);
        let back = utm_to_geo(&utm);
        assert!((back.lat - coord.lat).abs() < 1e-4);
        assert!((back.lon - coord.lon).abs() < 1e-4);
    }

    #[test]
    fn test_utm_northern_hemisphere() {
        let coord = GeoCoord::new(48.8566, 2.3522, 0.0); // Paris
        let utm = geo_to_utm(&coord);
        assert!(utm.is_northern, "Paris should be in northern hemisphere");
    }
}
