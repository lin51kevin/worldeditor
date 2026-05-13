//! NIO ProtoBuf autonomous driving map format — stub implementation.

use thiserror::Error;
use we_core::model::Project;

#[derive(Error, Debug)]
pub enum NioProtoError {
    #[error("NIO ProtoBuf parsing not yet implemented (Phase 3)")]
    NotImplemented,
    #[error("Invalid ProtoBuf data")]
    InvalidData,
}

/// Import a project from NIO ProtoBuf bytes (stub).
pub fn import_from_nio(_bytes: &[u8]) -> Result<Project, NioProtoError> {
    Err(NioProtoError::NotImplemented)
}

/// Export a project to NIO ProtoBuf bytes (stub).
pub fn export_to_nio(_project: &Project) -> Result<Vec<u8>, NioProtoError> {
    Err(NioProtoError::NotImplemented)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_import_not_implemented() {
        assert!(matches!(
            import_from_nio(&[]),
            Err(NioProtoError::NotImplemented)
        ));
    }

    #[test]
    fn test_export_not_implemented() {
        assert!(matches!(
            export_to_nio(&Project::default()),
            Err(NioProtoError::NotImplemented)
        ));
    }

    #[test]
    fn test_error_display() {
        assert!(
            NioProtoError::NotImplemented
                .to_string()
                .contains("not yet implemented")
        );
    }
}
