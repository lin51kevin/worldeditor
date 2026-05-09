//! Measurement tools for the road network editor.
//!
//! Provides distance, angle, and area measurement utilities
//! for interactive use. Pure Rust, WASM compatible.

use crate::geometry::eval::sample_road_reference_line;
use crate::model::Road;
use serde::{Deserialize, Serialize};

/// A measured distance result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistanceMeasurement {
    /// Straight-line (Euclidean) distance.
    pub straight: f64,
    /// Horizontal distance (XY plane).
    pub horizontal: f64,
    /// Vertical distance (Z axis).
    pub vertical: f64,
}

/// An angle measurement result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AngleMeasurement {
    /// Angle in radians.
    pub radians: f64,
    /// Angle in degrees.
    pub degrees: f64,
}

/// An area measurement result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AreaMeasurement {
    /// Area in square meters.
    pub area: f64,
    /// Perimeter in meters.
    pub perimeter: f64,
}

/// Measure the straight-line distance between two 3D points.
pub fn measure_distance(x1: f64, y1: f64, z1: f64, x2: f64, y2: f64, z2: f64) -> DistanceMeasurement {
    let dx = x2 - x1;
    let dy = y2 - y1;
    let dz = z2 - z1;
    DistanceMeasurement {
        straight: (dx * dx + dy * dy + dz * dz).sqrt(),
        horizontal: (dx * dx + dy * dy).sqrt(),
        vertical: dz.abs(),
    }
}

/// Measure the angle formed by three points (vertex at p2).
///
/// Returns the angle at p2 in the triangle p1-p2-p3.
pub fn measure_angle(
    x1: f64, y1: f64,
    x2: f64, y2: f64,
    x3: f64, y3: f64,
) -> AngleMeasurement {
    let v1x = x1 - x2;
    let v1y = y1 - y2;
    let v2x = x3 - x2;
    let v2y = y3 - y2;
    let dot = v1x * v2x + v1y * v2y;
    let mag1 = (v1x * v1x + v1y * v1y).sqrt();
    let mag2 = (v2x * v2x + v2y * v2y).sqrt();
    let denom = mag1 * mag2;
    let radians = if denom < 1e-12 {
        0.0
    } else {
        (dot / denom).clamp(-1.0, 1.0).acos()
    };
    AngleMeasurement {
        radians,
        degrees: radians.to_degrees(),
    }
}

/// Measure the area and perimeter of a polygon defined by 2D points.
pub fn measure_polygon_area(points: &[[f64; 2]]) -> AreaMeasurement {
    let n = points.len();
    if n < 3 {
        return AreaMeasurement {
            area: 0.0,
            perimeter: 0.0,
        };
    }
    // Shoelace formula for area
    let mut area = 0.0;
    for i in 0..n {
        let j = (i + 1) % n;
        area += points[i][0] * points[j][1];
        area -= points[j][0] * points[i][1];
    }
    let area = area.abs() / 2.0;

    // Perimeter
    let mut perimeter = 0.0;
    for i in 0..n {
        let j = (i + 1) % n;
        let dx = points[j][0] - points[i][0];
        let dy = points[j][1] - points[i][1];
        perimeter += (dx * dx + dy * dy).sqrt();
    }

    AreaMeasurement { area, perimeter }
}

/// Measure the arc length of a road between two stations.
pub fn measure_road_length(road: &Road, s_start: f64, s_end: f64) -> f64 {
    let start = s_start.max(0.0).min(road.length);
    let end = s_end.max(0.0).min(road.length);
    if end <= start {
        return 0.0;
    }
    // For OpenDRIVE roads, the s coordinate IS the arc length
    // So the distance is simply end - start
    end - start
}

/// Measure the road length considering elevation (3D arc length approximation).
pub fn measure_road_length_3d(road: &Road, s_start: f64, s_end: f64, step: f64) -> f64 {
    let start = s_start.max(0.0).min(road.length);
    let end = s_end.max(0.0).min(road.length);
    if end <= start {
        return 0.0;
    }

    let pts = sample_road_reference_line(road, step.max(0.5));
    let relevant: Vec<_> = pts
        .iter()
        .filter(|p| p.s >= start - 1e-9 && p.s <= end + 1e-9)
        .collect();

    if relevant.len() < 2 {
        return end - start; // fallback to 2D
    }

    let mut total = 0.0;
    for i in 1..relevant.len() {
        let dx = relevant[i].x - relevant[i - 1].x;
        let dy = relevant[i].y - relevant[i - 1].y;
        // Evaluate elevation at both points
        let z1 = crate::geometry::eval::evaluate_elevation(&road.elevation_profile, relevant[i - 1].s);
        let z2 = crate::geometry::eval::evaluate_elevation(&road.elevation_profile, relevant[i].s);
        let dz = z2 - z1;
        total += (dx * dx + dy * dy + dz * dz).sqrt();
    }

    total
}

