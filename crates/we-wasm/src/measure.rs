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

#[cfg(not(target_arch = "wasm32"))]
#[cfg(test)]
mod tests {
    use we_core::measurement::{measure_distance, measure_angle, measure_road_length};
    use we_core::model::{Road, Geometry, GeometryType};

    fn simple_road(length: f64) -> Road {
        Road::from_centerline("r1", vec![Geometry {
            s: 0.0, x: 0.0, y: 0.0, hdg: 0.0, length,
            geo_type: GeometryType::Line,
        }])
    }

    #[test]
    fn test_measure_distance_same_point_is_zero() {
        let result = measure_distance(1.0, 2.0, 3.0, 1.0, 2.0, 3.0);
        assert!(result.straight.abs() < 1e-12);
    }

    #[test]
    fn test_measure_distance_horizontal() {
        let result = measure_distance(0.0, 0.0, 0.0, 3.0, 4.0, 0.0);
        assert!((result.horizontal - 5.0).abs() < 1e-9, "horizontal = {}", result.horizontal);
        assert!(result.vertical.abs() < 1e-9);
    }

    #[test]
    fn test_measure_distance_3d_pythagoras() {
        let result = measure_distance(0.0, 0.0, 0.0, 1.0, 0.0, 0.0);
        assert!((result.straight - 1.0).abs() < 1e-9);
    }

    #[test]
    fn test_measure_angle_right_angle() {
        // p1=(1,0), p2=(0,0), p3=(0,1) → 90°
        let result = measure_angle(1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
        assert!((result.degrees - 90.0).abs() < 1e-9, "degrees = {}", result.degrees);
    }

    #[test]
    fn test_measure_road_length_full() {
        let road = simple_road(100.0);
        let len = measure_road_length(&road, 0.0, 100.0);
        assert!((len - 100.0).abs() < 1e-9);
    }

    #[test]
    fn test_measure_road_length_partial() {
        let road = simple_road(100.0);
        let len = measure_road_length(&road, 20.0, 70.0);
        assert!((len - 50.0).abs() < 1e-9);
    }
}
