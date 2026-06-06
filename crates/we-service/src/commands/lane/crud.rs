//! CRUD commands: add and delete lane sections and lanes.

use we_core::model::*;

use crate::{Command, EditorError};

use super::find_road_mut;

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
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.lane_sections.push(self.section.clone());
        road.lane_sections
            .sort_by(|a, b| a.s.partial_cmp(&b.s).unwrap_or(std::cmp::Ordering::Equal));
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.lane_sections
            .retain(|s| (s.s - self.section.s).abs() > f64::EPSILON);
        Ok(p)
    }

    fn description(&self) -> &str {
        "Add Lane Section"
    }
}

// ── AddLane ────────────────────────────────────────────

/// Which side of the road to add the lane.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaneSide {
    Left,
    Right,
}

/// Add a lane to a lane section.
#[derive(Debug, Clone)]
pub struct AddLane {
    pub road_id: String,
    pub section_s: f64,
    pub side: LaneSide,
    pub lane: Lane,
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
        let road = find_road_mut(&mut p, &self.road_id)?;
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
                section.left.push(self.lane.clone());
                section.left.sort_by_key(|l| l.id);
            }
            LaneSide::Right => {
                section.right.push(self.lane.clone());
                section.right.sort_by_key(|l| l.id);
            }
        }
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
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
        let road = find_road_mut(&mut p, &self.road_id)?;
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
            if !section.center.iter().any(|l| l.id == self.lane_id) {
                return Err(EditorError::OperationFailed("Center lane not found".into()));
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
        let road = find_road_mut(&mut p, &self.road_id)?;
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
