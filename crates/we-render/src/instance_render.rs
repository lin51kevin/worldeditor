//! GPU-instanced rendering for dense object scenes.
//!
//! Instead of generating unique vertices for every road object (sign, cone,
//! guardrail segment, etc.), this module collects per-instance transforms and
//! renders all objects of the same type with a single instanced draw call.
//!
//! This reduces draw calls from O(N) to O(types) and vertex buffer size from
//! O(N × vertices_per_object) to O(vertices_per_prototype + N × instance_data).

use bytemuck::{Pod, Zeroable};
use std::collections::HashMap;

/// Per-instance data sent to the GPU.
///
/// Each instance has a model transform (4×4 matrix stored as 4 column vectors)
/// and a color override. The vertex shader multiplies the prototype vertex
/// positions by this transform.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct InstanceData {
    /// Model matrix columns 0..3.  Laid out as 4 × vec4 for shader compatibility.
    pub model_col0: [f32; 4],
    pub model_col1: [f32; 4],
    pub model_col2: [f32; 4],
    pub model_col3: [f32; 4],
    /// Per-instance RGBA color (overrides or modulates prototype color).
    pub color: [f32; 4],
}

impl InstanceData {
    /// Vertex buffer layout for instanced attributes (locations 2-6).
    ///
    /// Slot 0 holds per-vertex data ([`super::vertex::ColorVertex`]), slot 1
    /// holds this per-instance data.
    pub const LAYOUT: wgpu::VertexBufferLayout<'static> = wgpu::VertexBufferLayout {
        array_stride: std::mem::size_of::<InstanceData>() as wgpu::BufferAddress,
        step_mode: wgpu::VertexStepMode::Instance,
        attributes: &[
            // model_col0
            wgpu::VertexAttribute {
                offset: 0,
                shader_location: 2,
                format: wgpu::VertexFormat::Float32x4,
            },
            // model_col1
            wgpu::VertexAttribute {
                offset: 16,
                shader_location: 3,
                format: wgpu::VertexFormat::Float32x4,
            },
            // model_col2
            wgpu::VertexAttribute {
                offset: 32,
                shader_location: 4,
                format: wgpu::VertexFormat::Float32x4,
            },
            // model_col3
            wgpu::VertexAttribute {
                offset: 48,
                shader_location: 5,
                format: wgpu::VertexFormat::Float32x4,
            },
            // color
            wgpu::VertexAttribute {
                offset: 64,
                shader_location: 6,
                format: wgpu::VertexFormat::Float32x4,
            },
        ],
    };

    /// Create an instance at `(x, y, z)` with heading rotation and uniform scale.
    pub fn from_transform(
        x: f32,
        y: f32,
        z: f32,
        heading: f32,
        scale: f32,
        color: [f32; 4],
    ) -> Self {
        let cos_h = heading.cos() * scale;
        let sin_h = heading.sin() * scale;
        Self {
            model_col0: [cos_h, sin_h, 0.0, 0.0],
            model_col1: [-sin_h, cos_h, 0.0, 0.0],
            model_col2: [0.0, 0.0, scale, 0.0],
            model_col3: [x, y, z, 1.0],
            color,
        }
    }

    /// Identity transform at the origin with the given color.
    pub fn identity(color: [f32; 4]) -> Self {
        Self {
            model_col0: [1.0, 0.0, 0.0, 0.0],
            model_col1: [0.0, 1.0, 0.0, 0.0],
            model_col2: [0.0, 0.0, 1.0, 0.0],
            model_col3: [0.0, 0.0, 0.0, 1.0],
            color,
        }
    }
}

/// Key for grouping objects by prototype shape.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum PrototypeKind {
    /// Unit box — scaled per instance.
    Box,
    /// Vertical post/pole.
    Pole,
    /// Flat quad on the ground plane.
    GroundQuad,
    /// Custom named prototype.
    Custom(String),
}

/// A batch of instances sharing the same prototype geometry.
#[derive(Debug, Clone)]
pub struct InstanceBatch {
    /// Which prototype mesh to use.
    pub kind: PrototypeKind,
    /// Per-instance transforms and colors.
    pub instances: Vec<InstanceData>,
}

/// Collects objects into instanced batches keyed by prototype kind.
#[derive(Debug, Default)]
pub struct InstanceCollector {
    batches: HashMap<PrototypeKind, Vec<InstanceData>>,
}

impl InstanceCollector {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add an instance to the appropriate batch.
    pub fn add(&mut self, kind: PrototypeKind, instance: InstanceData) {
        self.batches.entry(kind).or_default().push(instance);
    }

    /// Add a box instance at the given position and orientation.
    pub fn add_box(
        &mut self,
        x: f32,
        y: f32,
        z: f32,
        heading: f32,
        width: f32,
        height: f32,
        depth: f32,
        color: [f32; 4],
    ) {
        // Use the largest dimension as the uniform scale factor,
        // then encode the relative proportions in the instance matrix.
        let cos_h = heading.cos();
        let sin_h = heading.sin();
        let hw = width / 2.0;
        let hh = height / 2.0;
        let hd = depth / 2.0;
        let instance = InstanceData {
            model_col0: [cos_h * hw, sin_h * hw, 0.0, 0.0],
            model_col1: [-sin_h * hd, cos_h * hd, 0.0, 0.0],
            model_col2: [0.0, 0.0, hh, 0.0],
            model_col3: [x, y, z, 1.0],
            color,
        };
        self.batches
            .entry(PrototypeKind::Box)
            .or_default()
            .push(instance);
    }

