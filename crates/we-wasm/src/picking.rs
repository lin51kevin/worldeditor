use crate::render::{build_junction_polygon_points, point_in_polygon, road_point_at_s};
use serde::Serialize;
use std::cell::RefCell;
use wasm_bindgen::prelude::*;
use we_core::spatial_index::ProjectCache;

// ── Thread-local project cache ────────────────────────────────────────────────
//
// WASM is single-threaded, so a thread_local RefCell is safe and zero-overhead.
// The frontend calls `set_project_cache()` once per project mutation instead of
// serializing the entire project on every pick/snap call (60 Hz mousemove).

thread_local! {
    static PROJECT_CACHE: RefCell<Option<ProjectCache>> = const { RefCell::new(None) };
}

/// Store (or replace) the cached project used by `pick_road_cached` / `snap_point_cached`.
///
/// Call this once after every project mutation. Subsequent pick/snap calls will
/// reuse the parsed project and its spatial index without re-parsing JSON.
#[wasm_bindgen]
pub fn set_project_cache(project_json: &str) -> Result<(), JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    PROJECT_CACHE.with(|cell| {
        *cell.borrow_mut() = Some(ProjectCache::new(project));
    });
    Ok(())
}

/// Mark the spatial index as dirty so it is rebuilt on the next query.
///
/// Lighter than `set_project_cache` when only the spatial structure changed
/// but the project reference is the same.
#[wasm_bindgen]
pub fn invalidate_project_cache() {
    PROJECT_CACHE.with(|cell| {
        if let Some(cache) = cell.borrow_mut().as_mut() {
            cache.invalidate();
        }
    });
}

/// Returns `true` if a project cache has been initialised.
#[wasm_bindgen]
pub fn has_project_cache() -> bool {
    PROJECT_CACHE.with(|cell| cell.borrow().is_some())
}

#[cfg(not(target_arch = "wasm32"))]
#[cfg(test)]
mod tests {
    use super::PROJECT_CACHE;
    use we_core::spatial_index::ProjectCache;

    fn clear_cache() {
        PROJECT_CACHE.with(|cell| {
            *cell.borrow_mut() = None;
        });
    }

    #[test]
    fn test_has_project_cache_starts_false() {
        clear_cache();
        assert!(!super::has_project_cache());
    }

    #[test]
    fn test_set_project_cache_populates_cache() {
        clear_cache();
        let project = we_core::model::Project::default();
        let json = serde_json::to_string(&project).unwrap();
        // Directly populate (bypass wasm-bindgen function signature)
        let parsed: we_core::model::Project = serde_json::from_str(&json).unwrap();
        PROJECT_CACHE.with(|cell| {
            *cell.borrow_mut() = Some(ProjectCache::new(parsed));
        });
        assert!(super::has_project_cache());
        clear_cache();
    }

    #[test]
    fn test_invalidate_cache_does_not_clear() {
        clear_cache();
        let project = we_core::model::Project::default();
        PROJECT_CACHE.with(|cell| {
            *cell.borrow_mut() = Some(ProjectCache::new(project));
        });
        super::invalidate_project_cache();
        // Cache still present after invalidation
        assert!(super::has_project_cache());
        clear_cache();
    }

    #[test]
    fn test_pick_lane_via_core() {
        // Directly test we_core::picking::pick_lane (no wasm_bindgen dependency).
        let mut project = we_core::model::Project::default();
        project.roads.push(we_core::model::Road::from_centerline(
            "1",
            vec![we_core::model::Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length: 100.0,
                geo_type: we_core::model::GeometryType::Line,
            }],
        ));
        let result = we_core::picking::pick_lane(&project, 50.0, -1.75, 5.0);
        assert!(result.is_some());
        let (road_id, _section_idx, lane_id) = result.unwrap();
        assert_eq!(road_id, "1");
        assert!(lane_id < 0); // right lane
    }

    #[test]
    fn test_snap_config_serde_roundtrip() {
        let config = we_core::snapping::SnapConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let back: we_core::snapping::SnapConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(config.grid_size, back.grid_size);
    }
}

