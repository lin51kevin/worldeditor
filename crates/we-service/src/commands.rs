//! Concrete editor commands for road network editing.
//!
//! Each command implements the [`Command`] trait for undo/redo support.

use we_core::model::*;

use super::{Command, EditorError};

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
        let road = p
            .roads
            .iter_mut()
            .find(|r| r.id == self.road_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Road '{}' not found", self.road_id))
            })?;
        road.name = self.new_name.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = p
            .roads
            .iter_mut()
            .find(|r| r.id == self.road_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Road '{}' not found", self.road_id))
            })?;
        road.name = self.old_name.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Rename Road"
    }
}

// ── AddLaneSection ───────────────────────────────────

/// Add a lane section to a road.
#[derive(Debug, Clone)]
pub struct AddLaneSection {
    pub road_id: String,
    pub section: LaneSection,
}

impl AddLaneSection {
    pub fn new(road_id: impl Into<String>, section: LaneSection) -> Self {
        Self {
            road_id: road_id.into(),
            section,
        }
    }
}

impl Command for AddLaneSection {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = p
            .roads
            .iter_mut()
            .find(|r| r.id == self.road_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Road '{}' not found", self.road_id))
            })?;
        road.lane_sections.push(self.section.clone());
        road.lane_sections
            .sort_by(|a, b| a.s.partial_cmp(&b.s).unwrap_or(std::cmp::Ordering::Equal));
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = p
            .roads
            .iter_mut()
            .find(|r| r.id == self.road_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Road '{}' not found", self.road_id))
            })?;
        road.lane_sections
            .retain(|s| (s.s - self.section.s).abs() > f64::EPSILON);
        Ok(p)
    }

    fn description(&self) -> &str {
        "Add Lane Section"
    }
}

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

// ── SetRoadGeometry ──────────────────────────────────

/// Replace the plan view (geometries) of a road.
#[derive(Debug, Clone)]
pub struct SetRoadGeometry {
    pub road_id: String,
    pub new_geometries: Vec<Geometry>,
    pub old_geometries: Vec<Geometry>,
}

impl SetRoadGeometry {
    pub fn new(
        road_id: impl Into<String>,
        old_geometries: Vec<Geometry>,
        new_geometries: Vec<Geometry>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            new_geometries,
            old_geometries,
        }
    }
}

impl Command for SetRoadGeometry {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = p
            .roads
            .iter_mut()
            .find(|r| r.id == self.road_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Road '{}' not found", self.road_id))
            })?;
        road.plan_view = self.new_geometries.clone();
        // Update total length
        road.length = road.plan_view.iter().map(|g| g.length).sum();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = p
            .roads
            .iter_mut()
            .find(|r| r.id == self.road_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Road '{}' not found", self.road_id))
            })?;
        road.plan_view = self.old_geometries.clone();
        road.length = road.plan_view.iter().map(|g| g.length).sum();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Set Road Geometry"
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

// ── AddLane ────────────────────────────────────────────

/// Add a lane to a lane section.
#[derive(Debug, Clone)]
pub struct AddLane {
    pub road_id: String,
    pub section_s: f64,
    pub side: LaneSide,
    pub lane: Lane,
}

/// Which side of the road to add the lane.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaneSide {
    Left,
    Right,
}

impl AddLane {
    pub fn new(road_id: impl Into<String>, section_s: f64, side: LaneSide, lane: Lane) -> Self {
        Self {
            road_id: road_id.into(),
            section_s,
            side,
            lane,
        }
    }
}

