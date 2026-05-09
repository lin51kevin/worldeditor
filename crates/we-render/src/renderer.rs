//! Main renderer — orchestrates frame rendering.

use crate::camera::Camera;
use crate::gpu::GpuContext;
use crate::pipeline::{BasicUniforms, GridUniforms, LaneLineUniforms, Pipelines};
use crate::vertex::{ColorVertex, LineVertex};
use nalgebra::Matrix4;
use wgpu::util::DeviceExt;

/// The main renderer that manages GPU resources and draws frames.
pub struct Renderer {
    pub gpu: GpuContext,
    pipelines: Pipelines,
    depth_texture: wgpu::TextureView,
    grid_uniform_buffer: wgpu::Buffer,
    grid_bind_group: wgpu::BindGroup,
    basic_uniform_buffer: wgpu::Buffer,
    basic_bind_group: wgpu::BindGroup,
    lane_line_uniform_buffer: wgpu::Buffer,
    lane_line_bind_group: wgpu::BindGroup,
    width: u32,
    height: u32,
}

impl Renderer {
    /// Create a new renderer for a given surface format and size.
    pub fn new(
        gpu: GpuContext,
        surface_format: wgpu::TextureFormat,
        width: u32,
        height: u32,
    ) -> Self {
        let pipelines = Pipelines::new(&gpu, surface_format);
        let depth_texture = Self::create_depth_texture(&gpu.device, width, height);

        let grid_uniform_buffer =
            gpu.device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("grid_uniforms"),
                    contents: bytemuck::cast_slice(&[GridUniforms {
                        view_proj: identity_matrix(),
                        camera_pos: [0.0, 0.0, 50.0],
                        grid_scale: 10.0,
                    }]),
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                });

        let grid_bind_group = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("grid_bind_group"),
            layout: &pipelines.grid_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: grid_uniform_buffer.as_entire_binding(),
            }],
        });

        let basic_uniform_buffer =
            gpu.device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("basic_uniforms"),
                    contents: bytemuck::cast_slice(&[BasicUniforms {
                        view_proj: identity_matrix(),
                        model: identity_matrix(),
                    }]),
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                });

        let basic_bind_group = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("basic_bind_group"),
            layout: &pipelines.basic_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: basic_uniform_buffer.as_entire_binding(),
            }],
        });

        let lane_line_uniform_buffer =
            gpu.device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("lane_line_uniforms"),
                    contents: bytemuck::cast_slice(&[LaneLineUniforms {
                        view_proj: identity_matrix(),
                        model: identity_matrix(),
                    }]),
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                });

        let lane_line_bind_group = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("lane_line_bind_group"),
            layout: &pipelines.lane_line_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: lane_line_uniform_buffer.as_entire_binding(),
            }],
        });

        Self {
            gpu,
            pipelines,
            depth_texture,
            grid_uniform_buffer,
            grid_bind_group,
            basic_uniform_buffer,
            basic_bind_group,
            lane_line_uniform_buffer,
            lane_line_bind_group,
            width,
            height,
        }
    }

    /// Resize the rendering viewport.
    pub fn resize(&mut self, width: u32, height: u32) {
        if width > 0 && height > 0 {
            self.width = width;
            self.height = height;
            self.depth_texture = Self::create_depth_texture(&self.gpu.device, width, height);
        }
    }

    /// Render a frame to the given texture view.
    pub fn render_frame(&self, target: &wgpu::TextureView, camera: &Camera, meshes: &[RenderMesh]) {
        let view_proj = self.compute_view_proj(camera);

        // Update grid uniforms
        self.gpu.queue.write_buffer(
            &self.grid_uniform_buffer,
            0,
            bytemuck::cast_slice(&[GridUniforms {
                view_proj: mat4_to_array(&view_proj),
                camera_pos: [
                    camera.position.x as f32,
                    camera.position.y as f32,
                    camera.position.z as f32,
                ],
                grid_scale: 10.0,
            }]),
        );

        let mut encoder = self
            .gpu
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("render_encoder"),
            });

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("main_render_pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.12,
                            g: 0.12,
                            b: 0.14,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth_texture,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            // Draw grid
            render_pass.set_pipeline(&self.pipelines.grid);
            render_pass.set_bind_group(0, &self.grid_bind_group, &[]);
            render_pass.draw(0..6, 0..1);

            // Draw meshes
            if !meshes.is_empty() {
                render_pass.set_pipeline(&self.pipelines.basic);
                render_pass.set_bind_group(0, &self.basic_bind_group, &[]);

                for mesh in meshes {
                    // Update model matrix for each mesh
                    self.gpu.queue.write_buffer(
                        &self.basic_uniform_buffer,
                        0,
                        bytemuck::cast_slice(&[BasicUniforms {
                            view_proj: mat4_to_array(&view_proj),
                            model: mesh.model_matrix,
                        }]),
                    );
                    render_pass.set_vertex_buffer(0, mesh.vertex_buffer.slice(..));
                    render_pass.draw(0..mesh.vertex_count, 0..1);
                }
            }
        }

        self.gpu.queue.submit(std::iter::once(encoder.finish()));
    }

    /// Render road meshes with optional lane line overlay.
    pub fn render_road_with_lane_lines(
        &self,
        target: &wgpu::TextureView,
        camera: &Camera,
        meshes: &[RenderMesh],
        lane_line_mesh: Option<&LaneLineMesh>,
    ) {
        let view_proj = self.compute_view_proj(camera);

        // Update grid uniforms
        self.gpu.queue.write_buffer(
            &self.grid_uniform_buffer,
            0,
            bytemuck::cast_slice(&[GridUniforms {
                view_proj: mat4_to_array(&view_proj),
                camera_pos: [
                    camera.position.x as f32,
                    camera.position.y as f32,
                    camera.position.z as f32,
                ],
                grid_scale: 10.0,
            }]),
        );

        let mut encoder = self
            .gpu
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("render_encoder"),
            });

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("main_render_pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.12,
                            g: 0.12,
                            b: 0.14,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth_texture,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            // Draw grid
            render_pass.set_pipeline(&self.pipelines.grid);
            render_pass.set_bind_group(0, &self.grid_bind_group, &[]);
            render_pass.draw(0..6, 0..1);

            // Draw road meshes (road surface)
            // Render order: road surface → marking → lane line → object → signal
            if !meshes.is_empty() {
                render_pass.set_pipeline(&self.pipelines.basic);
                render_pass.set_bind_group(0, &self.basic_bind_group, &[]);

                for mesh in meshes {
                    self.gpu.queue.write_buffer(
                        &self.basic_uniform_buffer,
                        0,
                        bytemuck::cast_slice(&[BasicUniforms {
                            view_proj: mat4_to_array(&view_proj),
                            model: mesh.model_matrix,
                        }]),
                    );
                    render_pass.set_vertex_buffer(0, mesh.vertex_buffer.slice(..));
                    render_pass.draw(0..mesh.vertex_count, 0..1);
                }
            }

            // Draw lane lines
            if let Some(ll_mesh) = lane_line_mesh {
                render_pass.set_pipeline(&self.pipelines.lane_line);
                render_pass.set_bind_group(0, &self.lane_line_bind_group, &[]);
                self.gpu.queue.write_buffer(
                    &self.lane_line_uniform_buffer,
                    0,
                    bytemuck::cast_slice(&[LaneLineUniforms {
                        view_proj: mat4_to_array(&view_proj),
                        model: ll_mesh.model_matrix,
                    }]),
                );
                render_pass.set_vertex_buffer(0, ll_mesh.vertex_buffer.slice(..));
                render_pass.draw(0..ll_mesh.vertex_count, 0..1);
            }
        }

        self.gpu.queue.submit(std::iter::once(encoder.finish()));
    }

    fn compute_view_proj(&self, camera: &Camera) -> Matrix4<f32> {
        let view = camera.view_matrix().cast::<f32>();
        let proj = match camera.projection {
            crate::camera::ProjectionMode::Perspective { fov_y, near, far } => {
                Matrix4::new_perspective(
                    camera.aspect_ratio as f32,
                    fov_y as f32,
                    near as f32,
                    far as f32,
                )
            }
            crate::camera::ProjectionMode::Orthographic { scale, near, far } => {
                let half_w = (scale * camera.aspect_ratio) as f32;
                let half_h = scale as f32;
                Matrix4::new_orthographic(-half_w, half_w, -half_h, half_h, near as f32, far as f32)
            }
        };
        // wgpu uses a [0,1] depth range (not [-1,1] like OpenGL)
        let correction = Matrix4::new(
            1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0, 1.0,
        );
        correction * proj * view
    }

    fn create_depth_texture(device: &wgpu::Device, width: u32, height: u32) -> wgpu::TextureView {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("depth_texture"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Depth32Float,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        texture.create_view(&wgpu::TextureViewDescriptor::default())
    }
}

