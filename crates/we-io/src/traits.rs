//! Platform-agnostic file system traits.

use thiserror::Error;

#[derive(Error, Debug)]
pub enum IoError {
    #[error("File not found: {0}")]
    NotFound(String),
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
    #[error("IO error: {0}")]
    Other(String),
}

/// Abstract file system operations.
///
/// Implemented differently for each platform:
/// - Native: real file system via tokio
/// - Web: IndexedDB / localStorage
/// - Cloud: S3/OSS object storage
pub trait FileSystem {
    /// Read a file's entire contents as bytes.
    fn read_bytes(&self, path: &str) -> Result<Vec<u8>, IoError>;

    /// Read a file's entire contents as UTF-8 string.
    fn read_string(&self, path: &str) -> Result<String, IoError> {
        let bytes = self.read_bytes(path)?;
        String::from_utf8(bytes).map_err(|e| IoError::Other(e.to_string()))
    }

    /// Write bytes to a file, creating it if it doesn't exist.
    fn write_bytes(&self, path: &str, data: &[u8]) -> Result<(), IoError>;

    /// Write a UTF-8 string to a file.
    fn write_string(&self, path: &str, data: &str) -> Result<(), IoError> {
        self.write_bytes(path, data.as_bytes())
    }

    /// Check if a file exists.
    fn exists(&self, path: &str) -> Result<bool, IoError>;

    /// Delete a file.
    fn delete(&self, path: &str) -> Result<(), IoError>;

    /// List files in a directory.
    fn list_dir(&self, path: &str) -> Result<Vec<String>, IoError>;
}

/// In-memory file system for testing.
#[derive(Default)]
pub struct MemoryFileSystem {
    files: std::collections::HashMap<String, Vec<u8>>,
}

impl FileSystem for MemoryFileSystem {
    fn read_bytes(&self, path: &str) -> Result<Vec<u8>, IoError> {
        self.files
            .get(path)
            .cloned()
            .ok_or_else(|| IoError::NotFound(path.to_string()))
    }

    fn write_bytes(&self, _path: &str, _data: &[u8]) -> Result<(), IoError> {
        // MemoryFileSystem is immutable by trait contract; use MemoryFileSystemMut for tests
        Err(IoError::Other("read-only memory fs".to_string()))
    }

    fn exists(&self, path: &str) -> Result<bool, IoError> {
        Ok(self.files.contains_key(path))
    }

    fn delete(&self, _path: &str) -> Result<(), IoError> {
        Err(IoError::Other("read-only memory fs".to_string()))
    }

    fn list_dir(&self, prefix: &str) -> Result<Vec<String>, IoError> {
        Ok(self
            .files
            .keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_memory_fs_not_found() {
        let fs = MemoryFileSystem::default();
        let result = fs.read_bytes("nonexistent");
        assert!(matches!(result, Err(IoError::NotFound(_))));
    }

    #[test]
    fn test_memory_fs_exists() {
        let mut fs = MemoryFileSystem::default();
        fs.files.insert("test.txt".to_string(), b"hello".to_vec());
        assert!(fs.exists("test.txt").unwrap());
        assert!(!fs.exists("other.txt").unwrap());
    }

    #[test]
    fn test_memory_fs_read() {
        let mut fs = MemoryFileSystem::default();
        fs.files
            .insert("test.txt".to_string(), b"hello world".to_vec());
        let content = fs.read_string("test.txt").unwrap();
        assert_eq!(content, "hello world");
    }

    #[test]
    fn test_memory_fs_write_returns_error() {
        let fs = MemoryFileSystem::default();
        let result = fs.write_bytes("test.txt", b"hello");

        assert!(matches!(result, Err(IoError::Other(message)) if message == "read-only memory fs"));
    }

    #[test]
    fn test_memory_fs_delete_returns_error() {
        let fs = MemoryFileSystem::default();
        let result = fs.delete("test.txt");

        assert!(matches!(result, Err(IoError::Other(message)) if message == "read-only memory fs"));
    }

    #[test]
    fn test_memory_fs_list_dir() {
        let mut fs = MemoryFileSystem::default();
        fs.files
            .insert("assets/roads/main.xodr".to_string(), b"road".to_vec());
        fs.files
            .insert("assets/signs/stop.json".to_string(), b"sign".to_vec());
        fs.files
            .insert("docs/readme.md".to_string(), b"docs".to_vec());

        let mut entries = fs.list_dir("assets/").unwrap();
        entries.sort();

        assert_eq!(
            entries,
            vec![
                "assets/roads/main.xodr".to_string(),
                "assets/signs/stop.json".to_string(),
            ]
        );
    }

    #[test]
    fn test_memory_fs_list_dir_empty() {
        let fs = MemoryFileSystem::default();

        let entries = fs.list_dir("assets/").unwrap();

        assert!(entries.is_empty());
    }

    #[test]
    fn test_memory_fs_read_string_utf8() {
        let mut fs = MemoryFileSystem::default();
        fs.files.insert(
            "utf8.txt".to_string(),
            "你好，WorldEditor".as_bytes().to_vec(),
        );

        let content = fs.read_string("utf8.txt").unwrap();

        assert_eq!(content, "你好，WorldEditor");
    }

    #[test]
    fn test_memory_fs_read_string_invalid_utf8() {
        let mut fs = MemoryFileSystem::default();
        fs.files
            .insert("invalid.bin".to_string(), vec![0xff, 0xfe, 0xfd]);

        let result = fs.read_string("invalid.bin");

        assert!(matches!(result, Err(IoError::Other(_))));
    }

    #[test]
    fn test_memory_fs_default() {
        let fs = MemoryFileSystem::default();

        assert!(fs.files.is_empty());
    }

    #[test]
    fn test_io_error_display() {
        assert_eq!(
            IoError::NotFound("missing.txt".to_string()).to_string(),
            "File not found: missing.txt"
        );
        assert_eq!(
            IoError::PermissionDenied("secret.txt".to_string()).to_string(),
            "Permission denied: secret.txt"
        );
        assert_eq!(
            IoError::Other("boom".to_string()).to_string(),
            "IO error: boom"
        );
    }
}
