//! Elevation editing utilities.
//!
//! Provides fine-grained editing operations on road elevation profiles:
//! add/delete/move individual elevation entries, smooth profiles, and
//! compute grade/slope metrics.

use crate::model::{Elevation, Road};
use serde::{Deserialize, Serialize};

/// Result of an elevation query at a point.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ElevationQueryResult {
    /// Evaluated elevation (Z) at the query station.
    pub elevation: f64,
    /// Grade (slope) as a ratio (rise/run) at the query station.
    pub grade: f64,
    /// Grade as a percentage.
    pub grade_pct: f64,
}

/// Query the elevation and grade at a specific station on a road.
pub fn query_elevation_at(road: &Road, s: f64) -> ElevationQueryResult {
    let s_clamped = s.max(0.0).min(road.length);
    let entry = road
        .elevation_profile
        .iter()
        .rev()
        .find(|e| e.s <= s_clamped + 1e-9);

    match entry {
        Some(e) => {
            let ds = s_clamped - e.s;
            let elevation = e.a + e.b * ds + e.c * ds * ds + e.d * ds * ds * ds;
            // Grade = first derivative of cubic: b + 2c*ds + 3d*ds^2
            let grade = e.b + 2.0 * e.c * ds + 3.0 * e.d * ds * ds;
            ElevationQueryResult {
                elevation,
                grade,
                grade_pct: grade * 100.0,
            }
        }
        None => ElevationQueryResult {
            elevation: 0.0,
            grade: 0.0,
            grade_pct: 0.0,
        },
    }
}

/// Add a new elevation point to a profile, maintaining sorted order by s.
///
/// Returns the new profile (immutable pattern).
pub fn add_elevation_point(profile: &[Elevation], s: f64, height: f64) -> Vec<Elevation> {
    let mut result: Vec<Elevation> = profile.to_vec();
    let new_entry = Elevation {
        s,
        a: height,
        b: 0.0,
        c: 0.0,
        d: 0.0,
    };
    // Insert at the correct position to maintain sorted order
    let pos = result.partition_point(|e| e.s < s - 1e-9);
    // If there's already an entry at this s, replace it
    if pos < result.len() && (result[pos].s - s).abs() < 1e-9 {
        result[pos] = new_entry;
    } else {
        result.insert(pos, new_entry);
    }
    // Recompute tangents for smooth interpolation
    recompute_elevation_tangents(&mut result);
    result
}

/// Delete an elevation point at station s (within tolerance).
///
/// Returns the new profile, or None if no point was found.
pub fn delete_elevation_point(profile: &[Elevation], s: f64, tolerance: f64) -> Option<Vec<Elevation>> {
    let idx = profile
        .iter()
        .position(|e| (e.s - s).abs() < tolerance)?;
    let mut result: Vec<Elevation> = profile.to_vec();
    result.remove(idx);
    recompute_elevation_tangents(&mut result);
    Some(result)
}

