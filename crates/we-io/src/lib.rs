//! WorldEditor I/O abstraction layer.
//!
//! Provides platform-agnostic file system traits with implementations
//! for native (tokio fs), web (IndexedDB), and cloud (S3/OSS) backends.
//! Also contains format-specific import/export modules.

pub mod csv_io;
pub mod dxf_io;
pub mod mif_io;
pub mod nio_proto;
pub mod obj_export;
pub mod shapefile_io;
pub mod signal_json;
#[cfg(feature = "sumo")]
pub mod sumo;
pub mod traits;

#[cfg(not(target_arch = "wasm32"))]
pub mod native;

#[cfg(target_arch = "wasm32")]
pub mod web;