    /// Add a ground quad (flat decal on the road surface).
    pub fn add_ground_quad(
        &mut self,
        x: f32,
        y: f32,
        z: f32,
        heading: f32,
        width: f32,
        length: f32,
        color: [f32; 4],
    ) {
        let cos_h = heading.cos();
        let sin_h = heading.sin();
        let hw = width / 2.0;
        let hl = length / 2.0;
        let instance = InstanceData {
            model_col0: [cos_h * hw, sin_h * hw, 0.0, 0.0],
            model_col1: [-sin_h * hl, cos_h * hl, 0.0, 0.0],
            model_col2: [0.0, 0.0, 1.0, 0.0],
            model_col3: [x, y, z + 0.01, 1.0], // slight Z bias to avoid z-fighting
            color,
        };
        self.batches
            .entry(PrototypeKind::GroundQuad)
            .or_default()
            .push(instance);
    }

    /// Drain all batches into a vec.
    pub fn into_batches(self) -> Vec<InstanceBatch> {
        self.batches
            .into_iter()
            .map(|(kind, instances)| InstanceBatch { kind, instances })
            .collect()
    }

    /// Total number of instances across all batches.
    pub fn total_instances(&self) -> usize {
        self.batches.values().map(|v| v.len()).sum()
    }

    /// Check if there are any instances.
    pub fn is_empty(&self) -> bool {
        self.batches.is_empty()
    }
}

/// Generate the unit-box prototype vertices (8 corners, 36 indices for 12 triangles).
///
/// The box spans `[-1, 1]` on each axis. The instance transform scales and
/// positions it in world space.
pub fn unit_box_vertices() -> (Vec<[f32; 3]>, Vec<u32>) {
    let positions = vec![
        [-1.0, -1.0, -1.0], // 0
        [1.0, -1.0, -1.0],  // 1
        [1.0, 1.0, -1.0],   // 2
        [-1.0, 1.0, -1.0],  // 3
        [-1.0, -1.0, 1.0],  // 4
        [1.0, -1.0, 1.0],   // 5
        [1.0, 1.0, 1.0],    // 6
        [-1.0, 1.0, 1.0],   // 7
    ];

    let indices = vec![
        // Back
        0, 1, 2, 0, 2, 3, // Front
        4, 6, 5, 4, 7, 6, // Left
        0, 3, 7, 0, 7, 4, // Right
        1, 5, 6, 1, 6, 2, // Top
        3, 2, 6, 3, 6, 7, // Bottom
        0, 4, 5, 0, 5, 1,
    ];

    (positions, indices)
}

/// Generate the ground-quad prototype vertices (4 corners, 6 indices for 2 triangles).
///
/// Lies flat on the XY plane at Z=0, spanning `[-1, 1]` on X and Y.
pub fn ground_quad_vertices() -> (Vec<[f32; 3]>, Vec<u32>) {
    let positions = vec![
        [-1.0, -1.0, 0.0],
        [1.0, -1.0, 0.0],
        [1.0, 1.0, 0.0],
        [-1.0, 1.0, 0.0],
    ];
    let indices = vec![0, 1, 2, 0, 2, 3];
    (positions, indices)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_instance_data_from_transform() {
        let inst = InstanceData::from_transform(10.0, 20.0, 0.0, 0.0, 1.0, [1.0; 4]);
        // No rotation: col0 should be [1, 0, 0, 0]
        assert!((inst.model_col0[0] - 1.0).abs() < 1e-6);
        assert!((inst.model_col0[1]).abs() < 1e-6);
        // Translation in col3
        assert!((inst.model_col3[0] - 10.0).abs() < 1e-6);
        assert!((inst.model_col3[1] - 20.0).abs() < 1e-6);
    }

    #[test]
    fn test_instance_collector_batching() {
        let mut collector = InstanceCollector::new();
        collector.add_box(0.0, 0.0, 0.0, 0.0, 2.0, 3.0, 1.0, [1.0; 4]);
        collector.add_box(5.0, 5.0, 0.0, 1.57, 2.0, 3.0, 1.0, [1.0; 4]);
        collector.add_ground_quad(10.0, 10.0, 0.0, 0.0, 4.0, 6.0, [1.0; 4]);

        assert_eq!(collector.total_instances(), 3);

        let batches = collector.into_batches();
        assert_eq!(batches.len(), 2); // Box + GroundQuad
    }

    #[test]
    fn test_unit_box_vertices() {
        let (positions, indices) = unit_box_vertices();
        assert_eq!(positions.len(), 8);
        assert_eq!(indices.len(), 36);
    }

    #[test]
    fn test_ground_quad_vertices() {
        let (positions, indices) = ground_quad_vertices();
        assert_eq!(positions.len(), 4);
        assert_eq!(indices.len(), 6);
    }

    #[test]
    fn test_empty_collector() {
        let collector = InstanceCollector::new();
        assert!(collector.is_empty());
        assert_eq!(collector.total_instances(), 0);
    }

    #[test]
    fn test_identity_instance() {
        let inst = InstanceData::identity([1.0, 0.0, 0.0, 1.0]);
        assert!((inst.model_col0[0] - 1.0).abs() < 1e-6);
        assert!((inst.model_col1[1] - 1.0).abs() < 1e-6);
        assert!((inst.model_col2[2] - 1.0).abs() < 1e-6);
        assert!((inst.model_col3[3] - 1.0).abs() < 1e-6);
    }
}