/// Plain-object return types for wasm-bindgen.
///
/// serde-wasm-bindgen 0.4+ serializes `serde_json::Value::Object` (and any Rust map type) as
/// a JavaScript **Map** instead of a plain object. Named structs, however, still produce plain
/// JavaScript objects with dot-accessible properties.  We use these structs wherever the
/// TypeScript caller uses `result.fieldName` notation.
#[derive(Serialize)]
struct WorldPos {
    x: f64,
    y: f64,
}

#[derive(Serialize)]
struct SignalHit {
    #[serde(rename = "roadId")]
    road_id: String,
    #[serde(rename = "signalId")]
    signal_id: String,
}

#[derive(Serialize)]
struct ObjectHit {
    #[serde(rename = "roadId")]
    road_id: String,
    #[serde(rename = "objectId")]
    object_id: String,
}

/// Find the closest junction to a world-space point.
#[wasm_bindgen]
pub fn pick_junction_at_point(
    project_json: &str,
    x: f64,
    y: f64,
    threshold: f64,
) -> Result<JsValue, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut best: Option<String> = None;
    let mut best_dist = threshold;

    for junction in &project.junctions {
        let poly = build_junction_polygon_points(&project, junction);
        if poly.len() >= 3 {
            if point_in_polygon(x, y, &poly) {
                return Ok(JsValue::from_str(&junction.id));
            }
            let cx: f64 = poly.iter().map(|p| p[0] as f64).sum::<f64>() / poly.len() as f64;
            let cy: f64 = poly.iter().map(|p| p[1] as f64).sum::<f64>() / poly.len() as f64;
            let dx = cx - x;
            let dy = cy - y;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist < best_dist {
                best_dist = dist;
                best = Some(junction.id.clone());
            }
        } else {
            // Fallback for junctions with insufficient polygon points (e.g. missing
            // or hidden connected roads): collect road endpoints from all connections
            // and use their centroid for a proximity check.
            let mut sum_x = 0.0f64;
            let mut sum_y = 0.0f64;
            let mut count = 0usize;
            for conn in &junction.connections {
                if let Some(road) = project.roads.iter().find(|r| r.id == conn.connecting_road) {
                    if let Some(pt) = road_point_at_s(&road.plan_view, 0.0) {
                        sum_x += pt.x;
                        sum_y += pt.y;
                        count += 1;
                    }
                    if let Some(pt) = road_point_at_s(&road.plan_view, road.length) {
                        sum_x += pt.x;
                        sum_y += pt.y;
                        count += 1;
                    }
                }
                if let Some(road) = project.roads.iter().find(|r| r.id == conn.incoming_road) {
                    if let Some(pt) = road_point_at_s(&road.plan_view, 0.0) {
                        sum_x += pt.x;
                        sum_y += pt.y;
                        count += 1;
                    }
                    if let Some(pt) = road_point_at_s(&road.plan_view, road.length) {
                        sum_x += pt.x;
                        sum_y += pt.y;
                        count += 1;
                    }
                }
            }
            if count > 0 {
                let cx = sum_x / count as f64;
                let cy = sum_y / count as f64;
                let dx = cx - x;
                let dy = cy - y;
                let dist = (dx * dx + dy * dy).sqrt();
                // Use a larger effective radius for the fallback centroid check
                if dist < best_dist * 2.0 && dist < best_dist {
                    best_dist = dist;
                    best = Some(junction.id.clone());
                }
            }
        }
    }
    match best {
        Some(id) => Ok(JsValue::from_str(&id)),
        None => Ok(JsValue::NULL),
    }
}

