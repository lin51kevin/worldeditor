//! WorldEditor native-only features.
//!
//! This crate contains functionality that depends on native system libraries
//! and cannot be compiled to WASM:
//! - GDAL bindings for geospatial I/O
//! - Large-scale point cloud processing (memory-mapped files)
//! - FBX SDK FFI

pub mod pointcloud;