/// A mesh ready for rendering.
pub struct RenderMesh {
    pub vertex_buffer: wgpu::Buffer,
    pub vertex_count: u32,
    pub model_matrix: [[f32; 4]; 4],
}

impl RenderMesh {
    /// Create a mesh from vertices.
    pub fn from_vertices(
        device: &wgpu::Device,
        vertices: &[ColorVertex],
        model_matrix: [[f32; 4]; 4],
    ) -> Self {
        let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("mesh_vertex_buffer"),
            contents: bytemuck::cast_slice(vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });
        Self {
            vertex_buffer,
            vertex_count: vertices.len() as u32,
            model_matrix,
        }
    }
}

/// A lane-line mesh ready for rendering (uses LineVertex with dash pattern).
pub struct LaneLineMesh {
    pub vertex_buffer: wgpu::Buffer,
    pub vertex_count: u32,
    pub model_matrix: [[f32; 4]; 4],
}

impl LaneLineMesh {
    /// Create a lane line mesh from LineVertex vertices.
    pub fn from_vertices(
        device: &wgpu::Device,
        vertices: &[LineVertex],
        model_matrix: [[f32; 4]; 4],
    ) -> Self {
        let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("lane_line_vertex_buffer"),
            contents: bytemuck::cast_slice(vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });
        Self {
            vertex_buffer,
            vertex_count: vertices.len() as u32,
            model_matrix,
        }
    }
}

