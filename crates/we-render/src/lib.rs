//! WorldEditor rendering engine.
//!
//! Built on wgpu, supports both native and WebGPU (WASM) targets.

pub mod bridge_tunnel_render;
pub mod camera;
pub mod endpoint_render;
pub mod gizmo;
pub mod gpu;
pub mod instance_render;
pub mod junction_render;
pub mod mark_render;
pub mod mesh_cache;
pub mod object_instancing;
pub mod object_render;
pub mod pipeline;
pub mod point_render;
pub mod render_config;
pub mod renderer;
pub mod road_mesh;
pub mod signal_render;
pub mod vertex;

pub use bridge_tunnel_render::{
    BRIDGE_COLOR, BridgeTunnelConfig, ReferenceSample, TUNNEL_COLOR, generate_bridge_deck,
    generate_bridge_tunnel_render_data, generate_tunnel_enclosure,
};
pub use endpoint_render::{
    CONNECTED_COLOR, DANGLING_COLOR, END_COLOR, EndpointConfig, EndpointKind, RoadEndpoint,
    START_COLOR, generate_endpoint_markers,
};
pub use gpu::{GpuContext, GpuError};
pub use instance_render::{
    InstanceBatch, InstanceCollector, InstanceData, PrototypeKind, ground_quad_vertices,
    unit_box_vertices, unit_pole_vertices,
};
pub use object_instancing::collect_road_object_instances;
pub use mesh_cache::{MeshUpdate, SceneMeshCache};
pub use point_render::build_point_vertices;
pub use renderer::{LaneLineMesh, RenderMesh, Renderer};
pub use road_mesh::{generate_road_lane_lines, generate_road_mesh};
pub use vertex::{ColorVertex, LineVertex, PointVertex};

#[cfg(test)]
pub mod test_helpers {
    /// Try to create a headless GPU device for testing.
    /// Returns None if no GPU/compute device is found (CI environments).
    pub fn get_test_device() -> Option<wgpu::Device> {
        let _ = env_logger::builder().is_test(true).try_init();
        pollster::block_on(async {
            let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
                backends: wgpu::Backends::all(),
                ..Default::default()
            });
            let adapter = instance
                .request_adapter(&wgpu::RequestAdapterOptions {
                    power_preference: wgpu::PowerPreference::LowPower,
                    compatible_surface: None,
                    force_fallback_adapter: true,
                })
                .await?;
            let (device, _) = adapter
                .request_device(
                    &wgpu::DeviceDescriptor {
                        label: Some("test-device"),
                        required_features: wgpu::Features::empty(),
                        ..Default::default()
                    },
                    None,
                )
                .await
                .ok()?;
            Some(device)
        })
    }
}

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
