//! Bridge and tunnel overlay rendering.
//!
//! Generates colored geometry to highlight bridge decks and tunnel enclosures
//! along the road reference line. Pure geometry computation, WASM compatible.

use crate::vertex::ColorVertex;
use we_core::model::{Bridge, Point3D, Tunnel};

/// Default color for bridge deck overlay (translucent grey-blue).
pub const BRIDGE_COLOR: [f32; 4] = [0.50, 0.55, 0.65, 0.80];

/// Default color for tunnel enclosure overlay (translucent dark-brown).
pub const TUNNEL_COLOR: [f32; 4] = [0.30, 0.25, 0.20, 0.75];

/// Configuration for bridge/tunnel rendering.
#[derive(Debug, Clone)]
pub struct BridgeTunnelConfig {
    /// Half-width of the bridge/tunnel visual band (metres).
    pub half_width: f32,
    /// Height extrusion of the tunnel arch (metres).
    pub tunnel_arch_height: f32,
    /// Height of the bridge deck band above ground (metres).
    pub bridge_deck_height: f32,
    /// Number of segments used to sample the reference line.
    pub segments: usize,
}

impl Default for BridgeTunnelConfig {
    fn default() -> Self {
        Self {
            half_width: 6.0,
            tunnel_arch_height: 5.0,
            bridge_deck_height: 1.0,
            segments: 20,
        }
    }
}

/// A sampled point along the road reference line used by bridge/tunnel rendering.
#[derive(Debug, Clone)]
pub struct ReferenceSample {
    /// World position.
    pub position: Point3D,
    /// Heading angle (radians).
    pub heading: f64,
}

/// Generate a flat quad strip (deck) along a section of the reference line.
///
/// Covers the range `[s_start, s_start + length]` in road-local coordinates.
/// Returns vertices suitable for triangle-list rendering.
pub fn generate_bridge_deck(
    samples: &[ReferenceSample],
    s_start: f64,
    length: f64,
    road_total_length: f64,
    half_width: f32,
    deck_z: f32,
    color: [f32; 4],
) -> Vec<ColorVertex> {
    let road_len = road_total_length.max(f64::EPSILON);
    let t_start = (s_start / road_len).clamp(0.0, 1.0) as f32;
    let t_end = ((s_start + length) / road_len).clamp(0.0, 1.0) as f32;

    let n = samples.len();
    if n < 2 {
        return Vec::new();
    }

    let start_idx = ((t_start * (n - 1) as f32) as usize).min(n - 2);
    let end_idx = ((t_end * (n - 1) as f32) as usize).min(n - 1);

    if start_idx >= end_idx {
        return Vec::new();
    }

    let mut vertices = Vec::with_capacity((end_idx - start_idx) * 6);

    for i in start_idx..end_idx {
        let s = &samples[i];
        let s_next = &samples[i + 1];

        let perp_x = -s.heading.sin() as f32;
        let perp_y = s.heading.cos() as f32;
        let perp_x_next = -s_next.heading.sin() as f32;
        let perp_y_next = s_next.heading.cos() as f32;

        let cx = s.position.x as f32;
        let cy = s.position.y as f32;
        let cz = s.position.z as f32 + deck_z;
        let nx = s_next.position.x as f32;
        let ny = s_next.position.y as f32;
        let nz = s_next.position.z as f32 + deck_z;

        // Four corners of this quad segment
        let bl = [cx - perp_x * half_width, cy - perp_y * half_width, cz];
        let br = [cx + perp_x * half_width, cy + perp_y * half_width, cz];
        let tl = [
            nx - perp_x_next * half_width,
            ny - perp_y_next * half_width,
            nz,
        ];
        let tr = [
            nx + perp_x_next * half_width,
            ny + perp_y_next * half_width,
            nz,
        ];

        // Two triangles
        for &pos in &[bl, br, tl, br, tr, tl] {
            vertices.push(ColorVertex::new(pos, color));
        }
    }

    vertices
}

