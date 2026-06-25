//! Spatial picking for road network elements.
//!
//! Provides CPU-based hit-testing for roads and junctions using
//! reference line sampling and distance checks. Pure Rust, WASM compatible.

use crate::geometry::eval::{
    RefLinePoint, evaluate_lane_width, offset_point, sample_road_reference_line,
};
use crate::model::{Junction, Project, Road};
use crate::spatial_index::{ElementKind, ProjectCache, SpatialIndex};

/// Result of a pick operation.
#[derive(Debug, Clone)]
pub struct PickResult {
    /// ID of the picked element.
    pub id: String,
    /// Distance from the query point to the nearest point on the element.
    pub distance: f64,
    /// Station (s coordinate) on the road where the closest point was found.
    pub s: f64,
    /// Lateral offset (t) from the reference line at the closest point.
    pub t: f64,
}

/// Pick the nearest road to a world-space point (cached version).
///
/// Uses [`ProjectCache`] to avoid rebuilding the spatial index on every call.
/// Call [`ProjectCache::invalidate()`] after mutating the project.
pub fn pick_road_cached(
    cache: &mut ProjectCache,
    x: f64,
    y: f64,
    threshold: f64,
) -> Option<PickResult> {
    // Ensure index is built
    cache.get_index()?;
    // Now we can get references separately
    let project = &cache.project;
    let index = cache.spatial_index.as_ref().unwrap();
    pick_road_with_index(project, index, x, y, threshold)
}

/// Pick the nearest junction to a world-space point (cached version).
pub fn pick_junction_cached(
    cache: &mut ProjectCache,
    x: f64,
    y: f64,
    threshold: f64,
) -> Option<PickResult> {
    cache.get_index()?;
    let project = &cache.project;
    let index = cache.spatial_index.as_ref().unwrap();
    pick_junction_with_index(project, index, x, y, threshold)
}

/// Pick a specific lane at a world-space point (cached version).
pub fn pick_lane_cached(
    cache: &mut ProjectCache,
    x: f64,
    y: f64,
    threshold: f64,
) -> Option<(String, usize, i32)> {
    cache.get_index()?;
    let project = &cache.project;
    let index = cache.spatial_index.as_ref().unwrap();
    pick_lane_with_index(project, index, x, y, threshold)
}

/// Result of a signal pick operation.
#[derive(Debug, Clone)]
pub struct SignalPickResult {
    pub road_id: String,
    pub signal_id: String,
    pub distance: f64,
}

/// Result of an object pick operation.
#[derive(Debug, Clone)]
pub struct ObjectPickResult {
    pub road_id: String,
    pub object_id: String,
    pub distance: f64,
}

/// Pick the nearest signal to a world-space point (cached version).
///
/// Uses the spatial index to narrow candidates to nearby roads, then checks
/// each signal on those roads. Avoids JSON re-parsing on every call.
pub fn pick_signal_cached(
    cache: &mut ProjectCache,
    x: f64,
    y: f64,
    threshold: f64,
) -> Option<SignalPickResult> {
    use crate::geometry::eval::{evaluate_road_at_s, offset_point};

    cache.get_index()?;
    let project = &cache.project;
    let index = cache.spatial_index.as_ref().unwrap();

    // Use spatial index to find nearby roads, then check their signals
    let candidates = index.query_point(x, y, threshold);

    let mut best: Option<SignalPickResult> = None;
    let mut best_dist = threshold;

    for candidate in &candidates {
        if candidate.kind != ElementKind::Road {
            continue;
        }
        let road = match project.roads.iter().find(|r| r.id == candidate.id) {
            Some(r) => r,
            None => continue,
        };
        if road.render_hidden {
            continue;
        }
        for signal in &road.signals {
            let Some(ref_pt) = evaluate_road_at_s(road, signal.s) else {
                continue;
            };
            let (wx, wy, _) = offset_point(&ref_pt, signal.t, 0.0);
            let dx = wx - x;
            let dy = wy - y;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist < best_dist {
                best_dist = dist;
                best = Some(SignalPickResult {
                    road_id: road.id.clone(),
                    signal_id: signal.id.clone(),
                    distance: dist,
                });
            }
        }
    }

    best
}

