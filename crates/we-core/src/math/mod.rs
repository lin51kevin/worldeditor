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
}
