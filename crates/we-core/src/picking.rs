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
pub fn pick_object_cached(
    cache: &mut ProjectCache,
    x: f64,
    y: f64,
    threshold: f64,
) -> Option<ObjectPickResult> {
    use crate::geometry::eval::{evaluate_road_at_s, offset_point};

    cache.get_index()?;
    let project = &cache.project;
    let index = cache.spatial_index.as_ref().unwrap();

    let candidates = index.query_point(x, y, threshold);

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

/// Compute the minimum distance from a point to a road's reference line,
/// considering the road's full width.
fn distance_to_road(road: &Road, x: f64, y: f64) -> Option<PickResult> {
    let ref_pts = sample_road_reference_line(road, 2.0);
    if ref_pts.is_empty() {
        return None;
    }

    let mut best_dist = f64::MAX;
    let mut best_s = 0.0;
    let mut best_t = 0.0;

    for pt in &ref_pts {
        // Compute perpendicular distance to reference line
        let dx = x - pt.x;
        let dy = y - pt.y;
        // Project onto normal/tangent frame
        let cos_h = pt.hdg.cos();
        let sin_h = pt.hdg.sin();
        // tangent component (along road)
        let along = dx * cos_h + dy * sin_h;
        // normal component (perpendicular, positive = left)
        let perp = -dx * sin_h + dy * cos_h;

        // Use perpendicular distance as base, add penalty for out-of-segment
        let dist = (along * along + perp * perp).sqrt();

        if dist < best_dist {
            best_dist = dist;
            best_s = pt.s;
            best_t = perp;
        }
    }

    if best_dist < f64::MAX {
        // Adjust distance by road width — if point is within road surface,
        // effective distance is reduced
        let half_width = road_half_width_at(road, best_s);
        let effective_dist = (best_t.abs() - half_width).max(0.0);
        // Also consider along-road distance for endpoints
        let clamped_dist = if best_dist < half_width * 2.0 {
            effective_dist
        } else {
            best_dist
        };

        Some(PickResult {
            id: road.id.clone(),
            distance: clamped_dist,
            s: best_s,
            t: best_t,
        })
    } else {
        None
    }
}

/// Estimate the half-width of a road at a given station s.
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
            position: Point3D { x: 30.0, y: -2.0, z: 0.0, id: None }, // s=30, t=-2
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
            position: Point3D { x: 30.0, y: -2.0, z: 0.0, id: None },
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
}
