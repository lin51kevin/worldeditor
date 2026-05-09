//! Signal rendering — traffic lights, signs, etc.
//!
//! Renders signals as billboard icons facing the camera or as 3D meshes.
//! Supports instanced rendering for multiple identical signals.

use crate::vertex::ColorVertex;
use we_core::model::{DirectionalSubType, Point3D, Signal, SignalType};

/// Configuration for signal rendering.
#[derive(Debug, Clone)]
pub struct SignalRenderConfig {
    /// Scale factor for signal icons.
    pub icon_scale: f32,
    /// Whether to use 3D meshes instead of billboards.
    pub use_3d_meshes: bool,
    /// Default icon texture path prefix.
    pub icon_path_prefix: String,
}

impl Default for SignalRenderConfig {
    fn default() -> Self {
        Self {
            icon_scale: 1.0,
            use_3d_meshes: false,
            icon_path_prefix: "Assets/textures/Signals/".to_string(),
        }
    }
}

/// Signal rendering data ready for GPU upload.
pub struct SignalRenderData {
    /// Billboard vertices for icon rendering.
    pub billboard_vertices: Vec<ColorVertex>,
    /// 3D mesh vertices (if using 3D mode).
    pub mesh_vertices: Vec<ColorVertex>,
    /// Transform matrices for each signal instance.
    pub transforms: Vec<[[f32; 4]; 4]>,
}

impl Default for SignalRenderData {
    fn default() -> Self {
        Self {
            billboard_vertices: Vec::new(),
            mesh_vertices: Vec::new(),
            transforms: Vec::new(),
        }
    }
}

/// Generate billboard vertices for a signal icon at a world position.
pub fn generate_signal_billboard(
    position: &Point3D,
    orientation: f64,
    width: f32,
    height: f32,
    color: [f32; 4],
) -> Vec<ColorVertex> {
    let mut vertices = Vec::with_capacity(6);

    // Calculate the 4 corners of the billboard (always facing camera in shader)
    let half_w = width / 2.0;
    let half_h = height / 2.0;

    // Billboard center position
    let cx = position.x as f32;
    let cy = position.y as f32;
    let cz = position.z as f32;

    // Four corners (billboard will be oriented to face camera in shader)
    let corners = [
        [-half_w, -half_h, 0.0], // bottom-left
        [half_w, -half_h, 0.0],  // bottom-right
        [-half_w, half_h, 0.0],  // top-left
        [half_w, half_h, 0.0],   // top-right
    ];

    // Two triangles for the billboard quad
    // Triangle 1: bottom-left, bottom-right, top-left
    for corner in &corners[0..3] {
        vertices.push(ColorVertex::new(
            [cx + corner[0], cy + corner[1], cz + corner[2]],
            color,
        ));
    }
    // Triangle 2: bottom-right, top-right, top-left
    for corner in &[corners[1], corners[3], corners[2]] {
        vertices.push(ColorVertex::new(
            [cx + corner[0], cy + corner[1], cz + corner[2]],
            color,
        ));
    }

    vertices
}

/// Convert Signal to SignalType for texture path determination.
pub fn signal_type_to_icon_path(signal: &Signal) -> String {
    match &signal.signal_type {
        SignalType::StandardTrafficLight => "StandardTrafficLight.png".to_string(),
        SignalType::WalkingTrafficLight => "WalkingTrafficLight.png".to_string(),
        SignalType::DirectionalTrafficLight { subtype } => match subtype {
            DirectionalSubType::Left => "TurnLeftTrafficLight.png".to_string(),
            DirectionalSubType::Right => "TurnRightTrafficLight.png".to_string(),
            DirectionalSubType::Forward => "ForwardTrafficLight.png".to_string(),
        },
        SignalType::BicycleTrafficLight => "BikingTrafficLight.png".to_string(),
        SignalType::TurnUTrafficLight => "TurnUTrafficLight.png".to_string(),
        SignalType::SpeedLimit => {
            format!("speedlimit_{}.png", signal.value.as_deref().unwrap_or("30"))
        }
        SignalType::SpeedLimitRemoval => format!(
            "removespeedlimit_{}.png",
            signal.value.as_deref().unwrap_or("30")
        ),
        SignalType::SingleLight => format!("trafficLights/light/{}.png", signal.name),
        SignalType::Indicate => format!("Signs/indicate/{}.png", signal.name),
        SignalType::Prohibit => format!("Signs/prohibit/{}.png", signal.name),
        SignalType::Warn => format!("Signs/warn/{}.png", signal.name),
        SignalType::Custom(type_str) => format!("Signs/{}.png", type_str),
    }
}