/// Pick the nearest road object to a world-space point (cached version).
///
/// Uses the spatial index to narrow candidates to nearby roads, then checks
/// each object on those roads. Avoids JSON re-parsing on every call.
///
/// For objects that carry corner data (crosswalks, parking spaces, etc.) the
/// click point is tested against the world-space polygon of those corners so
/// that clicking anywhere on the visible area registers as a hit (distance 0).
/// Objects without corners fall back to distance-to-centre-point.
pub fn pick_object_cached(
    cache: &mut ProjectCache,
    x: f64,
    y: f64,
    threshold: f64,
) -> Option<ObjectPickResult> {
    use crate::geometry::eval::{evaluate_road_at_s, offset_point};
    use crate::geometry::point_in_polygon;
    use nalgebra::Vector2;

    cache.get_index()?;
    let project = &cache.project;
    let index = cache.spatial_index.as_ref().unwrap();

    // Expand candidate radius so large objects whose centre is far from the
    // click point are still considered.
    let query_radius = threshold.max(20.0);
    let candidates = index.query_point(x, y, query_radius);

    let mut best: Option<ObjectPickResult> = None;
    let mut best_dist = threshold;

    for candidate in &candidates {
        if candidate.kind != ElementKind::Road {
            continue;
        }
        let road = match project.roads.iter().find(|r| r.id == candidate.id) {
            Some(r) => r,
            None => continue,
        };
        if road.render_hidden {
            continue;
        }
        for obj in &road.objects {
            let s = obj.position.x;
            let t = obj.position.y;
            let Some(ref_pt) = evaluate_road_at_s(road, s) else {
                continue;
            };

            // --- Polygon hit test for objects with corners ---
            if !obj.corners.is_empty() {
                let world_poly = object_corners_to_world(
                    &obj.corners,
                    &obj.corner_type,
                    &ref_pt,
                    t,
                    obj.hdg,
                    obj.length,
                    obj.width,
                    &offset_point,
                    &road.plan_view,
                );
                if !world_poly.is_empty() {
                    let poly_v: Vec<Vector2<f64>> = world_poly
                        .iter()
                        .map(|&(px, py)| Vector2::new(px, py))
                        .collect();
                    if point_in_polygon(&Vector2::new(x, y), &poly_v) {
                        // Direct polygon hit — beat any previous candidate.
                        best_dist = 0.0;
                        best = Some(ObjectPickResult {
                            road_id: road.id.clone(),
                            object_id: obj.id.clone(),
                            distance: 0.0,
                        });
                        continue;
                    }
                    // Not inside; fall through to centre-point distance check
                    // (allows selecting objects by clicking near, not on, them).
                }
            }

            // --- Centre-point distance fallback ---
            let (wx, wy, _) = offset_point(&ref_pt, t, 0.0);
            let dx = wx - x;
            let dy = wy - y;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist < best_dist {
                best_dist = dist;
                best = Some(ObjectPickResult {
                    road_id: road.id.clone(),
                    object_id: obj.id.clone(),
                    distance: dist,
                });
            }
        }
    }

    best
}

/// Transform object corners to world-space (x, y) coordinates for polygon
/// hit-testing. Returns an empty Vec if the corners cannot be projected.
///
/// Supports both `CornerType::Local` (object-local frame, apply heading) and
/// `CornerType::Road` (road-frame absolute s/t, evaluate reference line directly).
fn object_corners_to_world(
    corners: &[crate::model::Point3D],
    corner_type: &crate::model::CornerType,
    ref_pt: &RefLinePoint,
    obj_t: f64,
    obj_hdg: f64,
    obj_length: f64,
    obj_width: f64,
    offset_pt: &impl Fn(&RefLinePoint, f64, f64) -> (f64, f64, f64),
    plan_view: &[crate::model::Geometry],
) -> Vec<(f64, f64)> {
    use crate::geometry::eval::evaluate_geometry;

    match corner_type {
        crate::model::CornerType::Local => {
            let (ox, oy, _) = offset_pt(ref_pt, obj_t, 0.0);
            let theta = ref_pt.hdg;
            let (cos_t, sin_t) = (theta.cos(), theta.sin());
            // Mirror the renderer's heading-convention detection so the picking
            // polygon matches the drawn geometry. See `detect_local_apply_hdg`.
            let (cos_h, sin_h) = if detect_local_apply_hdg(corners, obj_hdg, obj_length, obj_width)
            {
                (obj_hdg.cos(), obj_hdg.sin())
            } else {
                (1.0_f64, 0.0_f64)
            };
            corners
                .iter()
                .map(|c| {
                    let alpha = c.x * cos_h - c.y * sin_h;
                    let beta = c.x * sin_h + c.y * cos_h;
                    (
                        ox + alpha * cos_t - beta * sin_t,
                        oy + alpha * sin_t + beta * cos_t,
                    )
                })
                .collect()
        }
        crate::model::CornerType::Road => {
            corners
                .iter()
                .filter_map(|c| {
                    // For cornerRoad: c.x = s (along road), c.y = t (lateral)
                    let geo = plan_view.iter().rev().find(|g| g.s <= c.x + 1e-9)?;
                    let ds = (c.x - geo.s).clamp(0.0, geo.length);
                    let rp = evaluate_geometry(geo, ds);
                    let (wx, wy, _) = offset_pt(&rp, c.y, 0.0);
                    Some((wx, wy))
                })
                .collect()
        }
    }
}