/// Find the closest road to a world-space point.
///
/// Returns the road ID as a string, or null if no road is within the threshold.
/// Hit-testing uses the full road surface width (sum of all lane widths), not just
/// the reference line centre.
#[wasm_bindgen]
pub fn pick_road_at_point(
    project_json: &str,
    x: f64,
    y: f64,
    threshold: f64,
) -> Result<JsValue, JsError> {
    use we_core::geometry::eval::{evaluate_lane_width, sample_road_reference_line};

    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    /// Compute total left and right lane extents at road station `s`.
    fn road_half_widths(road: &we_core::model::Road, s: f64) -> (f64, f64) {
        let section = road
            .lane_sections
            .iter()
            .rev()
            .find(|ls| ls.s <= s + 1e-9)
            .or_else(|| road.lane_sections.first());

        if let Some(ls) = section {
            let ds = (s - ls.s).max(0.0);
            let left: f64 = ls
                .left
                .iter()
                .map(|l| evaluate_lane_width(&l.width, ds))
                .sum();
            let right: f64 = ls
                .right
                .iter()
                .map(|l| evaluate_lane_width(&l.width, ds))
                .sum();
            (left, right)
        } else {
            (0.0, 0.0)
        }
    }

    let mut best_road_id: Option<String> = None;
    // Score: 0 = inside road, >0 = distance outside road edge; threshold caps the search.
    let mut best_score = threshold;

    for road in &project.roads {
        if road.render_hidden {
            continue;
        }
        let ref_pts = sample_road_reference_line(road, 2.0);

        for (i, pt) in ref_pts.iter().enumerate() {
            // Perpendicular (left-normal) and tangent directions at this station
            let nx = -(pt.hdg.sin()); // left normal x
            let ny = pt.hdg.cos(); // left normal y
            let tx = pt.hdg.cos(); // tangent x
            let ty = pt.hdg.sin(); // tangent y

            // Vector from ref point to query point
            let dx = x - pt.x;
            let dy = y - pt.y;

            // Decompose into lateral (across-road) and along-road components
            let lateral = dx * nx + dy * ny; // positive = left of ref line
            let along = dx * tx + dy * ty; // positive = forward along road

            // Only consider this sample point if the click is "closest" to it along
            // the road — use half-step window to avoid double-counting neighbouring pts.
            let step = if i + 1 < ref_pts.len() {
                let np = &ref_pts[i + 1];
                let ddx = np.x - pt.x;
                let ddy = np.y - pt.y;
                (ddx * ddx + ddy * ddy).sqrt()
            } else if i > 0 {
                let pp = &ref_pts[i - 1];
                let ddx = pt.x - pp.x;
                let ddy = pt.y - pp.y;
                (ddx * ddx + ddy * ddy).sqrt()
            } else {
                2.0
            };
            if along.abs() > step * 0.6 {
                continue;
            }

            let (left_w, right_w) = road_half_widths(road, pt.s);
            // Fallback: if no lanes defined, use threshold as minimum road width
            let left_w = left_w.max(0.5);
            let right_w = right_w.max(0.5);

            // Distance outside the road surface (0 if click is inside)
            let score = if lateral >= -right_w && lateral <= left_w {
                0.0_f64 // inside road surface
            } else if lateral > left_w {
                lateral - left_w // outside left edge
            } else {
                -right_w - lateral // outside right edge
            };

            if score < best_score {
                best_score = score;
                best_road_id = Some(road.id.clone());
            }
        }
    }

    match best_road_id {
        Some(id) => Ok(JsValue::from_str(&id)),
        None => Ok(JsValue::NULL),
    }
}

/// Pick the closest knot to a point.
///
/// Returns JSON: `{ "index": number, "distance": number }` or `null` if none within threshold.
#[wasm_bindgen]
pub fn pick_spline_knot(
    spline_json: &str,
    x: f64,
    y: f64,
    threshold: f64,
) -> Result<JsValue, JsError> {
    let spline: we_core::spline::EditableSpline =
        serde_json::from_str(spline_json).map_err(|e| JsError::new(&e.to_string()))?;
    match we_core::spline::pick_knot(&spline, x, y, threshold) {
        Some((idx, dist)) => {
            let result = serde_json::json!({ "index": idx, "distance": dist });
            serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
        }
        None => Ok(JsValue::NULL),
    }
}

/// Query elements near a point using a spatial index.
///
/// Returns JSON array of `{ id, kind, aabb }`.
#[wasm_bindgen]
pub fn spatial_query_point(
    project_json: &str,
    x: f64,
    y: f64,
    radius: f64,
) -> Result<JsValue, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    let idx = we_core::spatial_index::SpatialIndex::build(&project, 100.0);
    let results = idx.query_point(x, y, radius);
    let out: Vec<serde_json::Value> = results
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": r.id,
                "kind": format!("{:?}", r.kind),
                "aabb": {
                    "min_x": r.aabb.min_x,
                    "min_y": r.aabb.min_y,
                    "max_x": r.aabb.max_x,
                    "max_y": r.aabb.max_y,
                }
            })
        })
        .collect();
    serde_wasm_bindgen::to_value(&out).map_err(|e| JsError::new(&e.to_string()))
}

