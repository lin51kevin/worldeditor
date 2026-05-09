//! Elevation editing commands.

use we_core::model::*;

use crate::{Command, EditorError};

use super::find_road_mut;

// ── AddElevationPoint ────────────────────────────────

/// Add a new elevation point to a road's profile at station `s` with height `height`.
///
/// Tangent coefficients are automatically recomputed for smooth interpolation.
#[derive(Debug, Clone)]
pub struct AddElevationPoint {
    pub road_id: String,
    pub s: f64,
    pub height: f64,
    pub old_profile: Vec<Elevation>,
}

impl AddElevationPoint {
    pub fn new(
        road_id: impl Into<String>,
        s: f64,
        height: f64,
        old_profile: Vec<Elevation>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            s,
            height,
            old_profile,
        }
    }
}

impl Command for AddElevationPoint {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.elevation_profile =
            we_core::elevation::add_elevation_point(&road.elevation_profile, self.s, self.height);
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.elevation_profile = self.old_profile.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Add Elevation Point"
    }
}

// ── DeleteElevationPoint ─────────────────────────────

/// Delete an elevation point at station `s` (within tolerance).
#[derive(Debug, Clone)]
pub struct DeleteElevationPoint {
    pub road_id: String,
    pub s: f64,
    pub tolerance: f64,
    pub old_profile: Vec<Elevation>,
}

impl DeleteElevationPoint {
    pub fn new(
        road_id: impl Into<String>,
        s: f64,
        tolerance: f64,
        old_profile: Vec<Elevation>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            s,
            tolerance,
            old_profile,
        }
    }
}

impl Command for DeleteElevationPoint {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let new_profile =
            we_core::elevation::delete_elevation_point(&road.elevation_profile, self.s, self.tolerance)
                .ok_or_else(|| {
                    EditorError::OperationFailed(format!(
                        "No elevation point at s={} on road '{}'",
                        self.s, self.road_id
                    ))
                })?;
        road.elevation_profile = new_profile;
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.elevation_profile = self.old_profile.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Delete Elevation Point"
    }
}

// ── MoveElevationPoint ───────────────────────────────

/// Move an existing elevation point to a new station/height.
#[derive(Debug, Clone)]
pub struct MoveElevationPoint {
    pub road_id: String,
    pub old_s: f64,
    pub new_s: f64,
    pub new_height: f64,
    pub tolerance: f64,
    pub old_profile: Vec<Elevation>,
}

impl MoveElevationPoint {
    pub fn new(
        road_id: impl Into<String>,
        old_s: f64,
        new_s: f64,
        new_height: f64,
        tolerance: f64,
        old_profile: Vec<Elevation>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            old_s,
            new_s,
            new_height,
            tolerance,
            old_profile,
        }
    }
}

impl Command for MoveElevationPoint {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let new_profile = we_core::elevation::move_elevation_point(
            &road.elevation_profile,
            self.old_s,
            self.new_s,
            self.new_height,
            self.tolerance,
        )
        .ok_or_else(|| {
            EditorError::OperationFailed(format!(
                "No elevation point at s={} on road '{}'",
                self.old_s, self.road_id
            ))
        })?;
        road.elevation_profile = new_profile;
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.elevation_profile = self.old_profile.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Move Elevation Point"
    }
}

// ── SmoothElevation ──────────────────────────────────

/// Smooth a road's elevation profile by averaging adjacent points.
#[derive(Debug, Clone)]
pub struct SmoothElevation {
    pub road_id: String,
    pub iterations: u32,
    pub old_profile: Vec<Elevation>,
}

impl SmoothElevation {
    pub fn new(
        road_id: impl Into<String>,
        iterations: u32,
        old_profile: Vec<Elevation>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            iterations,
            old_profile,
        }
    }
}

impl Command for SmoothElevation {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.elevation_profile =
            we_core::elevation::smooth_elevation_profile(&road.elevation_profile, self.iterations);
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.elevation_profile = self.old_profile.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Smooth Elevation"
    }
}
