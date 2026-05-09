//! S3/OSS storage backend.
//!
//! Uses `aws-sdk-s3` for AWS S3 or compatible object storage.

use async_trait::async_trait;
use std::error::Error as StdError;

use crate::storage::StorageBackend;

pub struct S3Storage {
    // TODO: implement S3 client
}

#[async_trait]
impl StorageBackend for S3Storage {
    async fn put(&self, _name: &str, _data: &[u8]) -> Result<String, Box<dyn StdError>> {
        todo!("Implement S3 upload")
    }

    async fn get(&self, _key: &str) -> Result<Vec<u8>, Box<dyn StdError>> {
        todo!("Implement S3 download")
    }

    async fn delete(&self, _key: &str) -> Result<(), Box<dyn StdError>> {
        todo!("Implement S3 delete")
    }
}
