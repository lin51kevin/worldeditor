//! Vertex types and buffer layouts for rendering.

use bytemuck::{Pod, Zeroable};

/// A vertex with position and RGBA color.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct ColorVertex {
    pub position: [f32; 3],
    pub color: [f32; 4],
}

impl ColorVertex {
    pub const LAYOUT: wgpu::VertexBufferLayout<'static> = wgpu::VertexBufferLayout {
        array_stride: std::mem::size_of::<ColorVertex>() as wgpu::BufferAddress,
        step_mode: wgpu::VertexStepMode::Vertex,
        attributes: &[
            // position
            wgpu::VertexAttribute {
                offset: 0,
                shader_location: 0,
                format: wgpu::VertexFormat::Float32x3,
            },
            // color
            wgpu::VertexAttribute {
                offset: std::mem::size_of::<[f32; 3]>() as wgpu::BufferAddress,
                shader_location: 1,
                format: wgpu::VertexFormat::Float32x4,
            },
        ],
    };

    pub fn new(position: [f32; 3], color: [f32; 4]) -> Self {
        Self { position, color }
    }
}

/// A vertex for textured road surface rendering (position + UV + color).
///
/// The UV coordinates carry road-space texture coordinates:
/// - `u`: lateral offset (0 at left edge, 1 at right edge of lane section)
/// - `v`: longitudinal distance along the road (meters)
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct SurfaceVertex {
    pub position: [f32; 3],
    pub uv: [f32; 2],
    pub color: [f32; 4],
}

impl SurfaceVertex {
    pub const LAYOUT: wgpu::VertexBufferLayout<'static> = wgpu::VertexBufferLayout {
        array_stride: std::mem::size_of::<SurfaceVertex>() as wgpu::BufferAddress,
        step_mode: wgpu::VertexStepMode::Vertex,
        attributes: &[
            // position @location(0)
            wgpu::VertexAttribute {
                offset: 0,
                shader_location: 0,
                format: wgpu::VertexFormat::Float32x3,
            },
            // uv @location(1)
            wgpu::VertexAttribute {
                offset: std::mem::size_of::<[f32; 3]>() as wgpu::BufferAddress,
                shader_location: 1,
                format: wgpu::VertexFormat::Float32x2,
            },
            // color @location(2)
            wgpu::VertexAttribute {
                offset: (std::mem::size_of::<[f32; 3]>() + std::mem::size_of::<[f32; 2]>())
                    as wgpu::BufferAddress,
                shader_location: 2,
                format: wgpu::VertexFormat::Float32x4,
            },
        ],
    };

    pub fn new(position: [f32; 3], uv: [f32; 2], color: [f32; 4]) -> Self {
        Self {
            position,
            uv,
            color,
        }
    }
}

/// A vertex for point cloud rendering (position + RGB color).
///
/// Built from the interleaved `[x, y, z, r, g, b]` buffer produced by
/// `we_core::pointcloud::build_render_buffer`. Rendered with `PointList` topology.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct PointVertex {
    pub position: [f32; 3],
    pub color: [f32; 3],
}

impl PointVertex {
    pub const LAYOUT: wgpu::VertexBufferLayout<'static> = wgpu::VertexBufferLayout {
        array_stride: std::mem::size_of::<PointVertex>() as wgpu::BufferAddress,
        step_mode: wgpu::VertexStepMode::Vertex,
        attributes: &[
            // position @location(0)
            wgpu::VertexAttribute {
                offset: 0,
                shader_location: 0,
                format: wgpu::VertexFormat::Float32x3,
            },
            // color @location(1)
            wgpu::VertexAttribute {
                offset: std::mem::size_of::<[f32; 3]>() as wgpu::BufferAddress,
                shader_location: 1,
                format: wgpu::VertexFormat::Float32x3,
            },
        ],
    };

    pub fn new(position: [f32; 3], color: [f32; 3]) -> Self {
        Self { position, color }
    }
}

#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct LineVertex {
    pub position: [f32; 3],
    pub offset: [f32; 2], // lateral half-extent (x) and z-height (y)
    pub color: [f32; 4],
    pub dash_info: [f32; 2], // cumulative_dist, dash_gap
    pub dash_scale: f32,
}

