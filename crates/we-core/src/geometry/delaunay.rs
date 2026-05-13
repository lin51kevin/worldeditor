//! Delaunay triangulation using the Bowyer-Watson algorithm.
//!
//! Produces a triangulation where no point lies inside the circumcircle of
//! any triangle. Pure Rust, WASM compatible.

use nalgebra::Vector2;

/// A triangle defined by three point indices.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Triangle {
    pub a: usize,
    pub b: usize,
    pub c: usize,
}

impl Triangle {
    /// Create a new triangle from three vertex indices.
    pub fn new(a: usize, b: usize, c: usize) -> Self {
        Self { a, b, c }
    }

    /// Returns the edges of this triangle as `(index, index)` pairs.
    pub fn edges(&self) -> [(usize, usize); 3] {
        [(self.a, self.b), (self.b, self.c), (self.c, self.a)]
    }
}

/// Circumcircle: returns `(center, radius_squared)` of the circumscribed circle of a triangle.
///
/// Returns `None` if the three points are collinear.
fn circumcircle(
    a: &Vector2<f64>,
    b: &Vector2<f64>,
    c: &Vector2<f64>,
) -> Option<(Vector2<f64>, f64)> {
    let ax = b.x - a.x;
    let ay = b.y - a.y;
    let bx = c.x - a.x;
    let by = c.y - a.y;

    let d = 2.0 * (ax * by - ay * bx);
    if d.abs() < f64::EPSILON {
        return None; // Collinear
    }

    let ux = (by * (ax * ax + ay * ay) - ay * (bx * bx + by * by)) / d;
    let uy = (ax * (bx * bx + by * by) - bx * (ax * ax + ay * ay)) / d;

    let center = Vector2::new(a.x + ux, a.y + uy);
    let r2 = ux * ux + uy * uy;
    Some((center, r2))
}

/// Returns `true` if `point` lies strictly inside the circumcircle of triangle `(a, b, c)`.
fn in_circumcircle(
    point: &Vector2<f64>,
    a: &Vector2<f64>,
    b: &Vector2<f64>,
    c: &Vector2<f64>,
) -> bool {
    let Some((center, r2)) = circumcircle(a, b, c) else {
        return false;
    };
    let dx = point.x - center.x;
    let dy = point.y - center.y;
    dx * dx + dy * dy < r2 - f64::EPSILON
}

/// Compute the Delaunay triangulation of a set of 2D points using Bowyer-Watson.
///
/// Returns a list of triangles as index triples into the input `points` slice.
/// Points that are duplicate or collinear in degenerate cases are handled gracefully.
///
/// # Arguments
///
/// * `points` - Input points to triangulate
///
/// # Returns
///
/// A vector of [`Triangle`] objects referencing indices into `points`.
///
/// # Examples
///
/// ```
/// use nalgebra::Vector2;
/// use we_core::geometry::delaunay::triangulate;
///
/// let points = vec![
///     Vector2::new(0.0, 0.0),
///     Vector2::new(1.0, 0.0),
///     Vector2::new(0.0, 1.0),
///     Vector2::new(1.0, 1.0),
/// ];
/// let tris = triangulate(&points);
/// assert_eq!(tris.len(), 2); // 4 points → 2 triangles
/// ```
pub fn triangulate(points: &[Vector2<f64>]) -> Vec<Triangle> {
    let n = points.len();
    if n < 3 {
        return Vec::new();
    }

    // Build working set: original points + super-triangle vertices
    let mut pts: Vec<Vector2<f64>> = points.to_vec();

    // Find bounding box
    let (mut min_x, mut min_y) = (f64::INFINITY, f64::INFINITY);
    let (mut max_x, mut max_y) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
    for p in points {
        min_x = min_x.min(p.x);
        min_y = min_y.min(p.y);
        max_x = max_x.max(p.x);
        max_y = max_y.max(p.y);
    }

    let dx = max_x - min_x;
    let dy = max_y - min_y;
    let delta = dx.max(dy).max(f64::EPSILON);
    let mid_x = (min_x + max_x) / 2.0;
    let mid_y = (min_y + max_y) / 2.0;

    // Super-triangle vertices (indices n, n+1, n+2)
    let st0 = Vector2::new(mid_x - 20.0 * delta, mid_y - delta);
    let st1 = Vector2::new(mid_x, mid_y + 20.0 * delta);
    let st2 = Vector2::new(mid_x + 20.0 * delta, mid_y - delta);
    pts.push(st0);
    pts.push(st1);
    pts.push(st2);

    let mut triangles: Vec<Triangle> = vec![Triangle::new(n, n + 1, n + 2)];

    for (pi, point) in points.iter().enumerate() {
        let mut bad_triangles: Vec<Triangle> = Vec::new();

        // Find all triangles whose circumcircle contains the current point
        for &tri in &triangles {
            if in_circumcircle(point, &pts[tri.a], &pts[tri.b], &pts[tri.c]) {
                bad_triangles.push(tri);
            }
        }

        // Find the boundary polygon (edges not shared by bad triangles)
        let mut boundary: Vec<(usize, usize)> = Vec::new();
        for &tri in &bad_triangles {
            for (ea, eb) in tri.edges() {
                let shared = bad_triangles.iter().any(|&other| {
                    other != tri
                        && ((other.a == ea && other.b == eb)
                            || (other.b == ea && other.c == eb)
                            || (other.c == ea && other.a == eb)
                            || (other.a == eb && other.b == ea)
                            || (other.b == eb && other.c == ea)
                            || (other.c == eb && other.a == ea))
                });
                if !shared {
                    boundary.push((ea, eb));
                }
            }
        }

        // Remove bad triangles
        triangles.retain(|t| !bad_triangles.contains(t));

        // Create new triangles from boundary edges to current point
        for (ea, eb) in boundary {
            triangles.push(Triangle::new(ea, eb, pi));
        }
    }

    // Remove triangles that share vertices with the super-triangle
    triangles.retain(|t| t.a < n && t.b < n && t.c < n);

    triangles
}

