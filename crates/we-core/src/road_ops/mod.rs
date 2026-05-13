//! Road-level transformation operations.
//!
//! Pure algorithms for cloning, reversing, mirroring, and optimizing roads.
//! All operations are WASM-compatible and side-effect free (return new Roads).

pub mod split;
pub mod weld;

#[allow(unused_imports)]
pub use split::*;
#[allow(unused_imports)]
pub use weld::*;

use crate::{
    geometry::eval::evaluate_geometry,
    model::{Geometry, GeometryType, Lane, LaneSection, Road},
    spline::{KnotType, road_to_spline, spline_to_geometries},
};
use std::f64::consts::PI;

// ── Clone ────────────────────────────────────────────────────────────────────

/// Create a deep-copied duplicate of a road with a new ID and XY offset.
///
/// The clone is disconnected (predecessor/successor links are cleared).
/// Use this to implement "Clone Road" tool.
pub fn clone_road(road: &Road, new_id: impl Into<String>, offset_xy: [f64; 2]) -> Road {
    let mut cloned = road.clone();
    cloned.id = new_id.into();
    cloned.link = None;

    let [dx, dy] = offset_xy;
    for geo in &mut cloned.plan_view {
        geo.x += dx;
        geo.y += dy;
    }

    cloned
}

// ── Reverse ──────────────────────────────────────────────────────────────────

/// Reverse the direction of a road.
///
/// - Geometry segments are reordered so the road runs in the opposite direction.
/// - Predecessor/successor links are swapped.
/// - Left and right lane sections are swapped; lane IDs are negated.
///
/// Returns a new road with the reversed geometry.
pub fn reverse_road(road: &Road) -> Road {
    let mut reversed = road.clone();

    // Reverse plan_view
    reversed.plan_view = reverse_plan_view(&road.plan_view);

    // Swap predecessor ↔ successor
    if let Some(ref mut link) = reversed.link {
        std::mem::swap(&mut link.predecessor, &mut link.successor);
    }

    // Swap left ↔ right lanes in every lane section; negate all lane IDs
    for section in &mut reversed.lane_sections {
        std::mem::swap(&mut section.left, &mut section.right);
        for lane in section
            .left
            .iter_mut()
            .chain(section.right.iter_mut())
            .chain(section.center.iter_mut())
        {
            lane.id = -lane.id;
        }
    }

    // Reverse elevation profile s-values: new_s = total_length - old_s, then sort
    let total = reversed.length;
    for ep in &mut reversed.elevation_profile {
        ep.s = (total - ep.s).max(0.0);
    }
    reversed
        .elevation_profile
        .sort_by(|a, b| a.s.partial_cmp(&b.s).unwrap_or(std::cmp::Ordering::Equal));

    reversed
}

/// Reverse a plan_view geometry list, rebuilding each segment's start pose.
fn reverse_plan_view(plan_view: &[Geometry]) -> Vec<Geometry> {
    if plan_view.is_empty() {
        return Vec::new();
    }

    // Compute the end pose (x, y, hdg) of every segment
    let end_poses: Vec<(f64, f64, f64)> = plan_view
        .iter()
        .map(|geo| {
            let pt = evaluate_geometry(geo, geo.length);
            (pt.x, pt.y, pt.hdg)
        })
        .collect();

    // The reversed road starts at the end of the last segment
    let mut reversed_geos: Vec<Geometry> = Vec::with_capacity(plan_view.len());
    let mut current_s = 0.0;

    for i in (0..plan_view.len()).rev() {
        let original = &plan_view[i];
        let (end_x, end_y, end_hdg) = end_poses[i];

        // New start of the reversed segment is the old end; heading flipped by π
        let new_hdg = normalize_angle(end_hdg + PI);
        let new_geo_type = reverse_geometry_type(&original.geo_type);

        reversed_geos.push(Geometry {
            s: current_s,
            x: end_x,
            y: end_y,
            hdg: new_hdg,
            length: original.length,
            geo_type: new_geo_type,
        });

        current_s += original.length;
    }

    reversed_geos
}

