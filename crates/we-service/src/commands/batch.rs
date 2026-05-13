//! Batch command for multiple operations as a single undo unit.

use we_core::model::*;

use crate::{Command, EditorError};

use super::{find_lane_mut, find_road_mut};

/// A single entry in a batch command.
#[derive(Debug, Clone)]
pub enum BatchEntry {
    UpdateRoadName {
        road_id: String,
        old_name: String,
        new_name: String,
    },
    UpdateLaneType {
        road_id: String,
        section_s: f64,
        lane_id: i32,
        old_type: LaneType,
        new_type: LaneType,
    },
    UpdateLaneWidth {
        road_id: String,
        section_s: f64,
        lane_id: i32,
        old_widths: Vec<LaneWidth>,
        new_widths: Vec<LaneWidth>,
    },
    DeleteRoad {
        road_id: String,
    },
    DeleteJunction {
        junction_id: String,
    },
    TransformRoad {
        road_id: String,
        dx: f64,
        dy: f64,
        dz: f64,
    },
    TransformJunction {
        junction_id: String,
        new_name: String,
    },
}

/// Execute multiple commands as a single undoable operation.
///
/// All sub-commands are applied sequentially. If any fails, the entire
/// batch is rolled back. Undo reverses all sub-commands in reverse order.
#[derive(Debug, Clone)]
pub struct BatchCommand {
    /// Human-readable description for the batch.
    pub label: String,
    /// Snapshot of project state before the batch (for undo).
    pub snapshot: Project,
    /// The sub-operations to execute.
    pub commands: Vec<BatchEntry>,
}

impl BatchCommand {
    pub fn new(label: impl Into<String>, snapshot: Project, commands: Vec<BatchEntry>) -> Self {
        Self {
            label: label.into(),
            snapshot,
            commands,
        }
    }
}

impl Command for BatchCommand {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        for entry in &self.commands {
            match entry {
                BatchEntry::UpdateRoadName {
                    road_id, new_name, ..
                } => {
                    let road = find_road_mut(&mut p, road_id)?;
                    road.name = new_name.clone();
                }
                BatchEntry::UpdateLaneType {
                    road_id,
                    section_s,
                    lane_id,
                    new_type,
                    ..
                } => {
                    let lane = find_lane_mut(&mut p, road_id, *section_s, *lane_id)?;
                    lane.lane_type = *new_type;
                }
                BatchEntry::UpdateLaneWidth {
                    road_id,
                    section_s,
                    lane_id,
                    new_widths,
                    ..
                } => {
                    let lane = find_lane_mut(&mut p, road_id, *section_s, *lane_id)?;
                    lane.width = new_widths.clone();
                }
                BatchEntry::DeleteRoad { road_id } => {
                    p.roads.retain(|r| r.id != *road_id);
                }
                BatchEntry::DeleteJunction { junction_id } => {
                    p.junctions.retain(|j| j.id != *junction_id);
                }
                BatchEntry::TransformRoad {
                    road_id,
                    dx,
                    dy,
                    dz,
                } => {
                    let road = find_road_mut(&mut p, road_id)?;
                    for geo in &mut road.plan_view {
                        geo.x += dx;
                        geo.y += dy;
                    }
                    for ep in &mut road.elevation_profile {
                        ep.a += dz;
                    }
                }
                BatchEntry::TransformJunction {
                    junction_id,
                    new_name,
                } => {
                    let junction = p
                        .junctions
                        .iter_mut()
                        .find(|j| j.id == *junction_id)
                        .ok_or_else(|| {
                            EditorError::OperationFailed(format!(
                                "Junction '{}' not found",
                                junction_id
                            ))
                        })?;
                    junction.name = new_name.clone();
                }
            }
        }
        Ok(p)
    }

    fn undo(&self, _project: &Project) -> Result<Project, EditorError> {
        // Restore from snapshot — simplest and most reliable approach
        Ok(self.snapshot.clone())
    }

    fn description(&self) -> &str {
        &self.label
    }
}