/// Convert a nalgebra Matrix4 to a 4x4 f32 array (column-major).
fn mat4_to_array(m: &Matrix4<f32>) -> [[f32; 4]; 4] {
    let s = m.as_slice();
    [
        [s[0], s[1], s[2], s[3]],
        [s[4], s[5], s[6], s[7]],
        [s[8], s[9], s[10], s[11]],
        [s[12], s[13], s[14], s[15]],
    ]
}

/// Identity matrix as a 4x4 f32 array.
fn identity_matrix() -> [[f32; 4]; 4] {
    [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identity_matrix() {
        let id = identity_matrix();
        assert_eq!(id[0][0], 1.0);
        assert_eq!(id[1][1], 1.0);
        assert_eq!(id[2][2], 1.0);
        assert_eq!(id[3][3], 1.0);
        assert_eq!(id[0][1], 0.0);
    }

    #[test]
    fn test_mat4_to_array_identity() {
        let m = Matrix4::<f32>::identity();
        let arr = mat4_to_array(&m);
        assert_eq!(arr, identity_matrix());
    }

    #[test]
    fn test_mat4_to_array_translation() {
        let m = Matrix4::new_translation(&nalgebra::Vector3::new(1.0_f32, 2.0, 3.0));
        let arr = mat4_to_array(&m);
        // Column-major: translation is in the 4th column
        assert_eq!(arr[3][0], 1.0);
        assert_eq!(arr[3][1], 2.0);
        assert_eq!(arr[3][2], 3.0);
    }
}