/// Generate a tunnel arch outline along a section of the reference line.
///
/// Produces a series of quads forming a simple rectangular tunnel enclosure.
pub fn generate_tunnel_enclosure(
    samples: &[ReferenceSample],
    s_start: f64,
    length: f64,
    road_total_length: f64,
    half_width: f32,
    arch_height: f32,
    color: [f32; 4],
) -> Vec<ColorVertex> {
    let road_len = road_total_length.max(f64::EPSILON);
    let t_start = (s_start / road_len).clamp(0.0, 1.0) as f32;
    let t_end = ((s_start + length) / road_len).clamp(0.0, 1.0) as f32;

    let n = samples.len();
    if n < 2 {
        return Vec::new();
    }

    let start_idx = ((t_start * (n - 1) as f32) as usize).min(n - 2);
    let end_idx = ((t_end * (n - 1) as f32) as usize).min(n - 1);

    if start_idx >= end_idx {
        return Vec::new();
    }

    let mut vertices = Vec::with_capacity((end_idx - start_idx) * 18);

    for i in start_idx..end_idx {
        let s = &samples[i];
        let s_next = &samples[i + 1];

        let perp_x = -s.heading.sin() as f32;
        let perp_y = s.heading.cos() as f32;
        let perp_x_next = -s_next.heading.sin() as f32;
        let perp_y_next = s_next.heading.cos() as f32;

        let cx = s.position.x as f32;
        let cy = s.position.y as f32;
        let cz = s.position.z as f32;
        let nx = s_next.position.x as f32;
        let ny = s_next.position.y as f32;
        let nz = s_next.position.z as f32;

        // Left wall
        let lbl = [cx - perp_x * half_width, cy - perp_y * half_width, cz];
        let ltl = [
            cx - perp_x * half_width,
            cy - perp_y * half_width,
            cz + arch_height,
        ];
        let lbl_n = [
            nx - perp_x_next * half_width,
            ny - perp_y_next * half_width,
            nz,
        ];
        let ltl_n = [
            nx - perp_x_next * half_width,
            ny - perp_y_next * half_width,
            nz + arch_height,
        ];

        for &pos in &[lbl, ltl, lbl_n, ltl, ltl_n, lbl_n] {
            vertices.push(ColorVertex::new(pos, color));
        }

        // Right wall
        let rbl = [cx + perp_x * half_width, cy + perp_y * half_width, cz];
        let rtl = [
            cx + perp_x * half_width,
            cy + perp_y * half_width,
            cz + arch_height,
        ];
        let rbl_n = [
            nx + perp_x_next * half_width,
            ny + perp_y_next * half_width,
            nz,
        ];
        let rtl_n = [
            nx + perp_x_next * half_width,
            ny + perp_y_next * half_width,
            nz + arch_height,
        ];

        for &pos in &[rbl, rtl, rbl_n, rtl, rtl_n, rbl_n] {
            vertices.push(ColorVertex::new(pos, color));
        }

        // Ceiling (top slab)
        for &pos in &[ltl, rtl, ltl_n, rtl, rtl_n, ltl_n] {
            vertices.push(ColorVertex::new(pos, color));
        }
    }

    vertices
}

