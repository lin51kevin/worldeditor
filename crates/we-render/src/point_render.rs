//! Point cloud render-mesh construction.
//!
//! Converts the interleaved `[x, y, z, r, g, b]` buffer produced by
//! `we_core::pointcloud::build_render_buffer` into [`PointVertex`] data ready
//! for GPU upload via the `point` pipeline.

use crate::vertex::PointVertex;

/// Build [`PointVertex`] data from an interleaved `[x, y, z, r, g, b, ...]`
/// buffer. Any trailing partial vertex (length not a multiple of 6) is ignored.
pub fn build_point_vertices(buffer: &[f32]) -> Vec<PointVertex> {
    buffer
        .chunks_exact(6)
        .map(|c| PointVertex::new([c[0], c[1], c[2]], [c[3], c[4], c[5]]))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_point_vertices_basic() {
        let buf = [0.0, 1.0, 2.0, 0.5, 0.6, 0.7];
        let verts = build_point_vertices(&buf);
        assert_eq!(verts.len(), 1);
        assert_eq!(verts[0].position, [0.0, 1.0, 2.0]);
        assert_eq!(verts[0].color, [0.5, 0.6, 0.7]);
    }

    #[test]
    fn test_build_point_vertices_ignores_partial_tail() {
        let buf = [0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 9.0, 9.0];
        let verts = build_point_vertices(&buf);
        assert_eq!(verts.len(), 1);
    }

    #[test]
    fn test_build_point_vertices_empty() {
        assert!(build_point_vertices(&[]).is_empty());
    }
}
