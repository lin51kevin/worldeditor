//! Junction commands: CRUD, connections.

use we_core::model::*;

use crate::{Command, EditorError};

// ── AddJunction ──────────────────────────────────────

/// Add a junction to the project.
#[derive(Debug, Clone)]
pub struct AddJunction {
    pub junction: Junction,
}

impl AddJunction {
    pub fn new(junction: Junction) -> Self {
        Self { junction }
    }
}

impl Command for AddJunction {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        if project.junctions.iter().any(|j| j.id == self.junction.id) {
            return Err(EditorError::OperationFailed(format!(
                "Junction '{}' already exists",
                self.junction.id
            )));
        }
        let mut p = project.clone();
        p.junctions.push(self.junction.clone());
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        p.junctions.retain(|j| j.id != self.junction.id);
        Ok(p)
    }

    fn description(&self) -> &str {
        "Add Junction"
    }
}

// ── DeleteJunction ───────────────────────────────────

/// Remove a junction by ID.
#[derive(Debug, Clone)]
pub struct DeleteJunction {
    pub junction_id: String,
    snapshot: Option<Junction>,
}

impl DeleteJunction {
    pub fn with_snapshot(junction_id: impl Into<String>, junction: Junction) -> Self {
        Self {
            junction_id: junction_id.into(),
            snapshot: Some(junction),
        }
    }
}

impl Command for DeleteJunction {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        if !project.junctions.iter().any(|j| j.id == self.junction_id) {
            return Err(EditorError::OperationFailed(format!(
                "Junction '{}' not found",
                self.junction_id
            )));
        }
        let mut p = project.clone();
        p.junctions.retain(|j| j.id != self.junction_id);
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let junction = self.snapshot.as_ref().ok_or_else(|| {
            EditorError::OperationFailed("Cannot undo: no junction snapshot".into())
        })?;
        let mut p = project.clone();
        p.junctions.push(junction.clone());
        Ok(p)
    }

    fn description(&self) -> &str {
        "Delete Junction"
    }
}

// ── UpdateJunctionConnections ─────────────────────────

/// Replace all connections in a junction.
#[derive(Debug, Clone)]
pub struct UpdateJunctionConnections {
    pub junction_id: String,
    pub new_connections: Vec<JunctionConnection>,
    pub old_connections: Vec<JunctionConnection>,
}

impl UpdateJunctionConnections {
    pub fn new(
        junction_id: impl Into<String>,
        old_connections: Vec<JunctionConnection>,
        new_connections: Vec<JunctionConnection>,
    ) -> Self {
        Self {
            junction_id: junction_id.into(),
            new_connections,
            old_connections,
        }
    }
}

impl Command for UpdateJunctionConnections {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let junction = p
            .junctions
            .iter_mut()
            .find(|j| j.id == self.junction_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Junction '{}' not found", self.junction_id))
            })?;
        junction.connections = self.new_connections.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let junction = p
            .junctions
            .iter_mut()
            .find(|j| j.id == self.junction_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Junction '{}' not found", self.junction_id))
            })?;
        junction.connections = self.old_connections.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Update Junction Connections"
    }
}

// ── UpdateJunction ───────────────────────────────────

/// Update junction properties (name, etc.).
#[derive(Debug, Clone)]
pub struct UpdateJunction {
    pub junction_id: String,
    pub old_name: String,
    pub new_name: String,
}

impl UpdateJunction {
    pub fn new(
        junction_id: impl Into<String>,
        old_name: impl Into<String>,
        new_name: impl Into<String>,
    ) -> Self {
        Self {
            junction_id: junction_id.into(),
            old_name: old_name.into(),
            new_name: new_name.into(),
        }
    }
}

impl Command for UpdateJunction {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let junction = p
            .junctions
            .iter_mut()
            .find(|j| j.id == self.junction_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Junction '{}' not found", self.junction_id))
            })?;
        junction.name = self.new_name.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let junction = p
            .junctions
            .iter_mut()
            .find(|j| j.id == self.junction_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Junction '{}' not found", self.junction_id))
            })?;
        junction.name = self.old_name.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Update Junction"
    }
}

#[cfg(test)]
mod tests {
    use serde_json::to_value;

    use super::*;

    fn assert_projects_equal(actual: &Project, expected: &Project) {
        assert_eq!(to_value(actual).unwrap(), to_value(expected).unwrap());
    }

