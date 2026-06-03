//! WorldEditor native-only features.
//!
//! This crate contains functionality that depends on native system libraries
//! and cannot be compiled to WASM:
//! - GDAL bindings for geospatial I/O
//! - Large-scale point cloud processing (memory-mapped files)
//! - FBX SDK FFI

#[cfg(feature = "pointcloud")]
pub mod pointcloud;

#[cfg(all(test, feature = "pointcloud"))]
mod tests {
    use crate::pointcloud::PointCloudLoader;
    use std::mem::size_of_val;

    #[test]
    fn test_crate_root_exposes_pointcloud_loader() {
        let loader = PointCloudLoader::new();

        assert_eq!(size_of_val(&loader), 0);
    }
}
