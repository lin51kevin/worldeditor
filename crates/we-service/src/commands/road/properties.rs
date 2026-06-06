//! Property commands: geometry, elevation, and link updates.

use we_core::model::*;

use crate::{Command, EditorError};

use super::find_road_mut;

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
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.plan_view = self.new_geometries.clone();
        road.length = road.plan_view.iter().map(|g| g.length).sum();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.plan_view = self.old_geometries.clone();
        road.length = road.plan_view.iter().map(|g| g.length).sum();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Set Road Geometry"
    }
}

// ── SetRoadElevation ─────────────────────────────────

/// Replace the elevation profile of a road.
#[derive(Debug, Clone)]
pub struct SetRoadElevation {
    pub road_id: String,
    pub new_elevations: Vec<Elevation>,
    pub old_elevations: Vec<Elevation>,
}

impl SetRoadElevation {
    pub fn new(
        road_id: impl Into<String>,
        old_elevations: Vec<Elevation>,
        new_elevations: Vec<Elevation>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            new_elevations,
            old_elevations,
        }
    }
}

impl Command for SetRoadElevation {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.elevation_profile = self.new_elevations.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.elevation_profile = self.old_elevations.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Set Road Elevation"
    }
}

// ── SetRoadLink ──────────────────────────────────────

/// Set or update the link (predecessor/successor) of a road.
#[derive(Debug, Clone)]
pub struct SetRoadLink {
    pub road_id: String,
    pub new_link: Option<RoadLink>,
    pub old_link: Option<RoadLink>,
}

impl SetRoadLink {
    pub fn new(
        road_id: impl Into<String>,
        old_link: Option<RoadLink>,
        new_link: Option<RoadLink>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            new_link,
            old_link,
        }
    }
}

impl Command for SetRoadLink {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.link = self.new_link.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.link = self.old_link.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Set Road Link"
    }
}