impl Command for AddLane {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = p
            .roads
            .iter_mut()
            .find(|r| r.id == self.road_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Road '{}' not found", self.road_id))
            })?;
        let section = road
            .lane_sections
            .iter_mut()
            .find(|s| (s.s - self.section_s).abs() < 1e-9)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!(
                    "Lane section at s={} not found",
                    self.section_s
                ))
            })?;
        match self.side {
            LaneSide::Left => {
                // Insert lane with positive id, maintaining increasing order
                section.left.push(self.lane.clone());
                section.left.sort_by_key(|l| l.id);
            }
            LaneSide::Right => {
                // Insert lane with negative id, maintaining decreasing order (more negative)
                section.right.push(self.lane.clone());
                section.right.sort_by_key(|l| l.id);
            }
        }
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = p
            .roads
            .iter_mut()
            .find(|r| r.id == self.road_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Road '{}' not found", self.road_id))
            })?;
        let section = road
            .lane_sections
            .iter_mut()
            .find(|s| (s.s - self.section_s).abs() < 1e-9)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!(
                    "Lane section at s={} not found",
                    self.section_s
                ))
            })?;
        match self.side {
            LaneSide::Left => {
                section.left.retain(|l| l.id != self.lane.id);
            }
            LaneSide::Right => {
                section.right.retain(|l| l.id != self.lane.id);
            }
        }
        Ok(p)
    }

    fn description(&self) -> &str {
        "Add Lane"
    }
}

// ── DeleteLane ─────────────────────────────────────────

/// Delete a lane from a lane section.
#[derive(Debug, Clone)]
pub struct DeleteLane {
    pub road_id: String,
    pub section_s: f64,
    pub lane_id: i32,
    pub snapshot: Option<Lane>,
}

impl DeleteLane {
    pub fn new(road_id: impl Into<String>, section_s: f64, lane_id: i32) -> Self {
        Self {
            road_id: road_id.into(),
            section_s,
            lane_id,
            snapshot: None,
        }
    }

    pub fn with_snapshot(
        road_id: impl Into<String>,
        section_s: f64,
        lane_id: i32,
        lane: Lane,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            section_s,
            lane_id,
            snapshot: Some(lane),
        }
    }
}

impl Command for DeleteLane {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = p
            .roads
            .iter_mut()
            .find(|r| r.id == self.road_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Road '{}' not found", self.road_id))
            })?;
        let section = road
            .lane_sections
            .iter_mut()
            .find(|s| (s.s - self.section_s).abs() < 1e-9)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!(
                    "Lane section at s={} not found",
                    self.section_s
                ))
            })?;
        // Determine side based on lane id sign
        if self.lane_id > 0 {
            if !section.left.iter().any(|l| l.id == self.lane_id) {
                return Err(EditorError::OperationFailed(format!(
                    "Lane {} not found on left side",
                    self.lane_id
                )));
            }
            section.left.retain(|l| l.id != self.lane_id);
        } else if self.lane_id < 0 {
            if !section.right.iter().any(|l| l.id == self.lane_id) {
                return Err(EditorError::OperationFailed(format!(
                    "Lane {} not found on right side",
                    self.lane_id
                )));
            }
            section.right.retain(|l| l.id != self.lane_id);
        } else {
            // lane_id == 0 (center lane)
            if !section.center.iter().any(|l| l.id == self.lane_id) {
                return Err(EditorError::OperationFailed(format!(
                    "Center lane not found"
                )));
            }
            section.center.retain(|l| l.id != self.lane_id);
        }
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let lane = self
            .snapshot
            .as_ref()
            .ok_or_else(|| EditorError::OperationFailed("Cannot undo: no lane snapshot".into()))?;
        let mut p = project.clone();
        let road = p
            .roads
            .iter_mut()
            .find(|r| r.id == self.road_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Road '{}' not found", self.road_id))
            })?;
        let section = road
            .lane_sections
            .iter_mut()
            .find(|s| (s.s - self.section_s).abs() < 1e-9)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!(
                    "Lane section at s={} not found",
                    self.section_s
                ))
            })?;
        if lane.id > 0 {
            section.left.push(lane.clone());
            section.left.sort_by_key(|l| l.id);
        } else if lane.id < 0 {
            section.right.push(lane.clone());
            section.right.sort_by_key(|l| l.id);
        } else {
            section.center.push(lane.clone());
        }
        Ok(p)
    }

    fn description(&self) -> &str {
        "Delete Lane"
    }
}

// ── UpdateLaneWidth ────────────────────────────────────

