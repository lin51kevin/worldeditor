//! Signal rendering — traffic lights, signs, etc.
//!
//! Renders signals as billboard icons facing the camera or as 3D meshes.
//! Supports instanced rendering for multiple identical signals.

use crate::vertex::ColorVertex;
use we_core::model::{Point3D, Signal};

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
#[derive(Debug, Default)]
pub struct SignalRenderData {
    /// Billboard vertices for icon rendering.
    pub billboard_vertices: Vec<ColorVertex>,
    /// 3D mesh vertices (if using 3D mode).
    pub mesh_vertices: Vec<ColorVertex>,
    /// Transform matrices for each signal instance.
    pub transforms: Vec<[[f32; 4]; 4]>,
}

/// Generate billboard vertices for a signal icon at a world position.
pub fn generate_signal_billboard(
    position: &Point3D,
    _orientation: f64,
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

/// Derive a texture/icon path from the signal's raw type string.
///
/// Maps known OpenDRIVE type codes to texture file names.
pub fn signal_type_to_icon_path(signal: &Signal) -> String {
    match signal.signal_type.as_str() {
        "1000001" => "StandardTrafficLight.png".to_string(),
        "1000002" => "WalkingTrafficLight.png".to_string(),
        "1000013" => "BikingTrafficLight.png".to_string(),
        "1010203800001413" => format!("speedlimit_{}.png", signal.value.as_deref().unwrap_or("30")),
        "1010203900001613" => format!(
            "removespeedlimit_{}.png",
            signal.value.as_deref().unwrap_or("30")
        ),
        "Graphics" => format!("paint/{}.png", signal.signal_subtype),
        other => format!("Signs/{}.png", other),
    }
}

/// Default billboard color for a signal based on its type string.
pub fn signal_default_color(signal: &Signal) -> [f32; 4] {
    match signal.signal_type.as_str() {
        "Graphics" => [1.0, 1.0, 1.0, 0.95], // white paint mark
        "1010203800001413" | "1010203900001613" => [0.0, 0.0, 0.0, 1.0], // black text
        s if s.starts_with("1000") => [0.2, 0.8, 0.2, 1.0], // green traffic lights
        _ => [1.0, 1.0, 1.0, 1.0],
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
///
/// Signals are positioned using the `world_position` helper; callers that have
/// pre-computed world coordinates should pass the position directly via
/// [`generate_signal_billboard`].
pub fn generate_signal_render_data(
    signals: &[Signal],
    icon_size: f32,
    get_world_pos: impl Fn(&Signal) -> Option<Point3D>,
) -> SignalRenderData {
    let mut data = SignalRenderData::default();

    for signal in signals {
        let Some(pos) = get_world_pos(signal) else {
            continue;
        };
        let color = signal_default_color(signal);
        let vertices =
            generate_signal_billboard(&pos, signal.h_offset, icon_size, icon_size, color);
        data.billboard_vertices.extend(vertices);
        data.transforms
            .push(build_signal_transform(&pos, signal.h_offset, 1.0));
    }

    data
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_signal(signal_type: &str, signal_subtype: &str) -> Signal {
        Signal {
            id: "1".to_string(),
            name: "test".to_string(),
            s: 0.0,
            t: 0.0,
            z_offset: 0.0,
            h_offset: 0.0,
            width: 1.0,
            height: 2.0,
            signal_type: signal_type.to_string(),
            signal_subtype: signal_subtype.to_string(),
            value: None,
            orientation: "+".to_string(),
            is_dynamic: false,
            country: String::new(),
            unit: String::new(),
            validities: Vec::new(),
        }
    }

    #[test]
    fn test_signal_billboard_generation() {
        let position = Point3D::new(0.0, 0.0, 5.0);
        let vertices = generate_signal_billboard(&position, 0.0, 1.0, 2.0, [1.0, 1.0, 1.0, 1.0]);
        assert_eq!(vertices.len(), 6);
    }

    #[test]
    fn test_signal_type_icon_path_traffic_light() {
        let signal = make_signal("1000001", "none");
        let path = signal_type_to_icon_path(&signal);
        assert_eq!(path, "StandardTrafficLight.png");
    }

    #[test]
    fn test_signal_type_icon_path_speed_limit() {
        let mut signal = make_signal("1010203800001413", "none");
        signal.value = Some("60".to_string());
        let path = signal_type_to_icon_path(&signal);
        assert_eq!(path, "speedlimit_60.png");
    }

    #[test]
    fn test_signal_type_icon_path_graphics() {
        let signal = make_signal("Graphics", "StraightAheadArrow");
        let path = signal_type_to_icon_path(&signal);
        assert_eq!(path, "paint/StraightAheadArrow.png");
    }

    #[test]
    fn test_signal_default_color_paint() {
        let signal = make_signal("Graphics", "StraightAheadArrow");
        let color = signal_default_color(&signal);
        assert_eq!(color, [1.0, 1.0, 1.0, 0.95]);
    }

    #[test]
    fn test_transform_matrix_creation() {
        let pos = Point3D::new(10.0, 20.0, 5.0);
        let transform = build_signal_transform(&pos, 0.0, 1.0);
        assert_eq!(transform[3][0], 10.0);
        assert_eq!(transform[3][1], 20.0);
        assert_eq!(transform[3][2], 5.0);
    }

    #[test]
    fn test_signal_default_color_branches() {
        // Speed-limit signals render as black text.
        assert_eq!(
            signal_default_color(&make_signal("1010203800001413", "")),
            [0.0, 0.0, 0.0, 1.0]
        );
        assert_eq!(
            signal_default_color(&make_signal("1010203900001613", "")),
            [0.0, 0.0, 0.0, 1.0]
        );
        // Traffic lights (1000*) render green.
        assert_eq!(
            signal_default_color(&make_signal("1000001", "")),
            [0.2, 0.8, 0.2, 1.0]
        );
        // Unknown sign types fall through to white.
        assert_eq!(
            signal_default_color(&make_signal("9999999", "")),
            [1.0, 1.0, 1.0, 1.0]
        );
    }

    #[test]
    fn test_signal_icon_path_remaining_branches() {
        assert_eq!(
            signal_type_to_icon_path(&make_signal("1000002", "")),
            "WalkingTrafficLight.png"
        );
        assert_eq!(
            signal_type_to_icon_path(&make_signal("1000013", "")),
            "BikingTrafficLight.png"
        );
        // Remove-speed-limit uses default value when none set.
        assert_eq!(
            signal_type_to_icon_path(&make_signal("1010203900001613", "")),
            "removespeedlimit_30.png"
        );
        // Unknown type → Signs/<type>.png
        assert_eq!(
            signal_type_to_icon_path(&make_signal("ABC123", "")),
            "Signs/ABC123.png"
        );
    }

    #[test]
    fn test_generate_signal_render_data_skips_unpositioned() {
        let signals = vec![
            make_signal("1000001", ""),
            make_signal("Graphics", "Arrow"),
            make_signal("9999999", ""),
        ];
        // Only the first signal gets a world position; others are skipped.
        let data = generate_signal_render_data(&signals, 1.0, |s| {
            if s.signal_type == "1000001" {
                Some(Point3D::new(1.0, 2.0, 3.0))
            } else {
                None
            }
        });
        assert_eq!(data.transforms.len(), 1);
        assert_eq!(data.billboard_vertices.len(), 6);
    }

    #[test]
    fn test_generate_signal_render_data_empty() {
        let data = generate_signal_render_data(&[], 1.0, |_| Some(Point3D::new(0.0, 0.0, 0.0)));
        assert!(data.transforms.is_empty());
        assert!(data.billboard_vertices.is_empty());
    }
}