/// Generate all bridge/tunnel render geometry for a road.
///
/// # Arguments
///
/// * `bridges` - All bridges on this road
/// * `tunnels` - All tunnels on this road
/// * `samples` - Reference line samples (uniform in s)
/// * `road_length` - Total road length (for normalisation)
/// * `config` - Rendering configuration
pub fn generate_bridge_tunnel_render_data(
    bridges: &[Bridge],
    tunnels: &[Tunnel],
    samples: &[ReferenceSample],
    road_length: f64,
    config: &BridgeTunnelConfig,
) -> Vec<ColorVertex> {
    let mut vertices = Vec::new();

    for bridge in bridges {
        vertices.extend(generate_bridge_deck(
            samples,
            bridge.s,
            bridge.length,
            road_length,
            config.half_width,
            config.bridge_deck_height,
            BRIDGE_COLOR,
        ));
    }

    for tunnel in tunnels {
        vertices.extend(generate_tunnel_enclosure(
            samples,
            tunnel.s,
            tunnel.length,
            road_length,
            config.half_width,
            config.tunnel_arch_height,
            TUNNEL_COLOR,
        ));
    }

    vertices
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_samples(n: usize, length: f64) -> Vec<ReferenceSample> {
        (0..n)
            .map(|i| {
                let t = i as f64 / (n - 1).max(1) as f64;
                ReferenceSample {
                    position: Point3D::new(t * length, 0.0, 0.0),
                    heading: 0.0,
                }
            })
            .collect()
    }

    fn assert_position_close(actual: [f32; 3], expected: [f32; 3]) {
        for (index, (actual, expected)) in actual.iter().zip(expected.iter()).enumerate() {
            assert!(
                (actual - expected).abs() < 1e-4,
                "position[{index}] expected {expected}, got {actual}"
            );
        }
    }

    #[test]
    fn test_generate_bridge_deck_straight_segment_matches_expected_quad() {
        let color = [0.2, 0.3, 0.4, 0.5];
        let vertices =
            generate_bridge_deck(&make_samples(2, 10.0), 0.0, 10.0, 10.0, 2.0, 1.5, color);

        assert_eq!(vertices.len(), 6);
        assert_position_close(vertices[0].position, [0.0, -2.0, 1.5]);
        assert_position_close(vertices[1].position, [0.0, 2.0, 1.5]);
        assert_position_close(vertices[2].position, [10.0, -2.0, 1.5]);
        assert_position_close(vertices[4].position, [10.0, 2.0, 1.5]);
        for vertex in &vertices {
            assert_eq!(vertex.color, color);
        }
    }

    #[test]
    fn test_generate_tunnel_enclosure_straight_segment_matches_expected_faces() {
        let color = [0.4, 0.3, 0.2, 0.6];
        let vertices =
            generate_tunnel_enclosure(&make_samples(2, 10.0), 0.0, 10.0, 10.0, 2.0, 3.0, color);

        assert_eq!(vertices.len(), 18);
        assert_position_close(vertices[0].position, [0.0, -2.0, 0.0]);
        assert_position_close(vertices[1].position, [0.0, -2.0, 3.0]);
        assert_position_close(vertices[6].position, [0.0, 2.0, 0.0]);
        assert_position_close(vertices[7].position, [0.0, 2.0, 3.0]);
        assert_position_close(vertices[12].position, [0.0, -2.0, 3.0]);
        assert_position_close(vertices[13].position, [0.0, 2.0, 3.0]);
        for vertex in &vertices {
            assert_eq!(vertex.color, color);
        }
    }

    #[test]
    fn test_generate_bridge_tunnel_render_data_combines_feature_vertices() {
        let bridge = Bridge {
            id: "b1".to_string(),
            s: 0.0,
            length: 10.0,
            bridge_type: "concrete".to_string(),
        };
        let tunnel = Tunnel {
            id: "t1".to_string(),
            s: 0.0,
            length: 10.0,
            tunnel_type: "underpass".to_string(),
        };
        let vertices = generate_bridge_tunnel_render_data(
            &[bridge],
            &[tunnel],
            &make_samples(2, 10.0),
            10.0,
            &BridgeTunnelConfig::default(),
        );

        assert_eq!(vertices.len(), 24);
        assert!(
            vertices[..6]
                .iter()
                .all(|vertex| vertex.color == BRIDGE_COLOR)
        );
        assert!(
            vertices[6..]
                .iter()
                .all(|vertex| vertex.color == TUNNEL_COLOR)
        );
    }

    #[test]
    fn test_bridge_deck_generates_vertices() {
        let samples = make_samples(21, 100.0);
        let vertices = generate_bridge_deck(&samples, 0.0, 100.0, 100.0, 6.0, 1.0, BRIDGE_COLOR);
        assert!(!vertices.is_empty(), "bridge deck should emit vertices");
        // Each segment produces 6 vertices
        assert_eq!(vertices.len() % 6, 0);
    }

    #[test]
    fn test_bridge_deck_partial_range() {
        let samples = make_samples(21, 100.0);
        let full = generate_bridge_deck(&samples, 0.0, 100.0, 100.0, 6.0, 1.0, BRIDGE_COLOR);
        let half = generate_bridge_deck(&samples, 0.0, 50.0, 100.0, 6.0, 1.0, BRIDGE_COLOR);
        assert!(
            half.len() < full.len(),
            "partial bridge should emit fewer vertices"
        );
    }

    #[test]
    fn test_bridge_deck_empty_samples() {
        let v = generate_bridge_deck(&[], 0.0, 10.0, 100.0, 6.0, 1.0, BRIDGE_COLOR);
        assert!(v.is_empty());
    }

    #[test]
    fn test_tunnel_enclosure_generates_vertices() {
        let samples = make_samples(11, 50.0);
        let vertices = generate_tunnel_enclosure(&samples, 0.0, 50.0, 50.0, 6.0, 5.0, TUNNEL_COLOR);
        assert!(!vertices.is_empty(), "tunnel should emit vertices");
        // Each segment: 3 faces * 6 vertices = 18
        assert_eq!(vertices.len() % 18, 0);
    }

    #[test]
    fn test_tunnel_enclosure_empty_samples() {
        let v = generate_tunnel_enclosure(&[], 0.0, 10.0, 100.0, 6.0, 5.0, TUNNEL_COLOR);
        assert!(v.is_empty());
    }

    #[test]
    fn test_generate_bridge_tunnel_render_data_no_features() {
        let samples = make_samples(10, 50.0);
        let v = generate_bridge_tunnel_render_data(&[], &[], &samples, 50.0, &Default::default());
        assert!(v.is_empty());
    }

    #[test]
    fn test_generate_bridge_tunnel_render_data_with_bridge() {
        let bridge = Bridge {
            id: "b1".to_string(),
            s: 0.0,
            length: 50.0,
            bridge_type: "concrete".to_string(),
        };
        let samples = make_samples(21, 100.0);
        let v = generate_bridge_tunnel_render_data(
            &[bridge],
            &[],
            &samples,
            100.0,
            &Default::default(),
        );
        assert!(!v.is_empty());
    }

    #[test]
    fn test_generate_bridge_tunnel_render_data_with_tunnel() {
        let tunnel = Tunnel {
            id: "t1".to_string(),
            s: 20.0,
            length: 30.0,
            tunnel_type: "underpass".to_string(),
        };
        let samples = make_samples(21, 100.0);
        let v = generate_bridge_tunnel_render_data(
            &[],
            &[tunnel],
            &samples,
            100.0,
            &Default::default(),
        );
        assert!(!v.is_empty());
    }

    #[test]
    fn test_bridge_deck_vertex_colors_match() {
        let samples = make_samples(3, 10.0);
        let v = generate_bridge_deck(&samples, 0.0, 10.0, 10.0, 3.0, 0.0, BRIDGE_COLOR);
        for vert in &v {
            assert_eq!(vert.color, BRIDGE_COLOR);
        }
    }
}
