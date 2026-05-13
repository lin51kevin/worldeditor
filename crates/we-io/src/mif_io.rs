//! MapInfo MIF/MID format import/export — stub implementation.

use thiserror::Error;
use we_core::model::Project;

#[derive(Error, Debug)]
pub enum MifError {
    #[error("MIF/MID parsing not yet implemented (Phase 3)")]
    NotImplemented,
    #[error("Invalid MIF structure: {0}")]
    Invalid(String),
}

/// Import roads from a MIF text string (stub).
pub fn import_from_mif(_mif: &str) -> Result<Project, MifError> {
    Err(MifError::NotImplemented)
}

/// Export a project as MIF text (stub).
pub fn export_to_mif(_project: &Project) -> Result<String, MifError> {
    Err(MifError::NotImplemented)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_import_not_implemented() {
        assert!(matches!(import_from_mif(""), Err(MifError::NotImplemented)));
    }

    #[test]
    fn test_export_not_implemented() {
        assert!(matches!(
            export_to_mif(&Project::default()),
            Err(MifError::NotImplemented)
        ));
    }

    #[test]
    fn test_error_display() {
        assert!(
            MifError::NotImplemented
                .to_string()
                .contains("not yet implemented")
        );
    }
}