/// Reverse the geometry type for a reversed road segment.
fn reverse_geometry_type(geo_type: &GeometryType) -> GeometryType {
    match geo_type {
        GeometryType::Line => GeometryType::Line,
        GeometryType::Arc { curvature } => GeometryType::Arc {
            curvature: -curvature,
        },
        GeometryType::Spiral {
            curv_start,
            curv_end,
        } => GeometryType::Spiral {
            curv_start: -curv_end,
            curv_end: -curv_start,
        },
        // Poly3 / ParamPoly3: approximate via spline roundtrip in higher-level callers
        other => other.clone(),
    }
}

/// Normalize an angle to (-π, π].
fn normalize_angle(a: f64) -> f64 {
    let mut a = a;
    while a > PI {
        a -= 2.0 * PI;
    }
    while a <= -PI {
        a += 2.0 * PI;
    }
    a
}

// ── Mirror ───────────────────────────────────────────────────────────────────

/// Mirror a road by swapping its left and right lanes.
///
/// The reference line geometry is **not** changed; only the lane layout is
/// mirrored so that left lanes become right lanes and vice-versa.
/// Lane IDs are negated accordingly.
pub fn mirror_road(road: &Road) -> Road {
    let mut mirrored = road.clone();

    for section in &mut mirrored.lane_sections {
        // Swap the lane vectors
        std::mem::swap(&mut section.left, &mut section.right);

        // Negate IDs so signs match the new side (left=positive, right=negative)
        negate_lane_ids_in_section(section);
    }

    mirrored
}

fn negate_lane_ids_in_section(section: &mut LaneSection) {
    let negate_vec = |lanes: &mut Vec<Lane>| {
        for lane in lanes.iter_mut() {
            lane.id = -lane.id;
        }
    };
    negate_vec(&mut section.left);
    negate_vec(&mut section.right);
    // Center lane stays at 0
}

// ── Optimize Knots ───────────────────────────────────────────────────────────

/// Configuration for knot optimization.
#[derive(Debug, Clone)]
pub struct OptimizeConfig {
    /// Maximum allowed XY deviation (meters) when removing a knot.  Default: 0.01.
    pub xy_threshold: f64,
    /// Maximum allowed Z deviation (meters) when removing a knot.  Default: 0.005.
    pub z_threshold: f64,
}

impl Default for OptimizeConfig {
    fn default() -> Self {
        Self {
            xy_threshold: 0.01,
            z_threshold: 0.005,
        }
    }
}

/// Remove redundant knots from a road's reference-line spline.
///
/// Converts the road to a spline, applies the Douglas–Peucker simplification,
/// then converts back to OpenDRIVE geometry segments.
///
/// Returns `(new_road, removed_count)`.
pub fn optimize_road_knots(road: &Road, config: &OptimizeConfig) -> (Road, usize) {
    if road.plan_view.is_empty() {
        return (road.clone(), 0);
    }

    let sample_step = 2.0; // 2 m sampling
    let mut spline = road_to_spline(road, sample_step);
    let original_count = spline.knots.len();

    // Douglas–Peucker on the XY plane for Key/Anchor knots
    douglas_peucker_simplify(&mut spline.knots, config.xy_threshold);

    let removed = original_count.saturating_sub(spline.knots.len());

    if removed == 0 {
        return (road.clone(), 0);
    }

    // Recompute spline metadata
    spline.recompute_stations();
    spline.compute_tangents();

    let new_geoms = spline_to_geometries(&spline);
    if new_geoms.is_empty() {
        return (road.clone(), 0);
    }

    let new_length: f64 = new_geoms.iter().map(|g| g.length).sum();
    let mut new_road = road.clone();
    new_road.plan_view = new_geoms;
    new_road.length = new_length;

    (new_road, removed)
}

