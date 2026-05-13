//! Convex hull computation using Andrew's monotone chain algorithm.
//!
//! O(n log n) time, pure Rust, WASM compatible.

use nalgebra::Vector2;

/// Cross product of vectors OA and OB.
fn cross(o: &Vector2<f64>, a: &Vector2<f64>, b: &Vector2<f64>) -> f64 {
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/// Compute the convex hull of a set of 2D points using Andrew's monotone chain.
///
/// Returns points in counter-clockwise order. Returns an empty vector if
/// fewer than 3 non-collinear points are provided.
///
/// # Examples
///
/// ```
/// use nalgebra::Vector2;
/// use we_core::geometry::convex_hull::convex_hull;
///
/// let points = vec![
///     Vector2::new(0.0, 0.0),
///     Vector2::new(1.0, 0.0),
///     Vector2::new(1.0, 1.0),
///     Vector2::new(0.0, 1.0),
///     Vector2::new(0.5, 0.5), // interior point
/// ];
/// let hull = convex_hull(&points);
/// assert_eq!(hull.len(), 4);
/// ```
pub fn convex_hull(points: &[Vector2<f64>]) -> Vec<Vector2<f64>> {
    let n = points.len();
    if n < 2 {
        return points.to_vec();
    }

    let mut sorted = points.to_vec();
    sorted.sort_by(|a, b| {
        a.x.partial_cmp(&b.x)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.y.partial_cmp(&b.y).unwrap_or(std::cmp::Ordering::Equal))
    });

    let mut hull: Vec<Vector2<f64>> = Vec::with_capacity(2 * n);

    // Lower hull
    for pt in &sorted {
        while hull.len() >= 2 && cross(&hull[hull.len() - 2], &hull[hull.len() - 1], pt) <= 0.0 {
            hull.pop();
        }
        hull.push(*pt);
    }

    // Upper hull
    let lower_len = hull.len() + 1;
    for pt in sorted.iter().rev() {
        while hull.len() >= lower_len
            && cross(&hull[hull.len() - 2], &hull[hull.len() - 1], pt) <= 0.0
        {
            hull.pop();
        }
        hull.push(*pt);
    }

    // Remove last point (it's the same as first)
    hull.pop();
    hull
}

/// Compute the bounding box of a set of points.
///
/// Returns `(min, max)` corners, or `None` if `points` is empty.
pub fn bounding_box(points: &[Vector2<f64>]) -> Option<(Vector2<f64>, Vector2<f64>)> {
    if points.is_empty() {
        return None;
    }
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for p in points {
        min_x = min_x.min(p.x);
        min_y = min_y.min(p.y);
        max_x = max_x.max(p.x);
        max_y = max_y.max(p.y);
    }
    Some((Vector2::new(min_x, min_y), Vector2::new(max_x, max_y)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convex_hull_square_with_interior_point() {
        let points = vec![
            Vector2::new(0.0, 0.0),
            Vector2::new(1.0, 0.0),
            Vector2::new(1.0, 1.0),
            Vector2::new(0.0, 1.0),
            Vector2::new(0.5, 0.5), // interior
        ];
        let hull = convex_hull(&points);
        assert_eq!(hull.len(), 4, "Square hull should have 4 vertices");
    }

    #[test]
    fn test_convex_hull_triangle() {
        let points = vec![
            Vector2::new(0.0, 0.0),
            Vector2::new(4.0, 0.0),
            Vector2::new(2.0, 3.0),
        ];
        let hull = convex_hull(&points);
        assert_eq!(hull.len(), 3);
    }

    #[test]
    fn test_convex_hull_collinear_points() {
        // All points collinear — hull should have 2 points (endpoints)
        let points = vec![
            Vector2::new(0.0, 0.0),
            Vector2::new(1.0, 0.0),
            Vector2::new(2.0, 0.0),
            Vector2::new(3.0, 0.0),
        ];
        let hull = convex_hull(&points);
        assert!(
            hull.len() <= 2,
            "Collinear hull should have at most 2 vertices"
        );
    }

    #[test]
    fn test_convex_hull_single_point() {
        let points = vec![Vector2::new(1.0, 2.0)];
        let hull = convex_hull(&points);
        assert_eq!(hull.len(), 1);
    }

    #[test]
    fn test_convex_hull_two_points() {
        let points = vec![Vector2::new(0.0, 0.0), Vector2::new(1.0, 1.0)];
        let hull = convex_hull(&points);
        assert_eq!(hull.len(), 2);
    }

    #[test]
    fn test_convex_hull_empty() {
        let hull = convex_hull(&[]);
        assert!(hull.is_empty());
    }

    #[test]
    fn test_convex_hull_interior_points_excluded() {
        let mut points: Vec<Vector2<f64>> = vec![
            Vector2::new(0.0, 0.0),
            Vector2::new(10.0, 0.0),
            Vector2::new(10.0, 10.0),
            Vector2::new(0.0, 10.0),
        ];
        // Add many interior points
        for i in 1..10 {
            for j in 1..10 {
                points.push(Vector2::new(i as f64, j as f64));
            }
        }
        let hull = convex_hull(&points);
        assert_eq!(hull.len(), 4, "Only the 4 corners should be in hull");
    }

    #[test]
    fn test_bounding_box_basic() {
        let points = vec![
            Vector2::new(1.0, 2.0),
            Vector2::new(3.0, -1.0),
            Vector2::new(-2.0, 4.0),
        ];
        let (min, max) = bounding_box(&points).unwrap();
        assert!((min.x - (-2.0)).abs() < f64::EPSILON);
        assert!((min.y - (-1.0)).abs() < f64::EPSILON);
        assert!((max.x - 3.0).abs() < f64::EPSILON);
        assert!((max.y - 4.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_bounding_box_empty() {
        assert!(bounding_box(&[]).is_none());
    }
}
