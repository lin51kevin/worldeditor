//! Lane profile commands: links, road marks, offsets, superelevation, and crossfall.

use we_core::model::*;

use crate::{Command, EditorError};

use super::{find_lane_mut, find_road_mut};

// ── SetLaneLink ──────────────────────────────────────

/// Set the predecessor/successor link for a lane.
#[derive(Debug, Clone)]
pub struct SetLaneLink {
    pub road_id: String,
    pub section_s: f64,
    pub lane_id: i32,
    pub new_link: Option<LaneLink>,
    pub old_link: Option<LaneLink>,
}

impl SetLaneLink {
    pub fn new(
        road_id: impl Into<String>,
        section_s: f64,
        lane_id: i32,
        old_link: Option<LaneLink>,
        new_link: Option<LaneLink>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            section_s,
            lane_id,
            new_link,
            old_link,
        }
    }
}

impl Command for SetLaneLink {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let lane = find_lane_mut(&mut p, &self.road_id, self.section_s, self.lane_id)?;
        lane.link = self.new_link.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let lane = find_lane_mut(&mut p, &self.road_id, self.section_s, self.lane_id)?;
        lane.link = self.old_link.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Set Lane Link"
    }
}

// ── SetLaneRoadMark ──────────────────────────────────

/// Replace road marks for a lane.
#[derive(Debug, Clone)]
pub struct SetLaneRoadMark {
    pub road_id: String,
    pub section_s: f64,
    pub lane_id: i32,
    pub new_marks: Vec<RoadMark>,
    pub old_marks: Vec<RoadMark>,
}

impl SetLaneRoadMark {
    pub fn new(
        road_id: impl Into<String>,
        section_s: f64,
        lane_id: i32,
        old_marks: Vec<RoadMark>,
        new_marks: Vec<RoadMark>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            section_s,
            lane_id,
            new_marks,
            old_marks,
        }
    }
}

impl Command for SetLaneRoadMark {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let lane = find_lane_mut(&mut p, &self.road_id, self.section_s, self.lane_id)?;
        lane.road_marks = self.new_marks.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let lane = find_lane_mut(&mut p, &self.road_id, self.section_s, self.lane_id)?;
        lane.road_marks = self.old_marks.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Set Lane Road Mark"
    }
}

// ── SetLaneOffset ────────────────────────────────────

/// Set lane offset polynomials for a road.
#[derive(Debug, Clone)]
pub struct SetLaneOffset {
    pub road_id: String,
    pub new_offsets: Vec<LaneOffset>,
    pub old_offsets: Vec<LaneOffset>,
}

impl SetLaneOffset {
    pub fn new(
        road_id: impl Into<String>,
        old_offsets: Vec<LaneOffset>,
        new_offsets: Vec<LaneOffset>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            new_offsets,
            old_offsets,
        }
    }
}

impl Command for SetLaneOffset {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.lane_offsets = self.new_offsets.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.lane_offsets = self.old_offsets.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Set Lane Offset"
    }
}

// ── SetSuperelevation ────────────────────────────────

/// Set superelevation profile for a road.
#[derive(Debug, Clone)]
pub struct SetSuperelevation {
    pub road_id: String,
    pub new_profile: Vec<Superelevation>,
    pub old_profile: Vec<Superelevation>,
}

impl SetSuperelevation {
    pub fn new(
        road_id: impl Into<String>,
        old_profile: Vec<Superelevation>,
        new_profile: Vec<Superelevation>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            new_profile,
            old_profile,
        }
    }
}

impl Command for SetSuperelevation {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.lateral_profile.superelevations = self.new_profile.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.lateral_profile.superelevations = self.old_profile.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Set Superelevation"
    }
}

// ── SetCrossfall ─────────────────────────────────────

/// Set crossfall profile for a road.
#[derive(Debug, Clone)]
pub struct SetCrossfall {
    pub road_id: String,
    pub new_profile: Vec<Crossfall>,
    pub old_profile: Vec<Crossfall>,
}

impl SetCrossfall {
    pub fn new(
        road_id: impl Into<String>,
        old_profile: Vec<Crossfall>,
        new_profile: Vec<Crossfall>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            new_profile,
            old_profile,
        }
    }
}

impl Command for SetCrossfall {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.lateral_profile.crossfalls = self.new_profile.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.lateral_profile.crossfalls = self.old_profile.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Set Crossfall"
    }
}
