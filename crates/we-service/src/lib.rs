//! WorldEditor business service layer.
//!
//! Orchestrates we-core + we-io for editor operations, undo/redo, project management.

pub mod commands;
pub mod editor;

pub use editor::{ActionHistory, Command, EditorError};

use we_core::model::Project;

/// Application state managed by the service layer.
#[derive(Debug, Default)]
pub struct AppState {
    pub project: Project,
    pub is_dirty: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_state_default() {
        let state = AppState::default();
        assert!(state.project.name.is_empty());
        assert!(state.project.roads.is_empty());
        assert!(state.project.junctions.is_empty());
        assert!(!state.is_dirty);
    }

    #[test]
    fn test_app_state_with_project() {
        let state = AppState {
            project: Project {
                name: "demo".to_string(),
                ..Project::default()
            },
            is_dirty: true,
        };

        assert_eq!(state.project.name, "demo");
        assert!(state.is_dirty);
    }
}
