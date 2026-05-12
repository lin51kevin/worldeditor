//! Computational geometry algorithms.
//!
//! Pure Rust, WASM compatible.

pub mod convex_hull;
pub mod delaunay;
pub mod eval;
pub mod simplify;

use nalgebra::Vector2;

pub use convex_hull::{bounding_box, convex_hull};
pub use delaunay::{Triangle, triangulate};
pub use eval::{
    RefLinePoint, evaluate_elevation, evaluate_geometry, evaluate_lane_width, offset_point,
    sample_road_reference_line,
};
pub use simplify::{simplify_polyline, simplify_polyline_3d, simplify_polyline_indices};

/// Check if a point is inside a polygon (2D, ray casting).
pub fn point_in_polygon(point: &Vector2<f64>, polygon: &[Vector2<f64>]) -> bool {
    let n = polygon.len();
    if n < 3 {
        return false;
    }

    let mut inside = false;
    let mut j = n - 1;

    for i in 0..n {
        let pi = &polygon[i];
        let pj = &polygon[j];

        if ((pi.y > point.y) != (pj.y > point.y))
            && (point.x < (pj.x - pi.x) * (point.y - pi.y) / (pj.y - pi.y) + pi.x)
        {
            inside = !inside;
        }
        j = i;
    }

    inside
}

/// Compute the signed area of a 2D polygon (positive = CCW).
pub fn polygon_signed_area(polygon: &[Vector2<f64>]) -> f64 {
    let n = polygon.len();
    if n < 3 {
        return 0.0;
    }

    let mut area = 0.0;
    for i in 0..n {
        let j = (i + 1) % n;
        area += polygon[i].x * polygon[j].y - polygon[j].x * polygon[i].y;
    }
    area / 2.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_point_in_triangle() {
        let triangle = vec![
            Vector2::new(0.0, 0.0),
            Vector2::new(4.0, 0.0),
            Vector2::new(2.0, 3.0),
        ];
        assert!(point_in_polygon(&Vector2::new(2.0, 1.0), &triangle));
        assert!(!point_in_polygon(&Vector2::new(5.0, 5.0), &triangle));
    }

    #[test]
    fn test_point_in_square() {
        let square = vec![
            Vector2::new(0.0, 0.0),
            Vector2::new(1.0, 0.0),
            Vector2::new(1.0, 1.0),
            Vector2::new(0.0, 1.0),
        ];
        assert!(point_in_polygon(&Vector2::new(0.5, 0.5), &square));
        assert!(!point_in_polygon(&Vector2::new(1.5, 0.5), &square));
    }

    #[test]
    fn test_degenerate_polygon() {
        let line = vec![Vector2::new(0.0, 0.0), Vector2::new(1.0, 1.0)];
        assert!(!point_in_polygon(&Vector2::new(0.5, 0.5), &line));
    }

    #[test]
    fn test_polygon_area_ccw() {
        let square = vec![
            Vector2::new(0.0, 0.0),
            Vector2::new(1.0, 0.0),
            Vector2::new(1.0, 1.0),
            Vector2::new(0.0, 1.0),
        ];
        let area = polygon_signed_area(&square);
        assert!((area.abs() - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_polygon_signed_area_cw() {
        let square = vec![
            Vector2::new(0.0, 0.0),
            Vector2::new(0.0, 1.0),
            Vector2::new(1.0, 1.0),
            Vector2::new(1.0, 0.0),
        ];
        let area = polygon_signed_area(&square);
        assert!(area < 0.0);
        assert!((area.abs() - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_polygon_signed_area_degenerate() {
        let polygon = vec![Vector2::new(0.0, 0.0), Vector2::new(2.0, 0.0)];
        assert!((polygon_signed_area(&polygon) - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_polygon_signed_area_triangle() {
        let triangle = vec![
            Vector2::new(0.0, 0.0),
            Vector2::new(4.0, 0.0),
            Vector2::new(0.0, 3.0),
        ];
        let area = polygon_signed_area(&triangle);
        assert!((area - 6.0).abs() < 1e-10);
    }

    #[test]
    fn test_point_on_edge() {
        let square = vec![
            Vector2::new(0.0, 0.0),
            Vector2::new(1.0, 0.0),
            Vector2::new(1.0, 1.0),
            Vector2::new(0.0, 1.0),
        ];
        assert!(point_in_polygon(&Vector2::new(0.5, 0.0), &square));
    }

    #[test]
    fn test_point_in_large_polygon() {
        let hexagon = vec![
            Vector2::new(0.0, 1.0),
            Vector2::new(1.0, 0.0),
            Vector2::new(3.0, 0.0),
            Vector2::new(4.0, 1.0),
            Vector2::new(3.0, 3.0),
            Vector2::new(1.0, 3.0),
        ];
        assert!(point_in_polygon(&Vector2::new(2.0, 1.5), &hexagon));
        assert!(!point_in_polygon(&Vector2::new(4.5, 1.5), &hexagon));
    }
}