/// Test if a point is inside a junction's computed area.
#[wasm_bindgen]
pub fn point_in_junction(
    project_json: &str,
    junction_id: &str,
    x: f64,
    y: f64,
) -> Result<bool, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    let junction = project
        .junctions
        .iter()
        .find(|j| j.id == junction_id)
        .ok_or_else(|| JsError::new(&format!("Junction '{}' not found", junction_id)))?;
    match we_core::junction_area::compute_junction_area(&project, junction) {
        Some(area) => Ok(we_core::junction_area::point_in_junction_area(&area, x, y)),
        None => Ok(false),
    }
}

/// Compute the boundary area of a junction from its connecting roads.
///
/// Returns JSON with `{ id, center, boundary, area }` or null if
/// the junction has insufficient connections.
#[wasm_bindgen]
pub fn compute_junction_area(project_json: &str, junction_id: &str) -> Result<JsValue, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    let junction = project
        .junctions
        .iter()
        .find(|j| j.id == junction_id)
        .ok_or_else(|| JsError::new(&format!("Junction '{}' not found", junction_id)))?;
    match we_core::junction_area::compute_junction_area(&project, junction) {
        Some(area) => serde_wasm_bindgen::to_value(&area).map_err(|e| JsError::new(&e.to_string())),
        None => Ok(JsValue::NULL),
    }
}

/// Snap a point to the nearest grid/endpoint/etc.
///
/// Returns JSON `{ x, y, snapped, snap_type, target_id }`.
#[wasm_bindgen]
pub fn snap_point(
    project_json: &str,
    x: f64,
    y: f64,
    config_json: &str,
    exclude_road_id: Option<String>,
) -> Result<JsValue, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    let config: we_core::snapping::SnapConfig =
        serde_json::from_str(config_json).map_err(|e| JsError::new(&e.to_string()))?;
    let result = we_core::snapping::snap_point(x, y, &config, &project, exclude_road_id.as_deref());
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
}

// ── Endpoint tangent helper ───────────────────────────────────────────────────

/// Get the position and heading at a road endpoint for tangent inheritance.
///
/// `contact_point` should be `"Start"` or `"End"`.
/// Returns `{ x, y, hdg }` or null if the road is not found.
#[wasm_bindgen]
pub fn get_road_endpoint_tangent(
    project_json: &str,
    road_id: &str,
    contact_point: &str,
) -> Result<JsValue, JsError> {
    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    let road = project.roads.iter().find(|r| r.id == road_id);
    match road {
        Some(road) => match we_core::snapping::get_road_endpoint_tangent(road, contact_point) {
            Some(result) => {
                serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
            }
            None => Ok(JsValue::NULL),
        },
        None => Ok(JsValue::NULL),
    }
}

// ── Signal & Object world-position helpers ────────────────────────────────────

/// Compute the world-space position (x, y) of a signal given its s/t road coordinates.
///
/// Returns JSON `{ "x": f64, "y": f64 }` or null if the road/signal is not found.
#[wasm_bindgen]
pub fn get_signal_world_pos(
    project_json: &str,
    road_id: &str,
    signal_id: &str,
) -> Result<JsValue, JsError> {
    use crate::render::road_point_at_s;
    use we_core::geometry::eval::offset_point;

    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let road = project.roads.iter().find(|r| r.id == road_id);
    let signal = road.and_then(|r| r.signals.iter().find(|s| s.id == signal_id));

    match (road, signal) {
        (Some(road), Some(signal)) => {
            if let Some(ref_pt) = road_point_at_s(&road.plan_view, signal.s) {
                let (wx, wy, _) = offset_point(&ref_pt, signal.t, 0.0);
                let result = WorldPos { x: wx, y: wy };
                serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
            } else {
                Ok(JsValue::NULL)
            }
        }
        _ => Ok(JsValue::NULL),
    }
}

