//! SUMO traffic simulator I/O — stub implementation (Phase 3).
//!
//! Will support importing SUMO `.net.xml` files and exporting
//! OpenDRIVE projects to SUMO network format.

use we_core::model::Project;

/// Error type for SUMO I/O operations.
#[derive(Debug, thiserror::Error)]
pub enum SumoError {
    #[error("SUMO I/O not yet implemented — available in Phase 3")]
    NotImplemented,
}

/// Import a SUMO `.net.xml` file and convert to a `Project`.
pub fn import_sumo_net(_xml: &str) -> Result<Project, SumoError> {
    Err(SumoError::NotImplemented)
}

/// Export a `Project` to SUMO `.net.xml` format.
pub fn export_sumo_net(_project: &Project) -> Result<String, SumoError> {
    Err(SumoError::NotImplemented)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_import_returns_not_implemented() {
        let result = import_sumo_net("<net/>");
        assert!(matches!(result, Err(SumoError::NotImplemented)));
    }

    #[test]
    fn test_export_returns_not_implemented() {
        let p = Project::default();
        let result = export_sumo_net(&p);
        assert!(matches!(result, Err(SumoError::NotImplemented)));
    }

    #[test]
    fn test_error_display() {
        let e = SumoError::NotImplemented;
        assert!(e.to_string().contains("Phase 3"));
    }
}
