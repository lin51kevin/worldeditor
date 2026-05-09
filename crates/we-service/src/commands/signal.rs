//! Signal and road object commands.

use we_core::model::*;

use crate::{Command, EditorError};

use super::find_road_mut;

// ── AddSignal ────────────────────────────────────────

/// Add a signal to a road.
#[derive(Debug, Clone)]
pub struct AddSignal {
    pub road_id: String,
    pub signal: Signal,
}

impl AddSignal {
    pub fn new(road_id: impl Into<String>, signal: Signal) -> Self {
        Self {
            road_id: road_id.into(),
            signal,
        }
    }
}

impl Command for AddSignal {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        if road.signals.iter().any(|s| s.id == self.signal.id) {
            return Err(EditorError::OperationFailed(format!(
                "Signal '{}' already exists on road '{}'",
                self.signal.id, self.road_id
            )));
        }
        road.signals.push(self.signal.clone());
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.signals.retain(|s| s.id != self.signal.id);
        Ok(p)
    }

    fn description(&self) -> &str {
        "Add Signal"
    }
}

// ── DeleteSignal ─────────────────────────────────────

/// Remove a signal from a road.
#[derive(Debug, Clone)]
pub struct DeleteSignal {
    pub road_id: String,
    pub signal_id: String,
    snapshot: Option<Signal>,
}

impl DeleteSignal {
    pub fn with_snapshot(
        road_id: impl Into<String>,
        signal_id: impl Into<String>,
        signal: Signal,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            signal_id: signal_id.into(),
            snapshot: Some(signal),
        }
    }
}

impl Command for DeleteSignal {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        if !road.signals.iter().any(|s| s.id == self.signal_id) {
            return Err(EditorError::OperationFailed(format!(
                "Signal '{}' not found on road '{}'",
                self.signal_id, self.road_id
            )));
        }
        road.signals.retain(|s| s.id != self.signal_id);
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let signal = self.snapshot.as_ref().ok_or_else(|| {
            EditorError::OperationFailed("Cannot undo: no signal snapshot".into())
        })?;
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.signals.push(signal.clone());
        Ok(p)
    }

    fn description(&self) -> &str {
        "Delete Signal"
    }
}

// ── UpdateSignal ─────────────────────────────────────

/// Update a signal's properties.
#[derive(Debug, Clone)]
pub struct UpdateSignal {
    pub road_id: String,
    pub new_signal: Signal,
    pub old_signal: Signal,
}

impl UpdateSignal {
    pub fn new(road_id: impl Into<String>, old_signal: Signal, new_signal: Signal) -> Self {
        Self {
            road_id: road_id.into(),
            new_signal,
            old_signal,
        }
    }
}

impl Command for UpdateSignal {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let sig = road
            .signals
            .iter_mut()
            .find(|s| s.id == self.old_signal.id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!(
                    "Signal '{}' not found",
                    self.old_signal.id
                ))
            })?;
        *sig = self.new_signal.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let sig = road
            .signals
            .iter_mut()
            .find(|s| s.id == self.new_signal.id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!(
                    "Signal '{}' not found",
                    self.new_signal.id
                ))
            })?;
        *sig = self.old_signal.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Update Signal"
    }
}

// ── AddObject ────────────────────────────────────────

/// Add a road object (sign, barrier, etc.) to a road.
#[derive(Debug, Clone)]
pub struct AddObject {
    pub road_id: String,
    pub object: RoadObject,
}

impl AddObject {
    pub fn new(road_id: impl Into<String>, object: RoadObject) -> Self {
        Self {
            road_id: road_id.into(),
            object,
        }
    }
}

impl Command for AddObject {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        if road.objects.iter().any(|o| o.id == self.object.id) {
            return Err(EditorError::OperationFailed(format!(
                "Object '{}' already exists on road '{}'",
                self.object.id, self.road_id
            )));
        }
        road.objects.push(self.object.clone());
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.objects.retain(|o| o.id != self.object.id);
        Ok(p)
    }

    fn description(&self) -> &str {
        "Add Object"
    }
}

// ── DeleteObject ─────────────────────────────────────

/// Remove a road object by ID.
#[derive(Debug, Clone)]
pub struct DeleteObject {
    pub road_id: String,
    pub object_id: String,
    snapshot: Option<RoadObject>,
}

impl DeleteObject {
    pub fn with_snapshot(
        road_id: impl Into<String>,
        object_id: impl Into<String>,
        object: RoadObject,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            object_id: object_id.into(),
            snapshot: Some(object),
        }
    }
}

impl Command for DeleteObject {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        if !road.objects.iter().any(|o| o.id == self.object_id) {
            return Err(EditorError::OperationFailed(format!(
                "Object '{}' not found on road '{}'",
                self.object_id, self.road_id
            )));
        }
        road.objects.retain(|o| o.id != self.object_id);
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let obj = self.snapshot.as_ref().ok_or_else(|| {
            EditorError::OperationFailed("Cannot undo: no object snapshot".into())
        })?;
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.objects.push(obj.clone());
        Ok(p)
    }

    fn description(&self) -> &str {
        "Delete Object"
    }
}

// ── UpdateObject ─────────────────────────────────────

/// Update a road object's properties.
#[derive(Debug, Clone)]
pub struct UpdateObject {
    pub road_id: String,
    pub new_object: RoadObject,
    pub old_object: RoadObject,
}

impl UpdateObject {
    pub fn new(road_id: impl Into<String>, old_object: RoadObject, new_object: RoadObject) -> Self {
        Self {
            road_id: road_id.into(),
            new_object,
            old_object,
        }
    }
}

impl Command for UpdateObject {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let obj = road
            .objects
            .iter_mut()
            .find(|o| o.id == self.old_object.id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!(
                    "Object '{}' not found",
                    self.old_object.id
                ))
            })?;
        *obj = self.new_object.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let obj = road
            .objects
            .iter_mut()
            .find(|o| o.id == self.new_object.id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!(
                    "Object '{}' not found",
                    self.new_object.id
                ))
            })?;
        *obj = self.old_object.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Update Object"
    }
}