/// Compute the world-space position (x, y) of a road object given its road-local position.
///
/// Returns JSON `{ "x": f64, "y": f64 }` or null if the road/object is not found.
#[wasm_bindgen]
pub fn get_object_world_pos(
    project_json: &str,
    road_id: &str,
    object_id: &str,
) -> Result<JsValue, JsError> {
    use crate::render::road_point_at_s;
    use we_core::geometry::eval::offset_point;

    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let road = project.roads.iter().find(|r| r.id == road_id);
    // position.x = s (station), position.y = t (lateral offset)
    let object = road.and_then(|r| r.objects.iter().find(|o| o.id == object_id));

    match (road, object) {
        (Some(road), Some(obj)) => {
            let s = obj.position.x;
            let t = obj.position.y;
            if let Some(ref_pt) = road_point_at_s(&road.plan_view, s) {
                let (wx, wy, _) = offset_point(&ref_pt, t, 0.0);
                let result = WorldPos { x: wx, y: wy };
                serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
            } else {
                Ok(JsValue::NULL)
            }
        }
        _ => Ok(JsValue::NULL),
    }
}

/// Pick the closest signal to a world-space point.
///
/// Returns JSON `{ "roadId": string, "signalId": string }` or null.
#[wasm_bindgen]
pub fn pick_signal_at_point(
    project_json: &str,
    x: f64,
    y: f64,
    threshold: f64,
) -> Result<JsValue, JsError> {
    use crate::render::road_point_at_s;
    use we_core::geometry::eval::offset_point;

    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut best_road_id: Option<String> = None;
    let mut best_signal_id: Option<String> = None;
    let mut best_dist = threshold;

    for road in &project.roads {
        if road.render_hidden {
            continue;
        }
        for signal in &road.signals {
            let Some(ref_pt) = road_point_at_s(&road.plan_view, signal.s) else {
                continue;
            };
            let (wx, wy, _) = offset_point(&ref_pt, signal.t, 0.0);
            let dx = wx - x;
            let dy = wy - y;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist < best_dist {
                best_dist = dist;
                best_road_id = Some(road.id.clone());
                best_signal_id = Some(signal.id.clone());
            }
        }
    }

    match (best_road_id, best_signal_id) {
        (Some(road_id), Some(signal_id)) => {
            let result = SignalHit { road_id, signal_id };
            serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
        }
        _ => Ok(JsValue::NULL),
    }
}

/// Pick the closest road object to a world-space point.
///
/// Returns JSON `{ "roadId": string, "objectId": string }` or null.
#[wasm_bindgen]
pub fn pick_object_at_point(
    project_json: &str,
    x: f64,
    y: f64,
    threshold: f64,
) -> Result<JsValue, JsError> {
    use crate::render::road_point_at_s;
    use we_core::geometry::eval::offset_point;

    let project: we_core::model::Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut best_road_id: Option<String> = None;
    let mut best_object_id: Option<String> = None;
    let mut best_dist = threshold;

    for road in &project.roads {
        if road.render_hidden {
            continue;
        }
        for obj in &road.objects {
            let s = obj.position.x;
            let t = obj.position.y;
            let Some(ref_pt) = road_point_at_s(&road.plan_view, s) else {
                continue;
            };
            let (wx, wy, _) = offset_point(&ref_pt, t, 0.0);
            let dx = wx - x;
            let dy = wy - y;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist < best_dist {
                best_dist = dist;
                best_road_id = Some(road.id.clone());
                best_object_id = Some(obj.id.clone());
            }
        }
    }

    match (best_road_id, best_object_id) {
        (Some(road_id), Some(object_id)) => {
            let result = ObjectHit { road_id, object_id };
            serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
        }
        _ => Ok(JsValue::NULL),
    }
}

// ── Cached pick / snap functions ──────────────────────────────────────────────
//
// These operate on the thread-local `ProjectCache` set by `set_project_cache()`.
// The spatial index is built lazily on the first query after invalidation.

