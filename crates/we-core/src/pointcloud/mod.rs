//! Point cloud import, processing, and vectorization.
//!
//! This module is platform-agnostic and WASM-compatible. It provides:
//! - [`model::PointCloud`] — the core container with voxel downsampling.
//! - Format parsers for PCD, PLY, and XYZ (pure Rust, no native deps).
//! - Ground extraction ([`ground`]) and a sampleable [`heightmap::Heightmap`].
//!
//! Heavy native formats (LAS/LAZ) and memory-mapped streaming live in the
//! desktop-only `we-native` crate, which produces a [`model::PointCloud`].

pub mod ground;
pub mod gaussian;
pub mod heightmap;
pub mod markings;
pub mod model;
pub mod pcd;
pub mod ply;
pub mod render;
pub mod vectorize;
pub mod xyz;

pub use ground::{GroundConfig, GroundResult, extract_ground};
pub use gaussian::{
    GaussianCloud, PackedGaussians, parse_gaussian_ply, parse_gaussian_ply_capped,
    parse_gaussian_ply_packed_f16,
};
pub use heightmap::Heightmap;
pub use markings::{MarkingConfig, extract_markings};
pub use model::{Aabb, PointCloud};
pub use render::{ColorMode, build_render_buffer};
pub use vectorize::{VectorizeConfig, polyline_to_road, polylines_to_roads};

use thiserror::Error;

/// Errors produced while parsing point cloud files.
#[derive(Error, Debug)]
pub enum PointCloudError {
    /// The file header was missing a required field or was malformed.
    #[error("Invalid point cloud header: {0}")]
    InvalidHeader(String),
    /// A data record could not be parsed.
    #[error("Invalid point cloud data: {0}")]
    InvalidData(String),
    /// The file used a feature this parser does not support.
    #[error("Unsupported point cloud format: {0}")]
    Unsupported(String),
}

/// Result alias for point cloud operations.
pub type PointCloudResult<T> = Result<T, PointCloudError>;

/// A decoded point record: `(x, y, z, intensity, rgb)` in world coordinates,
/// used internally by the format parsers before origin shifting.
pub(crate) type RawRecord = (f64, f64, f64, Option<f32>, Option<[u8; 3]>);
