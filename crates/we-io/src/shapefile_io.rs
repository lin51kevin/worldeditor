//! Shapefile (.shp/.dbf/.shx) import/export — stub implementation.

use thiserror::Error;
use we_core::model::Project;

#[derive(Error, Debug)]
pub enum ShapefileError {
    #[error("Shapefile parsing not yet implemented (Phase 3)")]
    NotImplemented,
    #[error("Invalid shapefile header")]
    InvalidHeader,
}

/// Import roads from raw shapefile bytes (stub).
pub fn import_from_shapefile(_shp_bytes: &[u8]) -> Result<Project, ShapefileError> {
    Err(ShapefileError::NotImplemented)
}

/// Export a project to shapefile bytes (stub).
pub fn export_to_shapefile(_project: &Project) -> Result<Vec<u8>, ShapefileError> {
    Err(ShapefileError::NotImplemented)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_import_returns_not_implemented() {
        assert!(matches!(
            import_from_shapefile(&[]),
            Err(ShapefileError::NotImplemented)
        ));
    }

    #[test]
    fn test_export_returns_not_implemented() {
        assert!(matches!(
            export_to_shapefile(&Project::default()),
            Err(ShapefileError::NotImplemented)
        ));
    }

    #[test]
    fn test_error_display() {
        assert!(
            ShapefileError::NotImplemented
                .to_string()
                .contains("not yet implemented")
        );
    }
}
