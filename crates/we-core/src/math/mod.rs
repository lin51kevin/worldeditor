//! Math utilities re-exported from nalgebra.
//!
//! Provides convenient type aliases for the project.

pub use nalgebra::{Matrix4, Vector2, Vector3, Vector4};

/// Type alias for a 3D point.
pub type Point3 = nalgebra::Point3<f64>;
/// Type alias for a 2D point.
pub type Point2 = nalgebra::Point2<f64>;

/// Linearly interpolate between two values.
pub fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// Clamp a value to a range.
pub fn clamp(value: f64, min: f64, max: f64) -> f64 {
    if value < min {
        min
    } else if value > max {
        max
    } else {
        value
    }
}

/// A ray in 3D space defined by an origin and direction.
#[derive(Debug, Clone, Copy)]
pub struct Ray {
    pub origin: Vector3<f64>,
    pub direction: Vector3<f64>,
}

impl Ray {
    /// Create a new ray with normalized direction.
    pub fn new(origin: Vector3<f64>, direction: Vector3<f64>) -> Self {
        Self {
            origin,
            direction: direction.normalize(),
        }
    }

    /// Evaluate the ray at parameter t: origin + t * direction.
    pub fn at(&self, t: f64) -> Vector3<f64> {
        self.origin + self.direction * t
    }
}

/// Unproject a screen-space point to a world-space ray.
///
/// - `screen_x`, `screen_y`: pixel coordinates (0..width, 0..height)
/// - `viewport_width`, `viewport_height`: viewport dimensions in pixels
/// - `inv_view_proj`: inverse of (projection * view) matrix
///
/// Returns a `Ray` from the camera through the given screen point.
pub fn unproject_ray(
    screen_x: f64,
    screen_y: f64,
    viewport_width: f64,
    viewport_height: f64,
    inv_view_proj: &Matrix4<f64>,
) -> Ray {
    // Convert screen coords to NDC [-1, 1]
    let ndc_x = (2.0 * screen_x / viewport_width) - 1.0;
    let ndc_y = 1.0 - (2.0 * screen_y / viewport_height); // flip Y

    // Near plane point in NDC
    let near_ndc = Vector4::new(ndc_x, ndc_y, -1.0, 1.0);
    // Far plane point in NDC
    let far_ndc = Vector4::new(ndc_x, ndc_y, 1.0, 1.0);

    // Transform to world space
    let near_world = inv_view_proj * near_ndc;
    let far_world = inv_view_proj * far_ndc;

    let near = Vector3::new(
        near_world.x / near_world.w,
        near_world.y / near_world.w,
        near_world.z / near_world.w,
    );
    let far = Vector3::new(
        far_world.x / far_world.w,
        far_world.y / far_world.w,
        far_world.z / far_world.w,
    );

    Ray::new(near, far - near)
}

/// Intersect a ray with a horizontal plane at the given Z height.
///
/// Returns `None` if the ray is parallel to the plane (no intersection).
pub fn ray_plane_intersect_z(ray: &Ray, z: f64) -> Option<Vector3<f64>> {
    if ray.direction.z.abs() < 1e-12 {
        return None; // Ray parallel to plane
    }
    let t = (z - ray.origin.z) / ray.direction.z;
    if t < 0.0 {
        return None; // Intersection behind camera
    }
    Some(ray.at(t))
}

