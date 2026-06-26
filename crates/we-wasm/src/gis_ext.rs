//! WASM bindings for extended GIS functions added in Phase 2c.
//!
//! Exposes ECEF conversions, MGRS grid references, Proj4/WKT parsing,
//! and Ground Control Point (GCP) affine transform fitting.

use wasm_bindgen::prelude::*;

// ── ECEF ─────────────────────────────────────────────────────────────────────

/// Convert WGS84 geodetic coordinates to ECEF (Earth-Centered, Earth-Fixed).
///
/// Returns JSON `{ x, y, z }` in metres.
#[wasm_bindgen]
pub fn geodetic_to_ecef(lat_deg: f64, lon_deg: f64, alt_m: f64) -> Result<JsValue, JsError> {
    let ecef = we_core::gis::ecef::geodetic_to_ecef(lat_deg, lon_deg, alt_m);
    serde_wasm_bindgen::to_value(&serde_json::json!({
        "x": ecef.x, "y": ecef.y, "z": ecef.z
    }))
    .map_err(|e| JsError::new(&e.to_string()))
}

/// Convert ECEF coordinates to WGS84 geodetic.
///
/// Returns JSON `{ lat, lon, alt }` (lat/lon in degrees, alt in metres).
#[wasm_bindgen]
pub fn ecef_to_geodetic(x: f64, y: f64, z: f64) -> Result<JsValue, JsError> {
    use we_core::gis::ecef::EcefCoord;
    let (lat, lon, alt) = we_core::gis::ecef::ecef_to_geodetic(EcefCoord { x, y, z });
    serde_wasm_bindgen::to_value(&serde_json::json!({
        "lat": lat, "lon": lon, "alt": alt
    }))
    .map_err(|e| JsError::new(&e.to_string()))
}

// ── MGRS ─────────────────────────────────────────────────────────────────────

/// Convert WGS84 geodetic coordinates to an MGRS grid reference string.
///
/// `precision`: number of digits per easting/northing component (1–5).
/// Returns the MGRS string (e.g. `"50TML1234056780"`) or an error if coordinates
/// are in a polar region (not supported by MGRS).
#[wasm_bindgen]
pub fn geo_to_mgrs(lat_deg: f64, lon_deg: f64, precision: u8) -> Result<String, JsError> {
    let mgrs = we_core::gis::mgrs::geo_to_mgrs(lat_deg, lon_deg, precision)
        .ok_or_else(|| JsError::new("Coordinates are in a polar region (MGRS not defined)"))?;
    Ok(mgrs.format_ref())
}

// ── Proj4 ────────────────────────────────────────────────────────────────────

