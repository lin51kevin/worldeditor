//! S3/OSS storage backend.
//!
//! Uses `aws-sdk-s3` for AWS S3 or compatible object storage.

use async_trait::async_trait;
use std::error::Error as StdError;

use crate::storage::StorageBackend;

/// S3 storage backend — not yet implemented.
/// Enable with `cargo run --features server-s3` once implemented.
pub struct S3Storage {
    _private: (),
}

#[async_trait]
impl StorageBackend for S3Storage {
    async fn put(&self, _name: &str, _data: &[u8]) -> Result<String, Box<dyn StdError>> {
        Err("S3 storage is not yet implemented".into())
    }

    async fn get(&self, _key: &str) -> Result<Vec<u8>, Box<dyn StdError>> {
        Err("S3 storage is not yet implemented".into())
    }

    async fn delete(&self, _key: &str) -> Result<(), Box<dyn StdError>> {
        Err("S3 storage is not yet implemented".into())
    }
}
