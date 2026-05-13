//! Road endpoint marker rendering.
//!
//! Generates colored geometry for road connection point indicators:
//! - Start/end terminus markers (diamonds, circles)
//! - Connection arrows showing predecessor/successor links
//! - Dangling endpoint warnings (unconnected road ends)
//!
//! Pure geometry computation, WASM compatible.

use crate::vertex::ColorVertex;
use we_core::model::Point3D;

/// Color for road start (green).
pub const START_COLOR: [f32; 4] = [0.20, 0.80, 0.30, 1.0];
/// Color for road end (red).
pub const END_COLOR: [f32; 4] = [0.85, 0.25, 0.25, 1.0];
/// Color for dangling (unconnected) endpoints (orange).
pub const DANGLING_COLOR: [f32; 4] = [0.95, 0.60, 0.10, 1.0];
/// Color for connected endpoint (blue).
pub const CONNECTED_COLOR: [f32; 4] = [0.30, 0.55, 0.90, 1.0];

/// Configuration for endpoint markers.
#[derive(Debug, Clone)]
pub struct EndpointConfig {
    /// Diamond half-size in metres.
    pub diamond_size: f32,
    /// Number of sides for the circle approximation.
    pub circle_sides: u32,
    /// Arrow shaft half-width in metres.
    pub arrow_half_width: f32,
    /// Arrow head length in metres.
    pub arrow_head_length: f32,
}

impl Default for EndpointConfig {
    fn default() -> Self {
        Self {
            diamond_size: 1.5,
            circle_sides: 8,
            arrow_half_width: 0.4,
            arrow_head_length: 1.5,
        }
    }
}

/// Generate a flat diamond marker centred at `position`.
///
/// The diamond lies in the XY plane at the given Z height.
pub fn generate_diamond_marker(position: &Point3D, size: f32, color: [f32; 4]) -> Vec<ColorVertex> {
    let cx = position.x as f32;
    let cy = position.y as f32;
    let cz = position.z as f32;

    // Diamond corners
    let top = [cx, cy + size, cz];
    let right = [cx + size, cy, cz];
    let bottom = [cx, cy - size, cz];
    let left = [cx - size, cy, cz];

    // Two triangles forming the diamond
    let mut verts = Vec::with_capacity(6);
    for &pos in &[top, right, left, right, bottom, left] {
        verts.push(ColorVertex::new(pos, color));
    }
    verts
}

/// Generate a regular polygon (circle approximation) at `position`.
///
/// Useful for drawing circular endpoint indicators.
pub fn generate_circle_marker(
    position: &Point3D,
    radius: f32,
    sides: u32,
    color: [f32; 4],
) -> Vec<ColorVertex> {
    if sides < 3 {
        return Vec::new();
    }

    let cx = position.x as f32;
    let cy = position.y as f32;
    let cz = position.z as f32;
    let center = [cx, cy, cz];

    let mut verts = Vec::with_capacity(sides as usize * 3);
    let step = std::f32::consts::TAU / sides as f32;

    for i in 0..sides {
        let a0 = i as f32 * step;
        let a1 = (i + 1) as f32 * step;
        let p0 = [cx + radius * a0.cos(), cy + radius * a0.sin(), cz];
        let p1 = [cx + radius * a1.cos(), cy + radius * a1.sin(), cz];
        for &pos in &[center, p0, p1] {
            verts.push(ColorVertex::new(pos, color));
        }
    }
    verts
}

/// Generate an arrow pointing in the given direction from `origin`.
///
/// The arrow consists of a rectangular shaft and a triangular head.
///
/// # Arguments
///
/// * `origin` - Arrow start position
/// * `heading` - Direction in radians (0 = +X axis)
/// * `total_length` - Total arrow length
/// * `half_width` - Half-width of the shaft
/// * `head_length` - Length of the triangular head
pub fn generate_arrow(
    origin: &Point3D,
    heading: f64,
    total_length: f32,
    half_width: f32,
    head_length: f32,
    color: [f32; 4],
) -> Vec<ColorVertex> {
    let cos_h = heading.cos() as f32;
    let sin_h = heading.sin() as f32;
    let perp_x = -sin_h;
    let perp_y = cos_h;

    let ox = origin.x as f32;
    let oy = origin.y as f32;
    let oz = origin.z as f32;

    let shaft_len = (total_length - head_length).max(0.0);

    // Shaft tip (where head starts)
    let tip_x = ox + cos_h * shaft_len;
    let tip_y = oy + sin_h * shaft_len;

    // Arrow end
    let end_x = ox + cos_h * total_length;
    let end_y = oy + sin_h * total_length;

    let mut verts = Vec::with_capacity(12);

    if shaft_len > 0.0 {
        // Shaft: rectangle (2 triangles)
        let s0l = [ox + perp_x * half_width, oy + perp_y * half_width, oz];
        let s0r = [ox - perp_x * half_width, oy - perp_y * half_width, oz];
        let s1l = [tip_x + perp_x * half_width, tip_y + perp_y * half_width, oz];
        let s1r = [tip_x - perp_x * half_width, tip_y - perp_y * half_width, oz];

        for &pos in &[s0l, s0r, s1l, s0r, s1r, s1l] {
            verts.push(ColorVertex::new(pos, color));
        }
    }

    // Head: triangle
    let head_hw = head_length * 0.5;
    let hl = [tip_x + perp_x * head_hw, tip_y + perp_y * head_hw, oz];
    let hr = [tip_x - perp_x * head_hw, tip_y - perp_y * head_hw, oz];
    let he = [end_x, end_y, oz];

    for &pos in &[hl, hr, he] {
        verts.push(ColorVertex::new(pos, color));
    }

    verts
}