/// Parse a Proj4 CRS string and return a JSON object with key-value pairs.
///
/// Example input: `"+proj=utm +zone=50 +datum=WGS84 +units=m"`
/// Returns JSON object like `{ "proj": "utm", "zone": "50", "datum": "WGS84", "units": "m" }`.
#[wasm_bindgen]
pub fn parse_proj4_crs(proj4_str: &str) -> Result<JsValue, JsError> {
    let crs = we_core::gis::proj4::Proj4Crs::parse(proj4_str).map_err(|e| JsError::new(&e))?;
    // Collect params into a serde_json::Value map
    let map: serde_json::Map<String, serde_json::Value> = crs
        .params
        .into_iter()
        .map(|(k, v)| (k, serde_json::Value::String(v)))
        .collect();
    serde_wasm_bindgen::to_value(&serde_json::Value::Object(map))
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Project WGS84 geographic coordinates into the CRS described by `proj4_str`.
///
/// Supports `longlat`, `utm`, `tmerc`/`etmerc` and `merc`/`webmerc`.
/// Returns JSON `{ x, y }` in the CRS's units (metres for projected systems).
#[wasm_bindgen]
pub fn proj4_forward(proj4_str: &str, lat_deg: f64, lon_deg: f64) -> Result<JsValue, JsError> {
    use we_core::gis::GeoCoord;
    use we_core::gis::proj4::Proj4Crs;
    let crs = Proj4Crs::parse(proj4_str).map_err(|e| JsError::new(&e))?;
    let (x, y) = crs
        .forward(&GeoCoord::new(lat_deg, lon_deg, 0.0))
        .map_err(|e| JsError::new(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&serde_json::json!({ "x": x, "y": y }))
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Inverse-project `(x, y)` in the CRS described by `proj4_str` back to WGS84.
///
/// Returns JSON `{ lat, lon }` in degrees.
#[wasm_bindgen]
pub fn proj4_inverse(proj4_str: &str, x: f64, y: f64) -> Result<JsValue, JsError> {
    use we_core::gis::proj4::Proj4Crs;
    let crs = Proj4Crs::parse(proj4_str).map_err(|e| JsError::new(&e))?;
    let geo = crs
        .inverse(x, y)
        .map_err(|e| JsError::new(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&serde_json::json!({ "lat": geo.lat, "lon": geo.lon }))
        .map_err(|e| JsError::new(&e.to_string()))
}

// ── WKT ─────────────────────────────────────────────────────────────────────

/// Parse a WKT (Well-Known Text) CRS string and return metadata as JSON.
///
/// Returns JSON `{ crs_type, name, epsg }` where `epsg` may be null.
#[wasm_bindgen]
pub fn parse_wkt_crs(wkt_str: &str) -> Result<JsValue, JsError> {
    let crs = we_core::gis::wkt::WktCrs::parse(wkt_str).map_err(|e| JsError::new(&e))?;
    serde_wasm_bindgen::to_value(&serde_json::json!({
        "crs_type": crs.crs_type,
        "name": crs.name,
        "epsg": crs.epsg,
    }))
    .map_err(|e| JsError::new(&e.to_string()))
}

// ── GCP ─────────────────────────────────────────────────────────────────────

/// Fit an affine transform from Ground Control Points (GCPs).
///
/// `gcps_json`: JSON array of `{ px, py, wx, wy }`.
/// Returns JSON `{ a00, a01, b0, a10, a11, b1 }` where the transform is:
///   `world_x = a00*px + a01*py + b0`
///   `world_y = a10*px + a11*py + b1`
/// Returns an error if fewer than 3 GCPs are provided.
#[wasm_bindgen]
pub fn fit_affine_from_gcps(gcps_json: &str) -> Result<JsValue, JsError> {
    let gcps: Vec<we_core::gis::gcp::Gcp> =
        serde_json::from_str(gcps_json).map_err(|e| JsError::new(&e.to_string()))?;
    let t = we_core::gis::gcp::fit_affine(&gcps).map_err(|e| JsError::new(&e))?;
    serde_wasm_bindgen::to_value(&serde_json::json!({
        "a00": t.a00, "a01": t.a01, "b0": t.b0,
        "a10": t.a10, "a11": t.a11, "b1": t.b1,
    }))
    .map_err(|e| JsError::new(&e.to_string()))
}

/// Apply a previously fitted affine transform to a point.
///
/// `transform_json`: JSON `{ a00, a01, b0, a10, a11, b1 }`.
/// Returns JSON `{ x, y }`.
#[wasm_bindgen]
pub fn apply_affine_transform(
    transform_json: &str,
    source_x: f64,
    source_y: f64,
) -> Result<JsValue, JsError> {
    // Parse the flat JSON into AffineTransform fields manually
    let v: serde_json::Value =
        serde_json::from_str(transform_json).map_err(|e| JsError::new(&e.to_string()))?;
    let get = |key: &str| -> Result<f64, JsError> {
        v.get(key)
            .and_then(|x| x.as_f64())
            .ok_or_else(|| JsError::new(&format!("Missing or invalid field '{key}'")))
    };
    let t = we_core::gis::gcp::AffineTransform {
        a00: get("a00")?,
        a01: get("a01")?,
        b0: get("b0")?,
        a10: get("a10")?,
        a11: get("a11")?,
        b1: get("b1")?,
    };
    let (tx, ty) = t.apply(source_x, source_y);
    serde_wasm_bindgen::to_value(&serde_json::json!({ "x": tx, "y": ty }))
        .map_err(|e| JsError::new(&e.to_string()))
}

#[cfg(test)]
mod tests {

    #[test]
    fn test_geodetic_to_ecef_roundtrip_logic() {
        // Test the underlying core function directly (not via wasm_bindgen)
        let ecef = we_core::gis::ecef::geodetic_to_ecef(39.9042, 116.4074, 50.0);
        let (lat, lon, alt) = we_core::gis::ecef::ecef_to_geodetic(ecef);
        assert!((lat - 39.9042).abs() < 1e-7);
        assert!((lon - 116.4074).abs() < 1e-7);
        assert!((alt - 50.0).abs() < 0.001);
    }

    #[test]
    fn test_mgrs_roundtrip_logic() {
        let mgrs = we_core::gis::mgrs::geo_to_mgrs(39.9042, 116.4074, 5);
        assert!(mgrs.is_some(), "should produce MGRS for Beijing");
        let s = mgrs.unwrap().format_ref();
        assert!(!s.is_empty());
    }

    #[test]
    fn test_proj4_parse_logic() {
        let crs = we_core::gis::proj4::Proj4Crs::parse("+proj=utm +zone=50 +datum=WGS84").unwrap();
        assert_eq!(crs.proj_type(), "utm");
    }

    #[test]
    fn test_wkt_parse_logic() {
        let wkt = r#"GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],AUTHORITY["EPSG","4326"]]"#;
        let crs = we_core::gis::wkt::WktCrs::parse(wkt).unwrap();
        assert_eq!(crs.crs_type, "GEOGCS");
        assert_eq!(crs.epsg, Some(4326));
    }

    #[test]
    fn test_gcp_affine_fit_logic() {
        use we_core::gis::gcp::{Gcp, fit_affine};
        let gcps = vec![
            Gcp::new(0.0, 0.0, 100.0, 200.0),
            Gcp::new(1.0, 0.0, 101.0, 200.0),
            Gcp::new(0.0, 1.0, 100.0, 201.0),
        ];
        let t = fit_affine(&gcps).unwrap();
        let (wx, wy) = t.apply(5.0, 10.0);
        assert!((wx - 105.0).abs() < 1e-9);
        assert!((wy - 210.0).abs() < 1e-9);
    }
}
