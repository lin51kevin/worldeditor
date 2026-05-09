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
                EditorError::OperationFailed(format!(
                    "Junction '{}' not found",
                    self.junction_id
                ))
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
                EditorError::OperationFailed(format!(
                    "Junction '{}' not found",
                    self.junction_id
                ))
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
                EditorError::OperationFailed(format!(
                    "Junction '{}' not found",
                    self.junction_id
                ))
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
                EditorError::OperationFailed(format!(
                    "Junction '{}' not found",
                    self.junction_id
                ))
            })?;
        junction.name = self.old_name.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Update Junction"
    }
}