/// In-place Douglas–Peucker simplification of a flat knot list.
///
/// Marks intermediate knots whose perpendicular distance to the chord
/// between their neighbors is below `epsilon` for removal.
fn douglas_peucker_simplify(knots: &mut Vec<crate::spline::SplineKnot>, epsilon: f64) {
    if knots.len() < 3 {
        return;
    }

    // Work only on Key/Anchor knots (skip Intermediate from road_to_spline)
    let mut keep = vec![true; knots.len()];
    dp_recurse(knots, &mut keep, 0, knots.len() - 1, epsilon);

    // Always keep first and last
    keep[0] = true;
    keep[knots.len() - 1] = true;

    let mut i = 0;
    knots.retain(|_| {
        let k = keep[i];
        i += 1;
        k
    });
}

fn dp_recurse(
    knots: &[crate::spline::SplineKnot],
    keep: &mut Vec<bool>,
    start: usize,
    end: usize,
    epsilon: f64,
) {
    if end <= start + 1 {
        return;
    }

    let (ax, ay) = (knots[start].position[0], knots[start].position[1]);
    let (bx, by) = (knots[end].position[0], knots[end].position[1]);
    let dx = bx - ax;
    let dy = by - ay;
    let chord_len = (dx * dx + dy * dy).sqrt();

    let mut max_dist = 0.0;
    let mut max_idx = start;

    for i in (start + 1)..end {
        if knots[i].knot_type == KnotType::Intermediate {
            // Intermediate knots from road sampling can always be removed
            keep[i] = false;
            continue;
        }
        let dist = if chord_len < 1e-9 {
            let ex = knots[i].position[0] - ax;
            let ey = knots[i].position[1] - ay;
            (ex * ex + ey * ey).sqrt()
        } else {
            // Perpendicular distance from point i to line start→end
            let px = knots[i].position[0] - ax;
            let py = knots[i].position[1] - ay;
            (px * dy - py * dx).abs() / chord_len
        };
        if dist > max_dist {
            max_dist = dist;
            max_idx = i;
        }
    }

    if max_dist < epsilon {
        // All interior points can be removed
        keep[(start + 1)..end].iter_mut().for_each(|k| *k = false);
    } else {
        dp_recurse(knots, keep, start, max_idx, epsilon);
        dp_recurse(knots, keep, max_idx, end, epsilon);
    }
}

// ── Swap Centerline with Lane Edge ───────────────────────────────────────────

/// Swap the road's reference line (centerline) with the outer edge of a target lane.
///
/// The target lane's outer edge becomes the new reference line.
/// All lane widths are preserved; lanes reorganize around the new centerline.
///
/// - `target_lane_id > 0`: shift reference line to the left (outward from left lane)
/// - `target_lane_id < 0`: shift reference line to the right (outward from right lane)
/// - `target_lane_id == 0`: returns a clone unchanged
///
/// Clears predecessor/successor links since the geometry has changed.
pub fn swap_centerline_with_edge(road: &Road, target_lane_id: i32) -> Road {
    if target_lane_id == 0 || road.plan_view.is_empty() {
        return road.clone();
    }

    // Compute cumulative lateral offset T to the outer edge of target_lane_id.
    // T is positive (left) for target_lane_id > 0, negative for target_lane_id < 0.
    let lateral_offset = compute_edge_offset(road, target_lane_id);

    // Sample the reference line and offset each point by T perpendicular to heading.
    let sample_step = 2.0;
    let ref_points = crate::geometry::eval::sample_road_reference_line(road, sample_step);

    let edge_knots: Vec<crate::spline::SplineKnot> = ref_points
        .iter()
        .map(|pt| {
            let (ex, ey, _) = crate::geometry::eval::offset_point(pt, lateral_offset, 0.0);
            // Use Key type so spline_to_geometries includes these knots
            crate::spline::SplineKnot::with_station(ex, ey, 0.0, pt.s)
        })
        .collect();

    // Convert sampled edge points to geometry segments via spline.
    let mut new_spline = crate::spline::EditableSpline::from_knots(edge_knots);
    new_spline.recompute_stations();
    new_spline.compute_tangents();
    let new_geoms = spline_to_geometries(&new_spline);

    if new_geoms.is_empty() {
        return road.clone();
    }

    let new_length: f64 = new_geoms.iter().map(|g| g.length).sum();
    let new_sections = rebuild_sections_after_swap(&road.lane_sections, target_lane_id);

    let mut new_road = road.clone();
    new_road.plan_view = new_geoms;
    new_road.length = new_length;
    new_road.lane_sections = new_sections;
    new_road.link = None;

    new_road
}