/// Endpoint type — determines marker colour and style.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndpointKind {
    /// Start of road (s = 0).
    Start,
    /// End of road (s = length).
    End,
    /// Endpoint with no predecessor/successor link.
    Dangling,
    /// Endpoint connected to another road.
    Connected,
}

impl EndpointKind {
    fn color(self) -> [f32; 4] {
        match self {
            Self::Start => START_COLOR,
            Self::End => END_COLOR,
            Self::Dangling => DANGLING_COLOR,
            Self::Connected => CONNECTED_COLOR,
        }
    }
}

/// A road endpoint description for rendering.
#[derive(Debug, Clone)]
pub struct RoadEndpoint {
    /// World position of the endpoint.
    pub position: Point3D,
    /// Heading direction of the road at this endpoint (radians).
    pub heading: f64,
    /// Endpoint kind.
    pub kind: EndpointKind,
}

/// Generate render vertices for a list of road endpoints.
pub fn generate_endpoint_markers(
    endpoints: &[RoadEndpoint],
    config: &EndpointConfig,
) -> Vec<ColorVertex> {
    let mut vertices = Vec::new();

    for ep in endpoints {
        let color = ep.kind.color();
        // Diamond marker
        vertices.extend(generate_diamond_marker(
            &ep.position,
            config.diamond_size,
            color,
        ));
        // Direction arrow for dangling endpoints (shows which way is unconnected)
        if ep.kind == EndpointKind::Dangling {
            vertices.extend(generate_arrow(
                &ep.position,
                ep.heading,
                config.arrow_head_length * 2.0,
                config.arrow_half_width,
                config.arrow_head_length,
                color,
            ));
        }
    }

    vertices
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pt(x: f64, y: f64) -> Point3D {
        Point3D::new(x, y, 0.0)
    }

    #[test]
    fn test_diamond_marker_emits_six_vertices() {
        let v = generate_diamond_marker(&pt(0.0, 0.0), 1.0, START_COLOR);
        assert_eq!(v.len(), 6);
    }

    #[test]
    fn test_diamond_marker_colors_match() {
        let v = generate_diamond_marker(&pt(0.0, 0.0), 1.0, END_COLOR);
        for vert in &v {
            assert_eq!(vert.color, END_COLOR);
        }
    }

    #[test]
    fn test_diamond_marker_centered_at_position() {
        let v = generate_diamond_marker(&pt(5.0, 3.0), 1.0, START_COLOR);
        // All vertices within bounding box around position
        for vert in &v {
            assert!(vert.position[0] >= 4.0 && vert.position[0] <= 6.0);
            assert!(vert.position[1] >= 2.0 && vert.position[1] <= 4.0);
        }
    }

    #[test]
    fn test_circle_marker_emits_sides_times_3() {
        let v = generate_circle_marker(&pt(0.0, 0.0), 2.0, 8, CONNECTED_COLOR);
        assert_eq!(v.len(), 24); // 8 * 3
    }

    #[test]
    fn test_circle_marker_degenerate_sides() {
        let v = generate_circle_marker(&pt(0.0, 0.0), 1.0, 2, START_COLOR);
        assert!(v.is_empty(), "< 3 sides should produce no vertices");
    }

    #[test]
    fn test_arrow_emits_shaft_plus_head() {
        let v = generate_arrow(&pt(0.0, 0.0), 0.0, 5.0, 0.4, 1.5, DANGLING_COLOR);
        // shaft (6) + head (3)
        assert_eq!(v.len(), 9);
    }

    #[test]
    fn test_arrow_zero_shaft_length_emits_head_only() {
        // total_length == head_length → shaft_len = 0 → only head (3 verts)
        let v = generate_arrow(&pt(0.0, 0.0), 0.0, 1.5, 0.4, 1.5, DANGLING_COLOR);
        assert_eq!(v.len(), 3);
    }

    #[test]
    fn test_endpoint_markers_empty_input() {
        let v = generate_endpoint_markers(&[], &Default::default());
        assert!(v.is_empty());
    }

    #[test]
    fn test_endpoint_markers_start_no_arrow() {
        let ep = RoadEndpoint {
            position: pt(0.0, 0.0),
            heading: 0.0,
            kind: EndpointKind::Start,
        };
        let v = generate_endpoint_markers(&[ep], &Default::default());
        // Only diamond (6 vertices), no arrow
        assert_eq!(v.len(), 6);
    }

    #[test]
    fn test_endpoint_markers_dangling_has_diamond_plus_arrow() {
        let ep = RoadEndpoint {
            position: pt(0.0, 0.0),
            heading: 0.0,
            kind: EndpointKind::Dangling,
        };
        let v = generate_endpoint_markers(&[ep], &Default::default());
        // Diamond (6) + arrow (shaft 6 + head 3) = 15
        assert_eq!(v.len(), 15);
    }

    #[test]
    fn test_endpoint_kind_colors() {
        assert_eq!(EndpointKind::Start.color(), START_COLOR);
        assert_eq!(EndpointKind::End.color(), END_COLOR);
        assert_eq!(EndpointKind::Dangling.color(), DANGLING_COLOR);
        assert_eq!(EndpointKind::Connected.color(), CONNECTED_COLOR);
    }
}
