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
    async fn put(&self, _name: &str, data: &[u8]) -> Result<String, Box<dyn StdError>> {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_storage() -> (LocalStorage, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let storage = LocalStorage::new(dir.path());
        (storage, dir)
    }

    #[tokio::test]
    async fn test_put_get_roundtrip() {
        let (storage, _dir) = temp_storage();
        let key = storage.put("test.txt", b"hello world").await.unwrap();
        let data = storage.get(&key).await.unwrap();
        assert_eq!(data, b"hello world");
    }

    #[tokio::test]
    async fn test_put_returns_unique_keys() {
        let (storage, _dir) = temp_storage();
        let k1 = storage.put("a", b"data1").await.unwrap();
        let k2 = storage.put("b", b"data2").await.unwrap();
        assert_ne!(k1, k2);
    }

    #[tokio::test]
    async fn test_delete_removes_file() {
        let (storage, _dir) = temp_storage();
        let key = storage.put("f", b"content").await.unwrap();
        storage.delete(&key).await.unwrap();
        assert!(storage.get(&key).await.is_err());
    }

    #[tokio::test]
    async fn test_get_missing_key_errors() {
        let (storage, _dir) = temp_storage();
        assert!(storage.get("nonexistent").await.is_err());
    }

    #[tokio::test]
    async fn test_delete_missing_key_errors() {
        let (storage, _dir) = temp_storage();
        assert!(storage.delete("nonexistent").await.is_err());
    }

    #[tokio::test]
    async fn test_put_empty_data() {
        let (storage, _dir) = temp_storage();
        let key = storage.put("empty", b"").await.unwrap();
        let data = storage.get(&key).await.unwrap();
        assert!(data.is_empty());
    }

    #[tokio::test]
    async fn test_put_large_data() {
        let (storage, _dir) = temp_storage();
        let big = vec![0xABu8; 1_000_000];
        let key = storage.put("big", &big).await.unwrap();
        let data = storage.get(&key).await.unwrap();
        assert_eq!(data.len(), 1_000_000);
    }
}