/// Compute the heading/bearing from point 1 to point 2.
pub fn compute_bearing(x1: f64, y1: f64, x2: f64, y2: f64) -> AngleMeasurement {
    let dx = x2 - x1;
    let dy = y2 - y1;
    let radians = dy.atan2(dx);
    AngleMeasurement {
        radians,
        degrees: radians.to_degrees(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;

    #[test]
    fn test_measure_distance_2d() {
        let d = measure_distance(0.0, 0.0, 0.0, 3.0, 4.0, 0.0);
        assert!((d.straight - 5.0).abs() < 1e-9);
        assert!((d.horizontal - 5.0).abs() < 1e-9);
        assert!(d.vertical < 1e-9);
    }

    #[test]
    fn test_measure_distance_3d() {
        let d = measure_distance(0.0, 0.0, 0.0, 1.0, 2.0, 2.0);
        let expected = (1.0 + 4.0 + 4.0_f64).sqrt(); // 3.0
        assert!((d.straight - expected).abs() < 1e-9);
        assert!((d.horizontal - (1.0 + 4.0_f64).sqrt()).abs() < 1e-9);
        assert!((d.vertical - 2.0).abs() < 1e-9);
    }

    #[test]
    fn test_measure_angle_right() {
        // 90° angle at origin between (1,0) and (0,1)
        let a = measure_angle(1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
        assert!((a.degrees - 90.0).abs() < 1e-6);
    }

    #[test]
    fn test_measure_angle_straight() {
        // 180° angle
        let a = measure_angle(-1.0, 0.0, 0.0, 0.0, 1.0, 0.0);
        assert!((a.degrees - 180.0).abs() < 1e-6);
    }

    #[test]
    fn test_measure_angle_zero() {
        // 0° — same direction
        let a = measure_angle(1.0, 0.0, 0.0, 0.0, 2.0, 0.0);
        assert!(a.degrees < 1e-6);
    }

    #[test]
    fn test_measure_polygon_area_square() {
        let pts = vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]];
        let m = measure_polygon_area(&pts);
        assert!((m.area - 100.0).abs() < 1e-6);
        assert!((m.perimeter - 40.0).abs() < 1e-6);
    }

    #[test]
    fn test_measure_polygon_area_triangle() {
        let pts = vec![[0.0, 0.0], [10.0, 0.0], [5.0, 10.0]];
        let m = measure_polygon_area(&pts);
        assert!((m.area - 50.0).abs() < 1e-6);
    }

    #[test]
    fn test_measure_polygon_insufficient() {
        let pts = vec![[0.0, 0.0], [1.0, 1.0]];
        let m = measure_polygon_area(&pts);
        assert!((m.area).abs() < 1e-9);
    }

    #[test]
    fn test_measure_road_length() {
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
        let l = measure_road_length(&road, 10.0, 60.0);
        assert!((l - 50.0).abs() < 1e-9);
    }

    #[test]
    fn test_measure_road_length_3d() {
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
        // Flat road: 3D length ≈ 2D length
        road.elevation_profile = vec![Elevation {
            s: 0.0,
            a: 0.0,
            b: 0.0,
            c: 0.0,
            d: 0.0,
        }];
        let l = measure_road_length_3d(&road, 0.0, 100.0, 2.0);
        assert!((l - 100.0).abs() < 1.0); // close to 100m
    }

    #[test]
    fn test_compute_bearing() {
        let b = compute_bearing(0.0, 0.0, 1.0, 0.0);
        assert!(b.degrees.abs() < 1e-6); // East = 0°

        let b = compute_bearing(0.0, 0.0, 0.0, 1.0);
        assert!((b.degrees - 90.0).abs() < 1e-6); // North = 90°
    }
}