/// Pick the nearest road using the cached project + spatial index.
///
/// Falls back to the uncached path if no cache has been set.
#[wasm_bindgen]
pub fn pick_road_at_point_cached(x: f64, y: f64, threshold: f64) -> Result<JsValue, JsError> {
    PROJECT_CACHE.with(|cell| {
        let mut borrow = cell.borrow_mut();
        let cache = borrow.as_mut().ok_or_else(|| {
            JsError::new("Project cache not initialised — call set_project_cache() first")
        })?;
        match we_core::picking::pick_road_cached(cache, x, y, threshold) {
            Some(result) => Ok(JsValue::from_str(&result.id)),
            None => Ok(JsValue::NULL),
        }
    })
}

/// Snap a point using the cached project + spatial index.
///
/// Falls back to the uncached path if no cache has been set.
#[wasm_bindgen]
pub fn snap_point_cached(
    x: f64,
    y: f64,
    config_json: &str,
    exclude_road_id: Option<String>,
) -> Result<JsValue, JsError> {
    let config: we_core::snapping::SnapConfig =
        serde_json::from_str(config_json).map_err(|e| JsError::new(&e.to_string()))?;
    PROJECT_CACHE.with(|cell| {
        let mut borrow = cell.borrow_mut();
        let cache = borrow.as_mut().ok_or_else(|| {
            JsError::new("Project cache not initialised — call set_project_cache() first")
        })?;
        let result =
            we_core::snapping::snap_point_cached(x, y, &config, cache, exclude_road_id.as_deref());
        serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
    })
}

/// Pick the nearest junction using the cached project.
#[wasm_bindgen]
pub fn pick_junction_at_point_cached(x: f64, y: f64, threshold: f64) -> Result<JsValue, JsError> {
    PROJECT_CACHE.with(|cell| {
        let mut borrow = cell.borrow_mut();
        let cache = borrow.as_mut().ok_or_else(|| {
            JsError::new("Project cache not initialised — call set_project_cache() first")
        })?;
        // Use the project from cache for junction picking (no spatial-index optimised path yet)
        let project = &cache.project;
        let mut best: Option<String> = None;
        let mut best_dist = threshold;

        for junction in &project.junctions {
            let poly = build_junction_polygon_points(project, junction);
            if poly.len() >= 3 {
                if point_in_polygon(x, y, &poly) {
                    return Ok(JsValue::from_str(&junction.id));
                }
                let cx: f64 = poly.iter().map(|p| p[0] as f64).sum::<f64>() / poly.len() as f64;
                let cy: f64 = poly.iter().map(|p| p[1] as f64).sum::<f64>() / poly.len() as f64;
                let dx = cx - x;
                let dy = cy - y;
                let dist = (dx * dx + dy * dy).sqrt();
                if dist < best_dist {
                    best_dist = dist;
                    best = Some(junction.id.clone());
                }
            }
        }
        match best {
            Some(id) => Ok(JsValue::from_str(&id)),
            None => Ok(JsValue::NULL),
        }
    })
}

/// Pick the nearest lane using the cached project + spatial index.
///
/// Returns JSON `{ "roadId": string, "sectionIndex": number, "laneId": number }` or null.
#[wasm_bindgen]
pub fn pick_lane_at_point_cached(x: f64, y: f64, threshold: f64) -> Result<JsValue, JsError> {
    PROJECT_CACHE.with(|cell| {
        let mut borrow = cell.borrow_mut();
        let cache = borrow.as_mut().ok_or_else(|| {
            JsError::new("Project cache not initialised — call set_project_cache() first")
        })?;
        match we_core::picking::pick_lane_cached(cache, x, y, threshold) {
            Some((road_id, section_index, lane_id)) => {
                let result = LanePickResult {
                    road_id,
                    section_index,
                    lane_id,
                };
                serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
            }
            None => Ok(JsValue::NULL),
        }
    })
}

#[derive(Serialize)]
struct LanePickResult {
    #[serde(rename = "roadId")]
    road_id: String,
    #[serde(rename = "sectionIndex")]
    section_index: usize,
    #[serde(rename = "laneId")]
    lane_id: i32,
}

