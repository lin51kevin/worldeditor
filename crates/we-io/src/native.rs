//! Native file system implementation using std::fs.

use crate::traits::{FileSystem, IoError};

/// Native file system backed by std::fs.
pub struct NativeFileSystem {
    /// Base directory for relative paths.
    pub base_dir: String,
}

impl NativeFileSystem {
    pub fn new(base_dir: impl Into<String>) -> Self {
        Self {
            base_dir: base_dir.into(),
        }
    }

    fn resolve_path(&self, path: &str) -> String {
        if std::path::Path::new(path).is_absolute() {
            path.to_string()
        } else {
            std::path::Path::new(&self.base_dir)
                .join(path)
                .to_string_lossy()
                .into_owned()
        }
    }
}

impl FileSystem for NativeFileSystem {
    fn read_bytes(&self, path: &str) -> Result<Vec<u8>, IoError> {
        let full_path = self.resolve_path(path);
        std::fs::read(&full_path).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => IoError::NotFound(full_path),
            std::io::ErrorKind::PermissionDenied => IoError::PermissionDenied(full_path),
            _ => IoError::Other(e.to_string()),
        })
    }

    fn write_bytes(&self, path: &str, data: &[u8]) -> Result<(), IoError> {
        let full_path = self.resolve_path(path);
        if let Some(parent) = std::path::Path::new(&full_path).parent() {
            std::fs::create_dir_all(parent).map_err(|e| IoError::Other(e.to_string()))?;
        }
        std::fs::write(&full_path, data).map_err(|e| IoError::Other(e.to_string()))
    }

    fn exists(&self, path: &str) -> Result<bool, IoError> {
        let full_path = self.resolve_path(path);
        Ok(std::path::Path::new(&full_path).exists())
    }

    fn delete(&self, path: &str) -> Result<(), IoError> {
        let full_path = self.resolve_path(path);
        std::fs::remove_file(&full_path).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => IoError::NotFound(full_path),
            _ => IoError::Other(e.to_string()),
        })
    }

    fn list_dir(&self, path: &str) -> Result<Vec<String>, IoError> {
        let full_path = self.resolve_path(path);
        let entries = std::fs::read_dir(&full_path).map_err(|e| IoError::Other(e.to_string()))?;

        let mut result = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|e| IoError::Other(e.to_string()))?;
            if let Some(name) = entry.file_name().to_str() {
                result.push(name.to_string());
            }
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use tempfile::tempdir;

    #[test]
    fn test_native_fs_write_and_read() {
        let temp_dir = tempdir().unwrap();
        let fs = NativeFileSystem::new(temp_dir.path().to_string_lossy().into_owned());

        fs.write_bytes("sample.txt", b"hello native fs").unwrap();

        let content = fs.read_bytes("sample.txt").unwrap();
        assert_eq!(content, b"hello native fs");
    }

    #[test]
    fn test_native_fs_read_not_found() {
        let temp_dir = tempdir().unwrap();
        let fs = NativeFileSystem::new(temp_dir.path().to_string_lossy().into_owned());

        let result = fs.read_bytes("missing.txt");

        assert!(matches!(result, Err(IoError::NotFound(_))));
    }

    #[test]
    fn test_native_fs_exists() {
        let temp_dir = tempdir().unwrap();
        let fs = NativeFileSystem::new(temp_dir.path().to_string_lossy().into_owned());
        let file_path = temp_dir.path().join("exists.txt");
        std::fs::write(&file_path, b"present").unwrap();

        assert!(fs.exists("exists.txt").unwrap());
        assert!(!fs.exists("missing.txt").unwrap());
    }

    #[test]
    fn test_native_fs_delete() {
        let temp_dir = tempdir().unwrap();
        let fs = NativeFileSystem::new(temp_dir.path().to_string_lossy().into_owned());

        fs.write_bytes("delete-me.txt", b"remove").unwrap();
        assert!(fs.exists("delete-me.txt").unwrap());

        fs.delete("delete-me.txt").unwrap();

        assert!(!fs.exists("delete-me.txt").unwrap());
    }

    #[test]
    fn test_native_fs_delete_not_found() {
        let temp_dir = tempdir().unwrap();
        let fs = NativeFileSystem::new(temp_dir.path().to_string_lossy().into_owned());

        let result = fs.delete("missing.txt");

        assert!(matches!(result, Err(IoError::NotFound(_))));
    }

    #[test]
    fn test_native_fs_list_dir() {
        let temp_dir = tempdir().unwrap();
        let fs = NativeFileSystem::new(temp_dir.path().to_string_lossy().into_owned());
        let assets_dir = temp_dir.path().join("assets");
        std::fs::create_dir_all(&assets_dir).unwrap();
        std::fs::write(assets_dir.join("a.txt"), b"a").unwrap();
        std::fs::write(assets_dir.join("b.txt"), b"b").unwrap();

        let mut entries = fs.list_dir("assets").unwrap();
        entries.sort();

        assert_eq!(entries, vec!["a.txt".to_string(), "b.txt".to_string()]);
    }

    #[test]
    fn test_native_fs_resolve_path_relative() {
        let temp_dir = tempdir().unwrap();
        let base_dir = temp_dir.path().to_string_lossy().into_owned();
        let fs = NativeFileSystem::new(base_dir.clone());

        let resolved = fs.resolve_path("nested\\file.txt");

        assert_eq!(
            resolved,
            Path::new(&base_dir)
                .join("nested\\file.txt")
                .to_string_lossy()
                .into_owned()
        );
    }

    #[test]
    fn test_native_fs_resolve_path_absolute() {
        let temp_dir = tempdir().unwrap();
        let fs = NativeFileSystem::new(temp_dir.path().to_string_lossy().into_owned());
        let absolute_path = temp_dir.path().join("absolute.txt");
        let absolute_path = absolute_path.to_string_lossy().into_owned();

        let resolved = fs.resolve_path(&absolute_path);

        assert_eq!(resolved, absolute_path);
    }

    #[test]
    fn test_native_fs_write_creates_parent_dirs() {
        let temp_dir = tempdir().unwrap();
        let fs = NativeFileSystem::new(temp_dir.path().to_string_lossy().into_owned());

        fs.write_bytes("nested\\folder\\file.txt", b"created")
            .unwrap();

        let created_path = temp_dir
            .path()
            .join("nested")
            .join("folder")
            .join("file.txt");
        assert!(created_path.exists());
        assert_eq!(std::fs::read(created_path).unwrap(), b"created");
    }

    #[test]
    fn test_native_fs_read_string() {
        let temp_dir = tempdir().unwrap();
        let fs = NativeFileSystem::new(temp_dir.path().to_string_lossy().into_owned());

        fs.write_bytes("text.txt", "你好，WorldEditor".as_bytes())
            .unwrap();

        let content = fs.read_string("text.txt").unwrap();
        assert_eq!(content, "你好，WorldEditor");
    }
}
