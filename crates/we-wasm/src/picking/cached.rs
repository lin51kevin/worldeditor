//! Cached pick / snap functions.
//!
//! These operate on the thread-local `ProjectCache` set by `set_project_cache()`.
//! Spatial and snap caches are built lazily on the first query after invalidation.

use crate::render::{build_junction_polygon_points, point_in_polygon, road_point_at_s};
use serde::Serialize;
use wasm_bindgen::prelude::*;

use super::{ObjectHit, PROJECT_CACHE, SignalHit, WorldPos};

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
pub fn get_signal_world_pos_cached(road_id: &str, signal_id: &str) -> Result<JsValue, JsError> {
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
pub fn get_object_world_pos_cached(road_id: &str, object_id: &str) -> Result<JsValue, JsError> {
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
                let s_mid = section.s
                    + (road
                        .lane_sections
                        .get(section_index + 1)
                        .map(|ns| ns.s)
                        .unwrap_or(road.length)
                        - section.s)
                        / 2.0;

                // Compute lateral offset to the lane center
                let lanes = if lane_id > 0 {
                    &section.left
                } else {
                    &section.right
                };
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
    } else if samples.len() == 1 {
        // Single-point road: project onto that point
        let pt = &samples[0];
        let dx = world_x - pt.x;
        let dy = world_y - pt.y;
        let cos_h = pt.hdg.cos();
        let sin_h = pt.hdg.sin();
        let t = -dx * sin_h + dy * cos_h;
        RoadLocalPos {
            s: pt.s,
            t,
            hdg: pt.hdg,
        }
    } else {
        // Project query point onto each segment between consecutive samples
        // (same approach as picking::distance_to_road for sub-meter accuracy).
        let mut best_dist_sq = f64::MAX;
        let mut best_s = samples[0].s;
        let mut best_t = 0.0;
        let mut best_hdg = samples[0].hdg;
        let mut any_valid_segment = false;

        for i in 0..samples.len() - 1 {
            let p0 = &samples[i];
            let p1 = &samples[i + 1];

            let seg_dx = p1.x - p0.x;
            let seg_dy = p1.y - p0.y;
            let seg_len_sq = seg_dx * seg_dx + seg_dy * seg_dy;

            if seg_len_sq < 1e-12 {
                continue;
            }
            any_valid_segment = true;

            // Parameter along segment [0, 1]
            let qx = world_x - p0.x;
            let qy = world_y - p0.y;
            let param = ((qx * seg_dx + qy * seg_dy) / seg_len_sq).clamp(0.0, 1.0);

            // Closest point on segment
            let cx = p0.x + param * seg_dx;
            let cy = p0.y + param * seg_dy;

            let dx = world_x - cx;
            let dy = world_y - cy;
            let dist_sq = dx * dx + dy * dy;

            if dist_sq < best_dist_sq {
                best_dist_sq = dist_sq;
                // Interpolate s along this segment
                best_s = p0.s + param * (p1.s - p0.s);
                // Interpolate heading
                best_hdg = p0.hdg + param * (p1.hdg - p0.hdg);
                // Signed perpendicular offset (positive = left of travel direction)
                let seg_len = seg_len_sq.sqrt();
                let nx = -seg_dy / seg_len; // left normal
                let ny = seg_dx / seg_len;
                best_t = dx * nx + dy * ny;
            }
        }

        // All segments degenerate (coincident points): fall back to nearest sample point.
        if !any_valid_segment {
            for pt in &samples {
                let dx = world_x - pt.x;
                let dy = world_y - pt.y;
                let d = dx * dx + dy * dy;
                if d < best_dist_sq {
                    best_dist_sq = d;
                    best_s = pt.s;
                    best_hdg = pt.hdg;
                    let sin_h = pt.hdg.sin();
                    let cos_h = pt.hdg.cos();
                    best_t = -dx * sin_h + dy * cos_h;
                }
            }
        }

        RoadLocalPos {
            s: best_s,
            t: best_t,
            hdg: best_hdg,
        }
    };

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
}
