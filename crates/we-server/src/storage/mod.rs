use async_trait::async_trait;
use std::error::Error as StdError;

#[cfg(feature = "s3")]
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
        tokio::fs::create_dir_all(&self.base_path).await?;

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
    async fn test_put_and_get_file() {
        let (storage, _dir) = temp_storage();
        let expected = b"hello local storage";
        let key = storage.put("test.txt", expected).await.unwrap();

        let actual = storage.get(&key).await.unwrap();
        assert_eq!(actual, expected);
    }

    #[tokio::test]
    async fn test_get_nonexistent_file_returns_error() {
        let (storage, _dir) = temp_storage();

        assert!(storage.get("missing-file").await.is_err());
    }

    #[tokio::test]
    async fn test_delete_file_removes_it() {
        let (storage, _dir) = temp_storage();
        let key = storage.put("delete.txt", b"delete me").await.unwrap();

        storage.delete(&key).await.unwrap();

        assert!(storage.get(&key).await.is_err());
    }

    #[tokio::test]
    async fn test_put_creates_directory_if_not_exists() {
        let root = tempfile::tempdir().unwrap();
        let nested_path = root.path().join("nested").join("storage");
        let storage = LocalStorage::new(&nested_path);
        let key = storage.put("created.txt", b"created").await.unwrap();

        assert!(nested_path.exists());
        assert_eq!(storage.get(&key).await.unwrap(), b"created");
    }
}
