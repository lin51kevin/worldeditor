//! Douglas-Peucker polyline simplification algorithm.
//!
//! Reduces the number of points in a polyline while preserving shape.
//! O(n log n) average, O(n²) worst case. Pure Rust, WASM compatible.

use nalgebra::Vector2;

/// Compute the perpendicular distance from point `p` to the line segment `(a, b)`.
fn point_to_segment_distance(p: &Vector2<f64>, a: &Vector2<f64>, b: &Vector2<f64>) -> f64 {
    let ab = b - a;
    let len_sq = ab.dot(&ab);
    if len_sq < f64::EPSILON {
        // Degenerate segment (a == b)
        return (p - a).norm();
    }
    // Project p onto the line, clamped to [0, 1]
    let t = ((p - a).dot(&ab) / len_sq).clamp(0.0, 1.0);
    let proj = a + ab * t;
    (p - proj).norm()
}

/// Simplify a polyline using the Douglas-Peucker algorithm.
///
/// Points further than `epsilon` from the simplified line are retained.
/// Returns indices of the retained points from the original slice.
fn simplify_recursive(
    points: &[Vector2<f64>],
    start: usize,
    end: usize,
    epsilon: f64,
    keep: &mut Vec<bool>,
) {
    if end <= start + 1 {
        return;
    }

    let mut max_dist = 0.0;
    let mut max_idx = start;

    for i in (start + 1)..end {
        let d = point_to_segment_distance(&points[i], &points[start], &points[end]);
        if d > max_dist {
            max_dist = d;
            max_idx = i;
        }
    }

    if max_dist > epsilon {
        keep[max_idx] = true;
        simplify_recursive(points, start, max_idx, epsilon, keep);
        simplify_recursive(points, max_idx, end, epsilon, keep);
    }
}

/// Simplify a polyline using the Douglas-Peucker algorithm.
///
/// Points within `epsilon` distance of the simplified line are removed.
/// Always keeps the first and last points.
///
/// # Arguments
///
/// * `points` - Input polyline points
/// * `epsilon` - Maximum allowed deviation from the simplified line
///
/// # Returns
///
/// A new vector containing the simplified polyline points.
///
/// # Examples
///
/// ```
/// use nalgebra::Vector2;
/// use we_core::geometry::simplify::simplify_polyline;
///
/// let points = vec![
///     Vector2::new(0.0, 0.0),
///     Vector2::new(1.0, 0.1), // near-collinear, will be removed
///     Vector2::new(2.0, 0.0),
/// ];
/// let simplified = simplify_polyline(&points, 0.5);
/// assert_eq!(simplified.len(), 2); // only endpoints
/// ```
pub fn simplify_polyline(points: &[Vector2<f64>], epsilon: f64) -> Vec<Vector2<f64>> {
    let n = points.len();
    if n <= 2 {
        return points.to_vec();
    }

    let mut keep = vec![false; n];
    keep[0] = true;
    keep[n - 1] = true;

    simplify_recursive(points, 0, n - 1, epsilon, &mut keep);

    points
        .iter()
        .zip(keep.iter())
        .filter_map(|(p, &k)| if k { Some(*p) } else { None })
        .collect()
}

/// Simplify a 3D polyline using Douglas-Peucker (projects to 2D XY plane).
///
/// Same as `simplify_polyline` but operates on `[f64; 3]` slices by
/// projecting to XY for distance computation.
pub fn simplify_polyline_3d(points: &[[f64; 3]], epsilon: f64) -> Vec<[f64; 3]> {
    let pts_2d: Vec<Vector2<f64>> = points.iter().map(|p| Vector2::new(p[0], p[1])).collect();
    let indices = simplify_polyline_indices(&pts_2d, epsilon);
    indices.into_iter().map(|i| points[i]).collect()
}

