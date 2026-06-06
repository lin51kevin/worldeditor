//! Lane property commands: type and width updates.

use we_core::model::*;

use crate::{Command, EditorError};

use super::find_lane_mut;

// ── UpdateLaneType ─────────────────────────────────────

/// Update the type of a lane.
#[derive(Debug, Clone)]
pub struct UpdateLaneType {
    pub road_id: String,
    pub section_s: f64,
    pub lane_id: i32,
    pub new_type: LaneType,
    pub old_type: LaneType,
}

impl UpdateLaneType {
    pub fn new(
        road_id: impl Into<String>,
        section_s: f64,
        lane_id: i32,
        old_type: LaneType,
        new_type: LaneType,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            section_s,
            lane_id,
            new_type,
            old_type,
        }
    }
}

impl Command for UpdateLaneType {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let lane = find_lane_mut(&mut p, &self.road_id, self.section_s, self.lane_id)?;
        lane.lane_type = self.new_type;
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let lane = find_lane_mut(&mut p, &self.road_id, self.section_s, self.lane_id)?;
        lane.lane_type = self.old_type;
        Ok(p)
    }

    fn description(&self) -> &str {
        "Update Lane Type"
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
        let lane = find_lane_mut(&mut p, &self.road_id, self.section_s, self.lane_id)?;
        lane.width = self.new_widths.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let lane = find_lane_mut(&mut p, &self.road_id, self.section_s, self.lane_id)?;
        lane.width = self.old_widths.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Update Lane Width"
    }
}