    fn assert_operation_failed(result: Result<Project, EditorError>, expected: &str) {
        match result {
            Err(EditorError::OperationFailed(message)) => {
                assert!(
                    message.contains(expected),
                    "expected error containing '{expected}', got '{message}'"
                );
            }
            other => panic!("expected operation failed error, got {other:?}"),
        }
    }

    fn sample_connection(id: &str, incoming: &str, connecting: &str) -> JunctionConnection {
        JunctionConnection {
            id: id.into(),
            incoming_road: incoming.into(),
            connecting_road: connecting.into(),
            contact_point: ContactPoint::Start,
            lane_links: vec![JunctionLaneLink { from: -1, to: 1 }],
        }
    }

    fn sample_junction(junction_id: &str) -> Junction {
        Junction {
            id: junction_id.into(),
            name: "Old Junction".into(),
            connections: vec![sample_connection("conn-1", "road-a", "road-b")],
        }
    }

    fn project_with_junction() -> Project {
        Project {
            junctions: vec![sample_junction("junction-1")],
            ..Default::default()
        }
    }

    #[test]
    fn test_add_junction_execute_adds_junction() {
        let original = Project::default();
        let command = AddJunction::new(sample_junction("junction-1"));

        let result = command.execute(&original).unwrap();

        assert_eq!(result.junctions.len(), 1);
        assert_eq!(result.junctions[0].name, "Old Junction");
    }

    #[test]
    fn test_add_junction_undo_restores_original_project() {
        let original = Project::default();
        let command = AddJunction::new(sample_junction("junction-1"));
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_add_junction_execute_duplicate_id_returns_error() {
        let project = project_with_junction();
        let command = AddJunction::new(sample_junction("junction-1"));

        assert_operation_failed(command.execute(&project), "already exists");
    }

    #[test]
    fn test_delete_junction_execute_removes_junction() {
        let original = project_with_junction();
        let command = DeleteJunction::with_snapshot("junction-1", original.junctions[0].clone());

        let result = command.execute(&original).unwrap();

        assert!(result.junctions.is_empty());
    }

    #[test]
    fn test_delete_junction_undo_restores_original_project() {
        let original = project_with_junction();
        let command = DeleteJunction::with_snapshot("junction-1", original.junctions[0].clone());
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_delete_junction_execute_missing_junction_returns_error() {
        let project = project_with_junction();
        let command =
            DeleteJunction::with_snapshot("missing-junction", sample_junction("missing-junction"));

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_update_junction_connections_execute_replaces_connections() {
        let original = project_with_junction();
        let new_connections = vec![
            sample_connection("conn-2", "road-c", "road-d"),
            sample_connection("conn-3", "road-e", "road-f"),
        ];
        let command = UpdateJunctionConnections::new(
            "junction-1",
            original.junctions[0].connections.clone(),
            new_connections,
        );

        let result = command.execute(&original).unwrap();

        assert_eq!(result.junctions[0].connections.len(), 2);
        assert_eq!(result.junctions[0].connections[0].id, "conn-2");
    }

    #[test]
    fn test_update_junction_connections_undo_restores_original_project() {
        let original = project_with_junction();
        let command = UpdateJunctionConnections::new(
            "junction-1",
            original.junctions[0].connections.clone(),
            vec![sample_connection("conn-2", "road-c", "road-d")],
        );
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_update_junction_connections_execute_missing_junction_returns_error() {
        let project = project_with_junction();
        let command = UpdateJunctionConnections::new(
            "missing-junction",
            vec![],
            vec![sample_connection("conn-2", "road-c", "road-d")],
        );

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_update_junction_execute_renames_junction() {
        let original = project_with_junction();
        let command = UpdateJunction::new("junction-1", "Old Junction", "Renamed Junction");

        let result = command.execute(&original).unwrap();

        assert_eq!(result.junctions[0].name, "Renamed Junction");
    }

    #[test]
    fn test_update_junction_undo_restores_original_project() {
        let original = project_with_junction();
        let command = UpdateJunction::new("junction-1", "Old Junction", "Renamed Junction");
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_update_junction_execute_missing_junction_returns_error() {
        let project = project_with_junction();
        let command = UpdateJunction::new("missing-junction", "Old Junction", "Renamed Junction");

        assert_operation_failed(command.execute(&project), "not found");
    }
}
