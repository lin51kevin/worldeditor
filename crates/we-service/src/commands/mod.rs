//! Concrete editor commands for road network editing.
//!
//! Each command implements the [`Command`] trait for undo/redo support.

mod batch;
mod elevation;
mod junction;
mod lane;
mod road;
mod road_ops;
mod signal;
mod spline;
mod topology;

#[cfg(test)]
mod tests;

pub use batch::*;
pub use elevation::*;
pub use junction::*;
pub use lane::*;
pub use road::*;
pub use road_ops::*;
pub use signal::*;
pub use spline::*;
pub use topology::*;

use we_core::model::*;

use super::EditorError;

/// Find a mutable reference to a lane within a project.
pub(crate) fn find_lane_mut<'a>(
    project: &'a mut Project,
    road_id: &str,
    section_s: f64,
    lane_id: i32,
) -> Result<&'a mut Lane, EditorError> {
    let road = project
        .roads
        .iter_mut()
        .find(|r| r.id == road_id)
        .ok_or_else(|| EditorError::OperationFailed(format!("Road '{}' not found", road_id)))?;
    let section = road
        .lane_sections
        .iter_mut()
        .find(|s| (s.s - section_s).abs() < 1e-9)
        .ok_or_else(|| {
            EditorError::OperationFailed(format!("Lane section at s={} not found", section_s))
        })?;
    let lane = if lane_id > 0 {
        section.left.iter_mut().find(|l| l.id == lane_id)
    } else if lane_id < 0 {
        section.right.iter_mut().find(|l| l.id == lane_id)
    } else {
        section.center.iter_mut().find(|l| l.id == lane_id)
    };
    lane.ok_or_else(|| EditorError::OperationFailed(format!("Lane {} not found", lane_id)))
}

/// Find a mutable reference to a road within a project.
pub(crate) fn find_road_mut<'a>(
    project: &'a mut Project,
    road_id: &str,
) -> Result<&'a mut Road, EditorError> {
    project
        .roads
        .iter_mut()
        .find(|r| r.id == road_id)
        .ok_or_else(|| EditorError::OperationFailed(format!("Road '{}' not found", road_id)))
}
