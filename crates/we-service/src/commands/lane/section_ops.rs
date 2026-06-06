//! Lane section operations: split, merge, and delete sections.

use we_core::model::*;

use crate::{Command, EditorError};

use super::find_road_mut;

// ── SplitLaneSection ─────────────────────────────────

/// Split a lane section at a given s position.
///
/// The original section is shortened to end at `split_s`, and a new section
/// is created from `split_s` inheriting the same lane configuration.
/// Lane widths are recalculated to maintain continuity.
#[derive(Debug, Clone)]
pub struct SplitLaneSection {
    pub road_id: String,
    pub section_s: f64,
    pub split_s: f64,
    /// Snapshot of original sections for undo.
    pub old_sections: Vec<LaneSection>,
}

impl SplitLaneSection {
    pub fn new(
        road_id: impl Into<String>,
        section_s: f64,
        split_s: f64,
        old_sections: Vec<LaneSection>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            section_s,
            split_s,
            old_sections,
        }
    }
}

/// Re-evaluate a list of lane width polynomials at a new s-offset origin.
fn rebase_lane_widths(widths: &[LaneWidth], ds: f64) -> Vec<LaneWidth> {
    if widths.is_empty() {
        return Vec::new();
    }
    let mut active_idx = 0;
    for (i, w) in widths.iter().enumerate() {
        if w.s_offset <= ds + 1e-9 {
            active_idx = i;
        }
    }
    let active = &widths[active_idx];
    let local_ds = ds - active.s_offset;
    let new_a = active.a
        + active.b * local_ds
        + active.c * local_ds * local_ds
        + active.d * local_ds * local_ds * local_ds;
    let new_b = active.b + 2.0 * active.c * local_ds + 3.0 * active.d * local_ds * local_ds;
    let new_c = active.c + 3.0 * active.d * local_ds;
    let new_d = active.d;

    let mut result = vec![LaneWidth {
        s_offset: 0.0,
        a: new_a,
        b: new_b,
        c: new_c,
        d: new_d,
    }];

    for w in widths.iter() {
        if w.s_offset > ds + 1e-9 {
            result.push(LaneWidth {
                s_offset: w.s_offset - ds,
                a: w.a,
                b: w.b,
                c: w.c,
                d: w.d,
            });
        }
    }

    result
}

/// Clone lanes with rebased widths for a new section starting at ds.
fn clone_lanes_rebased(lanes: &[Lane], ds: f64) -> Vec<Lane> {
    lanes
        .iter()
        .map(|lane| Lane {
            id: lane.id,
            lane_type: lane.lane_type,
            level: lane.level,
            render_hidden: lane.render_hidden,
            link: lane.link.clone(),
            width: rebase_lane_widths(&lane.width, ds),
            borders: lane.borders.clone(),
            road_marks: lane
                .road_marks
                .iter()
                .filter(|rm| rm.s_offset >= ds - 1e-9)
                .map(|rm| RoadMark {
                    s_offset: (rm.s_offset - ds).max(0.0),
                    ..rm.clone()
                })
                .collect(),
        })
        .collect()
}

impl Command for SplitLaneSection {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;

        let section_idx = road
            .lane_sections
            .iter()
            .position(|s| (s.s - self.section_s).abs() < 1e-9)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!(
                    "Lane section at s={} not found",
                    self.section_s
                ))
            })?;

        let ds = self.split_s - self.section_s;
        if ds <= 1e-6 {
            return Err(EditorError::OperationFailed(
                "Split point too close to section start".into(),
            ));
        }

        let section_end = if section_idx + 1 < road.lane_sections.len() {
            road.lane_sections[section_idx + 1].s
        } else {
            road.length
        };
        if self.split_s >= section_end - 1e-6 {
            return Err(EditorError::OperationFailed(
                "Split point at or beyond section end".into(),
            ));
        }

        let section = &road.lane_sections[section_idx];
        let new_section = LaneSection {
            s: self.split_s,
            single_side: section.single_side,
            render_hidden: section.render_hidden,
            left: clone_lanes_rebased(&section.left, ds),
            center: clone_lanes_rebased(&section.center, ds),
            right: clone_lanes_rebased(&section.right, ds),
        };

        road.lane_sections.insert(section_idx + 1, new_section);
        road.lane_sections
            .sort_by(|a, b| a.s.partial_cmp(&b.s).unwrap_or(std::cmp::Ordering::Equal));

        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.lane_sections = self.old_sections.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Split Lane Section"
    }
}

// ── MergeLaneSections ────────────────────────────────

/// Merge a lane section with its successor.
#[derive(Debug, Clone)]
pub struct MergeLaneSections {
    pub road_id: String,
    pub section_s: f64,
    /// Snapshot of all sections for undo.
    pub old_sections: Vec<LaneSection>,
}

impl MergeLaneSections {
    pub fn new(road_id: impl Into<String>, section_s: f64, old_sections: Vec<LaneSection>) -> Self {
        Self {
            road_id: road_id.into(),
            section_s,
            old_sections,
        }
    }
}

impl Command for MergeLaneSections {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;

        let section_idx = road
            .lane_sections
            .iter()
            .position(|s| (s.s - self.section_s).abs() < 1e-9)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!(
                    "Lane section at s={} not found",
                    self.section_s
                ))
            })?;

        if section_idx + 1 >= road.lane_sections.len() {
            return Err(EditorError::OperationFailed(
                "No successor section to merge with".into(),
            ));
        }

        road.lane_sections.remove(section_idx + 1);
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.lane_sections = self.old_sections.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Merge Lane Sections"
    }
}

// ── DeleteLaneSection ────────────────────────────────

/// Remove a lane section from a road.
#[derive(Debug, Clone)]
pub struct DeleteLaneSection {
    pub road_id: String,
    pub section_s: f64,
    /// Snapshot for undo.
    pub snapshot: Option<LaneSection>,
}

impl DeleteLaneSection {
    pub fn new(road_id: impl Into<String>, section_s: f64) -> Self {
        Self {
            road_id: road_id.into(),
            section_s,
            snapshot: None,
        }
    }

    pub fn with_snapshot(road_id: impl Into<String>, section_s: f64, section: LaneSection) -> Self {
        Self {
            road_id: road_id.into(),
            section_s,
            snapshot: Some(section),
        }
    }
}

impl Command for DeleteLaneSection {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;

        if road.lane_sections.len() <= 1 {
            return Err(EditorError::OperationFailed(
                "Cannot delete: road must have at least one lane section".into(),
            ));
        }

        let count_before = road.lane_sections.len();
        road.lane_sections
            .retain(|s| (s.s - self.section_s).abs() >= 1e-9);

        if road.lane_sections.len() == count_before {
            return Err(EditorError::OperationFailed(format!(
                "Lane section at s={} not found",
                self.section_s
            )));
        }

        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let section = self.snapshot.as_ref().ok_or_else(|| {
            EditorError::OperationFailed("Cannot undo: no section snapshot".into())
        })?;
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.lane_sections.push(section.clone());
        road.lane_sections
            .sort_by(|a, b| a.s.partial_cmp(&b.s).unwrap_or(std::cmp::Ordering::Equal));
        Ok(p)
    }

    fn description(&self) -> &str {
        "Delete Lane Section"
    }
}
