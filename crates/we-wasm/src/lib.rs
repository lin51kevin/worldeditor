//! WorldEditor WASM entry point.
//!
//! Exports we-core + we-service functions to JavaScript via wasm-bindgen.

use wasm_bindgen::prelude::*;

// Set up better panic messages in the browser console.
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
    console_log::init_with_level(log::Level::Info).unwrap_or(());
    log::info!("WorldEditor WASM initialized (v{})", we_core::VERSION);
}

/// Parse an OpenDRIVE XML string and return the project as JSON.
#[wasm_bindgen]
pub fn parse_opendrive(xml: &str) -> Result<JsValue, JsError> {
    let project = we_core::opendrive::parse_xodr(xml).map_err(|e| JsError::new(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&project).map_err(|e| JsError::new(&e.to_string()))
}

/// Serialize a project (as JSON) to OpenDRIVE XML.
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

/// Generate road mesh vertices from a project JSON. Returns vertex data as Float32Array.
///
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
/// This is used by the WebGPU renderer in the frontend.
#[wasm_bindgen]
pub fn generate_road_vertices(project_json: &str, sample_step: f64) -> Result<Vec<f32>, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut all_floats = Vec::new();
    for road in &project.roads {
        let verts = we_core::geometry::eval::sample_road_reference_line(road, sample_step);
        let color = [0.35_f32, 0.35, 0.38, 1.0]; // asphalt
        let mesh_verts = generate_road_ribbon(road, &verts, color);
        for v in &mesh_verts {
            all_floats.extend_from_slice(&[
                v[0], v[1], v[2], // position
                v[3], v[4], v[5], v[6], // color
            ]);
        }
    }
    Ok(all_floats)
}

/// Generate road mesh vertices for a single road. Returns Float32Array.
///
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
/// The `color` parameter is [r, g, b, a] in 0..1 range.
#[wasm_bindgen]
pub fn generate_single_road_vertices(
    road_json: &str,
    sample_step: f64,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
) -> Result<Vec<f32>, JsError> {
    let road: we_core::model::Road =
        serde_json::from_str(road_json).map_err(|e| JsError::new(&e.to_string()))?;

    let ref_pts = we_core::geometry::eval::sample_road_reference_line(&road, sample_step);
    let mesh_verts = generate_road_ribbon(&road, &ref_pts, [r, g, b, a]);

    let mut floats = Vec::with_capacity(mesh_verts.len() * 7);
    for v in &mesh_verts {
        floats.extend_from_slice(&[v[0], v[1], v[2], v[3], v[4], v[5], v[6]]);
    }
    Ok(floats)
}

/// Find the closest road to a world-space point.
///
/// Returns the road ID as a string, or null if no road is within the threshold.
#[wasm_bindgen]
pub fn pick_road_at_point(
    project_json: &str,
    x: f64,
    y: f64,
    threshold: f64,
) -> Result<JsValue, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut best_road_id: Option<String> = None;
    let mut best_dist = threshold;

    for road in &project.roads {
        let ref_pts = we_core::geometry::eval::sample_road_reference_line(road, 2.0);
        for pt in &ref_pts {
            let dx = pt.x - x;
            let dy = pt.y - y;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist < best_dist {
                best_dist = dist;
                best_road_id = Some(road.id.clone());
            }
        }
    }

    match best_road_id {
        Some(id) => Ok(JsValue::from_str(&id)),
        None => Ok(JsValue::NULL),
    }
}

/// Simple road ribbon generation for WASM (no wgpu dependency).
fn generate_road_ribbon(
    road: &we_core::model::Road,
    ref_pts: &[we_core::geometry::eval::RefLinePoint],
    color: [f32; 4],
) -> Vec<[f32; 7]> {
    use we_core::geometry::eval::{evaluate_elevation, offset_point};

    let half_width = 3.5; // default half-width
    let mut verts = Vec::new();

    if ref_pts.len() < 2 {
        return verts;
    }

    for i in 0..ref_pts.len() - 1 {
        let pt0 = &ref_pts[i];
        let pt1 = &ref_pts[i + 1];

        let z0 = evaluate_elevation(&road.elevation_profile, pt0.s) as f32;
        let z1 = evaluate_elevation(&road.elevation_profile, pt1.s) as f32;

        let (lx0, ly0, _) = offset_point(pt0, half_width, 0.0);
        let (rx0, ry0, _) = offset_point(pt0, -half_width, 0.0);
        let (lx1, ly1, _) = offset_point(pt1, half_width, 0.0);
        let (rx1, ry1, _) = offset_point(pt1, -half_width, 0.0);

        verts.push([
            lx0 as f32, ly0 as f32, z0, color[0], color[1], color[2], color[3],
        ]);
        verts.push([
            rx0 as f32, ry0 as f32, z0, color[0], color[1], color[2], color[3],
        ]);
        verts.push([
            lx1 as f32, ly1 as f32, z1, color[0], color[1], color[2], color[3],
        ]);

        verts.push([
            rx0 as f32, ry0 as f32, z0, color[0], color[1], color[2], color[3],
        ]);
        verts.push([
            rx1 as f32, ry1 as f32, z1, color[0], color[1], color[2], color[3],
        ]);
        verts.push([
            lx1 as f32, ly1 as f32, z1, color[0], color[1], color[2], color[3],
        ]);
    }

    verts
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn test_version() {
        let v = version();
        assert!(!v.is_empty());
    }

    #[wasm_bindgen_test]
    fn test_parse_opendrive() {
        let xml =
            r#"<?xml version="1.0"?><OpenDRIVE><header revMajor="1" revMinor="6"/></OpenDRIVE>"#;
        let result = parse_opendrive(xml);
        assert!(result.is_ok());
    }
}