/// Decide whether `cornerLocal` coordinates are stored in the object's heading
/// frame (apply `obj_hdg`) or already in the road frame (identity).
///
/// This mirrors the renderer's `detect_crosswalk_apply_hdg` (in we-wasm) so that
/// the picking polygon matches the drawn geometry exactly:
/// - length > 0 && width > 0 && |hdg| ≈ π → object-local (apply)
/// - length > 0 && width > 0 (other hdg) → aspect-ratio heuristic
/// - length == 0 || width == 0 → always apply
fn detect_local_apply_hdg(
    corners: &[crate::model::Point3D],
    obj_hdg: f64,
    obj_length: f64,
    obj_width: f64,
) -> bool {
    if obj_length > 0.0 && obj_width > 0.0 {
        let hdg_near_pi = (obj_hdg.abs() - std::f64::consts::PI).abs() < 0.17; // ≈ 10°
        if hdg_near_pi {
            true
        } else {
            let (u_min, u_max) = corners
                .iter()
                .fold((f64::INFINITY, f64::NEG_INFINITY), |(mn, mx), c| {
                    (mn.min(c.x), mx.max(c.x))
                });
            let (v_min, v_max) = corners
                .iter()
                .fold((f64::INFINITY, f64::NEG_INFINITY), |(mn, mx), c| {
                    (mn.min(c.y), mx.max(c.y))
                });
            (u_max - u_min) > (v_max - v_min)
        }
    } else {
        true
    }
}

/// Internal implementation that works with a pre-built spatial index.
fn pick_road_with_index(
    project: &Project,
    index: &SpatialIndex,
    x: f64,
    y: f64,
    threshold: f64,
) -> Option<PickResult> {
    let candidates = index.query_point(x, y, threshold);

    let mut best: Option<PickResult> = None;
    let mut best_dist = threshold;

    for candidate in &candidates {
        if candidate.kind != ElementKind::Road {
            continue;
        }
        let road = match project.roads.iter().find(|r| r.id == candidate.id) {
            Some(r) => r,
            None => continue,
        };
        if road.render_hidden {
            continue;
        }
        if let Some(result) = distance_to_road(road, x, y)
            && result.distance < best_dist
        {
            best_dist = result.distance;
            best = Some(result);
        }
    }

    best
}

/// Pick the nearest road to a world-space point.
///
/// Uses a spatial index for fast candidate filtering, then performs
/// detailed distance checks only on nearby roads.
/// Returns `None` if no road is within `threshold` distance.
pub fn pick_road(project: &Project, x: f64, y: f64, threshold: f64) -> Option<PickResult> {
    let index = SpatialIndex::build(project, 100.0);
    pick_road_with_index(project, &index, x, y, threshold)
}

/// Internal implementation that works with a pre-built spatial index.
fn pick_junction_with_index(
    project: &Project,
    index: &SpatialIndex,
    x: f64,
    y: f64,
    threshold: f64,
) -> Option<PickResult> {
    let candidates = index.query_point(x, y, threshold);

    let mut best: Option<PickResult> = None;
    let mut best_dist = threshold;

    for candidate in &candidates {
        if candidate.kind != ElementKind::Junction {
            continue;
        }
        let junction = match project.junctions.iter().find(|j| j.id == candidate.id) {
            Some(j) => j,
            None => continue,
        };
        if let Some(dist) = distance_to_junction(project, junction, x, y)
            && dist < best_dist
        {
            best_dist = dist;
            best = Some(PickResult {
                id: junction.id.clone(),
                distance: dist,
                s: 0.0,
                t: 0.0,
            });
        }
    }

    best
}

