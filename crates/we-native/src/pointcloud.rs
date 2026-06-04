//! Large-scale point cloud loading (native only).
//!
//! Provides desktop file loading for point clouds. Lightweight ASCII/binary
//! formats (PCD, PLY, XYZ) are parsed by the platform-agnostic `we-core`
//! parsers; heavy LiDAR formats (LAS/LAZ) are read with the `las` crate behind
//! the `pointcloud` feature. All loaders produce a [`we_core::pointcloud::PointCloud`].

use std::path::Path;

use thiserror::Error;
use we_core::pointcloud::{PointCloud, pcd, ply, xyz};

/// Errors produced while loading a point cloud from disk.
#[derive(Error, Debug)]
pub enum LoadError {
    /// The file could not be read.
    #[error("I/O error reading point cloud: {0}")]
    Io(String),
    /// The file extension was not recognized.
    #[error("unsupported point cloud extension: {0}")]
    UnsupportedExtension(String),
    /// A parser rejected the file contents.
    #[error("failed to parse point cloud: {0}")]
    Parse(String),
}

/// Result alias for native point cloud loading.
pub type LoadResult<T> = Result<T, LoadError>;

/// Load any supported point cloud file, dispatching by extension.
///
/// Supported: `.pcd`, `.ply`, `.xyz`/`.txt`/`.asc`, and (with the `pointcloud`
/// feature) `.las`/`.laz`. When `voxel_size` is `Some`, the result is
/// voxel-downsampled to bound memory and rendering cost.
pub fn load_point_cloud(path: &Path, voxel_size: Option<f64>) -> LoadResult<PointCloud> {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let cloud = match ext.as_str() {
        "pcd" => {
            let bytes = read_bytes(path)?;
            pcd::parse_pcd(&bytes).map_err(|e| LoadError::Parse(e.to_string()))?
        }
        "ply" => {
            let bytes = read_bytes(path)?;
            ply::parse_ply(&bytes).map_err(|e| LoadError::Parse(e.to_string()))?
        }
        "xyz" | "txt" | "asc" => {
            let bytes = read_bytes(path)?;
            xyz::parse_xyz(&bytes).map_err(|e| LoadError::Parse(e.to_string()))?
        }
        "las" | "laz" => load_las(path)?,
        other => return Err(LoadError::UnsupportedExtension(other.to_string())),
    };

    Ok(match voxel_size {
        Some(size) if size > 0.0 => cloud.voxel_downsample(size),
        _ => cloud,
    })
}

/// Load every supported point cloud in a directory and merge them into one
/// cloud (tiled datasets). Sub-clouds keep a shared origin from the first tile.
pub fn load_point_cloud_dir(dir: &Path, voxel_size: Option<f64>) -> LoadResult<PointCloud> {
    let entries = std::fs::read_dir(dir).map_err(|e| LoadError::Io(e.to_string()))?;
    let mut merged: Option<PointCloud> = None;

    for entry in entries {
        let entry = entry.map_err(|e| LoadError::Io(e.to_string()))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(
            ext.as_str(),
            "pcd" | "ply" | "xyz" | "txt" | "asc" | "las" | "laz"
        ) {
            continue;
        }
        // Load each tile without downsampling, merge, then downsample once.
        let tile = load_point_cloud(&path, None)?;
        merged = Some(match merged {
            None => tile,
            Some(acc) => merge_clouds(acc, &tile),
        });
    }

    let cloud = merged.unwrap_or_default();
    Ok(match voxel_size {
        Some(size) if size > 0.0 => cloud.voxel_downsample(size),
        _ => cloud,
    })
}

/// Merge `other` into `base`, rebasing `other`'s points onto `base`'s origin.
fn merge_clouds(mut base: PointCloud, other: &PointCloud) -> PointCloud {
    let base_origin = base.origin();
    let other_origin = other.origin();
    let shift = [
        other_origin[0] - base_origin[0],
        other_origin[1] - base_origin[1],
        other_origin[2] - base_origin[2],
    ];
    base.reserve(other.len());
    for i in 0..other.len() {
        if let Some(p) = other.point(i) {
            base.push(
                [p[0] + shift[0], p[1] + shift[1], p[2] + shift[2]],
                other.intensity(i),
                other.color(i),
            );
        }
    }
    base
}

fn read_bytes(path: &Path) -> LoadResult<Vec<u8>> {
    std::fs::read(path).map_err(|e| LoadError::Io(e.to_string()))
}

/// A decoded LAS/LAZ point: local position, normalized intensity, optional RGB.
#[cfg(feature = "pointcloud")]
type LasRecord = ([f64; 3], Option<f32>, Option<[u8; 3]>);

#[cfg(feature = "pointcloud")]
fn load_las(path: &Path) -> LoadResult<PointCloud> {
    use las::Reader;

    let mut reader = Reader::from_path(path).map_err(|e| LoadError::Parse(e.to_string()))?;

    let mut origin: Option<[f64; 3]> = None;
    let mut records: Vec<LasRecord> = Vec::new();

    for point in reader.points() {
        let p = point.map_err(|e| LoadError::Parse(e.to_string()))?;
        let o = *origin.get_or_insert([p.x, p.y, p.z]);
        // Normalize 16-bit LAS intensity to 0..1.
        let intensity = Some(p.intensity as f32 / u16::MAX as f32);
        let rgb = p.color.map(|c| {
            [
                (c.red >> 8) as u8,
                (c.green >> 8) as u8,
                (c.blue >> 8) as u8,
            ]
        });
        records.push(([p.x - o[0], p.y - o[1], p.z - o[2]], intensity, rgb));
    }

    let mut cloud = PointCloud::with_origin(origin.unwrap_or([0.0; 3]));
    cloud.reserve(records.len());
    for (local, intensity, rgb) in records {
        cloud.push(local, intensity, rgb);
    }
    Ok(cloud)
}

#[cfg(not(feature = "pointcloud"))]
fn load_las(_path: &Path) -> LoadResult<PointCloud> {
    Err(LoadError::UnsupportedExtension(
        "las/laz requires the 'pointcloud' feature".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_file(name: &str, contents: &[u8]) -> std::path::PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("we_native_pc_test_{name}"));
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(contents).unwrap();
        path
    }

    #[test]
    fn test_load_xyz_file() {
        let path = temp_file("a.xyz", b"0 0 0\n1 2 3\n4 5 6\n");
        let cloud = load_point_cloud(&path, None).unwrap();
        assert_eq!(cloud.len(), 3);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_unsupported_extension() {
        let path = temp_file("a.bin", b"\x00\x01");
        let err = load_point_cloud(&path, None).unwrap_err();
        assert!(matches!(err, LoadError::UnsupportedExtension(_)));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_voxel_downsample_applied() {
        // Two near-identical points collapse under a coarse voxel.
        let path = temp_file("b.xyz", b"0 0 0\n0.01 0.01 0.0\n");
        let cloud = load_point_cloud(&path, Some(1.0)).unwrap();
        assert_eq!(cloud.len(), 1);
        let _ = std::fs::remove_file(&path);
    }

    #[cfg(not(feature = "pointcloud"))]
    #[test]
    fn test_las_requires_feature() {
        let path = temp_file("c.las", b"not really las");
        let err = load_point_cloud(&path, None).unwrap_err();
        assert!(matches!(err, LoadError::UnsupportedExtension(_)));
        let _ = std::fs::remove_file(&path);
    }
}
