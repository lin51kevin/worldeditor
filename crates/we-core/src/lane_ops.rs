//! Lane editing operations and boundary computation.
//!
//! Provides algorithms for:
//! - Computing lane boundary polylines from OpenDRIVE data
//! - Generating default lane sections from road geometry
//! - Lane width interpolation and rebasing

use crate::geometry::eval::{evaluate_geometry, evaluate_lane_width, offset_point, RefLinePoint};
use crate::model::{Lane, LaneSection, LaneType, LaneWidth, Road};

/// A sampled point on a lane boundary.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LaneBoundaryPoint {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    /// Station along the road reference line.
    pub s: f64,
    /// Lateral offset from reference line (signed: left positive, right negative).
    pub t: f64,
}

/// Sample the left or right boundary of a specific lane.
///
/// `lane_id > 0` → left side, `lane_id < 0` → right side.
/// Returns a polyline of boundary points sampled at `step` intervals.
pub fn sample_lane_boundary(
    road: &Road,
    section_s: f64,
    lane_id: i32,
    step: f64,
) -> Vec<LaneBoundaryPoint> {
    let section = match road
        .lane_sections
        .iter()
        .find(|s| (s.s - section_s).abs() < 1e-9)
    {
        Some(s) => s,
        None => return Vec::new(),
    };

    // Determine section end
    let section_end = road
        .lane_sections
        .iter()
        .filter(|s| s.s > section_s + 1e-9)
        .map(|s| s.s)
        .next()
        .unwrap_or(road.length);

    let section_len = section_end - section_s;
    if section_len <= 0.0 {
        return Vec::new();
    }

    let sample_step = step.max(0.1);
    let n_samples = ((section_len / sample_step).ceil() as usize).max(1) + 1;

    let mut points = Vec::with_capacity(n_samples);

    for i in 0..n_samples {
        let ds = (i as f64 * sample_step).min(section_len);
        let s = section_s + ds;

        // Evaluate reference line point
        let ref_pt = evaluate_reference_line_at(road, s);

        // Compute lateral offset to the outer edge of this lane
        let t = compute_lane_outer_offset(section, lane_id, ds);

        let elevation = crate::geometry::eval::evaluate_elevation(&road.elevation_profile, s);
        let (px, py, _pz) = offset_point(&ref_pt, t, elevation);

        points.push(LaneBoundaryPoint {
            x: px,
            y: py,
            z: elevation,
            s,
            t,
        });
    }

    points
}

/// Compute the lateral offset to the outer edge of a lane at a given ds within the section.
///
/// For left lanes (id > 0): offset is positive, accumulated from center outward.
/// For right lanes (id < 0): offset is negative, accumulated from center outward.
pub fn compute_lane_outer_offset(section: &LaneSection, lane_id: i32, ds: f64) -> f64 {
    if lane_id == 0 {
        return 0.0;
    }

    if lane_id > 0 {
        // Left side: lanes 1, 2, 3, ... (positive t direction)
        let mut offset = 0.0;
        for id in 1..=lane_id {
            if let Some(lane) = section.left.iter().find(|l| l.id == id) {
                offset += evaluate_lane_width(&lane.width, ds);
            }
        }
        offset
    } else {
        // Right side: lanes -1, -2, -3, ... (negative t direction)
        let mut offset = 0.0;
        for id in (lane_id..=-1).rev() {
            if let Some(lane) = section.right.iter().find(|l| l.id == id) {
                offset -= evaluate_lane_width(&lane.width, ds);
            }
        }
        offset
    }
}

/// Evaluate the reference line (plan_view) at a given s coordinate.
///
/// Finds the correct geometry segment and evaluates it.
fn evaluate_reference_line_at(road: &Road, s: f64) -> RefLinePoint {
    // Find the geometry segment that contains this s value
    let mut active_geo_idx = 0;
    for (i, geo) in road.plan_view.iter().enumerate() {
        if geo.s <= s + 1e-9 {
            active_geo_idx = i;
        }
    }

    if road.plan_view.is_empty() {
        return RefLinePoint {
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            s,
        };
    }

    let geo = &road.plan_view[active_geo_idx];
    let ds = (s - geo.s).max(0.0).min(geo.length);
    evaluate_geometry(geo, ds)
}

/// Generate a default lane section for a road with the given number of lanes per side.
///
/// Creates a symmetric layout with `n_lanes` driving lanes on each side
/// plus optional shoulder lanes.
pub fn generate_default_lane_section(
    s: f64,
    n_lanes_per_side: u32,
    lane_width: f64,
    with_shoulder: bool,
) -> LaneSection {
    let mut left = Vec::new();
    let mut right = Vec::new();

    let make_lane = |id: i32, lt: LaneType, w: f64| -> Lane {
        Lane {
            id,
            lane_type: lt,
            level: 0,
            render_hidden: false,
            link: None,
            width: vec![LaneWidth {
                s_offset: 0.0,
                a: w,
                b: 0.0,
                c: 0.0,
                d: 0.0,
            }],
            borders: vec![],
            road_marks: vec![],
        }
    };

    // Left lanes (positive IDs, numbered outward from center)
    for i in 1..=n_lanes_per_side {
        left.push(make_lane(i as i32, LaneType::Driving, lane_width));
    }
    if with_shoulder {
        left.push(make_lane(
            (n_lanes_per_side + 1) as i32,
            LaneType::Shoulder,
            2.0,
        ));
    }

    // Right lanes (negative IDs, numbered outward from center)
    for i in 1..=n_lanes_per_side {
        right.push(make_lane(-(i as i32), LaneType::Driving, lane_width));
    }
    if with_shoulder {
        right.push(make_lane(
            -((n_lanes_per_side + 1) as i32),
            LaneType::Shoulder,
            2.0,
        ));
    }

    let center = vec![make_lane(0, LaneType::None, 0.0)];

    LaneSection {
        s,
        single_side: false,
        render_hidden: false,
        left,
        center,
        right,
    }
}