/// Compute the total area of a triangulation.
pub fn triangulation_area(points: &[Vector2<f64>], triangles: &[Triangle]) -> f64 {
    triangles.iter().fold(0.0, |acc, tri| {
        let a = &points[tri.a];
        let b = &points[tri.b];
        let c = &points[tri.c];
        let area = ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)).abs() / 2.0;
        acc + area
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_triangulate_three_points() {
        let points = vec![
            Vector2::new(0.0, 0.0),
            Vector2::new(1.0, 0.0),
            Vector2::new(0.0, 1.0),
        ];
        let tris = triangulate(&points);
        assert_eq!(tris.len(), 1);
    }

    #[test]
    fn test_triangulate_four_points_square() {
        let points = vec![
            Vector2::new(0.0, 0.0),
            Vector2::new(1.0, 0.0),
            Vector2::new(1.0, 1.0),
            Vector2::new(0.0, 1.0),
        ];
        let tris = triangulate(&points);
        assert_eq!(tris.len(), 2, "Square should triangulate into 2 triangles");
    }

    #[test]
    fn test_triangulate_correct_area_square() {
        let points = vec![
            Vector2::new(0.0, 0.0),
            Vector2::new(1.0, 0.0),
            Vector2::new(1.0, 1.0),
            Vector2::new(0.0, 1.0),
        ];
        let tris = triangulate(&points);
        let area = triangulation_area(&points, &tris);
        assert!((area - 1.0).abs() < 1e-10, "Area should be 1.0, got {area}");
    }

    #[test]
    fn test_triangulate_indices_in_bounds() {
        let points = vec![
            Vector2::new(0.0, 0.0),
            Vector2::new(2.0, 0.0),
            Vector2::new(1.0, 2.0),
            Vector2::new(1.0, 0.5),
        ];
        let tris = triangulate(&points);
        let n = points.len();
        for t in &tris {
            assert!(t.a < n, "Triangle index out of bounds");
            assert!(t.b < n, "Triangle index out of bounds");
            assert!(t.c < n, "Triangle index out of bounds");
        }
    }

    #[test]
    fn test_triangulate_fewer_than_three_points() {
        assert!(triangulate(&[]).is_empty());
        assert!(triangulate(&[Vector2::new(0.0, 0.0)]).is_empty());
        assert!(triangulate(&[Vector2::new(0.0, 0.0), Vector2::new(1.0, 0.0)]).is_empty());
    }

    #[test]
    fn test_triangle_edges() {
        let t = Triangle::new(0, 1, 2);
        let edges = t.edges();
        assert_eq!(edges[0], (0, 1));
        assert_eq!(edges[1], (1, 2));
        assert_eq!(edges[2], (2, 0));
    }

    #[test]
    fn test_circumcircle_equilateral_triangle() {
        // Equilateral triangle centered at origin
        let a = Vector2::new(0.0, 1.0);
        let b = Vector2::new(-0.866, -0.5);
        let c = Vector2::new(0.866, -0.5);
        let (center, r2) = circumcircle(&a, &b, &c).unwrap();
        assert!(center.norm() < 0.01, "Circumcenter should be near origin");
        assert!((r2 - 1.0).abs() < 0.01, "Circumradius should be ~1");
    }

    #[test]
    fn test_circumcircle_collinear_returns_none() {
        let a = Vector2::new(0.0, 0.0);
        let b = Vector2::new(1.0, 0.0);
        let c = Vector2::new(2.0, 0.0);
        assert!(circumcircle(&a, &b, &c).is_none());
    }

    #[test]
    fn test_triangulate_many_points_count() {
        // For n points in general position, Delaunay gives 2n - h - 2 triangles
        // where h is the hull count. We just verify a reasonable count.
        let points: Vec<Vector2<f64>> = (0..5)
            .flat_map(|i| (0..5).map(move |j| Vector2::new(i as f64, j as f64)))
            .collect();
        let tris = triangulate(&points);
        assert!(!tris.is_empty());
        // Each triangle should reference only valid indices
        for t in &tris {
            assert!(t.a < 25 && t.b < 25 && t.c < 25);
        }
    }

    #[test]
    fn test_triangulation_area_triangle() {
        let points = vec![
            Vector2::new(0.0, 0.0),
            Vector2::new(4.0, 0.0),
            Vector2::new(0.0, 3.0),
        ];
        let tris = triangulate(&points);
        let area = triangulation_area(&points, &tris);
        assert!((area - 6.0).abs() < 1e-10, "Area should be 6.0");
    }
}