/// Pick the nearest junction to a world-space point.
///
/// Uses a spatial index for fast candidate filtering.
/// Returns `None` if no junction is within `threshold` distance.
pub fn pick_junction(project: &Project, x: f64, y: f64, threshold: f64) -> Option<PickResult> {
    let index = SpatialIndex::build(project, 100.0);
    pick_junction_with_index(project, &index, x, y, threshold)
}

/// Internal implementation that works with a pre-built spatial index.
fn pick_lane_with_index(
    project: &Project,
    index: &SpatialIndex,
    x: f64,
    y: f64,
    threshold: f64,
) -> Option<(String, usize, i32)> {
    let candidates = index.query_point(x, y, threshold);

    let mut best_dist = threshold;
    let mut best_result: Option<(String, usize, i32)> = None;

    for candidate in &candidates {
        if candidate.kind != ElementKind::Road {
            continue;
        }
        let road = match project.roads.iter().find(|r| r.id == candidate.id) {
            Some(r) => r,
            None => continue,
        };
        if road.render_hidden {
            continue;
        }
        let ref_pts = sample_road_reference_line(road, 2.0);
        if ref_pts.len() < 2 {
            continue;
        }

        for (section_idx, section) in road.lane_sections.iter().enumerate() {
            if section.render_hidden {
                continue;
            }
            let section_end_s = road
                .lane_sections
                .get(section_idx + 1)
                .map(|ls| ls.s)
                .unwrap_or(road.length);

            let section_pts: Vec<&RefLinePoint> = ref_pts
                .iter()
                .filter(|p| p.s >= section.s - 1e-9 && p.s <= section_end_s + 1e-9)
                .collect();

            if section_pts.is_empty() {
                continue;
            }

            // Check right lanes (negative IDs)
            let mut right_sorted: Vec<_> = section.right.iter().collect();
            right_sorted.sort_by_key(|l| l.id.abs());
            let mut right_offset = 0.0;
            for lane in &right_sorted {
                for pt in &section_pts {
                    let ds = pt.s - section.s;
                    let w = evaluate_lane_width(&lane.width, ds);
                    let inner_t = -(right_offset);
                    let outer_t = -(right_offset + w);
                    let mid_t = (inner_t + outer_t) / 2.0;
                    let (px, py, _) = offset_point(pt, mid_t, 0.0);
                    let dx = px - x;
                    let dy = py - y;
                    let dist = (dx * dx + dy * dy).sqrt();
                    if dist < best_dist {
                        best_dist = dist;
                        best_result = Some((road.id.clone(), section_idx, lane.id));
                    }
                }
                let ds_mid = (section_end_s - section.s) / 2.0;
                right_offset += evaluate_lane_width(&lane.width, ds_mid);
            }

            // Check left lanes (positive IDs)
            let mut left_sorted: Vec<_> = section.left.iter().collect();
            left_sorted.sort_by_key(|l| l.id);
            let mut left_offset = 0.0;
            for lane in &left_sorted {
                for pt in &section_pts {
                    let ds = pt.s - section.s;
                    let w = evaluate_lane_width(&lane.width, ds);
                    let inner_t = left_offset;
                    let outer_t = left_offset + w;
                    let mid_t = (inner_t + outer_t) / 2.0;
                    let (px, py, _) = offset_point(pt, mid_t, 0.0);
                    let dx = px - x;
                    let dy = py - y;
                    let dist = (dx * dx + dy * dy).sqrt();
                    if dist < best_dist {
                        best_dist = dist;
                        best_result = Some((road.id.clone(), section_idx, lane.id));
                    }
                }
                let ds_mid = (section_end_s - section.s) / 2.0;
                left_offset += evaluate_lane_width(&lane.width, ds_mid);
            }
        }
    }

    best_result
}

/// Pick a specific lane at a world-space point.
///
/// Uses a spatial index for fast candidate filtering, then performs
/// detailed per-lane distance checks on nearby roads.
/// Returns `(road_id, section_index, lane_id)` if a lane is found within threshold.
pub fn pick_lane(
    project: &Project,
    x: f64,
    y: f64,
    threshold: f64,
) -> Option<(String, usize, i32)> {
    let index = SpatialIndex::build(project, 100.0);
    pick_lane_with_index(project, &index, x, y, threshold)
}

