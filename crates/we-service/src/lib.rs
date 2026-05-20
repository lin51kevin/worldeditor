//! WorldEditor business service layer.
//!
//! Orchestrates we-core + we-io for editor operations, undo/redo, project management.

pub mod commands;
pub mod editor;

pub use editor::{ActionHistory, Command, EditorError};

use we_core::model::Project;

/// Application state managed by the service layer.
///
/// Fields are private to enforce access through methods, preventing
/// direct mutation that could skip dirty-state tracking.
#[derive(Debug, Default)]
pub struct AppState {
    project: Project,
    is_dirty: bool,
}

impl AppState {
    /// Create a new AppState with the given project.
    pub fn new(project: Project) -> Self {
        Self {
            project,
            is_dirty: false,
        }
    }

    /// Get a reference to the current project.
    pub fn project(&self) -> &Project {
        &self.project
    }

    /// Get a mutable reference to the project and mark state as dirty.
    pub fn project_mut(&mut self) -> &mut Project {
        self.is_dirty = true;
        &mut self.project
    }

    /// Replace the current project (e.g., after undo/redo or load).
    pub fn set_project(&mut self, project: Project) {
        self.project = project;
        self.is_dirty = true;
    }

    /// Whether the project has unsaved changes.
    pub fn is_dirty(&self) -> bool {
        self.is_dirty
    }

    /// Mark the project as clean (e.g., after saving).
    pub fn mark_clean(&mut self) {
        self.is_dirty = false;
    }

    /// Mark the project as dirty.
    pub fn mark_dirty(&mut self) {
        self.is_dirty = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_state_default() {
        let state = AppState::default();
        assert!(state.project().name.is_empty());
        assert!(state.project().roads.is_empty());
        assert!(state.project().junctions.is_empty());
        assert!(!state.is_dirty());
    }

    #[test]
    fn test_app_state_with_project() {
        let state = AppState::new(Project {
            name: "demo".to_string(),
            ..Project::default()
        });

        assert_eq!(state.project().name, "demo");
        assert!(!state.is_dirty());
    }

    #[test]
    fn test_app_state_project_mut_marks_dirty() {
        let mut state = AppState::default();
        assert!(!state.is_dirty());
        state.project_mut().name = "modified".to_string();
        assert!(state.is_dirty());
    }

    #[test]
    fn test_app_state_mark_clean() {
        let mut state = AppState::default();
        state.mark_dirty();
        assert!(state.is_dirty());
        state.mark_clean();
        assert!(!state.is_dirty());
    }

    #[test]
    fn test_app_state_set_project() {
        let mut state = AppState::default();
        state.set_project(Project {
            name: "new_project".to_string(),
            ..Project::default()
        });
        assert_eq!(state.project().name, "new_project");
        assert!(state.is_dirty());
    }
}