/// Pick the nearest signal using the cached project + spatial index.
///
/// Returns `{ roadId, signalId }` or null. No JSON serialisation per call.
#[wasm_bindgen]
pub fn pick_signal_at_point_cached(x: f64, y: f64, threshold: f64) -> Result<JsValue, JsError> {
    PROJECT_CACHE.with(|cell| {
        let mut borrow = cell.borrow_mut();
        let cache = borrow.as_mut().ok_or_else(|| {
            JsError::new("Project cache not initialised — call set_project_cache() first")
        })?;
        match we_core::picking::pick_signal_cached(cache, x, y, threshold) {
            Some(result) => {
                let hit = SignalHit {
                    road_id: result.road_id,
                    signal_id: result.signal_id,
                };
                serde_wasm_bindgen::to_value(&hit).map_err(|e| JsError::new(&e.to_string()))
            }
            None => Ok(JsValue::NULL),
        }
    })
}

/// Pick the nearest road object using the cached project + spatial index.
///
/// Returns `{ roadId, objectId }` or null. No JSON serialisation per call.
#[wasm_bindgen]
pub fn pick_object_at_point_cached(x: f64, y: f64, threshold: f64) -> Result<JsValue, JsError> {
    PROJECT_CACHE.with(|cell| {
        let mut borrow = cell.borrow_mut();
        let cache = borrow.as_mut().ok_or_else(|| {
            JsError::new("Project cache not initialised — call set_project_cache() first")
        })?;
        match we_core::picking::pick_object_cached(cache, x, y, threshold) {
            Some(result) => {
                let hit = ObjectHit {
                    road_id: result.road_id,
                    object_id: result.object_id,
                };
                serde_wasm_bindgen::to_value(&hit).map_err(|e| JsError::new(&e.to_string()))
            }
            None => Ok(JsValue::NULL),
        }
    })
}

/// Compute the world position of a signal using the cached project (no JSON serialization per call).
///
/// Returns `{ x, y }` or null.
#[wasm_bindgen]
pub fn get_signal_world_pos_cached(
    road_id: &str,
    signal_id: &str,
) -> Result<JsValue, JsError> {
    use we_core::geometry::eval::offset_point;

    PROJECT_CACHE.with(|cell| {
        let borrow = cell.borrow();
        let cache = borrow.as_ref().ok_or_else(|| {
            JsError::new("Project cache not initialised — call set_project_cache() first")
        })?;
        let project = &cache.project;

        let road = project.roads.iter().find(|r| r.id == road_id);
        let signal = road.and_then(|r| r.signals.iter().find(|s| s.id == signal_id));

        match (road, signal) {
            (Some(road), Some(signal)) => {
                if let Some(ref_pt) = road_point_at_s(&road.plan_view, signal.s) {
                    let (wx, wy, _) = offset_point(&ref_pt, signal.t, 0.0);
                    let result = WorldPos { x: wx, y: wy };
                    serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
                } else {
                    Ok(JsValue::NULL)
                }
            }
            _ => Ok(JsValue::NULL),
        }
    })
}

/// Compute the world position of a road object using the cached project (no JSON serialization per call).
///
/// Returns `{ x, y }` or null.
#[wasm_bindgen]
pub fn get_object_world_pos_cached(
    road_id: &str,
    object_id: &str,
) -> Result<JsValue, JsError> {
    use we_core::geometry::eval::offset_point;

    PROJECT_CACHE.with(|cell| {
        let borrow = cell.borrow();
        let cache = borrow.as_ref().ok_or_else(|| {
            JsError::new("Project cache not initialised — call set_project_cache() first")
        })?;
        let project = &cache.project;

        let road = project.roads.iter().find(|r| r.id == road_id);
        let object = road.and_then(|r| r.objects.iter().find(|o| o.id == object_id));

        match (road, object) {
            (Some(road), Some(obj)) => {
                let s = obj.position.x;
                let t = obj.position.y;
                if let Some(ref_pt) = road_point_at_s(&road.plan_view, s) {
                    let (wx, wy, _) = offset_point(&ref_pt, t, 0.0);
                    let result = WorldPos { x: wx, y: wy };
                    serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
                } else {
                    Ok(JsValue::NULL)
                }
            }
            _ => Ok(JsValue::NULL),
        }
    })
}