/// Compute the minimum distance from a point to a road's surface.
///
/// Uses point-to-segment projection between consecutive reference line samples
/// for precise closest-point computation. When the point is within the road
/// surface, returns a small fractional value (`|t| / half_width * 0.001`) to
/// discriminate between overlapping roads (preferring the road whose reference
/// line is closer to the query point).
fn distance_to_road(road: &Road, x: f64, y: f64) -> Option<PickResult> {
    let ref_pts = sample_road_reference_line(road, 2.0);
    if ref_pts.is_empty() {
        return None;
    }

    let mut best_dist = f64::MAX;
    let mut best_s = 0.0;
    let mut best_t = 0.0;

    // Project query point onto each segment between consecutive reference line samples
    for i in 0..ref_pts.len().saturating_sub(1) {
        let p0 = &ref_pts[i];
        let p1 = &ref_pts[i + 1];

        let seg_dx = p1.x - p0.x;
        let seg_dy = p1.y - p0.y;
        let seg_len_sq = seg_dx * seg_dx + seg_dy * seg_dy;

        if seg_len_sq < 1e-12 {
            continue;
        }

        // Parameter t along segment [0, 1]
        let qx = x - p0.x;
        let qy = y - p0.y;
        let param = ((qx * seg_dx + qy * seg_dy) / seg_len_sq).clamp(0.0, 1.0);

        // Closest point on segment
        let cx = p0.x + param * seg_dx;
        let cy = p0.y + param * seg_dy;

        let dx = x - cx;
        let dy = y - cy;
        let dist = (dx * dx + dy * dy).sqrt();

        if dist < best_dist {
            best_dist = dist;
            // Interpolate s
            best_s = p0.s + param * (p1.s - p0.s);
            // Compute signed perpendicular offset (t) using segment normal
            // positive = left of travel direction, negative = right
            let seg_len = seg_len_sq.sqrt();
            let nx = -seg_dy / seg_len; // left normal
            let ny = seg_dx / seg_len;
            best_t = (x - cx) * nx + (y - cy) * ny;
        }
    }

    // Also check distance to the last sample point (for single-point roads or endpoints)
    if ref_pts.len() == 1 {
        let pt = &ref_pts[0];
        let dx = x - pt.x;
        let dy = y - pt.y;
        let dist = (dx * dx + dy * dy).sqrt();
        if dist < best_dist {
            best_dist = dist;
            best_s = pt.s;
            let cos_h = pt.hdg.cos();
            let sin_h = pt.hdg.sin();
            best_t = -dx * sin_h + dy * cos_h;
        }
    }

    if best_dist >= f64::MAX {
        return None;
    }

    // Get the road half-width on the relevant side
    let half_width = road_half_width_at_side(road, best_s, best_t);

    if best_t.abs() <= half_width {
        // Point is ON the road surface — use a small fractional distance
        // proportional to how far from the reference line it is, so that
        // overlapping roads are disambiguated (closer to center = smaller distance).
        let normalized = best_t.abs() / half_width.max(0.01);
        Some(PickResult {
            id: road.id.clone(),
            distance: normalized * 0.001,
            s: best_s,
            t: best_t,
        })
    } else {
        // Point is outside road surface — return perpendicular distance beyond edge
        let edge_dist = best_t.abs() - half_width;
        Some(PickResult {
            id: road.id.clone(),
            distance: edge_dist,
            s: best_s,
            t: best_t,
        })
    }
}

/// Estimate the half-width of a road at a given station s, on the side where
/// the query point falls (left if t > 0, right if t < 0).
fn road_half_width_at_side(road: &Road, s: f64, t: f64) -> f64 {
    let section = road.lane_sections.iter().rev().find(|ls| ls.s <= s + 1e-9);

    match section {
        Some(sec) => {
            let ds = s - sec.s;
            if t >= 0.0 {
                // Point is on the left side
                let left_width: f64 = sec
                    .left
                    .iter()
                    .map(|l| evaluate_lane_width(&l.width, ds))
                    .sum();
                if left_width > 0.0 { left_width } else { 3.5 }
            } else {
                // Point is on the right side
                let right_width: f64 = sec
                    .right
                    .iter()
                    .map(|l| evaluate_lane_width(&l.width, ds))
                    .sum();
                if right_width > 0.0 { right_width } else { 3.5 }
            }
        }
        None => 3.5, // default single lane width
    }
}

