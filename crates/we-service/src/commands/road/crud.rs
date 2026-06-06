//! CRUD commands: add, create, and delete roads.

use we_core::model::*;

use crate::{Command, EditorError};

use super::find_road_mut;

// ── AddRoad ──────────────────────────────────────────

/// Add a new road to the project.
#[derive(Debug, Clone)]
pub struct AddRoad {
    pub road: Road,
}

impl AddRoad {
    pub fn new(road: Road) -> Self {
        Self { road }
    }
}

impl Command for AddRoad {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        if project.roads.iter().any(|r| r.id == self.road.id) {
            return Err(EditorError::OperationFailed(format!(
                "Road '{}' already exists",
                self.road.id
            )));
        }
        let mut p = project.clone();
        p.roads.push(self.road.clone());
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        p.roads.retain(|r| r.id != self.road.id);
        Ok(p)
    }

    fn description(&self) -> &str {
        "Add Road"
    }
}

// ── AddRoads ─────────────────────────────────────────

/// Add multiple roads as a single undo unit (e.g. from point-cloud vectorization).
#[derive(Debug, Clone)]
pub struct AddRoads {
    pub roads: Vec<Road>,
    label: String,
}

impl AddRoads {
    /// Create a command adding `roads` with a default description.
    pub fn new(roads: Vec<Road>) -> Self {
        Self {
            roads,
            label: "Add Roads".to_string(),
        }
    }

    /// Create with a custom description (shown in the undo history).
    pub fn with_label(roads: Vec<Road>, label: impl Into<String>) -> Self {
        Self {
            roads,
            label: label.into(),
        }
    }
}

impl Command for AddRoads {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        for road in &self.roads {
            if project.roads.iter().any(|r| r.id == road.id) {
                return Err(EditorError::OperationFailed(format!(
                    "Road '{}' already exists",
                    road.id
                )));
            }
        }
        let mut p = project.clone();
        p.roads.extend(self.roads.iter().cloned());
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        p.roads
            .retain(|r| !self.roads.iter().any(|added| added.id == r.id));
        Ok(p)
    }

    fn description(&self) -> &str {
        &self.label
    }
}

// ── DeleteRoad ───────────────────────────────────────

/// Remove a road from the project by ID.
#[derive(Debug, Clone)]
pub struct DeleteRoad {
    pub road_id: String,
    /// Snapshot of the deleted road for undo.
    snapshot: Option<Road>,
}

impl DeleteRoad {
    pub fn new(road_id: impl Into<String>) -> Self {
        Self {
            road_id: road_id.into(),
            snapshot: None,
        }
    }

    /// Create with a pre-captured snapshot (for use when the road is known).
    pub fn with_snapshot(road_id: impl Into<String>, road: Road) -> Self {
        Self {
            road_id: road_id.into(),
            snapshot: Some(road),
        }
    }
}

impl Command for DeleteRoad {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let found = project.roads.iter().any(|r| r.id == self.road_id);
        if !found {
            return Err(EditorError::OperationFailed(format!(
                "Road '{}' not found",
                self.road_id
            )));
        }
        let mut p = project.clone();
        p.roads.retain(|r| r.id != self.road_id);
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let road = self
            .snapshot
            .as_ref()
            .ok_or_else(|| EditorError::OperationFailed("Cannot undo: no road snapshot".into()))?;
        let mut p = project.clone();
        p.roads.push(road.clone());
        Ok(p)
    }

    fn description(&self) -> &str {
        "Delete Road"
    }
}

// ── UpdateRoadName ───────────────────────────────────

/// Rename a road.
#[derive(Debug, Clone)]
pub struct UpdateRoadName {
    pub road_id: String,
    pub new_name: String,
    pub old_name: String,
}

impl UpdateRoadName {
    pub fn new(
        road_id: impl Into<String>,
        old_name: impl Into<String>,
        new_name: impl Into<String>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            old_name: old_name.into(),
            new_name: new_name.into(),
        }
    }
}

impl Command for UpdateRoadName {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.name = self.new_name.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.name = self.old_name.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Rename Road"
    }
}

// ── CreateRoadFromCenterline ───────────────────────────

/// Create a new road from a centerline geometry with default lanes.
#[derive(Debug, Clone)]
pub struct CreateRoadFromCenterline {
    pub road_id: String,
    pub geometries: Vec<Geometry>,
}

impl CreateRoadFromCenterline {
    pub fn new(road_id: impl Into<String>, geometries: Vec<Geometry>) -> Self {
        Self {
            road_id: road_id.into(),
            geometries,
        }
    }
}

impl Command for CreateRoadFromCenterline {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        if project.roads.iter().any(|r| r.id == self.road_id) {
            return Err(EditorError::OperationFailed(format!(
                "Road '{}' already exists",
                self.road_id
            )));
        }
        let road = Road::from_centerline(&self.road_id, self.geometries.clone());
        let mut p = project.clone();
        p.roads.push(road);
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        p.roads.retain(|r| r.id != self.road_id);
        Ok(p)
    }

    fn description(&self) -> &str {
        "Create Road from Centerline"
    }
}

// ── CreateRoadFromSpline ─────────────────────────────

/// Create a new road from an editable spline with a lane template.
#[derive(Debug, Clone)]
pub struct CreateRoadFromSpline {
    pub road_id: String,
    pub spline: we_core::spline::EditableSpline,
    pub template: RoadTemplate,
    pub output_mode: we_core::spline::SplineOutputMode,
}

impl CreateRoadFromSpline {
    pub fn new(
        road_id: impl Into<String>,
        spline: we_core::spline::EditableSpline,
        template: RoadTemplate,
        output_mode: we_core::spline::SplineOutputMode,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            spline,
            template,
            output_mode,
        }
    }
}

impl Command for CreateRoadFromSpline {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        if project.roads.iter().any(|r| r.id == self.road_id) {
            return Err(EditorError::OperationFailed(format!(
                "Road '{}' already exists",
                self.road_id
            )));
        }

        // Convert spline to geometries
        let geometries =
            we_core::spline::spline_to_geometries_with_mode(&self.spline, self.output_mode);

        if geometries.is_empty() {
            return Err(EditorError::OperationFailed(
                "Spline must have at least one geometry segment".into(),
            ));
        }

        // Calculate total length
        let total_length: f64 = geometries.iter().map(|geo| geo.length).sum();

        // Build road with template lanes
        let mut road = Road::new(&self.road_id, total_length);
        road.plan_view = geometries;
        let lane_section = self.template.to_lane_section();
        road.lane_sections.push(lane_section);

        let mut p = project.clone();
        p.roads.push(road);
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        p.roads.retain(|r| r.id != self.road_id);
        Ok(p)
    }

    fn description(&self) -> &str {
        "Create Road from Spline"
    }
}
