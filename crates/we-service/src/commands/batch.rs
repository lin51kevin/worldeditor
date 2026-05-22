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
    /// Set the speed limit (max speed attribute) on a road.
    SetRoadSpeed {
        road_id: String,
        new_speed: f64,
    },
    /// Toggle render visibility for a set of roads.
    SetRoadsVisibility {
        road_ids: Vec<String>,
        visible: bool,
    },
    /// Toggle render visibility for a set of lane sections.
    SetLaneSectionsVisibility {
        road_id: String,
        section_indices: Vec<usize>,
        visible: bool,
    },
    /// Align elevations of multiple roads to a single target value at their endpoints.
    AlignElevations {
        road_ids: Vec<String>,
        target_elevation: f64,
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
                BatchEntry::SetRoadSpeed { road_id, new_speed } => {
                    let road = find_road_mut(&mut p, road_id)?;
                    road.speed = Some(*new_speed);
                }
                BatchEntry::SetRoadsVisibility { road_ids, visible } => {
                    for rid in road_ids {
                        if let Some(road) = p.roads.iter_mut().find(|r| r.id == *rid) {
                            road.render_hidden = !visible;
                        }
                    }
                }
                BatchEntry::SetLaneSectionsVisibility {
                    road_id,
                    section_indices,
                    visible,
                } => {
                    let road = find_road_mut(&mut p, road_id)?;
                    for &idx in section_indices {
                        if let Some(section) = road.lane_sections.get_mut(idx) {
                            section.render_hidden = !visible;
                        }
                    }
                }
                BatchEntry::AlignElevations {
                    road_ids,
                    target_elevation,
                } => {
                    for rid in road_ids {
                        if let Some(road) = p.roads.iter_mut().find(|r| r.id == *rid) {
                            // Set or replace the first and last elevation entries
                            if road.elevation_profile.is_empty() {
                                road.elevation_profile.push(Elevation {
                                    s: 0.0,
                                    a: *target_elevation,
                                    b: 0.0,
                                    c: 0.0,
                                    d: 0.0,
                                });
                            } else {
                                road.elevation_profile[0].a = *target_elevation;
                                if let Some(last) = road.elevation_profile.last_mut() {
                                    last.a = *target_elevation;
                                }
                            }
                        }
                    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_project() -> Project {
        Project {
            roads: vec![Road::from_centerline(
                "road-1",
                vec![Geometry {
                    s: 0.0,
                    x: 0.0,
                    y: 0.0,
                    hdg: 0.0,
                    length: 100.0,
                    geo_type: GeometryType::Line,
                }],
            )],
            ..Project::default()
        }
    }

    #[test]
    fn test_batch_command_execute_applies_entries() {
        let project = make_project();
        let entries = vec![
            BatchEntry::UpdateRoadName {
                road_id: "road-1".into(),
                old_name: String::new(),
                new_name: "Renamed Road".into(),
            },
            BatchEntry::UpdateLaneType {
                road_id: "road-1".into(),
                section_s: 0.0,
                lane_id: 1,
                old_type: LaneType::Driving,
                new_type: LaneType::Shoulder,
            },
            BatchEntry::SetRoadSpeed {
                road_id: "road-1".into(),
                new_speed: 22.5,
            },
            BatchEntry::SetLaneSectionsVisibility {
                road_id: "road-1".into(),
                section_indices: vec![0],
                visible: false,
            },
            BatchEntry::AlignElevations {
                road_ids: vec!["road-1".into()],
                target_elevation: 5.0,
            },
        ];
        let cmd = BatchCommand::new("batch edit", project.clone(), entries);

        let result = cmd.execute(&project).unwrap();

        assert_eq!(result.roads[0].name, "Renamed Road");
        assert_eq!(
            result.roads[0].lane_sections[0].left[0].lane_type,
            LaneType::Shoulder
        );
        assert_eq!(result.roads[0].speed, Some(22.5));
        assert!(result.roads[0].lane_sections[0].render_hidden);
        assert_eq!(result.roads[0].elevation_profile[0].a, 5.0);
    }

    #[test]
    fn test_batch_command_undo_restores_snapshot() {
        let project = make_project();
        let entries = vec![BatchEntry::UpdateRoadName {
            road_id: "road-1".into(),
            old_name: String::new(),
            new_name: "Renamed Road".into(),
        }];
        let cmd = BatchCommand::new("batch edit", project.clone(), entries);

        let executed = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&executed).unwrap();

        assert_eq!(undone.roads[0].name, project.roads[0].name);
        assert_eq!(undone.roads[0].length, project.roads[0].length);
    }

    #[test]
    fn test_batch_command_execute_invalid_road_returns_error() {
        let project = make_project();
        let entries = vec![BatchEntry::UpdateRoadName {
            road_id: "missing-road".into(),
            old_name: String::new(),
            new_name: "Renamed Road".into(),
        }];
        let cmd = BatchCommand::new("batch edit", project.clone(), entries);

        assert!(cmd.execute(&project).is_err());
        assert!(project.roads[0].name.is_empty());
    }
}
