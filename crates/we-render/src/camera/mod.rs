//! Camera system for 2D/3D viewport.

use nalgebra::{Matrix4, Point3, Vector3};

/// Camera projection mode.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ProjectionMode {
    Perspective { fov_y: f64, near: f64, far: f64 },
    Orthographic { scale: f64, near: f64, far: f64 },
}

/// A 3D camera with orbit controls.
#[derive(Debug, Clone)]
pub struct Camera {
    pub position: Point3<f64>,
    pub target: Point3<f64>,
    pub up: Vector3<f64>,
    pub projection: ProjectionMode,
    pub aspect_ratio: f64,
}

impl Camera {
    pub fn new_perspective(aspect_ratio: f64) -> Self {
        Self {
            position: Point3::new(0.0, -100.0, 50.0),
            target: Point3::origin(),
            up: Vector3::z(),
            projection: ProjectionMode::Perspective {
                fov_y: 45.0_f64.to_radians(),
                near: 0.1,
                far: 10000.0,
            },
            aspect_ratio,
        }
    }

    /// Compute the view matrix (world → camera).
    pub fn view_matrix(&self) -> Matrix4<f64> {
        Matrix4::look_at_rh(&self.position, &self.target, &self.up)
    }

    /// Orbit the camera around the target.
    pub fn orbit(&mut self, delta_yaw: f64, delta_pitch: f64) {
        let offset = self.position - self.target;
        let r = offset.norm();
        let theta = offset.y.atan2(offset.x) + delta_yaw;
        let phi = (offset.z / r)
            .acos()
            .clamp(0.01, std::f64::consts::PI - 0.01)
            - delta_pitch;

        self.position = self.target
            + Vector3::new(
                r * phi.sin() * theta.cos(),
                r * phi.sin() * theta.sin(),
                r * phi.cos(),
            );
    }

    /// Zoom by moving toward/away from target.
    pub fn zoom(&mut self, factor: f64) {
        let direction = self.target - self.position;
        let distance = direction.norm();
        let new_distance = (distance * factor).max(0.1);
        self.position = self.target - direction.normalize() * new_distance;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_camera_creation() {
        let cam = Camera::new_perspective(16.0 / 9.0);
        assert!(cam.position.z > 0.0); // above ground
    }

    #[test]
    fn test_view_matrix_is_invertible() {
        let cam = Camera::new_perspective(1.0);
        let view = cam.view_matrix();
        assert!(view.try_inverse().is_some());
    }

    #[test]
    fn test_zoom_limits() {
        let mut cam = Camera::new_perspective(1.0);
        // Zoom in many times — should never go past target
        for _ in 0..100 {
            cam.zoom(0.5);
        }
        let dist = (cam.position - cam.target).norm();
        assert!(dist >= 0.1);
    }
}