/// Returns the indices of points to keep after simplification.
pub fn simplify_polyline_indices(points: &[Vector2<f64>], epsilon: f64) -> Vec<usize> {
    let n = points.len();
    if n <= 2 {
        return (0..n).collect();
    }

    let mut keep = vec![false; n];
    keep[0] = true;
    keep[n - 1] = true;

    simplify_recursive(points, 0, n - 1, epsilon, &mut keep);

    keep.iter()
        .enumerate()
        .filter_map(|(i, &k)| if k { Some(i) } else { None })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simplify_straight_line_removes_midpoints() {
        // All points collinear → only endpoints kept
        let points: Vec<Vector2<f64>> = (0..=10)
            .map(|i| Vector2::new(i as f64, 0.0))
            .collect();
        let simplified = simplify_polyline(&points, 0.01);
        assert_eq!(simplified.len(), 2);
        assert!((simplified[0].x - 0.0).abs() < f64::EPSILON);
        assert!((simplified[1].x - 10.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_simplify_preserves_significant_points() {
        // Zigzag line — all points are significant
        let points = vec![
            Vector2::new(0.0, 0.0),
            Vector2::new(1.0, 1.0),
            Vector2::new(2.0, 0.0),
            Vector2::new(3.0, 1.0),
            Vector2::new(4.0, 0.0),
        ];
        let simplified = simplify_polyline(&points, 0.1);
        assert_eq!(simplified.len(), 5, "Zigzag should keep all points");
    }

    #[test]
    fn test_simplify_near_collinear_removes_points() {
        // Slightly off-center midpoint → removed when epsilon is large enough
        let points = vec![
            Vector2::new(0.0, 0.0),
            Vector2::new(1.0, 0.05), // 0.05 deviation
            Vector2::new(2.0, 0.0),
        ];
        let simplified = simplify_polyline(&points, 0.1);
        assert_eq!(simplified.len(), 2);
    }

    #[test]
    fn test_simplify_near_collinear_keeps_points_below_epsilon() {
        // Same as above but epsilon smaller than deviation
        let points = vec![
            Vector2::new(0.0, 0.0),
            Vector2::new(1.0, 0.5), // 0.5 deviation
            Vector2::new(2.0, 0.0),
        ];
        let simplified = simplify_polyline(&points, 0.1);
        assert_eq!(simplified.len(), 3, "Large deviation should keep midpoint");
    }

    #[test]
    fn test_simplify_single_point() {
        let points = vec![Vector2::new(1.0, 2.0)];
        let simplified = simplify_polyline(&points, 1.0);
        assert_eq!(simplified.len(), 1);
    }

    #[test]
    fn test_simplify_two_points() {
        let points = vec![Vector2::new(0.0, 0.0), Vector2::new(1.0, 1.0)];
        let simplified = simplify_polyline(&points, 0.5);
        assert_eq!(simplified.len(), 2);
    }

    #[test]
    fn test_simplify_empty() {
        let simplified = simplify_polyline(&[], 1.0);
        assert!(simplified.is_empty());
    }

    #[test]
    fn test_simplify_preserves_endpoints() {
        let points: Vec<Vector2<f64>> = (0..=20)
            .map(|i| Vector2::new(i as f64, (i as f64 * 0.3).sin() * 0.01))
            .collect();
        let simplified = simplify_polyline(&points, 0.5);
        assert_eq!(simplified.first(), points.first());
        assert_eq!(simplified.last(), points.last());
    }

    #[test]
    fn test_point_to_segment_distance_perpendicular() {
        let a = Vector2::new(0.0, 0.0);
        let b = Vector2::new(2.0, 0.0);
        let p = Vector2::new(1.0, 1.0);
        let d = point_to_segment_distance(&p, &a, &b);
        assert!((d - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_point_to_segment_distance_at_endpoint() {
        let a = Vector2::new(0.0, 0.0);
        let b = Vector2::new(1.0, 0.0);
        let p = Vector2::new(2.0, 0.0);
        let d = point_to_segment_distance(&p, &a, &b);
        assert!((d - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_simplify_indices() {
        let points: Vec<Vector2<f64>> = (0..=10)
            .map(|i| Vector2::new(i as f64, 0.0))
            .collect();
        let indices = simplify_polyline_indices(&points, 0.01);
        assert_eq!(indices, vec![0, 10]);
    }
}
