//! Road knot optimization using Douglas–Peucker simplification.

use crate::{
    model::Road,
    spline::{KnotType, road_to_spline, spline_to_geometries},
};

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
