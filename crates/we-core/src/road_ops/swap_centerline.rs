//! Swap the road's reference line (centerline) with a lane edge.

use crate::{
    model::{Lane, LaneSection, Road},
    spline::spline_to_geometries,
};

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
