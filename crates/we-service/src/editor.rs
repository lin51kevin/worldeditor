//! Editor operations with undo/redo support.

use thiserror::Error;
use we_core::model::Project;

#[derive(Error, Debug)]
pub enum EditorError {
    #[error("Nothing to undo")]
    NothingToUndo,
    #[error("Nothing to redo")]
    NothingToRedo,
    #[error("Operation failed: {0}")]
    OperationFailed(String),
}

/// A reversible command for the undo/redo system.
pub trait Command: std::fmt::Debug {
    /// Execute the command, modifying the project.
    fn execute(&self, project: &Project) -> Result<Project, EditorError>;
    /// Reverse the command's effect.
    fn undo(&self, project: &Project) -> Result<Project, EditorError>;
    /// Human-readable description for the UI.
    fn description(&self) -> &str;
}

/// Manages the undo/redo history stack.
#[derive(Debug, Default)]
pub struct ActionHistory {
    undo_stack: Vec<Box<dyn Command>>,
    redo_stack: Vec<Box<dyn Command>>,
}

impl ActionHistory {
    pub fn new() -> Self {
        Self::default()
    }

    /// Execute a command and push it onto the undo stack.
    pub fn execute(
        &mut self,
        command: Box<dyn Command>,
        project: &Project,
    ) -> Result<Project, EditorError> {
        let new_project = command.execute(project)?;
        self.undo_stack.push(command);
        self.redo_stack.clear(); // new action invalidates redo history
        Ok(new_project)
    }

    /// Undo the last command.
    pub fn undo(&mut self, project: &Project) -> Result<Project, EditorError> {
        let command = self.undo_stack.pop().ok_or(EditorError::NothingToUndo)?;
        let new_project = command.undo(project)?;
        self.redo_stack.push(command);
        Ok(new_project)
    }

    /// Redo the last undone command.
    pub fn redo(&mut self, project: &Project) -> Result<Project, EditorError> {
        let command = self.redo_stack.pop().ok_or(EditorError::NothingToRedo)?;
        let new_project = command.execute(project)?;
        self.undo_stack.push(command);
        Ok(new_project)
    }

    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    pub fn undo_description(&self) -> Option<&str> {
        self.undo_stack.last().map(|c| c.description())
    }

