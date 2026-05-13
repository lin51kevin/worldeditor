use wasm_bindgen::prelude::*;

/// Measure the distance between two 3D points.
///
/// Returns JSON `{ straight, horizontal, vertical }`.
#[wasm_bindgen]
pub fn measure_distance(
    x1: f64,
    y1: f64,
    z1: f64,
    x2: f64,
    y2: f64,
    z2: f64,
) -> Result<JsValue, JsError> {
    let result = we_core::measurement::measure_distance(x1, y1, z1, x2, y2, z2);
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Measure the angle at a vertex (p2) formed by p1-p2-p3.
///
/// Returns JSON `{ radians, degrees }`.
#[wasm_bindgen]
pub fn measure_angle(
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
    x3: f64,
    y3: f64,
) -> Result<JsValue, JsError> {
    let result = we_core::measurement::measure_angle(x1, y1, x2, y2, x3, y3);
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Measure the area and perimeter of a polygon.
///
/// `points_json` is a JSON array of `[x, y]` pairs.
/// Returns JSON `{ area, perimeter }`.
#[wasm_bindgen]
pub fn measure_area(points_json: &str) -> Result<JsValue, JsError> {
    let points: Vec<[f64; 2]> =
        serde_json::from_str(points_json).map_err(|e| JsError::new(&e.to_string()))?;
    let result = we_core::measurement::measure_polygon_area(&points);
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Measure the arc length along a road between two stations.
#[wasm_bindgen]
pub fn measure_road_length(road_json: &str, s_start: f64, s_end: f64) -> Result<f64, JsError> {
    let road: we_core::model::Road =
        serde_json::from_str(road_json).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(we_core::measurement::measure_road_length(
        &road, s_start, s_end,
    ))
}

/// Sample a lane boundary polyline as JSON.
///
/// Returns JSON array of `{ x, y, z, s, t }` points.
#[wasm_bindgen]
pub fn sample_lane_boundary(
    road_json: &str,
    section_s: f64,
    lane_id: i32,
    step: f64,
) -> Result<String, JsError> {
    let road: we_core::model::Road =
        serde_json::from_str(road_json).map_err(|e| JsError::new(&e.to_string()))?;
    let points = we_core::lane_ops::sample_lane_boundary(&road, section_s, lane_id, step);
    serde_json::to_string(&points).map_err(|e| JsError::new(&e.to_string()))
}

/// Compute total road width (left, right) at a given s position.
///
/// Returns JSON: `{ "left": number, "right": number }`.
#[wasm_bindgen]
pub fn compute_road_width(road_json: &str, s: f64) -> Result<JsValue, JsError> {
    let road: we_core::model::Road =
        serde_json::from_str(road_json).map_err(|e| JsError::new(&e.to_string()))?;

    // Find the active lane section at s
    let section = road
        .lane_sections
        .iter()
        .rev()
        .find(|sec| sec.s <= s + 1e-9);

    match section {
        Some(sec) => {
            let ds = s - sec.s;
            let (left, right) = we_core::lane_ops::compute_road_width_at(sec, ds);
            let result = serde_json::json!({ "left": left, "right": right });
            serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
        }
        None => Ok(JsValue::NULL),
    }
}