/// Intersect a ray with an arbitrary plane defined by point + normal.
///
/// Returns `None` if the ray is parallel to the plane.
pub fn ray_plane_intersect(
    ray: &Ray,
    plane_point: &Vector3<f64>,
    plane_normal: &Vector3<f64>,
) -> Option<Vector3<f64>> {
    let denom = plane_normal.dot(&ray.direction);
    if denom.abs() < 1e-12 {
        return None;
    }
    let t = (plane_point - ray.origin).dot(plane_normal) / denom;
    if t < 0.0 {
        return None;
    }
    Some(ray.at(t))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lerp() {
        assert!((lerp(0.0, 10.0, 0.5) - 5.0).abs() < f64::EPSILON);
        assert!((lerp(0.0, 10.0, 0.0) - 0.0).abs() < f64::EPSILON);
        assert!((lerp(0.0, 10.0, 1.0) - 10.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_clamp() {
        assert!((clamp(5.0, 0.0, 10.0) - 5.0).abs() < f64::EPSILON);
        assert!((clamp(-1.0, 0.0, 10.0) - 0.0).abs() < f64::EPSILON);
        assert!((clamp(15.0, 0.0, 10.0) - 10.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_lerp_negative_values() {
        assert!((lerp(-10.0, -2.0, 0.25) - (-8.0)).abs() < f64::EPSILON);
    }

    #[test]
    fn test_lerp_same_values() {
        assert!((lerp(3.5, 3.5, 0.0) - 3.5).abs() < f64::EPSILON);
        assert!((lerp(3.5, 3.5, 0.5) - 3.5).abs() < f64::EPSILON);
        assert!((lerp(3.5, 3.5, 1.5) - 3.5).abs() < f64::EPSILON);
    }

    #[test]
    fn test_lerp_extrapolate() {
        assert!((lerp(0.0, 10.0, 1.5) - 15.0).abs() < f64::EPSILON);
        assert!((lerp(0.0, 10.0, -0.5) - (-5.0)).abs() < f64::EPSILON);
    }

    #[test]
    fn test_clamp_at_boundary() {
        assert!((clamp(0.0, 0.0, 10.0) - 0.0).abs() < f64::EPSILON);
        assert!((clamp(10.0, 0.0, 10.0) - 10.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_clamp_min_equals_max() {
        assert!((clamp(-5.0, 2.0, 2.0) - 2.0).abs() < f64::EPSILON);
        assert!((clamp(2.0, 2.0, 2.0) - 2.0).abs() < f64::EPSILON);
        assert!((clamp(10.0, 2.0, 2.0) - 2.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_point3_creation() {
        let point = Point3::new(1.0, 2.0, 3.0);
        assert!((point.x - 1.0).abs() < f64::EPSILON);
        assert!((point.y - 2.0).abs() < f64::EPSILON);
        assert!((point.z - 3.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_point2_creation() {
        let point = Point2::new(4.0, 5.0);
        assert!((point.x - 4.0).abs() < f64::EPSILON);
        assert!((point.y - 5.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_ray_new() {
        let ray = Ray::new(Vector3::new(0.0, 0.0, 10.0), Vector3::new(0.0, 0.0, -1.0));
        assert!((ray.direction.norm() - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_ray_at() {
        let ray = Ray::new(Vector3::new(0.0, 0.0, 10.0), Vector3::new(0.0, 0.0, -1.0));
        let p = ray.at(5.0);
        assert!((p.z - 5.0).abs() < 1e-10);
    }

    #[test]
    fn test_ray_plane_intersect_z() {
        let ray = Ray::new(Vector3::new(5.0, 3.0, 10.0), Vector3::new(0.0, 0.0, -1.0));
        let result = ray_plane_intersect_z(&ray, 0.0);
        assert!(result.is_some());
        let p = result.unwrap();
        assert!((p.x - 5.0).abs() < 1e-10);
        assert!((p.y - 3.0).abs() < 1e-10);
        assert!((p.z - 0.0).abs() < 1e-10);
    }

    #[test]
    fn test_ray_plane_intersect_z_parallel() {
        let ray = Ray::new(Vector3::new(0.0, 0.0, 10.0), Vector3::new(1.0, 0.0, 0.0));
        assert!(ray_plane_intersect_z(&ray, 0.0).is_none());
    }

    #[test]
    fn test_ray_plane_intersect_z_behind() {
        let ray = Ray::new(Vector3::new(0.0, 0.0, -5.0), Vector3::new(0.0, 0.0, -1.0));
        // Plane at z=0 is above origin, ray goes down → behind
        assert!(ray_plane_intersect_z(&ray, 0.0).is_none());
    }

    #[test]
    fn test_ray_plane_intersect() {
        let ray = Ray::new(Vector3::new(0.0, 0.0, 10.0), Vector3::new(0.0, 0.0, -1.0));
        let plane_point = Vector3::new(0.0, 0.0, 0.0);
        let plane_normal = Vector3::new(0.0, 0.0, 1.0);
        let result = ray_plane_intersect(&ray, &plane_point, &plane_normal);
        assert!(result.is_some());
        let p = result.unwrap();
        assert!((p.z - 0.0).abs() < 1e-10);
    }

    #[test]
    fn test_unproject_center() {
        // Identity matrix → NDC = world. Screen center → (0,0) in NDC
        let identity = Matrix4::identity();
        let ray = unproject_ray(400.0, 300.0, 800.0, 600.0, &identity);
        // Center of screen → NDC (0, 0), ray should go from near to far along Z
        assert!((ray.origin.x).abs() < 1e-10);
        assert!((ray.origin.y).abs() < 1e-10);
    }
}