/// Compute the total road width at a given ds within a lane section.
///
/// Returns (left_width, right_width) — both positive values.
pub fn compute_road_width_at(section: &LaneSection, ds: f64) -> (f64, f64) {
    let left_width: f64 = section
        .left
        .iter()
        .map(|lane| evaluate_lane_width(&lane.width, ds))
        .sum();
    let right_width: f64 = section
        .right
        .iter()
        .map(|lane| evaluate_lane_width(&lane.width, ds))
        .sum();
    (left_width, right_width)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;

    fn make_test_road() -> Road {
        Road::from_centerline(
            "r1",
            vec![Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length: 100.0,
                geo_type: GeometryType::Line,
            }],
        )
    }

    #[test]
    fn test_compute_lane_outer_offset_center() {
        let road = make_test_road();
        let section = &road.lane_sections[0];
        let offset = compute_lane_outer_offset(section, 0, 0.0);
        assert!((offset - 0.0).abs() < 1e-10);
    }

    #[test]
    fn test_compute_lane_outer_offset_right() {
        let road = make_test_road();
        let section = &road.lane_sections[0];
        // Right lane -1 has width 3.5, offset should be -3.5
        let offset = compute_lane_outer_offset(section, -1, 0.0);
        assert!((offset - (-3.5)).abs() < 1e-6);
    }

    #[test]
    fn test_compute_lane_outer_offset_right_multilane() {
        let section = generate_default_lane_section(0.0, 3, 3.5, false);
        let offset_lane2 = compute_lane_outer_offset(&section, -2, 0.0);
        let offset_lane3 = compute_lane_outer_offset(&section, -3, 0.0);
        assert!((offset_lane2 - (-7.0)).abs() < 1e-6);
        assert!((offset_lane3 - (-10.5)).abs() < 1e-6);
    }

    #[test]
    fn test_compute_lane_outer_offset_left() {
        let road = make_test_road();
        let section = &road.lane_sections[0];
        let offset = compute_lane_outer_offset(section, 1, 0.0);
        assert!((offset - 3.5).abs() < 1e-6);
    }

    #[test]
    fn test_sample_lane_boundary() {
        let road = make_test_road();
        let points = sample_lane_boundary(&road, 0.0, -1, 10.0);
        // Should have ~11 points (0, 10, 20, ..., 100)
        assert!(points.len() >= 10);
        // All points should be at t = -3.5 (constant width)
        for p in &points {
            assert!((p.t - (-3.5)).abs() < 1e-6, "t = {}", p.t);
        }
        // First point should be near (0, -3.5)
        assert!(points[0].x.abs() < 0.1);
        assert!((points[0].y - (-3.5)).abs() < 0.1);
    }

    #[test]
    fn test_sample_lane_boundary_left() {
        let road = make_test_road();
        let points = sample_lane_boundary(&road, 0.0, 1, 10.0);
        assert!(points.len() >= 10);
        for p in &points {
            assert!((p.t - 3.5).abs() < 1e-6);
        }
    }

    #[test]
    fn test_sample_lane_boundary_right_multilane() {
        let mut road = make_test_road();
        road.lane_sections[0] = generate_default_lane_section(0.0, 3, 3.5, false);
        let points = sample_lane_boundary(&road, 0.0, -2, 10.0);
        assert!(points.len() >= 10);
        for p in &points {
            assert!((p.t - (-7.0)).abs() < 1e-6, "t = {}", p.t);
        }
    }

    #[test]
    fn test_sample_lane_boundary_nonexistent_section() {
        let road = make_test_road();
        let points = sample_lane_boundary(&road, 999.0, -1, 10.0);
        assert!(points.is_empty());
    }

    #[test]
    fn test_generate_default_lane_section() {
        let section = generate_default_lane_section(0.0, 2, 3.75, false);
        assert_eq!(section.left.len(), 2);
        assert_eq!(section.right.len(), 2);
        assert_eq!(section.center.len(), 1);
        assert_eq!(section.left[0].id, 1);
        assert_eq!(section.left[1].id, 2);
        assert_eq!(section.right[0].id, -1);
        assert_eq!(section.right[1].id, -2);
    }

    #[test]
    fn test_generate_default_lane_section_with_shoulder() {
        let section = generate_default_lane_section(0.0, 1, 3.5, true);
        assert_eq!(section.left.len(), 2); // 1 driving + 1 shoulder
        assert_eq!(section.right.len(), 2);
        assert_eq!(section.left[1].lane_type, LaneType::Shoulder);
        assert_eq!(section.right[1].lane_type, LaneType::Shoulder);
    }

    #[test]
    fn test_compute_road_width_at() {
        let road = make_test_road();
        let section = &road.lane_sections[0];
        let (left, right) = compute_road_width_at(section, 0.0);
        assert!((left - 3.5).abs() < 1e-6);
        assert!((right - 3.5).abs() < 1e-6);
    }

    #[test]
    fn test_compute_road_width_at_varying() {
        let mut road = make_test_road();
        // Set right lane to have varying width: a=3.0 + b=0.02 → width at ds=50 = 4.0
        road.lane_sections[0].right[0].width = vec![LaneWidth {
            s_offset: 0.0,
            a: 3.0,
            b: 0.02,
            c: 0.0,
            d: 0.0,
        }];
        let section = &road.lane_sections[0];
        let (_, right) = compute_road_width_at(section, 50.0);
        assert!((right - 4.0).abs() < 1e-6);
    }
}
