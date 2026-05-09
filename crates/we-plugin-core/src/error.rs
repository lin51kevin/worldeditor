//! Plugin system error types

use thiserror::Error;

/// Errors that can occur during plugin operations
#[derive(Error, Debug)]
pub enum PluginError {
    #[error("Plugin `{0}` not found")]
    NotFound(String),

    #[error("Plugin `{0}` is already loaded")]
    AlreadyLoaded(String),

    #[error("Plugin `{0}` is not loaded")]
    NotLoaded(String),

    #[error("Failed to load plugin `{0}`: {1}")]
    LoadFailed(String, String),

    #[error("Failed to initialize plugin `{0}`: {1}")]
    InitFailed(String, String),

    #[error("Failed to shutdown plugin `{0}`: {1}")]
    ShutdownFailed(String, String),

    #[error("Version mismatch for plugin `{0}`: expected `{1}`, found `{2}`")]
    VersionMismatch(String, String, String),

    #[error("Missing dependency `{0}` for plugin `{1}`")]
    MissingDependency(String, String),

    #[error("Circular dependency detected: {0}")]
    CircularDependency(String),

    #[error("Invalid manifest for plugin `{0}`: {1}")]
    InvalidManifest(String, String),

    #[error("Plugin `{0}` is disabled")]
    Disabled(String),

    #[error("Permission denied: plugin `{0}` requires `{1}`")]
    PermissionDenied(String, String),

    #[error("WASM execution error: {0}")]
    WasmError(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

/// Result type alias for plugin operations
pub type PluginResult<T> = Result<T, PluginError>;

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::ErrorKind;

    #[test]
    fn test_error_display_not_found() {
        assert_eq!(
            PluginError::NotFound("example-plugin".to_string()).to_string(),
            "Plugin `example-plugin` not found"
        );
    }

    #[test]
    fn test_error_display_already_loaded() {
        assert_eq!(
            PluginError::AlreadyLoaded("example-plugin".to_string()).to_string(),
            "Plugin `example-plugin` is already loaded"
        );
    }

    #[test]
    fn test_error_display_load_failed() {
        assert_eq!(
            PluginError::LoadFailed("example-plugin".to_string(), "boom".to_string()).to_string(),
            "Failed to load plugin `example-plugin`: boom"
        );
    }

    #[test]
    fn test_error_display_version_mismatch() {
        assert_eq!(
            PluginError::VersionMismatch(
                "example-plugin".to_string(),
                "1.0.0".to_string(),
                "2.0.0".to_string(),
            )
            .to_string(),
            "Version mismatch for plugin `example-plugin`: expected `1.0.0`, found `2.0.0`"
        );
    }

    #[test]
    fn test_error_display_missing_dependency() {
        assert_eq!(
            PluginError::MissingDependency("core".to_string(), "example-plugin".to_string())
                .to_string(),
            "Missing dependency `core` for plugin `example-plugin`"
        );
    }

    #[test]
    fn test_error_display_circular_dependency() {
        assert_eq!(
            PluginError::CircularDependency("a -> b -> a".to_string()).to_string(),
            "Circular dependency detected: a -> b -> a"
        );
    }

    #[test]
    fn test_error_display_disabled() {
        assert_eq!(
            PluginError::Disabled("example-plugin".to_string()).to_string(),
            "Plugin `example-plugin` is disabled"
        );
    }

    #[test]
    fn test_error_display_permission_denied() {
        assert_eq!(
            PluginError::PermissionDenied("example-plugin".to_string(), "filesystem".to_string())
                .to_string(),
            "Permission denied: plugin `example-plugin` requires `filesystem`"
        );
    }

    #[test]
    fn test_error_display_wasm_error() {
        assert_eq!(
            PluginError::WasmError("trap".to_string()).to_string(),
            "WASM execution error: trap"
        );
    }

    #[test]
    fn test_io_error_conversion() {
        let plugin_error: PluginError =
            std::io::Error::new(ErrorKind::PermissionDenied, "denied").into();

        match plugin_error {
            PluginError::IoError(error) => {
                assert_eq!(error.kind(), ErrorKind::PermissionDenied);
                assert_eq!(error.to_string(), "denied");
            }
            other => panic!("expected IoError, got {other:?}"),
        }
    }
}
