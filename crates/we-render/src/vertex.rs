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

/// A vertex for lane line rendering with dash pattern support.
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
    fn test_line_vertex_size() {
        assert_eq!(std::mem::size_of::<LineVertex>(), 48); // 12 + 8 + 16 + 8 + 4
    }
}
