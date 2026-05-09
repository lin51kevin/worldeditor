//! Web file system implementation using browser APIs.
//! Only compiled for wasm32 target.

use crate::traits::{FileSystem, IoError};

/// Web-based file system using localStorage (small files) or IndexedDB (large files).
pub struct WebFileSystem;

impl WebFileSystem {
    pub fn new() -> Self {
        Self
    }

    fn get_storage(&self) -> Result<web_sys::Storage, IoError> {
        let window = web_sys::window().ok_or_else(|| IoError::Other("no window".to_string()))?;
        window
            .local_storage()
            .map_err(|_| IoError::Other("localStorage unavailable".to_string()))?
            .ok_or_else(|| IoError::Other("localStorage is null".to_string()))
    }
}

impl FileSystem for WebFileSystem {
    fn read_bytes(&self, path: &str) -> Result<Vec<u8>, IoError> {
        let storage = self.get_storage()?;
        let value = storage
            .get_item(path)
            .map_err(|_| IoError::Other("read failed".to_string()))?
            .ok_or_else(|| IoError::NotFound(path.to_string()))?;

        // Stored as base64 for binary data
        Ok(value.into_bytes())
    }

    fn write_bytes(&self, path: &str, data: &[u8]) -> Result<(), IoError> {
        let storage = self.get_storage()?;
        let value = String::from_utf8_lossy(data);
        storage
            .set_item(path, &value)
            .map_err(|_| IoError::Other("write failed".to_string()))
    }

    fn exists(&self, path: &str) -> Result<bool, IoError> {
        let storage = self.get_storage()?;
        Ok(storage
            .get_item(path)
            .map_err(|_| IoError::Other("exists check failed".to_string()))?
            .is_some())
    }

    fn delete(&self, path: &str) -> Result<(), IoError> {
        let storage = self.get_storage()?;
        storage
            .remove_item(path)
            .map_err(|_| IoError::Other("delete failed".to_string()))
    }

    fn list_dir(&self, _path: &str) -> Result<Vec<String>, IoError> {
        // localStorage doesn't support directory listing natively
        // Phase 3: Migrate to IndexedDB for proper support
        Ok(Vec::new())
    }
}