/// Move an elevation point: change its height (and optionally station).
///
/// Returns the new profile, or None if no point was found at `old_s`.
pub fn move_elevation_point(
    profile: &[Elevation],
    old_s: f64,
    new_s: f64,
    new_height: f64,
    tolerance: f64,
) -> Option<Vec<Elevation>> {
    let idx = profile
        .iter()
        .position(|e| (e.s - old_s).abs() < tolerance)?;
    let mut result: Vec<Elevation> = profile.to_vec();
    result[idx].s = new_s;
    result[idx].a = new_height;
    // Re-sort by s
    result.sort_by(|a, b| {
        a.s.partial_cmp(&b.s)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    recompute_elevation_tangents(&mut result);
    Some(result)
}

/// Smooth the elevation profile using a simple averaging filter.
///
/// Each interior point's height is averaged with its neighbors.
/// `iterations` controls how many smoothing passes to apply.
pub fn smooth_elevation_profile(profile: &[Elevation], iterations: u32) -> Vec<Elevation> {
    if profile.len() < 3 {
        return profile.to_vec();
    }
    let mut result = profile.to_vec();
    for _ in 0..iterations {
        let prev = result.clone();
        for i in 1..prev.len() - 1 {
            result[i].a = (prev[i - 1].a + prev[i].a + prev[i + 1].a) / 3.0;
        }
    }
    recompute_elevation_tangents(&mut result);
    result
}

/// Recompute tangent coefficients (b, c, d) for smooth cubic interpolation
/// between elevation entries using Catmull-Rom-style tangents.
fn recompute_elevation_tangents(profile: &mut [Elevation]) {
    let n = profile.len();
    if n < 2 {
        // Single point or empty: zero slope
        for e in profile.iter_mut() {
            e.b = 0.0;
            e.c = 0.0;
            e.d = 0.0;
        }
        return;
    }

    for i in 0..n {
        let s_i = profile[i].s;
        let a_i = profile[i].a;

        // Determine next segment length and height
        let (ds_next, a_next) = if i + 1 < n {
            (profile[i + 1].s - s_i, profile[i + 1].a)
        } else {
            // Last segment: flat
            (1.0, a_i)
        };

        if ds_next.abs() < 1e-12 {
            profile[i].b = 0.0;
            profile[i].c = 0.0;
            profile[i].d = 0.0;
            continue;
        }

        // Simple linear interpolation for b, zero for c and d
        // (cubic Hermite would need tangent info from neighbors)
        let slope = (a_next - a_i) / ds_next;

        // For a cubic that starts at a_i with slope and ends at a_next:
        // We use Hermite basis: h(t) = a + b*t + c*t^2 + d*t^3
        // with h(0) = a_i, h(ds) = a_next
        // For simplicity with Catmull-Rom tangent at endpoints:
        let slope_in = if i > 0 {
            let ds_prev = s_i - profile[i - 1].s;
            if ds_prev.abs() > 1e-12 {
                (a_i - profile[i - 1].a) / ds_prev
            } else {
                slope
            }
        } else {
            slope
        };
        let tangent_start = (slope_in + slope) / 2.0;

        let slope_out = if i + 2 < n {
            let ds_nn = profile[i + 2].s - profile[i + 1].s;
            if ds_nn.abs() > 1e-12 {
                (profile[i + 2].a - a_next) / ds_nn
            } else {
                slope
            }
        } else {
            slope
        };
        let tangent_end = (slope + slope_out) / 2.0;

        // Hermite cubic coefficients:
        // h(t) = a + b*t + c*t^2 + d*t^3
        // h(0) = a => a = a_i (already set)
        // h'(0) = b => b = tangent_start
        // h(ds) = a_next => a + b*ds + c*ds^2 + d*ds^3 = a_next
        // h'(ds) = tangent_end => b + 2c*ds + 3d*ds^2 = tangent_end
        let da = a_next - a_i;
        let ds = ds_next;
        let ds2 = ds * ds;
        let ds3 = ds2 * ds;

        profile[i].b = tangent_start;
        // From the two equations:
        // c*ds^2 + d*ds^3 = da - b*ds
        // 2c*ds + 3d*ds^2 = tangent_end - b
        // Solving:
        // c = (3*(da) - ds*(2*tangent_start + tangent_end)) / ds^2
        // d = (2*(-da) + ds*(tangent_start + tangent_end)) / ds^3
        profile[i].c = (3.0 * da - ds * (2.0 * tangent_start + tangent_end)) / ds2;
        profile[i].d = (-2.0 * da + ds * (tangent_start + tangent_end)) / ds3;
    }
}

/// Compute the total elevation change along a road.
pub fn total_elevation_change(road: &Road) -> f64 {
    if road.elevation_profile.is_empty() {
        return 0.0;
    }
    let start = query_elevation_at(road, 0.0).elevation;
    let end = query_elevation_at(road, road.length).elevation;
    (end - start).abs()
}

/// Compute the maximum grade (slope) along a road by sampling.
pub fn max_grade(road: &Road, sample_interval: f64) -> f64 {
    if road.elevation_profile.is_empty() {
        return 0.0;
    }
    let interval = sample_interval.max(0.1);
    let n = ((road.length / interval).ceil() as usize).max(1);
    let mut max_g = 0.0_f64;
    for i in 0..=n {
        let s = (i as f64 * interval).min(road.length);
        let g = query_elevation_at(road, s).grade.abs();
        max_g = max_g.max(g);
    }
    max_g
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;

    fn make_road_with_elevation() -> Road {
        let mut road = Road::from_centerline(
            "r1",
            vec![Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length: 100.0,
                geo_type: GeometryType::Line,
            }],
        );
        road.elevation_profile = vec![
            Elevation { s: 0.0, a: 0.0, b: 0.05, c: 0.0, d: 0.0 },
            Elevation { s: 50.0, a: 2.5, b: 0.0, c: 0.0, d: 0.0 },
        ];
        road
    }

    #[test]
    fn test_query_elevation_at_start() {
        let road = make_road_with_elevation();
        let result = query_elevation_at(&road, 0.0);
        assert!((result.elevation - 0.0).abs() < 1e-6);
    }

    #[test]
    fn test_query_elevation_at_midpoint() {
        let road = make_road_with_elevation();
        let result = query_elevation_at(&road, 50.0);
        assert!((result.elevation - 2.5).abs() < 1e-6);
    }

    #[test]
    fn test_query_elevation_grade() {
        let road = make_road_with_elevation();
        let result = query_elevation_at(&road, 0.0);
        assert!((result.grade - 0.05).abs() < 1e-6);
        assert!((result.grade_pct - 5.0).abs() < 1e-6);
    }

    #[test]
    fn test_add_elevation_point() {
        let profile = vec![
            Elevation { s: 0.0, a: 0.0, b: 0.0, c: 0.0, d: 0.0 },
            Elevation { s: 100.0, a: 5.0, b: 0.0, c: 0.0, d: 0.0 },
        ];
        let new_profile = add_elevation_point(&profile, 50.0, 3.0);
        assert_eq!(new_profile.len(), 3);
        assert!((new_profile[1].s - 50.0).abs() < 1e-9);
        assert!((new_profile[1].a - 3.0).abs() < 1e-9);
    }

    #[test]
    fn test_add_elevation_point_replace_existing() {
        let profile = vec![
            Elevation { s: 0.0, a: 0.0, b: 0.0, c: 0.0, d: 0.0 },
            Elevation { s: 50.0, a: 2.0, b: 0.0, c: 0.0, d: 0.0 },
        ];
        let new_profile = add_elevation_point(&profile, 50.0, 5.0);
        assert_eq!(new_profile.len(), 2);
        assert!((new_profile[1].a - 5.0).abs() < 1e-9);
    }

    #[test]
    fn test_delete_elevation_point() {
        let profile = vec![
            Elevation { s: 0.0, a: 0.0, b: 0.0, c: 0.0, d: 0.0 },
            Elevation { s: 50.0, a: 3.0, b: 0.0, c: 0.0, d: 0.0 },
            Elevation { s: 100.0, a: 5.0, b: 0.0, c: 0.0, d: 0.0 },
        ];
        let result = delete_elevation_point(&profile, 50.0, 1.0);
        assert!(result.is_some());
        assert_eq!(result.unwrap().len(), 2);
    }

    #[test]
    fn test_delete_elevation_point_not_found() {
        let profile = vec![
            Elevation { s: 0.0, a: 0.0, b: 0.0, c: 0.0, d: 0.0 },
        ];
        let result = delete_elevation_point(&profile, 999.0, 1.0);
        assert!(result.is_none());
    }

    #[test]
    fn test_move_elevation_point() {
        let profile = vec![
            Elevation { s: 0.0, a: 0.0, b: 0.0, c: 0.0, d: 0.0 },
            Elevation { s: 50.0, a: 3.0, b: 0.0, c: 0.0, d: 0.0 },
            Elevation { s: 100.0, a: 5.0, b: 0.0, c: 0.0, d: 0.0 },
        ];
        let result = move_elevation_point(&profile, 50.0, 60.0, 4.0, 1.0);
        assert!(result.is_some());
        let p = result.unwrap();
        assert!((p[1].s - 60.0).abs() < 1e-9);
        assert!((p[1].a - 4.0).abs() < 1e-9);
    }

    #[test]
    fn test_smooth_elevation_profile() {
        let profile = vec![
            Elevation { s: 0.0, a: 0.0, b: 0.0, c: 0.0, d: 0.0 },
            Elevation { s: 50.0, a: 10.0, b: 0.0, c: 0.0, d: 0.0 }, // spike
            Elevation { s: 100.0, a: 0.0, b: 0.0, c: 0.0, d: 0.0 },
        ];
        let smoothed = smooth_elevation_profile(&profile, 1);
        // Middle point should be averaged: (0 + 10 + 0) / 3 ≈ 3.33
        assert!(smoothed[1].a < 10.0);
        assert!(smoothed[1].a > 0.0);
        // Endpoints should be unchanged
        assert!((smoothed[0].a - 0.0).abs() < 1e-9);
        assert!((smoothed[2].a - 0.0).abs() < 1e-9);
    }

    #[test]
    fn test_total_elevation_change() {
        let road = make_road_with_elevation();
        let change = total_elevation_change(&road);
        assert!(change > 0.0);
    }

    #[test]
    fn test_max_grade() {
        let road = make_road_with_elevation();
        let mg = max_grade(&road, 5.0);
        assert!(mg >= 0.05 - 1e-6); // At least 5% grade from the b=0.05 entry
    }

    #[test]
    fn test_query_empty_profile() {
        let road = Road::from_centerline(
            "r1",
            vec![Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length: 100.0,
                geo_type: GeometryType::Line,
            }],
        );
        let result = query_elevation_at(&road, 50.0);
        assert!((result.elevation).abs() < 1e-9);
        assert!((result.grade).abs() < 1e-9);
    }

    #[test]
    fn test_recompute_tangents_smooth() {
        let profile = vec![
            Elevation { s: 0.0, a: 0.0, b: 0.0, c: 0.0, d: 0.0 },
            Elevation { s: 50.0, a: 5.0, b: 0.0, c: 0.0, d: 0.0 },
            Elevation { s: 100.0, a: 5.0, b: 0.0, c: 0.0, d: 0.0 },
        ];
        let result = add_elevation_point(&profile, 25.0, 2.0);
        // After recompute, tangents should be non-zero for interior entries
        assert_eq!(result.len(), 4);
        // First entry should have a slope towards 2.0 at s=25
        assert!(result[0].b.abs() > 1e-12 || result[0].c.abs() > 1e-12);
    }
}
