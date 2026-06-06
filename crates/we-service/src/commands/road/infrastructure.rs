//! Infrastructure commands: bridges and tunnels.

use we_core::model::*;

use crate::{Command, EditorError};

use super::find_road_mut;

// ── UpdateBridge ─────────────────────────────────────

/// Update the position, length, and type of a bridge on a road.
#[derive(Debug, Clone)]
pub struct UpdateBridge {
    pub road_id: String,
    pub bridge_id: String,
    pub new_s: f64,
    pub new_length: f64,
    pub new_type: String,
    // Snapshots for undo
    old_s: f64,
    old_length: f64,
    old_type: String,
}

impl UpdateBridge {
    /// Create from old and new values.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        road_id: impl Into<String>,
        bridge_id: impl Into<String>,
        old_s: f64,
        old_length: f64,
        old_type: impl Into<String>,
        new_s: f64,
        new_length: f64,
        new_type: impl Into<String>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            bridge_id: bridge_id.into(),
            new_s,
            new_length,
            new_type: new_type.into(),
            old_s,
            old_length,
            old_type: old_type.into(),
        }
    }
}

impl Command for UpdateBridge {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let bridge = road
            .bridges
            .iter_mut()
            .find(|b| b.id == self.bridge_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Bridge '{}' not found", self.bridge_id))
            })?;
        bridge.s = self.new_s;
        bridge.length = self.new_length;
        bridge.bridge_type = self.new_type.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let bridge = road
            .bridges
            .iter_mut()
            .find(|b| b.id == self.bridge_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Bridge '{}' not found", self.bridge_id))
            })?;
        bridge.s = self.old_s;
        bridge.length = self.old_length;
        bridge.bridge_type = self.old_type.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Update Bridge"
    }
}

// ── DeleteBridge ─────────────────────────────────────

/// Remove a bridge from a road. Stores a snapshot for undo.
#[derive(Debug, Clone)]
pub struct DeleteBridge {
    pub road_id: String,
    pub bridge_id: String,
    snapshot: Option<Bridge>,
}

impl DeleteBridge {
    pub fn new(road_id: impl Into<String>, bridge_id: impl Into<String>) -> Self {
        Self {
            road_id: road_id.into(),
            bridge_id: bridge_id.into(),
            snapshot: None,
        }
    }

    pub fn with_snapshot(
        road_id: impl Into<String>,
        bridge_id: impl Into<String>,
        bridge: Bridge,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            bridge_id: bridge_id.into(),
            snapshot: Some(bridge),
        }
    }
}

impl Command for DeleteBridge {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let before = road.bridges.len();
        road.bridges.retain(|b| b.id != self.bridge_id);
        if road.bridges.len() == before {
            return Err(EditorError::OperationFailed(format!(
                "Bridge '{}' not found on road '{}'",
                self.bridge_id, self.road_id
            )));
        }
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let bridge = self.snapshot.as_ref().ok_or_else(|| {
            EditorError::OperationFailed("Cannot undo DeleteBridge: no snapshot".into())
        })?;
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.bridges.push(bridge.clone());
        Ok(p)
    }

    fn description(&self) -> &str {
        "Delete Bridge"
    }
}

// ── UpdateTunnel ─────────────────────────────────────

/// Update the position, length, and type of a tunnel on a road.
#[derive(Debug, Clone)]
pub struct UpdateTunnel {
    pub road_id: String,
    pub tunnel_id: String,
    pub new_s: f64,
    pub new_length: f64,
    pub new_type: String,
    old_s: f64,
    old_length: f64,
    old_type: String,
}

impl UpdateTunnel {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        road_id: impl Into<String>,
        tunnel_id: impl Into<String>,
        old_s: f64,
        old_length: f64,
        old_type: impl Into<String>,
        new_s: f64,
        new_length: f64,
        new_type: impl Into<String>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            tunnel_id: tunnel_id.into(),
            new_s,
            new_length,
            new_type: new_type.into(),
            old_s,
            old_length,
            old_type: old_type.into(),
        }
    }
}

impl Command for UpdateTunnel {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let tunnel = road
            .tunnels
            .iter_mut()
            .find(|t| t.id == self.tunnel_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Tunnel '{}' not found", self.tunnel_id))
            })?;
        tunnel.s = self.new_s;
        tunnel.length = self.new_length;
        tunnel.tunnel_type = self.new_type.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let tunnel = road
            .tunnels
            .iter_mut()
            .find(|t| t.id == self.tunnel_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Tunnel '{}' not found", self.tunnel_id))
            })?;
        tunnel.s = self.old_s;
        tunnel.length = self.old_length;
        tunnel.tunnel_type = self.old_type.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Update Tunnel"
    }
}

// ── DeleteTunnel ─────────────────────────────────────

/// Remove a tunnel from a road. Stores a snapshot for undo.
#[derive(Debug, Clone)]
pub struct DeleteTunnel {
    pub road_id: String,
    pub tunnel_id: String,
    snapshot: Option<Tunnel>,
}

impl DeleteTunnel {
    pub fn new(road_id: impl Into<String>, tunnel_id: impl Into<String>) -> Self {
        Self {
            road_id: road_id.into(),
            tunnel_id: tunnel_id.into(),
            snapshot: None,
        }
    }

    pub fn with_snapshot(
        road_id: impl Into<String>,
        tunnel_id: impl Into<String>,
        tunnel: Tunnel,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            tunnel_id: tunnel_id.into(),
            snapshot: Some(tunnel),
        }
    }
}

impl Command for DeleteTunnel {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let before = road.tunnels.len();
        road.tunnels.retain(|t| t.id != self.tunnel_id);
        if road.tunnels.len() == before {
            return Err(EditorError::OperationFailed(format!(
                "Tunnel '{}' not found on road '{}'",
                self.tunnel_id, self.road_id
            )));
        }
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let tunnel = self.snapshot.as_ref().ok_or_else(|| {
            EditorError::OperationFailed("Cannot undo DeleteTunnel: no snapshot".into())
        })?;
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.tunnels.push(tunnel.clone());
        Ok(p)
    }

    fn description(&self) -> &str {
        "Delete Tunnel"
    }
}
