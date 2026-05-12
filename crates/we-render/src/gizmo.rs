//! Gizmo rendering — 3D translate/rotate/scale handles for editor interaction.
//!
//! Renders axis arrows (X=red, Y=green, Z=blue) and rotation rings
//! as line primitives using a simple uniform-color shader.

/// Axis of a gizmo handle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum GizmoAxis {
    X,
    Y,
    Z,
    All,
}

/// Operation mode for the gizmo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GizmoMode {
    Translate,
    Rotate,
    Scale,
}

/// State of a gizmo at a given frame.
#[derive(Debug, Clone)]
pub struct GizmoState {
    /// World-space origin of the gizmo.
    pub position: [f32; 3],
    /// Active mode.
    pub mode: GizmoMode,
    /// Currently hovered axis (if any).
    pub hovered: Option<GizmoAxis>,
    /// Currently dragging axis (if any).
    pub active: Option<GizmoAxis>,
    /// World-space scale factor for rendering.
    pub scale: f32,
}

impl Default for GizmoState {
    fn default() -> Self {
        Self {
            position: [0.0, 0.0, 0.0],
            mode: GizmoMode::Translate,
            hovered: None,
            active: None,
            scale: 1.0,
        }
    }
}

/// RGBA color for each axis.
pub fn axis_color(axis: GizmoAxis) -> [f32; 4] {
    match axis {
        GizmoAxis::X => [1.0, 0.1, 0.1, 1.0],
        GizmoAxis::Y => [0.1, 1.0, 0.1, 1.0],
        GizmoAxis::Z => [0.1, 0.1, 1.0, 1.0],
        GizmoAxis::All => [1.0, 1.0, 0.0, 1.0],
    }
}

/// Generate vertex positions for a single axis arrow (shaft + tip).
///
/// Returns (shaft_start, shaft_end, tip_vertices) along the given axis.
pub fn axis_vertices(axis: GizmoAxis, length: f32) -> Vec<[f32; 3]> {
    let dir = match axis {
        GizmoAxis::X => [1.0_f32, 0.0, 0.0],
        GizmoAxis::Y => [0.0, 1.0, 0.0],
        GizmoAxis::Z => [0.0, 0.0, 1.0],
        GizmoAxis::All => [0.0, 0.0, 0.0],
    };
    vec![
        [0.0, 0.0, 0.0],
        [dir[0] * length, dir[1] * length, dir[2] * length],
    ]
}

/// Generate circle vertices for a rotation ring around the given axis.
pub fn rotation_ring_vertices(axis: GizmoAxis, radius: f32, segments: usize) -> Vec<[f32; 3]> {
    let count = segments.max(8);
    (0..=count)
        .map(|i| {
            let t = std::f32::consts::TAU * i as f32 / count as f32;
            match axis {
                GizmoAxis::X => [0.0, t.cos() * radius, t.sin() * radius],
                GizmoAxis::Y => [t.cos() * radius, 0.0, t.sin() * radius],
                GizmoAxis::Z | GizmoAxis::All => [t.cos() * radius, t.sin() * radius, 0.0],
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_axis_color_x_is_red() {
        let c = axis_color(GizmoAxis::X);
        assert!(c[0] > 0.8, "R should be high");
        assert!(c[1] < 0.2, "G should be low");
    }

    #[test]
    fn test_axis_vertices_x_length() {
        let verts = axis_vertices(GizmoAxis::X, 1.0);
        assert_eq!(verts.len(), 2);
        assert_eq!(verts[0], [0.0, 0.0, 0.0]);
        assert_eq!(verts[1], [1.0, 0.0, 0.0]);
    }

    #[test]
    fn test_rotation_ring_segments() {
        let ring = rotation_ring_vertices(GizmoAxis::Z, 1.0, 16);
        assert_eq!(ring.len(), 17); // 0..=16
    }

    #[test]
    fn test_gizmo_state_default() {
        let g = GizmoState::default();
        assert_eq!(g.position, [0.0, 0.0, 0.0]);
        assert_eq!(g.mode, GizmoMode::Translate);
        assert!(g.hovered.is_none());
        assert!(g.active.is_none());
    }

    #[test]
    fn test_gizmo_mode_debug() {
        let s = format!("{:?}", GizmoMode::Rotate);
        assert!(s.contains("Rotate"));
    }
}
