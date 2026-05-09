use async_trait::async_trait;
use std::error::Error as StdError;

pub mod s3;

#[async_trait]
pub trait StorageBackend: Send + Sync + 'static {
    async fn put(&self, name: &str, data: &[u8]) -> Result<String, Box<dyn StdError>>;
    async fn get(&self, key: &str) -> Result<Vec<u8>, Box<dyn StdError>>;
    async fn delete(&self, key: &str) -> Result<(), Box<dyn StdError>>;
}

#[derive(Clone)]
pub struct LocalStorage {
    base_path: std::path::PathBuf,
}

impl LocalStorage {
    pub fn new(base_path: impl Into<std::path::PathBuf>) -> Self {
        Self {
            base_path: base_path.into(),
        }
    }
}

#[async_trait]
impl StorageBackend for LocalStorage {
    async fn put(&self, name: &str, data: &[u8]) -> Result<String, Box<dyn StdError>> {
        let key = uuid::Uuid::new_v4().to_string();
        let path = self.base_path.join(&key);
        tokio::fs::write(&path, data).await?;
        Ok(key)
    }

    async fn get(&self, key: &str) -> Result<Vec<u8>, Box<dyn StdError>> {
        let path = self.base_path.join(key);
        let data = tokio::fs::read(&path).await?;
        Ok(data)
    }

    async fn delete(&self, key: &str) -> Result<(), Box<dyn StdError>> {
        let path = self.base_path.join(key);
        tokio::fs::remove_file(&path).await?;
        Ok(())
    }
}