/// Estimate the half-width of a road at a given station s (max of both sides).
#[cfg(test)]
fn road_half_width_at(road: &Road, s: f64) -> f64 {
    // Find applicable lane section
    let section = road.lane_sections.iter().rev().find(|ls| ls.s <= s + 1e-9);

    match section {
        Some(sec) => {
            let ds = s - sec.s;
            let right_width: f64 = sec
                .right
                .iter()
                .map(|l| evaluate_lane_width(&l.width, ds))
                .sum();
            let left_width: f64 = sec
                .left
                .iter()
                .map(|l| evaluate_lane_width(&l.width, ds))
                .sum();
            right_width.max(left_width)
        }
        None => 3.5, // default single lane width
    }
}

/// Compute the distance from a point to a junction's center.
fn distance_to_junction(project: &Project, junction: &Junction, x: f64, y: f64) -> Option<f64> {
    // Approximate junction center from connecting road endpoints
    let mut cx = 0.0;
    let mut cy = 0.0;
    let mut count = 0;

    for conn in &junction.connections {
        if let Some(road) = project.roads.iter().find(|r| r.id == conn.connecting_road) {
            let ref_pts = sample_road_reference_line(road, road.length.max(1.0));
            if let Some(first) = ref_pts.first() {
                cx += first.x;
                cy += first.y;
                count += 1;
            }
            if let Some(last) = ref_pts.last() {
                cx += last.x;
                cy += last.y;
                count += 1;
            }
        }
    }

    if count == 0 {
        return None;
    }

    cx /= count as f64;
    cy /= count as f64;
    let dx = cx - x;
    let dy = cy - y;
    Some((dx * dx + dy * dy).sqrt())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;

    fn make_straight_road(id: &str, length: f64) -> Road {
        Road::from_centerline(
            id,
            vec![Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length,
                geo_type: GeometryType::Line,
            }],
        )
    }

    #[test]
    fn test_pick_road_on_surface() {
        let mut project = Project::default();
        project.roads.push(make_straight_road("1", 100.0));
        // Point on the road surface (y=0, right on reference line)
        let result = pick_road(&project, 50.0, 0.0, 10.0);
        assert!(result.is_some());
        assert_eq!(result.unwrap().id, "1");
    }

    #[test]
    fn test_pick_road_near_surface() {
        let mut project = Project::default();
        project.roads.push(make_straight_road("1", 100.0));
        // Point near road (y=5, within threshold but outside road width)
        let result = pick_road(&project, 50.0, 5.0, 10.0);
        assert!(result.is_some());
        assert_eq!(result.unwrap().id, "1");
    }

    #[test]
    fn test_pick_road_too_far() {
        let mut project = Project::default();
        project.roads.push(make_straight_road("1", 100.0));
        // Point far from road
        let result = pick_road(&project, 50.0, 50.0, 10.0);
        assert!(result.is_none());
    }

    #[test]
    fn test_pick_road_hidden() {
        let mut project = Project::default();
        let mut road = make_straight_road("1", 100.0);
        road.render_hidden = true;
        project.roads.push(road);
        let result = pick_road(&project, 50.0, 0.0, 10.0);
        assert!(result.is_none());
    }

    #[test]
    fn test_pick_road_closest() {
        let mut project = Project::default();
        project.roads.push(make_straight_road("1", 100.0));
        let mut road2 = Road::from_centerline(
            "2",
            vec![Geometry {
                s: 0.0,
                x: 0.0,
                y: 20.0,
                hdg: 0.0,
                length: 100.0,
                geo_type: GeometryType::Line,
            }],
        );
        road2.name = "Road 2".into();
        project.roads.push(road2);
        // Point closer to road 2
        let result = pick_road(&project, 50.0, 18.0, 10.0);
        assert!(result.is_some());
        assert_eq!(result.unwrap().id, "2");
    }

    #[test]
    fn test_pick_lane() {
        let mut project = Project::default();
        project.roads.push(make_straight_road("1", 100.0));
        // Pick on the right side of the road (negative t → right lane with negative id)
        let result = pick_lane(&project, 50.0, -1.75, 5.0);
        assert!(result.is_some());
        let (road_id, _section_idx, lane_id) = result.unwrap();
        assert_eq!(road_id, "1");
        assert!(lane_id < 0); // right lane
    }

    #[test]
    fn test_pick_lane_left_side() {
        let mut project = Project::default();
        project.roads.push(make_straight_road("1", 100.0));
        // Pick on the left side of the road (positive t → left lane with positive id)
        let result = pick_lane(&project, 50.0, 1.75, 5.0);
        assert!(result.is_some());
        let (road_id, _section_idx, lane_id) = result.unwrap();
        assert_eq!(road_id, "1");
        assert!(lane_id > 0); // left lane
    }

    #[test]
    fn test_road_half_width() {
        let road = make_straight_road("1", 100.0);
        let hw = road_half_width_at(&road, 50.0);
        assert!((hw - 3.5).abs() < f64::EPSILON);
    }

    #[test]
    fn test_pick_signal_cached_finds_signal() {
        let mut project = Project::default();
        let mut road = make_straight_road("1", 100.0);
        road.signals.push(Signal {
            id: "sig1".into(),
            name: String::new(),
            s: 50.0,
            t: 3.0, // 3m left of reference line
            z_offset: 0.0,
            h_offset: 0.0,
            width: 0.6,
            height: 2.0,
            signal_type: String::new(),
            signal_subtype: String::new(),
            value: None,
            orientation: "+".into(),
            is_dynamic: false,
            country: String::new(),
            unit: String::new(),
            validities: vec![],
        });
        project.roads.push(road);
        let mut cache = ProjectCache::new(project);
        // Road at y=0, hdg=0 → signal world pos is (50, 3)
        let result = pick_signal_cached(&mut cache, 50.0, 3.0, 5.0);
        assert!(result.is_some());
        let hit = result.unwrap();
        assert_eq!(hit.road_id, "1");
        assert_eq!(hit.signal_id, "sig1");
    }

    #[test]
    fn test_pick_signal_cached_too_far() {
        let mut project = Project::default();
        let mut road = make_straight_road("1", 100.0);
        road.signals.push(Signal {
            id: "sig1".into(),
            name: String::new(),
            s: 50.0,
            t: 3.0,
            z_offset: 0.0,
            h_offset: 0.0,
            width: 0.6,
            height: 2.0,
            signal_type: String::new(),
            signal_subtype: String::new(),
            value: None,
            orientation: "+".into(),
            is_dynamic: false,
            country: String::new(),
            unit: String::new(),
            validities: vec![],
        });
        project.roads.push(road);
        let mut cache = ProjectCache::new(project);
        let result = pick_signal_cached(&mut cache, 200.0, 200.0, 5.0);
        assert!(result.is_none());
    }

    #[test]
    fn test_pick_object_cached_finds_object() {
        let mut project = Project::default();
        let mut road = make_straight_road("1", 100.0);
        road.objects.push(RoadObject {
            id: "obj1".into(),
            object_type: ObjectType::Barrier,
            name: String::new(),
            position: Point3D {
                x: 30.0,
                y: -2.0,
                z: 0.0,
                id: None,
            }, // s=30, t=-2
            orientation: 0.0,
            hdg: 0.0,
            pitch: 0.0,
            roll: 0.0,
            width: 1.0,
            height: 1.0,
            length: 0.0,
            corners: vec![],
            corner_type: CornerType::default(),
            validity: None,
            from_object_ref: false,
            user_data: vec![],
        });
        project.roads.push(road);
        let mut cache = ProjectCache::new(project);
        // Road at y=0, hdg=0 → object world pos is (30, -2)
        let result = pick_object_cached(&mut cache, 30.0, -2.0, 5.0);
        assert!(result.is_some());
        let hit = result.unwrap();
        assert_eq!(hit.road_id, "1");
        assert_eq!(hit.object_id, "obj1");
    }

    #[test]
    fn test_pick_object_cached_too_far() {
        let mut project = Project::default();
        let mut road = make_straight_road("1", 100.0);
        road.objects.push(RoadObject {
            id: "obj1".into(),
            object_type: ObjectType::Barrier,
            name: String::new(),
            position: Point3D {
                x: 30.0,
                y: -2.0,
                z: 0.0,
                id: None,
            },
            orientation: 0.0,
            hdg: 0.0,
            pitch: 0.0,
            roll: 0.0,
            width: 1.0,
            height: 1.0,
            length: 0.0,
            corners: vec![],
            corner_type: CornerType::default(),
            validity: None,
            from_object_ref: false,
            user_data: vec![],
        });
        project.roads.push(road);
        let mut cache = ProjectCache::new(project);
        let result = pick_object_cached(&mut cache, 200.0, 200.0, 5.0);
        assert!(result.is_none());
    }

    #[test]
    fn test_pick_road_overlapping_prefers_closer_centerline() {
        // Two parallel roads at y=0 and y=5, both with 3.5m half-width.
        // Point at (50, 4) is within road2's surface (5-3.5=1.5 < 4 < 5+3.5=8.5)
        // and within road1's surface if half-width extends to it (0+3.5=3.5 < 4).
        // Actually point at y=4 is outside road1 (half_width=3.5, so edge at y=3.5)
        // and inside road2 (edge from y=1.5 to y=8.5). Should pick road2.
        let mut project = Project::default();
        project.roads.push(make_straight_road("1", 100.0));
        let road2 = Road::from_centerline(
            "2",
            vec![Geometry {
                s: 0.0,
                x: 0.0,
                y: 5.0,
                hdg: 0.0,
                length: 100.0,
                geo_type: GeometryType::Line,
            }],
        );
        project.roads.push(road2);
        // Point at y=4, closer to road2's centerline (dist=1) vs road1's (dist=4)
        let result = pick_road(&project, 50.0, 4.0, 10.0);
        assert!(result.is_some());
        assert_eq!(result.unwrap().id, "2");
    }

    #[test]
    fn test_pick_road_crossing_prefers_closer_centerline() {
        // Road 1 goes horizontal (hdg=0) through (0,0)→(100,0)
        // Road 2 goes at 45° through (50,0) crossing road 1
        let mut project = Project::default();
        project.roads.push(make_straight_road("1", 100.0));
        let road2 = Road::from_centerline(
            "2",
            vec![Geometry {
                s: 0.0,
                x: 50.0,
                y: -20.0,
                hdg: std::f64::consts::FRAC_PI_2, // heading up (north)
                length: 40.0,
                geo_type: GeometryType::Line,
            }],
        );
        project.roads.push(road2);
        // Point at (50, 1): on road1's surface (t=1, within 3.5)
        //                    and on road2's surface (perpendicular dist ~0, within 3.5)
        // Road2's reference line passes through (50, -20) → (50, 20) at x=50
        // At (50, 1), road2's centerline is exactly at x=50, so t≈0 for road2
        // road1's centerline is at y=0, so t=1 for road1
        // Should prefer road2 (t=0) over road1 (t=1)
        let result = pick_road(&project, 50.0, 1.0, 10.0);
        assert!(result.is_some());
        assert_eq!(result.unwrap().id, "2");
    }

    #[test]
    fn test_pick_road_on_centerline_has_minimum_distance() {
        // A point directly on the reference line should have distance ≈ 0
        let mut project = Project::default();
        project.roads.push(make_straight_road("1", 100.0));
        let result = pick_road(&project, 50.0, 0.0, 10.0);
        assert!(result.is_some());
        let r = result.unwrap();
        assert!(
            r.distance < 0.001,
            "Distance on centerline should be near-zero, got {}",
            r.distance
        );
    }

    #[test]
    fn test_pick_road_between_samples_accurate() {
        // Pick a point between two sample points (samples at every 2m)
        // at s=51 (between s=50 and s=52 samples), y=0 (on centerline)
        let mut project = Project::default();
        project.roads.push(make_straight_road("1", 100.0));
        let result = pick_road(&project, 51.0, 0.0, 5.0);
        assert!(result.is_some());
        let r = result.unwrap();
        assert!(
            r.distance < 0.001,
            "Distance between samples should be near-zero, got {}",
            r.distance
        );
        assert!(
            (r.s - 51.0).abs() < 0.1,
            "Station should be ~51, got {}",
            r.s
        );
    }

    #[test]
    fn test_pick_road_curved_road_precision() {
        // Arc road: center at (0,0), curvature 0.02 (radius=50m), length=50m (about 57°)
        let mut project = Project::default();
        let road = Road::from_centerline(
            "1",
            vec![Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length: 50.0,
                geo_type: GeometryType::Arc { curvature: 0.02 },
            }],
        );
        project.roads.push(road);
        // The arc curves left (positive curvature). At s=25, the road has turned ~28.6°.
        // The point at the center of the arc should be outside the road.
        // A point just offset from the reference line by 1m inward (toward center) should pick.
        let result = pick_road(&project, 10.0, 1.0, 5.0);
        assert!(result.is_some());
        assert_eq!(result.unwrap().id, "1");
    }
}