/// Update lane width polynomial coefficients.
#[derive(Debug, Clone)]
pub struct UpdateLaneWidth {
    pub road_id: String,
    pub section_s: f64,
    pub lane_id: i32,
    pub new_widths: Vec<LaneWidth>,
    pub old_widths: Vec<LaneWidth>,
}

impl UpdateLaneWidth {
    pub fn new(
        road_id: impl Into<String>,
        section_s: f64,
        lane_id: i32,
        old_widths: Vec<LaneWidth>,
        new_widths: Vec<LaneWidth>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            section_s,
            lane_id,
            new_widths,
            old_widths,
        }
    }
}

impl Command for UpdateLaneWidth {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = p
            .roads
            .iter_mut()
            .find(|r| r.id == self.road_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Road '{}' not found", self.road_id))
            })?;
        let section = road
            .lane_sections
            .iter_mut()
            .find(|s| (s.s - self.section_s).abs() < 1e-9)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!(
                    "Lane section at s={} not found",
                    self.section_s
                ))
            })?;
        let lane = if self.lane_id > 0 {
            section.left.iter_mut().find(|l| l.id == self.lane_id)
        } else if self.lane_id < 0 {
            section.right.iter_mut().find(|l| l.id == self.lane_id)
        } else {
            section.center.iter_mut().find(|l| l.id == self.lane_id)
        };
        let lane = lane.ok_or_else(|| {
            EditorError::OperationFailed(format!("Lane {} not found", self.lane_id))
        })?;
        lane.width = self.new_widths.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = p
            .roads
            .iter_mut()
            .find(|r| r.id == self.road_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Road '{}' not found", self.road_id))
            })?;
        let section = road
            .lane_sections
            .iter_mut()
            .find(|s| (s.s - self.section_s).abs() < 1e-9)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!(
                    "Lane section at s={} not found",
                    self.section_s
                ))
            })?;
        let lane = if self.lane_id > 0 {
            section.left.iter_mut().find(|l| l.id == self.lane_id)
        } else if self.lane_id < 0 {
            section.right.iter_mut().find(|l| l.id == self.lane_id)
        } else {
            section.center.iter_mut().find(|l| l.id == self.lane_id)
        };
        let lane = lane.ok_or_else(|| {
            EditorError::OperationFailed(format!("Lane {} not found", self.lane_id))
        })?;
        lane.width = self.old_widths.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Update Lane Width"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_project() -> Project {
        Project {
            name: "test".into(),
            header: Header::default(),
            roads: vec![Road::new("1", 100.0), Road::new("2", 200.0)],
            junctions: vec![],
        }
    }

    // ── AddRoad tests ────────────────────────────────

    #[test]
    fn test_add_road() {
        let project = Project::default();
        let cmd = AddRoad::new(Road::new("1", 50.0));
        let result = cmd.execute(&project).unwrap();
        assert_eq!(result.roads.len(), 1);
        assert_eq!(result.roads[0].id, "1");
    }

    #[test]
    fn test_add_road_duplicate() {
        let project = make_project();
        let cmd = AddRoad::new(Road::new("1", 50.0));
        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_add_road_undo() {
        let project = Project::default();
        let cmd = AddRoad::new(Road::new("1", 50.0));
        let after = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&after).unwrap();
        assert_eq!(undone.roads.len(), 0);
    }

    // ── DeleteRoad tests ─────────────────────────────

    #[test]
    fn test_delete_road() {
        let project = make_project();
        let road = project.roads[0].clone();
        let cmd = DeleteRoad::with_snapshot("1", road);
        let result = cmd.execute(&project).unwrap();
        assert_eq!(result.roads.len(), 1);
        assert_eq!(result.roads[0].id, "2");
    }

    #[test]
    fn test_delete_road_not_found() {
        let project = make_project();
        let cmd = DeleteRoad::new("999");
        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_delete_road_undo() {
        let project = make_project();
        let road = project.roads[0].clone();
        let cmd = DeleteRoad::with_snapshot("1", road);
        let after = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&after).unwrap();
        assert_eq!(undone.roads.len(), 2);
    }

    // ── UpdateRoadName tests ─────────────────────────

    #[test]
    fn test_rename_road() {
        let mut project = make_project();
        project.roads[0].name = "OldName".into();
        let cmd = UpdateRoadName::new("1", "OldName", "NewName");
        let result = cmd.execute(&project).unwrap();
        assert_eq!(result.roads[0].name, "NewName");
    }

    #[test]
    fn test_rename_road_undo() {
        let mut project = make_project();
        project.roads[0].name = "OldName".into();
        let cmd = UpdateRoadName::new("1", "OldName", "NewName");
        let after = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&after).unwrap();
        assert_eq!(undone.roads[0].name, "OldName");
    }

    // ── AddLaneSection tests ─────────────────────────

    #[test]
    fn test_add_lane_section() {
        let project = make_project();
        let section = LaneSection {
            s: 0.0,
            single_side: false,
            left: vec![],
            center: vec![Lane {
                id: 0,
                lane_type: LaneType::None,
                level: 0,
                link: None,
                width: vec![],
                borders: vec![],
                road_marks: vec![],
            }],
            right: vec![Lane {
                id: -1,
                lane_type: LaneType::Driving,
                level: 0,
                link: None,
                width: vec![LaneWidth {
                    s_offset: 0.0,
                    a: 3.5,
                    b: 0.0,
                    c: 0.0,
                    d: 0.0,
                }],
                borders: vec![],
                road_marks: vec![],
            }],
        };
        let cmd = AddLaneSection::new("1", section);
        let result = cmd.execute(&project).unwrap();
        assert_eq!(result.roads[0].lane_sections.len(), 1);
    }

    #[test]
    fn test_add_lane_section_undo() {
        let project = make_project();
        let section = LaneSection {
            s: 0.0,
            single_side: false,
            left: vec![],
            center: vec![],
            right: vec![],
        };
        let cmd = AddLaneSection::new("1", section);
        let after = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&after).unwrap();
        assert_eq!(undone.roads[0].lane_sections.len(), 0);
    }

    // ── AddJunction tests ────────────────────────────

    #[test]
    fn test_add_junction() {
        let project = Project::default();
        let junction = Junction {
            id: "100".into(),
            name: "J1".into(),
            connections: vec![],
        };
        let cmd = AddJunction::new(junction);
        let result = cmd.execute(&project).unwrap();
        assert_eq!(result.junctions.len(), 1);
        assert_eq!(result.junctions[0].name, "J1");
    }

    #[test]
    fn test_add_junction_duplicate() {
        let junction = Junction {
            id: "100".into(),
            name: "J1".into(),
            connections: vec![],
        };
        let mut project = Project::default();
        project.junctions.push(junction.clone());
        let cmd = AddJunction::new(junction);
        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_add_junction_undo() {
        let project = Project::default();
        let junction = Junction {
            id: "100".into(),
            name: "J1".into(),
            connections: vec![],
        };
        let cmd = AddJunction::new(junction);
        let after = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&after).unwrap();
        assert_eq!(undone.junctions.len(), 0);
    }

    // ── DeleteJunction tests ─────────────────────────

    #[test]
    fn test_delete_junction() {
        let junction = Junction {
            id: "100".into(),
            name: "J1".into(),
            connections: vec![],
        };
        let mut project = Project::default();
        project.junctions.push(junction.clone());
        let cmd = DeleteJunction::with_snapshot("100", junction);
        let result = cmd.execute(&project).unwrap();
        assert_eq!(result.junctions.len(), 0);
    }

    #[test]
    fn test_delete_junction_undo() {
        let junction = Junction {
            id: "100".into(),
            name: "J1".into(),
            connections: vec![],
        };
        let mut project = Project::default();
        project.junctions.push(junction.clone());
        let cmd = DeleteJunction::with_snapshot("100", junction);
        let after = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&after).unwrap();
        assert_eq!(undone.junctions.len(), 1);
    }

    // ── SetRoadGeometry tests ────────────────────────

    #[test]
    fn test_set_road_geometry() {
        let project = make_project();
        let new_geos = vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 75.0,
            geo_type: GeometryType::Line,
        }];
        let cmd = SetRoadGeometry::new("1", vec![], new_geos);
        let result = cmd.execute(&project).unwrap();
        assert_eq!(result.roads[0].plan_view.len(), 1);
        assert!((result.roads[0].length - 75.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_set_road_geometry_undo() {
        let project = make_project();
        let old_geos = vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 100.0,
            geo_type: GeometryType::Line,
        }];
        let new_geos = vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 75.0,
            geo_type: GeometryType::Line,
        }];
        let cmd = SetRoadGeometry::new("1", old_geos, new_geos);
        let after = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&after).unwrap();
        assert_eq!(undone.roads[0].plan_view.len(), 1);
        assert!((undone.roads[0].length - 100.0).abs() < f64::EPSILON);
    }

    // ── Integration with ActionHistory ───────────────

    #[test]
    fn test_multi_step_undo_redo() {
        use super::super::ActionHistory;

        let mut history = ActionHistory::new();
        let project = Project::default();

        // Step 1: Add road
        let project = history
            .execute(Box::new(AddRoad::new(Road::new("1", 100.0))), &project)
            .unwrap();
        assert_eq!(project.roads.len(), 1);

        // Step 2: Add another road
        let project = history
            .execute(Box::new(AddRoad::new(Road::new("2", 200.0))), &project)
            .unwrap();
        assert_eq!(project.roads.len(), 2);

        // Step 3: Rename road 1
        let project = history
            .execute(Box::new(UpdateRoadName::new("1", "", "Highway")), &project)
            .unwrap();
        assert_eq!(project.roads[0].name, "Highway");

        // Undo rename
        let project = history.undo(&project).unwrap();
        assert_eq!(project.roads[0].name, "");

        // Undo add road 2
        let project = history.undo(&project).unwrap();
        assert_eq!(project.roads.len(), 1);

        // Redo add road 2
        let project = history.redo(&project).unwrap();
        assert_eq!(project.roads.len(), 2);

        // Undo all
        let project = history.undo(&project).unwrap();
        let project = history.undo(&project).unwrap();
        assert_eq!(project.roads.len(), 0);
    }

    // ── CreateRoadFromCenterline tests ────────────────────

    #[test]
    fn test_create_road_from_centerline() {
        let project = Project::default();
        let geometries = vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 100.0,
            geo_type: GeometryType::Line,
        }];
        let cmd = CreateRoadFromCenterline::new("1", geometries);
        let result = cmd.execute(&project).unwrap();
        assert_eq!(result.roads.len(), 1);
        let road = &result.roads[0];
        assert_eq!(road.id, "1");
        assert!((road.length - 100.0).abs() < f64::EPSILON);
        assert_eq!(road.plan_view.len(), 1);
        assert_eq!(road.lane_sections.len(), 1);
        let section = &road.lane_sections[0];
        assert_eq!(section.left.len(), 1);
        assert_eq!(section.left[0].id, 1);
        assert_eq!(section.right.len(), 1);
        assert_eq!(section.right[0].id, -1);
        assert_eq!(section.center.len(), 1);
        assert_eq!(section.center[0].id, 0);
    }

    #[test]
    fn test_create_road_from_centerline_undo() {
        let project = Project::default();
        let geometries = vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 100.0,
            geo_type: GeometryType::Line,
        }];
        let cmd = CreateRoadFromCenterline::new("1", geometries);
        let after = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&after).unwrap();
        assert_eq!(undone.roads.len(), 0);
    }

    #[test]
    fn test_create_road_from_centerline_duplicate() {
        let mut project = Project::default();
        project.roads.push(Road::new("1", 50.0));
        let geometries = vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 100.0,
            geo_type: GeometryType::Line,
        }];
        let cmd = CreateRoadFromCenterline::new("1", geometries);
        assert!(cmd.execute(&project).is_err());
    }

    // ── AddLane tests ─────────────────────────────────────

    #[test]
    fn test_add_lane() {
        let mut project = Project::default();
        // Create a road with default lane section
        let geometries = vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 100.0,
            geo_type: GeometryType::Line,
        }];
        let road = Road::from_centerline("1", geometries);
        project.roads.push(road);
        // Add a new left lane
        let new_lane = Lane {
            id: 2,
            lane_type: LaneType::Driving,
            level: 0,
            link: None,
            width: vec![LaneWidth {
                s_offset: 0.0,
                a: 3.5,
                b: 0.0,
                c: 0.0,
                d: 0.0,
            }],
            borders: vec![],
            road_marks: vec![],
        };
        let cmd = AddLane::new("1", 0.0, LaneSide::Left, new_lane.clone());
        let result = cmd.execute(&project).unwrap();
        let road = &result.roads[0];
        let section = &road.lane_sections[0];
        assert_eq!(section.left.len(), 2); // original lane id=1 + new lane id=2
        assert!(section.left.iter().any(|l| l.id == 2));
        // Undo
        let undone = cmd.undo(&result).unwrap();
        let road = &undone.roads[0];
        let section = &road.lane_sections[0];
        assert_eq!(section.left.len(), 1);
        assert!(!section.left.iter().any(|l| l.id == 2));
    }

    #[test]
    fn test_add_lane_right() {
        let mut project = Project::default();
        let geometries = vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 100.0,
            geo_type: GeometryType::Line,
        }];
        let road = Road::from_centerline("1", geometries);
        project.roads.push(road);
        let new_lane = Lane {
            id: -2,
            lane_type: LaneType::Driving,
            level: 0,
            link: None,
            width: vec![LaneWidth {
                s_offset: 0.0,
                a: 3.5,
                b: 0.0,
                c: 0.0,
                d: 0.0,
            }],
            borders: vec![],
            road_marks: vec![],
        };
        let cmd = AddLane::new("1", 0.0, LaneSide::Right, new_lane.clone());
        let result = cmd.execute(&project).unwrap();
        let road = &result.roads[0];
        let section = &road.lane_sections[0];
        assert_eq!(section.right.len(), 2); // original lane id=-1 + new lane id=-2
        assert!(section.right.iter().any(|l| l.id == -2));
    }

    // ── DeleteLane tests ──────────────────────────────────

    #[test]
    fn test_delete_lane() {
        let mut project = Project::default();
        let geometries = vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 100.0,
            geo_type: GeometryType::Line,
        }];
        let road = Road::from_centerline("1", geometries);
        let lane_snapshot = road.lane_sections[0].left[0].clone();
        project.roads.push(road);
        // Delete left lane id=1
        let cmd = DeleteLane::with_snapshot("1", 0.0, 1, lane_snapshot);
        let result = cmd.execute(&project).unwrap();
        let road = &result.roads[0];
        let section = &road.lane_sections[0];
        assert_eq!(section.left.len(), 0);
        assert_eq!(section.right.len(), 1);
        // Undo
        let undone = cmd.undo(&result).unwrap();
        let road = &undone.roads[0];
        let section = &road.lane_sections[0];
        assert_eq!(section.left.len(), 1);
        assert_eq!(section.left[0].id, 1);
    }

    // ── UpdateLaneWidth tests ─────────────────────────────

    #[test]
    fn test_update_lane_width() {
        let mut project = Project::default();
        let geometries = vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 100.0,
            geo_type: GeometryType::Line,
        }];
        let road = Road::from_centerline("1", geometries);
        let old_widths = road.lane_sections[0].left[0].width.clone();
        project.roads.push(road);
        let new_widths = vec![LaneWidth {
            s_offset: 0.0,
            a: 4.0,
            b: 0.0,
            c: 0.0,
            d: 0.0,
        }];
        let cmd = UpdateLaneWidth::new("1", 0.0, 1, old_widths, new_widths.clone());
        let result = cmd.execute(&project).unwrap();
        let road = &result.roads[0];
        let section = &road.lane_sections[0];
        assert_eq!(section.left[0].width.len(), 1);
        assert!((section.left[0].width[0].a - 4.0).abs() < f64::EPSILON);
        // Undo
        let undone = cmd.undo(&result).unwrap();
        let road = &undone.roads[0];
        let section = &road.lane_sections[0];
        assert!((section.left[0].width[0].a - 3.5).abs() < f64::EPSILON);
    }
}