    pub fn redo_description(&self) -> Option<&str> {
        self.redo_stack.last().map(|c| c.description())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use we_core::model::Road;

    #[derive(Debug)]
    struct AddRoadCommand {
        road: Road,
    }

    impl Command for AddRoadCommand {
        fn execute(&self, project: &Project) -> Result<Project, EditorError> {
            let mut new_project = project.clone();
            new_project.roads.push(self.road.clone());
            Ok(new_project)
        }

        fn undo(&self, project: &Project) -> Result<Project, EditorError> {
            let mut new_project = project.clone();
            new_project.roads.retain(|r| r.id != self.road.id);
            Ok(new_project)
        }

        fn description(&self) -> &str {
            "Add Road"
        }
    }

    #[test]
    fn test_execute_and_undo() {
        let mut history = ActionHistory::new();
        let project = Project::default();

        // Execute: add a road
        let cmd = Box::new(AddRoadCommand {
            road: Road::new("1", 100.0),
        });
        let project = history.execute(cmd, &project).unwrap();
        assert_eq!(project.roads.len(), 1);
        assert!(history.can_undo());
        assert!(!history.can_redo());

        // Undo: remove the road
        let project = history.undo(&project).unwrap();
        assert_eq!(project.roads.len(), 0);
        assert!(!history.can_undo());
        assert!(history.can_redo());

        // Redo: add the road again
        let project = history.redo(&project).unwrap();
        assert_eq!(project.roads.len(), 1);
    }

    #[test]
    fn test_undo_empty_stack() {
        let mut history = ActionHistory::new();
        let project = Project::default();
        assert!(matches!(
            history.undo(&project),
            Err(EditorError::NothingToUndo)
        ));
    }

    #[test]
    fn test_new_action_clears_redo() {
        let mut history = ActionHistory::new();
        let project = Project::default();

        let cmd1 = Box::new(AddRoadCommand {
            road: Road::new("1", 100.0),
        });
        let project = history.execute(cmd1, &project).unwrap();
        let project = history.undo(&project).unwrap();
        assert!(history.can_redo());

        // New action should clear redo
        let cmd2 = Box::new(AddRoadCommand {
            road: Road::new("2", 200.0),
        });
        let _project = history.execute(cmd2, &project).unwrap();
        assert!(!history.can_redo());
    }

    #[test]
    fn test_redo_empty_stack() {
        let mut history = ActionHistory::new();
        let project = Project::default();
        assert!(matches!(
            history.redo(&project),
            Err(EditorError::NothingToRedo)
        ));
    }

    #[test]
    fn test_undo_description() {
        let mut history = ActionHistory::new();
        let project = Project::default();
        let project = history
            .execute(
                Box::new(AddRoadCommand {
                    road: Road::new("1", 100.0),
                }),
                &project,
            )
            .unwrap();

        assert_eq!(history.undo_description(), Some("Add Road"));
        assert_eq!(project.roads.len(), 1);
    }

    #[test]
    fn test_redo_description() {
        let mut history = ActionHistory::new();
        let project = Project::default();
        let project = history
            .execute(
                Box::new(AddRoadCommand {
                    road: Road::new("1", 100.0),
                }),
                &project,
            )
            .unwrap();
        let _project = history.undo(&project).unwrap();

        assert_eq!(history.redo_description(), Some("Add Road"));
    }

    #[test]
    fn test_description_empty() {
        let history = ActionHistory::new();
        assert_eq!(history.undo_description(), None);
        assert_eq!(history.redo_description(), None);
    }

    #[test]
    fn test_multiple_undo_redo() {
        let mut history = ActionHistory::new();
        let project = Project::default();

        let project = history
            .execute(
                Box::new(AddRoadCommand {
                    road: Road::new("1", 100.0),
                }),
                &project,
            )
            .unwrap();
        let project = history
            .execute(
                Box::new(AddRoadCommand {
                    road: Road::new("2", 200.0),
                }),
                &project,
            )
            .unwrap();
        let project = history
            .execute(
                Box::new(AddRoadCommand {
                    road: Road::new("3", 300.0),
                }),
                &project,
            )
            .unwrap();

        assert_eq!(project.roads.len(), 3);
        let project = history.undo(&project).unwrap();
        assert_eq!(project.roads.len(), 2);
        let project = history.undo(&project).unwrap();
        assert_eq!(project.roads.len(), 1);
        let project = history.undo(&project).unwrap();
        assert!(project.roads.is_empty());
        assert!(!history.can_undo());
        assert!(history.can_redo());

        let project = history.redo(&project).unwrap();
        assert_eq!(project.roads.len(), 1);
        let project = history.redo(&project).unwrap();
        assert_eq!(project.roads.len(), 2);
        let project = history.redo(&project).unwrap();
        assert_eq!(project.roads.len(), 3);
        assert!(history.can_undo());
        assert!(!history.can_redo());
    }

    #[test]
    fn test_can_undo_after_execute() {
        let mut history = ActionHistory::new();
        let project = Project::default();
        let _project = history
            .execute(
                Box::new(AddRoadCommand {
                    road: Road::new("1", 100.0),
                }),
                &project,
            )
            .unwrap();

        assert!(history.can_undo());
    }

    #[test]
    fn test_can_redo_after_undo() {
        let mut history = ActionHistory::new();
        let project = Project::default();
        let project = history
            .execute(
                Box::new(AddRoadCommand {
                    road: Road::new("1", 100.0),
                }),
                &project,
            )
            .unwrap();
        let _project = history.undo(&project).unwrap();

        assert!(history.can_redo());
    }

    #[test]
    fn test_editor_error_display() {
        assert_eq!(EditorError::NothingToUndo.to_string(), "Nothing to undo");
        assert_eq!(EditorError::NothingToRedo.to_string(), "Nothing to redo");
        assert_eq!(
            EditorError::OperationFailed("boom".to_string()).to_string(),
            "Operation failed: boom"
        );
    }
}