impl LineVertex {
    pub const LAYOUT: wgpu::VertexBufferLayout<'static> = wgpu::VertexBufferLayout {
        array_stride: std::mem::size_of::<LineVertex>() as wgpu::BufferAddress,
        step_mode: wgpu::VertexStepMode::Vertex,
        attributes: &[
            // position
            wgpu::VertexAttribute {
                offset: 0,
                shader_location: 0,
                format: wgpu::VertexFormat::Float32x3,
            },
            // offset
            wgpu::VertexAttribute {
                offset: std::mem::size_of::<[f32; 3]>() as wgpu::BufferAddress,
                shader_location: 1,
                format: wgpu::VertexFormat::Float32x2,
            },
            // color
            wgpu::VertexAttribute {
                offset: (std::mem::size_of::<[f32; 3]>() + std::mem::size_of::<[f32; 2]>())
                    as wgpu::BufferAddress,
                shader_location: 2,
                format: wgpu::VertexFormat::Float32x4,
            },
            // dash_info
            wgpu::VertexAttribute {
                offset: (std::mem::size_of::<[f32; 3]>()
                    + std::mem::size_of::<[f32; 2]>()
                    + std::mem::size_of::<[f32; 4]>())
                    as wgpu::BufferAddress,
                shader_location: 3,
                format: wgpu::VertexFormat::Float32x2,
            },
            // dash_scale
            wgpu::VertexAttribute {
                offset: (std::mem::size_of::<[f32; 3]>()
                    + std::mem::size_of::<[f32; 2]>()
                    + std::mem::size_of::<[f32; 4]>()
                    + std::mem::size_of::<[f32; 2]>())
                    as wgpu::BufferAddress,
                shader_location: 4,
                format: wgpu::VertexFormat::Float32,
            },
        ],
    };

    pub fn new(
        position: [f32; 3],
        offset: [f32; 2],
        color: [f32; 4],
        dash_info: [f32; 2],
        dash_scale: f32,
    ) -> Self {
        Self {
            position,
            offset,
            color,
            dash_info,
            dash_scale,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_color_vertex_size() {
        assert_eq!(std::mem::size_of::<ColorVertex>(), 28); // 3*4 + 4*4
    }

    #[test]
    fn test_color_vertex_is_pod() {
        let v = ColorVertex::new([1.0, 2.0, 3.0], [1.0, 0.0, 0.0, 1.0]);
        let bytes = bytemuck::bytes_of(&v);
        assert_eq!(bytes.len(), 28);
    }

    #[test]
    fn test_surface_vertex_size() {
        // 3*4 (pos) + 2*4 (uv) + 4*4 (color) = 12 + 8 + 16 = 36 bytes
        assert_eq!(std::mem::size_of::<SurfaceVertex>(), 36);
    }

    #[test]
    fn test_surface_vertex_is_pod() {
        let v = SurfaceVertex::new([1.0, 0.0, 0.0], [0.5, 0.5], [0.3, 0.3, 0.3, 1.0]);
        let bytes = bytemuck::bytes_of(&v);
        assert_eq!(bytes.len(), 36);
    }

    #[test]
    fn test_line_vertex_size() {
        assert_eq!(std::mem::size_of::<LineVertex>(), 48); // 12 + 8 + 16 + 8 + 4
    }

    #[test]
    fn test_point_vertex_size() {
        assert_eq!(std::mem::size_of::<PointVertex>(), 24); // 3*4 + 3*4
    }

    #[test]
    fn test_point_vertex_is_pod() {
        let v = PointVertex::new([1.0, 2.0, 3.0], [0.5, 0.6, 0.7]);
        let bytes = bytemuck::bytes_of(&v);
        assert_eq!(bytes.len(), 24);
    }

    #[test]
    fn test_color_vertex_layout_offsets_match_memory_layout() {
        assert_eq!(
            ColorVertex::LAYOUT.array_stride,
            std::mem::size_of::<ColorVertex>() as wgpu::BufferAddress
        );
        assert_eq!(ColorVertex::LAYOUT.attributes.len(), 2);
        assert_eq!(ColorVertex::LAYOUT.attributes[0].offset, 0);
        assert_eq!(
            ColorVertex::LAYOUT.attributes[1].offset,
            std::mem::size_of::<[f32; 3]>() as wgpu::BufferAddress
        );
    }

    #[test]
    fn test_surface_vertex_layout_offsets_match_memory_layout() {
        assert_eq!(
            SurfaceVertex::LAYOUT.array_stride,
            std::mem::size_of::<SurfaceVertex>() as wgpu::BufferAddress
        );
        assert_eq!(SurfaceVertex::LAYOUT.attributes.len(), 3);
        assert_eq!(SurfaceVertex::LAYOUT.attributes[0].offset, 0);
        assert_eq!(
            SurfaceVertex::LAYOUT.attributes[1].offset,
            std::mem::size_of::<[f32; 3]>() as wgpu::BufferAddress
        );
        assert_eq!(
            SurfaceVertex::LAYOUT.attributes[2].offset,
            (std::mem::size_of::<[f32; 3]>() + std::mem::size_of::<[f32; 2]>())
                as wgpu::BufferAddress
        );
    }

    #[test]
    fn test_line_vertex_new_preserves_fields_and_layout_offsets() {
        let vertex = LineVertex::new(
            [1.0, 2.0, 3.0],
            [0.5, 1.5],
            [0.1, 0.2, 0.3, 0.4],
            [4.0, 5.0],
            2.5,
        );

        assert_eq!(vertex.position, [1.0, 2.0, 3.0]);
        assert_eq!(vertex.offset, [0.5, 1.5]);
        assert_eq!(vertex.color, [0.1, 0.2, 0.3, 0.4]);
        assert_eq!(vertex.dash_info, [4.0, 5.0]);
        assert_eq!(vertex.dash_scale, 2.5);
        assert_eq!(
            LineVertex::LAYOUT.attributes[3].offset,
            (std::mem::size_of::<[f32; 3]>()
                + std::mem::size_of::<[f32; 2]>()
                + std::mem::size_of::<[f32; 4]>()) as wgpu::BufferAddress
        );
        assert_eq!(
            LineVertex::LAYOUT.attributes[4].offset,
            (std::mem::size_of::<[f32; 3]>()
                + std::mem::size_of::<[f32; 2]>()
                + std::mem::size_of::<[f32; 4]>()
                + std::mem::size_of::<[f32; 2]>()) as wgpu::BufferAddress
        );
    }
}
