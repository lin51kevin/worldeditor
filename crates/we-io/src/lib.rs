//! WorldEditor I/O abstraction layer.
//!
//! Provides platform-agnostic file system traits with implementations
//! for native (tokio fs), web (IndexedDB), and cloud (S3/OSS) backends.

pub mod traits;

#[cfg(not(target_arch = "wasm32"))]
pub mod native;

#[cfg(target_arch = "wasm32")]
pub mod web;
