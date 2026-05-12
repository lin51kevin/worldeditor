//! DXF CAD format import/export — stub implementation.

use thiserror::Error;
use we_core::model::Project;

#[derive(Error, Debug)]
pub enum DxfError {
    #[error("DXF parsing not yet implemented (Phase 3)")]
    NotImplemented,
    #[error("Invalid DXF structure: {0}")]
    Invalid(String),
}

/// Import roads from a DXF text string (stub).
pub fn import_from_dxf(_dxf: &str) -> Result<Project, DxfError> {
    Err(DxfError::NotImplemented)
}

/// Export a project as DXF text (stub).
pub fn export_to_dxf(_project: &Project) -> Result<String, DxfError> {
    Err(DxfError::NotImplemented)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_import_not_implemented() {
        assert!(matches!(import_from_dxf(""), Err(DxfError::NotImplemented)));
    }

    #[test]
    fn test_export_not_implemented() {
        assert!(matches!(export_to_dxf(&Project::default()), Err(DxfError::NotImplemented)));
    }

    #[test]
    fn test_error_display() {
        assert!(DxfError::NotImplemented.to_string().contains("not yet implemented"));
    }
}