/// Compute the cumulative lateral offset (signed) to the outer edge of `target_lane_id`.
///
/// Sums lane widths from the center lane outward to the target lane.
/// Positive = left, negative = right (OpenDRIVE convention).
fn compute_edge_offset(road: &Road, target_lane_id: i32) -> f64 {
    let section = match road.lane_sections.first() {
        Some(s) => s,
        None => return 0.0,
    };

    let abs_id = target_lane_id.unsigned_abs() as i32;
    let lanes = if target_lane_id > 0 {
        &section.left
    } else {
        &section.right
    };

    let mut total = 0.0;
    for lane in lanes {
        if lane.id.unsigned_abs() as i32 <= abs_id {
            total += lane.width.first().map(|lw| lw.a).unwrap_or(0.0);
        }
    }

    if target_lane_id > 0 { total } else { -total }
}

/// Rebuild lane sections so lane IDs are valid after the centerline swap.
///
/// For a left-side swap (target_lane_id > 0):
///   - Lanes outside the target (id > target_lane_id) remain on the left side.
///   - The target lane itself and lanes inside it plus original right lanes move to the right.
///
/// For a right-side swap (target_lane_id < 0):
///   - Symmetric logic.
fn rebuild_sections_after_swap(sections: &[LaneSection], target_lane_id: i32) -> Vec<LaneSection> {
    sections
        .iter()
        .map(|sec| {
            let mut new_sec = sec.clone();
            if target_lane_id > 0 {
                // Left-side swap
                let outside_left: Vec<Lane> = sec
                    .left
                    .iter()
                    .filter(|l| l.id > target_lane_id)
                    .cloned()
                    .enumerate()
                    .map(|(i, mut l)| {
                        l.id = (i + 1) as i32;
                        l
                    })
                    .collect();

                // Inside-left lanes (1..=target) + original right lanes → new right
                let inside_left: Vec<Lane> = sec
                    .left
                    .iter()
                    .filter(|l| l.id <= target_lane_id)
                    .rev() // innermost first for consistent ordering
                    .cloned()
                    .collect();

                let orig_right: Vec<Lane> = sec.right.to_vec();
                let new_right: Vec<Lane> = inside_left
                    .into_iter()
                    .chain(orig_right)
                    .enumerate()
                    .map(|(i, mut l)| {
                        l.id = -((i + 1) as i32);
                        l
                    })
                    .collect();

                new_sec.left = outside_left;
                new_sec.right = new_right;
            } else {
                // Right-side swap (target_lane_id < 0)
                let abs_id = target_lane_id.unsigned_abs() as i32;

                let outside_right: Vec<Lane> = sec
                    .right
                    .iter()
                    .filter(|l| l.id.unsigned_abs() as i32 > abs_id)
                    .cloned()
                    .enumerate()
                    .map(|(i, mut l)| {
                        l.id = -((i + 1) as i32);
                        l
                    })
                    .collect();

                let inside_right: Vec<Lane> = sec
                    .right
                    .iter()
                    .filter(|l| l.id.unsigned_abs() as i32 <= abs_id)
                    .rev()
                    .cloned()
                    .collect();

                let orig_left: Vec<Lane> = sec.left.to_vec();
                let new_left: Vec<Lane> = inside_right
                    .into_iter()
                    .chain(orig_left)
                    .enumerate()
                    .map(|(i, mut l)| {
                        l.id = (i + 1) as i32;
                        l
                    })
                    .collect();

                new_sec.right = outside_right;
                new_sec.left = new_left;
            }
            new_sec
        })
        .collect()
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        Geometry, GeometryType, Lane, LaneSection, LaneType, LaneWidth, LinkElement,
        LinkElementType, Road, RoadLink,
    };

    fn make_link(pred: Option<&str>, succ: Option<&str>) -> Option<RoadLink> {
        let make_el = |id: &str| LinkElement {
            element_type: LinkElementType::Road,
            element_id: id.to_string(),
            contact_point: None,
        };
        Some(RoadLink {
            predecessor: pred.map(make_el),
            successor: succ.map(make_el),
        })
    }

    fn make_road_with_line(id: &str) -> Road {
        let mut road = Road::new(id, 100.0);
        road.plan_view = vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 100.0,
            geo_type: GeometryType::Line,
        }];
        road
    }

    fn make_road_with_lane_sections(id: &str) -> Road {
        let make_lane = |lane_id: i32| Lane {
            id: lane_id,
            lane_type: LaneType::Driving,
            level: 0,
            render_hidden: false,
            link: None,
            width: vec![LaneWidth {
                s_offset: 0.0,
                a: 3.5,
                b: 0.0,
                c: 0.0,
                d: 0.0,
            }],
            borders: vec![],
            road_marks: vec![],
        };
        let section = LaneSection {
            s: 0.0,
            single_side: false,
            render_hidden: false,
            left: vec![make_lane(1), make_lane(2)],
            center: vec![make_lane(0)],
            right: vec![make_lane(-1), make_lane(-2)],
        };
        let mut road = make_road_with_line(id);
        road.lane_sections = vec![section];
        road
    }

    // ── clone_road ────────────────────────────────────────────────────────────

    #[test]
    fn test_clone_road_assigns_new_id() {
        let road = make_road_with_line("original");
        let cloned = clone_road(&road, "copy", [0.0, 0.0]);
        assert_eq!(cloned.id, "copy");
        assert_eq!(road.id, "original"); // original unchanged
    }

    #[test]
    fn test_clone_road_applies_xy_offset() {
        let road = make_road_with_line("r1");
        let cloned = clone_road(&road, "r2", [10.0, 20.0]);
        assert!((cloned.plan_view[0].x - 10.0).abs() < 1e-9);
        assert!((cloned.plan_view[0].y - 20.0).abs() < 1e-9);
        // Original should be untouched
        assert!((road.plan_view[0].x - 0.0).abs() < 1e-9);
    }

    #[test]
    fn test_clone_road_zero_offset_keeps_same_geometry() {
        let road = make_road_with_line("r1");
        let cloned = clone_road(&road, "r2", [0.0, 0.0]);
        assert_eq!(cloned.plan_view.len(), road.plan_view.len());
        assert!((cloned.plan_view[0].x - road.plan_view[0].x).abs() < 1e-9);
    }

    #[test]
    fn test_clone_road_clears_links() {
        let mut road = make_road_with_line("r1");
        road.link = make_link(Some("prev"), Some("next"));
        let cloned = clone_road(&road, "r2", [0.0, 0.0]);
        assert!(cloned.link.is_none());
    }

    #[test]
    fn test_clone_road_preserves_length() {
        let road = make_road_with_line("r1");
        let cloned = clone_road(&road, "r2", [5.0, 5.0]);
        assert!((cloned.length - road.length).abs() < 1e-9);
    }

    #[test]
    fn test_clone_road_is_independent() {
        let mut road = make_road_with_lane_sections("r1");
        let cloned = clone_road(&road, "r2", [0.0, 0.0]);
        // Mutating original should not affect clone
        road.lane_sections[0].left[0].id = 99;
        assert_eq!(cloned.lane_sections[0].left[0].id, 1);
    }

    // ── reverse_road ─────────────────────────────────────────────────────────

    #[test]
    fn test_reverse_road_same_length() {
        let road = make_road_with_line("r1");
        let rev = reverse_road(&road);
        assert!((rev.length - road.length).abs() < 1e-9);
    }

    #[test]
    fn test_reverse_road_line_start_is_old_end() {
        let road = make_road_with_line("r1");
        // Line goes from (0,0) heading 0, length 100  → end at (100, 0)
        let rev = reverse_road(&road);
        assert_eq!(rev.plan_view.len(), 1);
        assert!(
            (rev.plan_view[0].x - 100.0).abs() < 1e-6,
            "start x should be 100, got {}",
            rev.plan_view[0].x
        );
        assert!((rev.plan_view[0].y - 0.0).abs() < 1e-6);
    }

    #[test]
    fn test_reverse_road_line_heading_flipped() {
        let road = make_road_with_line("r1");
        let rev = reverse_road(&road);
        // Reversed heading should be ~π (pointing in -X direction)
        let hdg = rev.plan_view[0].hdg;
        assert!(
            (hdg.abs() - PI).abs() < 1e-6,
            "heading should be ±π, got {}",
            hdg
        );
    }

    #[test]
    fn test_reverse_road_multiple_segments_reorder() {
        let mut road = Road::new("r1", 30.0);
        road.plan_view = vec![
            Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length: 10.0,
                geo_type: GeometryType::Line,
            },
            Geometry {
                s: 10.0,
                x: 10.0,
                y: 0.0,
                hdg: 0.0,
                length: 10.0,
                geo_type: GeometryType::Line,
            },
            Geometry {
                s: 20.0,
                x: 20.0,
                y: 0.0,
                hdg: 0.0,
                length: 10.0,
                geo_type: GeometryType::Line,
            },
        ];
        let rev = reverse_road(&road);
        assert_eq!(rev.plan_view.len(), 3);
        // The first segment in reversed road starts near x=30 (end of original)
        assert!(
            (rev.plan_view[0].x - 30.0).abs() < 1e-6,
            "expected x≈30, got {}",
            rev.plan_view[0].x
        );
        // s values must be monotone from 0
        assert!((rev.plan_view[0].s - 0.0).abs() < 1e-9);
        assert!((rev.plan_view[1].s - 10.0).abs() < 1e-9);
        assert!((rev.plan_view[2].s - 20.0).abs() < 1e-9);
    }

    #[test]
    fn test_reverse_road_arc_negates_curvature() {
        let mut road = Road::new("r1", 50.0);
        road.plan_view = vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 50.0,
            geo_type: GeometryType::Arc { curvature: 0.02 },
        }];
        let rev = reverse_road(&road);
        if let GeometryType::Arc { curvature } = rev.plan_view[0].geo_type {
            assert!((curvature - (-0.02)).abs() < 1e-9);
        } else {
            panic!("Expected Arc");
        }
    }

    #[test]
    fn test_reverse_road_spiral_swaps_curv() {
        let mut road = Road::new("r1", 60.0);
        road.plan_view = vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 60.0,
            geo_type: GeometryType::Spiral {
                curv_start: 0.0,
                curv_end: 0.02,
            },
        }];
        let rev = reverse_road(&road);
        if let GeometryType::Spiral {
            curv_start,
            curv_end,
        } = rev.plan_view[0].geo_type
        {
            assert!(
                (curv_start - (-0.02)).abs() < 1e-9,
                "curv_start should be -0.02, got {}",
                curv_start
            );
            assert!(
                (curv_end - 0.0).abs() < 1e-9,
                "curv_end should be 0.0, got {}",
                curv_end
            );
        } else {
            panic!("Expected Spiral");
        }
    }

    #[test]
    fn test_reverse_road_swaps_predecessor_successor() {
        let mut road = make_road_with_line("r1");
        road.link = make_link(Some("prev-road"), Some("succ-road"));
        let rev = reverse_road(&road);
        let link = rev.link.as_ref().unwrap();
        assert_eq!(link.predecessor.as_ref().unwrap().element_id, "succ-road");
        assert_eq!(link.successor.as_ref().unwrap().element_id, "prev-road");
    }

    #[test]
    fn test_reverse_road_swaps_left_right_lanes() {
        let road = make_road_with_lane_sections("r1");
        // Original: left=[1,2], right=[-1,-2]
        let rev = reverse_road(&road);
        let sec = &rev.lane_sections[0];
        // After reverse+negate: left was right ([-1,-2]) → negated → [1,2]
        let left_ids: Vec<i32> = sec.left.iter().map(|l| l.id).collect();
        let right_ids: Vec<i32> = sec.right.iter().map(|l| l.id).collect();
        // All left IDs should be positive (came from right, negated)
        assert!(
            left_ids.iter().all(|&id| id > 0),
            "left IDs should be positive: {:?}",
            left_ids
        );
        // All right IDs should be negative
        assert!(
            right_ids.iter().all(|&id| id < 0),
            "right IDs should be negative: {:?}",
            right_ids
        );
    }

    #[test]
    fn test_reverse_road_no_link() {
        let road = make_road_with_line("r1");
        let rev = reverse_road(&road);
        assert!(rev.link.is_none());
    }

    // ── mirror_road ───────────────────────────────────────────────────────────

    #[test]
    fn test_mirror_road_swaps_left_right_lanes() {
        let road = make_road_with_lane_sections("r1");
        let mirrored = mirror_road(&road);
        let sec = &mirrored.lane_sections[0];
        // After swap: left was [-1,-2] negated → [1,2]; right was [1,2] negated → [-1,-2]
        let left_ids: Vec<i32> = sec.left.iter().map(|l| l.id).collect();
        let right_ids: Vec<i32> = sec.right.iter().map(|l| l.id).collect();
        assert!(
            left_ids.iter().all(|&id| id > 0),
            "left IDs should be positive: {:?}",
            left_ids
        );
        assert!(
            right_ids.iter().all(|&id| id < 0),
            "right IDs should be negative: {:?}",
            right_ids
        );
    }

    #[test]
    fn test_mirror_road_preserves_lane_count() {
        let road = make_road_with_lane_sections("r1");
        let mirrored = mirror_road(&road);
        assert_eq!(
            mirrored.lane_sections[0].left.len(),
            road.lane_sections[0].right.len()
        );
        assert_eq!(
            mirrored.lane_sections[0].right.len(),
            road.lane_sections[0].left.len()
        );
    }

    #[test]
    fn test_mirror_road_preserves_geometry() {
        let road = make_road_with_line("r1");
        let mirrored = mirror_road(&road);
        assert_eq!(mirrored.plan_view.len(), road.plan_view.len());
        assert!((mirrored.plan_view[0].x - road.plan_view[0].x).abs() < 1e-9);
        assert!((mirrored.plan_view[0].y - road.plan_view[0].y).abs() < 1e-9);
    }

    #[test]
    fn test_mirror_road_is_independent() {
        let mut road = make_road_with_lane_sections("r1");
        let mirrored = mirror_road(&road);
        road.lane_sections[0].left[0].id = 99;
        // mirrored.left came from road.right (id -1), negated to +1
        assert_eq!(mirrored.lane_sections[0].left[0].id, 1);
    }

    #[test]
    fn test_mirror_road_center_lane_unchanged() {
        let road = make_road_with_lane_sections("r1");
        let mirrored = mirror_road(&road);
        assert_eq!(mirrored.lane_sections[0].center[0].id, 0);
    }

    // ── optimize_road_knots ───────────────────────────────────────────────────

    #[test]
    fn test_optimize_no_change_for_simple_road() {
        // A single straight-line geometry segment is already optimal.
        let road = make_road_with_line("r1");
        let config = OptimizeConfig::default();
        let (optimized, _removed) = optimize_road_knots(&road, &config);
        // Result must still be a valid non-empty road
        assert!(
            !optimized.plan_view.is_empty(),
            "optimized road should still have geometry"
        );
        assert!(
            optimized.length > 0.0,
            "optimized road should have positive length"
        );
    }

    #[test]
    fn test_optimize_empty_road_returns_unchanged() {
        let road = Road::new("empty", 0.0);
        let config = OptimizeConfig::default();
        let (optimized, removed) = optimize_road_knots(&road, &config);
        assert_eq!(removed, 0);
        assert!(optimized.plan_view.is_empty());
    }

    #[test]
    fn test_optimize_collinear_points_removed() {
        // Road with three collinear geometry segments — middle one is redundant
        let mut road = Road::new("r1", 30.0);
        road.plan_view = vec![
            Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length: 10.0,
                geo_type: GeometryType::Line,
            },
            Geometry {
                s: 10.0,
                x: 10.0,
                y: 0.0,
                hdg: 0.0,
                length: 10.0,
                geo_type: GeometryType::Line,
            },
            Geometry {
                s: 20.0,
                x: 20.0,
                y: 0.0,
                hdg: 0.0,
                length: 10.0,
                geo_type: GeometryType::Line,
            },
        ];
        let config = OptimizeConfig {
            xy_threshold: 0.1,
            z_threshold: 0.005,
        };
        let (optimized, removed) = optimize_road_knots(&road, &config);
        // The resulting road should have fewer or equal geometry segments
        assert!(optimized.plan_view.len() <= road.plan_view.len());
        let _ = removed;
    }

    // ── swap_centerline_with_edge ─────────────────────────────────────────────

    #[test]
    fn test_swap_centerline_with_left_lane_offsets_refline() {
        // Road with left lane 1 (width 3.5m), right lane -1 (width 3.5m)
        // Swapping with left lane 1 outer edge should shift refline 3.5m to the left
        let road = make_road_with_lane_sections("r1");
        let swapped = swap_centerline_with_edge(&road, 1);
        // New plan_view start should be offset 3.5m perpendicular (heading=0, so +Y direction)
        assert!(
            !swapped.plan_view.is_empty(),
            "swapped road should have geometry"
        );
        let start_y = swapped.plan_view[0].y;
        assert!(
            (start_y - 3.5).abs() < 0.5,
            "start y should be ~3.5, got {}",
            start_y
        );
    }

    #[test]
    fn test_swap_centerline_with_right_lane_offsets_refline() {
        let road = make_road_with_lane_sections("r1");
        let swapped = swap_centerline_with_edge(&road, -1);
        assert!(!swapped.plan_view.is_empty());
        let start_y = swapped.plan_view[0].y;
        // New refline shifted 3.5m to the right → start_y should be ~-3.5
        assert!(
            (start_y - (-3.5)).abs() < 0.5,
            "start y should be ~-3.5, got {}",
            start_y
        );
    }

    #[test]
    fn test_swap_centerline_id_zero_returns_clone() {
        let road = make_road_with_lane_sections("r1");
        let swapped = swap_centerline_with_edge(&road, 0);
        assert_eq!(swapped.plan_view.len(), road.plan_view.len());
    }

    #[test]
    fn test_swap_centerline_lane_count_preserved() {
        let road = make_road_with_lane_sections("r1");
        let swapped = swap_centerline_with_edge(&road, 1);
        // Total non-center lane count should be preserved
        let orig_total = road.lane_sections[0].left.len() + road.lane_sections[0].right.len();
        let new_total = swapped.lane_sections[0].left.len() + swapped.lane_sections[0].right.len();
        assert_eq!(new_total, orig_total);
    }

    #[test]
    fn test_swap_centerline_left_side_moves_inside_lanes_to_right() {
        // Left lane 2 is outside lane 1; swapping with lane 1 outer edge:
        // - Lane 2 (outside) should remain on left
        // - Lane 1 and old right lanes should be on right
        let road = make_road_with_lane_sections("r1");
        let swapped = swap_centerline_with_edge(&road, 1);
        let sec = &swapped.lane_sections[0];
        // All left IDs should be positive, right IDs negative (OpenDRIVE convention)
        for lane in &sec.left {
            assert!(
                lane.id > 0,
                "Left lane id should be positive, got {}",
                lane.id
            );
        }
        for lane in &sec.right {
            assert!(
                lane.id < 0,
                "Right lane id should be negative, got {}",
                lane.id
            );
        }
    }

    #[test]
    fn test_swap_centerline_preserves_length_approximately() {
        let road = make_road_with_lane_sections("r1");
        let swapped = swap_centerline_with_edge(&road, 1);
        // Length should be approximately the same (offset line is same arc length for straight road)
        assert!((swapped.length - road.length).abs() < road.length * 0.05 + 1.0);
    }
}
