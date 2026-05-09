//! WorldEditor rendering engine.
//!
//! Built on wgpu, supports both native and WebGPU (WASM) targets.

pub mod camera;
pub mod gpu;
pub mod junction_render;
pub mod mark_render;
pub mod object_render;
pub mod pipeline;
pub mod render_config;
pub mod renderer;
pub mod road_mesh;
pub mod signal_render;
pub mod vertex;

pub use gpu::{GpuContext, GpuError};
pub use renderer::{LaneLineMesh, RenderMesh, Renderer};
pub use road_mesh::{generate_road_lane_lines, generate_road_mesh};
pub use vertex::{ColorVertex, LineVertex};

/// Renderer configuration.
pub struct RendererConfig {
    pub width: u32,
    pub height: u32,
    pub sample_count: u32,
}

impl Default for RendererConfig {
    fn default() -> Self {
        Self {
            width: 1280,
            height: 720,
            sample_count: 4,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_renderer_config_default() {
        let config = RendererConfig::default();

        assert_eq!(config.width, 1280);
        assert_eq!(config.height, 720);
        assert_eq!(config.sample_count, 4);
    }

    #[test]
    fn test_renderer_config_custom() {
        let config = RendererConfig {
            width: 1920,
            height: 1080,
            sample_count: 8,
        };

        assert_eq!(config.width, 1920);
        assert_eq!(config.height, 1080);
        assert_eq!(config.sample_count, 8);
    }
}