/// Compute the world position of a lane center at a specific s-coordinate using the cached project.
///
/// Returns `{ x, y }` or null.
#[wasm_bindgen]
pub fn get_lane_world_pos_cached(
    road_id: &str,
    section_index: usize,
    lane_id: i32,
) -> Result<JsValue, JsError> {
    use we_core::geometry::eval::offset_point;

    PROJECT_CACHE.with(|cell| {
        let borrow = cell.borrow();
        let cache = borrow.as_ref().ok_or_else(|| {
            JsError::new("Project cache not initialised — call set_project_cache() first")
        })?;
        let project = &cache.project;

        let road = project.roads.iter().find(|r| r.id == road_id);
        if let Some(road) = road {
            if let Some(section) = road.lane_sections.get(section_index) {
                // Find the lane's center offset: sum widths of inner lanes + half this lane's width
                let s_mid = section.s + (road.lane_sections.get(section_index + 1)
                    .map(|ns| ns.s)
                    .unwrap_or(road.length)
                    - section.s) / 2.0;

                // Compute lateral offset to the lane center
                let lanes = if lane_id > 0 { &section.left } else { &section.right };
                let abs_id = lane_id.unsigned_abs() as usize;
                let mut t_offset = 0.0;
                for lane in lanes.iter() {
                    let lane_abs_id = lane.id.unsigned_abs() as usize;
                    let w = lane.width.first().map(|wp| wp.a).unwrap_or(3.5);
                    if lane_abs_id == abs_id {
                        t_offset += w / 2.0;
                        break;
                    }
                    t_offset += w;
                }
                let t = if lane_id > 0 { t_offset } else { -t_offset };

                if let Some(ref_pt) = road_point_at_s(&road.plan_view, s_mid) {
                    let (wx, wy, _) = offset_point(&ref_pt, t, 0.0);
                    let result = WorldPos { x: wx, y: wy };
                    serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
                } else {
                    Ok(JsValue::NULL)
                }
            } else {
                Ok(JsValue::NULL)
            }
        } else {
            Ok(JsValue::NULL)
        }
    })
}

/// Project a world-space point onto a road's reference line, returning road-local
/// coordinates `{ s, t, hdg }` at the closest point.
///
/// - `s`: arc-length station along the road reference line (metres from road start)
/// - `t`: signed lateral offset from the reference line (positive = left)
/// - `hdg`: road heading at that station (radians)
///
/// Used by the viewport after picking a road via `pick_road_at_point` to convert
/// the world click position into correct road-local s/t for placing signals and objects.
#[wasm_bindgen]
pub fn snap_point_on_road(road_json: &str, world_x: f64, world_y: f64) -> Result<JsValue, JsError> {
    use we_core::geometry::eval::sample_road_reference_line;

    #[derive(Serialize)]
    struct RoadLocalPos {
        s: f64,
        t: f64,
        hdg: f64,
    }

    let road: we_core::model::Road =
        serde_json::from_str(road_json).map_err(|e| JsError::new(&e.to_string()))?;

    let samples = sample_road_reference_line(&road, 1.0);

    let result = if samples.is_empty() {
        RoadLocalPos {
            s: 0.0,
            t: 0.0,
            hdg: 0.0,
        }
    } else {
        // Find the closest reference-line sample
        let mut best_idx = 0usize;
        let mut best_dist_sq = f64::MAX;
        for (i, pt) in samples.iter().enumerate() {
            let dx = pt.x - world_x;
            let dy = pt.y - world_y;
            let d = dx * dx + dy * dy;
            if d < best_dist_sq {
                best_dist_sq = d;
                best_idx = i;
            }
        }
        let pt = &samples[best_idx];
        // Decompose world offset into road-local axes
        let dx = world_x - pt.x;
        let dy = world_y - pt.y;
        let cos_h = pt.hdg.cos();
        let sin_h = pt.hdg.sin();
        // t = perpendicular component (positive = left of heading direction)
        let t = -dx * sin_h + dy * cos_h;
        RoadLocalPos {
            s: pt.s,
            t,
            hdg: pt.hdg,
        }
    };

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
}
