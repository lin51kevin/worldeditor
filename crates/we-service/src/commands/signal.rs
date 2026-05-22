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
                EditorError::OperationFailed(format!("Signal '{}' not found", self.old_signal.id))
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
                EditorError::OperationFailed(format!("Signal '{}' not found", self.new_signal.id))
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
                EditorError::OperationFailed(format!("Object '{}' not found", self.old_object.id))
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
                EditorError::OperationFailed(format!("Object '{}' not found", self.new_object.id))
            })?;
        *obj = self.old_object.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Update Object"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_project() -> Project {
        Project {
            roads: vec![Road::new("road-1", 100.0)],
            ..Project::default()
        }
    }

    fn make_signal(id: &str) -> Signal {
        Signal {
            id: id.into(),
            name: "Signal".into(),
            s: 25.0,
            t: 2.0,
            z_offset: 3.0,
            h_offset: 0.0,
            width: 0.5,
            height: 0.8,
            signal_type: "1000001".into(),
            signal_subtype: "none".into(),
            value: Some("30".into()),
            orientation: "+".into(),
            is_dynamic: false,
            country: String::new(),
            unit: "km/h".into(),
            validities: vec![],
        }
    }

    fn make_object(id: &str) -> RoadObject {
        RoadObject {
            id: id.into(),
            object_type: ObjectType::Sign,
            name: "Object".into(),
            position: Point3D::new(10.0, 2.0, 0.0),
            orientation: 0.0,
            hdg: 0.0,
            pitch: 0.0,
            roll: 0.0,
            width: 1.0,
            height: 2.0,
            length: 0.0,
            corners: vec![],
            corner_type: CornerType::Local,
            validity: None,
            from_object_ref: false,
            user_data: vec![],
        }
    }

    #[test]
    fn test_add_signal_execute_adds_signal() {
        let project = make_project();
        let cmd = AddSignal::new("road-1", make_signal("sig-1"));

        let result = cmd.execute(&project).unwrap();

        assert_eq!(result.roads[0].signals.len(), 1);
        assert_eq!(result.roads[0].signals[0].id, "sig-1");
    }

    #[test]
    fn test_add_signal_undo_removes_signal() {
        let project = make_project();
        let cmd = AddSignal::new("road-1", make_signal("sig-1"));

        let executed = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&executed).unwrap();

        assert!(undone.roads[0].signals.is_empty());
    }

    #[test]
    fn test_add_signal_execute_missing_road_returns_error() {
        let project = make_project();
        let cmd = AddSignal::new("missing-road", make_signal("sig-1"));

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_delete_signal_execute_removes_signal() {
        let mut project = make_project();
        let signal = make_signal("sig-1");
        project.roads[0].signals.push(signal.clone());
        let cmd = DeleteSignal::with_snapshot("road-1", "sig-1", signal);

        let result = cmd.execute(&project).unwrap();

        assert!(result.roads[0].signals.is_empty());
    }

    #[test]
    fn test_delete_signal_undo_restores_signal() {
        let mut project = make_project();
        let signal = make_signal("sig-1");
        project.roads[0].signals.push(signal.clone());
        let cmd = DeleteSignal::with_snapshot("road-1", "sig-1", signal);

        let executed = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&executed).unwrap();

        assert_eq!(undone.roads[0].signals.len(), 1);
        assert_eq!(undone.roads[0].signals[0].id, "sig-1");
    }

    #[test]
    fn test_delete_signal_execute_missing_signal_returns_error() {
        let project = make_project();
        let cmd = DeleteSignal::with_snapshot("road-1", "sig-1", make_signal("sig-1"));

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_update_signal_execute_replaces_signal() {
        let mut project = make_project();
        let old_signal = make_signal("sig-1");
        project.roads[0].signals.push(old_signal.clone());
        let mut new_signal = old_signal.clone();
        new_signal.name = "Updated Signal".into();
        new_signal.s = 50.0;
        let cmd = UpdateSignal::new("road-1", old_signal, new_signal);

        let result = cmd.execute(&project).unwrap();

        assert_eq!(result.roads[0].signals[0].name, "Updated Signal");
        assert!((result.roads[0].signals[0].s - 50.0).abs() < 1e-9);
    }

    #[test]
    fn test_update_signal_undo_restores_signal() {
        let mut project = make_project();
        let old_signal = make_signal("sig-1");
        project.roads[0].signals.push(old_signal.clone());
        let mut new_signal = old_signal.clone();
        new_signal.name = "Updated Signal".into();
        let cmd = UpdateSignal::new("road-1", old_signal.clone(), new_signal);

        let executed = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&executed).unwrap();

        assert_eq!(undone.roads[0].signals[0].name, old_signal.name);
    }

    #[test]
    fn test_update_signal_execute_missing_signal_returns_error() {
        let project = make_project();
        let old_signal = make_signal("sig-1");
        let mut new_signal = old_signal.clone();
        new_signal.name = "Updated Signal".into();
        let cmd = UpdateSignal::new("road-1", old_signal, new_signal);

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_add_object_execute_adds_object() {
        let project = make_project();
        let cmd = AddObject::new("road-1", make_object("obj-1"));

        let result = cmd.execute(&project).unwrap();

        assert_eq!(result.roads[0].objects.len(), 1);
        assert_eq!(result.roads[0].objects[0].id, "obj-1");
    }

    #[test]
    fn test_add_object_undo_removes_object() {
        let project = make_project();
        let cmd = AddObject::new("road-1", make_object("obj-1"));

        let executed = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&executed).unwrap();

        assert!(undone.roads[0].objects.is_empty());
    }

    #[test]
    fn test_add_object_execute_missing_road_returns_error() {
        let project = make_project();
        let cmd = AddObject::new("missing-road", make_object("obj-1"));

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_delete_object_execute_removes_object() {
        let mut project = make_project();
        let object = make_object("obj-1");
        project.roads[0].objects.push(object.clone());
        let cmd = DeleteObject::with_snapshot("road-1", "obj-1", object);

        let result = cmd.execute(&project).unwrap();

        assert!(result.roads[0].objects.is_empty());
    }

    #[test]
    fn test_delete_object_undo_restores_object() {
        let mut project = make_project();
        let object = make_object("obj-1");
        project.roads[0].objects.push(object.clone());
        let cmd = DeleteObject::with_snapshot("road-1", "obj-1", object);

        let executed = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&executed).unwrap();

        assert_eq!(undone.roads[0].objects.len(), 1);
        assert_eq!(undone.roads[0].objects[0].id, "obj-1");
    }

    #[test]
    fn test_delete_object_execute_missing_object_returns_error() {
        let project = make_project();
        let cmd = DeleteObject::with_snapshot("road-1", "obj-1", make_object("obj-1"));

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_update_object_execute_replaces_object() {
        let mut project = make_project();
        let old_object = make_object("obj-1");
        project.roads[0].objects.push(old_object.clone());
        let mut new_object = old_object.clone();
        new_object.name = "Updated Object".into();
        new_object.width = 3.0;
        let cmd = UpdateObject::new("road-1", old_object, new_object);

        let result = cmd.execute(&project).unwrap();

        assert_eq!(result.roads[0].objects[0].name, "Updated Object");
        assert!((result.roads[0].objects[0].width - 3.0).abs() < 1e-9);
    }

    #[test]
    fn test_update_object_undo_restores_object() {
        let mut project = make_project();
        let old_object = make_object("obj-1");
        project.roads[0].objects.push(old_object.clone());
        let mut new_object = old_object.clone();
        new_object.name = "Updated Object".into();
        let cmd = UpdateObject::new("road-1", old_object.clone(), new_object);

        let executed = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&executed).unwrap();

        assert_eq!(undone.roads[0].objects[0].name, old_object.name);
    }

    #[test]
    fn test_update_object_execute_missing_object_returns_error() {
        let project = make_project();
        let old_object = make_object("obj-1");
        let mut new_object = old_object.clone();
        new_object.name = "Updated Object".into();
        let cmd = UpdateObject::new("road-1", old_object, new_object);

        assert!(cmd.execute(&project).is_err());
    }
}