/// Default signal colors for different signal types.
pub fn signal_default_color(signal: &Signal) -> [f32; 4] {
    match &signal.signal_type {
        SignalType::SpeedLimit | SignalType::SpeedLimitRemoval => [0.0, 0.0, 0.0, 1.0], // Black for speed signs
        SignalType::StandardTrafficLight => [0.2, 0.8, 0.2, 1.0],                       // Greenish
        SignalType::WalkingTrafficLight => [0.2, 0.8, 0.2, 1.0],
        SignalType::DirectionalTrafficLight { .. } => [0.2, 0.8, 0.2, 1.0],
        SignalType::BicycleTrafficLight => [0.2, 0.8, 0.2, 1.0],
        SignalType::TurnUTrafficLight => [0.2, 0.8, 0.2, 1.0],
        _ => [1.0, 1.0, 1.0, 1.0], // White for generic
    }
}

/// Build transform matrix for a signal at a given position and orientation.
pub fn build_signal_transform(position: &Point3D, orientation: f64, scale: f32) -> [[f32; 4]; 4] {
    let cos_h = orientation.cos() as f32;
    let sin_h = orientation.sin() as f32;

    // Build a rotation matrix around Z axis (heading)
    // Then translation to position
    [
        [cos_h * scale, sin_h * scale, 0.0, 0.0],
        [-sin_h * scale, cos_h * scale, 0.0, 0.0],
        [0.0, 0.0, scale, 0.0],
        [position.x as f32, position.y as f32, position.z as f32, 1.0],
    ]
}

/// Generate render data for all signals on a road.
pub fn generate_signal_render_data(signals: &[Signal], icon_size: f32) -> SignalRenderData {
    let mut data = SignalRenderData::default();

    for signal in signals {
        let color = signal_default_color(signal);
        let vertices = generate_signal_billboard(
            &signal.position,
            signal.orientation,
            icon_size,
            icon_size,
            color,
        );
        data.billboard_vertices.extend(vertices);
        data.transforms.push(build_signal_transform(
            &signal.position,
            signal.orientation,
            1.0,
        ));
    }

    data
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_signal_billboard_generation() {
        let position = Point3D::new(0.0, 0.0, 5.0);
        let vertices = generate_signal_billboard(&position, 0.0, 1.0, 2.0, [1.0, 1.0, 1.0, 1.0]);
        assert_eq!(vertices.len(), 6);
    }

    #[test]
    fn test_signal_type_icon_path() {
        let signal = Signal {
            id: "1".to_string(),
            signal_type: SignalType::StandardTrafficLight,
            name: "test".to_string(),
            position: Point3D::new(0.0, 0.0, 0.0),
            orientation: 0.0,
            value: None,
            is_dynamic: true,
            subtype: None,
        };
        let path = signal_type_to_icon_path(&signal);
        assert_eq!(path, "StandardTrafficLight.png");
    }

    #[test]
    fn test_transform_matrix_creation() {
        let pos = Point3D::new(10.0, 20.0, 5.0);
        let transform = build_signal_transform(&pos, 0.0, 1.0);
        assert_eq!(transform[3][0], 10.0);
        assert_eq!(transform[3][1], 20.0);
        assert_eq!(transform[3][2], 5.0);
    }
}
