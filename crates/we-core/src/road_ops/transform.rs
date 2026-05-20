//! Road transform operations: clone, reverse, mirror.

use crate::{
    geometry::eval::evaluate_geometry,
    model::{Geometry, GeometryType, Lane, LaneSection, Road},
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
