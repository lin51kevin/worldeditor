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
        let new_profile = we_core::elevation::delete_elevation_point(
            &road.elevation_profile,
            self.s,
            self.tolerance,
        )
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
    pub fn new(road_id: impl Into<String>, iterations: u32, old_profile: Vec<Elevation>) -> Self {
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

#[cfg(test)]
mod tests {
    use serde_json::to_value;

    use super::*;

    fn assert_projects_equal(actual: &Project, expected: &Project) {
        assert_eq!(to_value(actual).unwrap(), to_value(expected).unwrap());
    }

    fn assert_operation_failed(result: Result<Project, EditorError>, expected: &str) {
        match result {
            Err(EditorError::OperationFailed(message)) => {
                assert!(
                    message.contains(expected),
                    "expected error containing '{expected}', got '{message}'"
                );
            }
            other => panic!("expected operation failed error, got {other:?}"),
        }
    }

    fn elevation(s: f64, a: f64) -> Elevation {
        Elevation {
            s,
            a,
            b: 0.0,
            c: 0.0,
            d: 0.0,
        }
    }

    fn project_with_elevation_profile() -> Project {
        let mut road = Road::from_centerline(
            "road-1",
            vec![Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length: 100.0,
                geo_type: GeometryType::Line,
            }],
        );
        road.elevation_profile = vec![
            elevation(0.0, 0.0),
            elevation(50.0, 5.0),
            elevation(100.0, 2.0),
        ];
        Project {
            roads: vec![road],
            ..Default::default()
        }
    }

    #[test]
    fn test_add_elevation_point_execute_inserts_profile_entry() {
        let original = project_with_elevation_profile();
        let command = AddElevationPoint::new(
            "road-1",
            25.0,
            3.0,
            original.roads[0].elevation_profile.clone(),
        );

        let result = command.execute(&original).unwrap();

        assert_eq!(result.roads[0].elevation_profile.len(), 4);
        assert!(
            result.roads[0]
                .elevation_profile
                .iter()
                .any(|entry| (entry.s - 25.0).abs() < 1e-9 && (entry.a - 3.0).abs() < 1e-9)
        );
    }

    #[test]
    fn test_add_elevation_point_undo_restores_original_project() {
        let original = project_with_elevation_profile();
        let command = AddElevationPoint::new(
            "road-1",
            25.0,
            3.0,
            original.roads[0].elevation_profile.clone(),
        );
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_add_elevation_point_execute_missing_road_returns_error() {
        let project = project_with_elevation_profile();
        let command = AddElevationPoint::new("missing-road", 25.0, 3.0, vec![]);

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_delete_elevation_point_execute_removes_profile_entry() {
        let original = project_with_elevation_profile();
        let command = DeleteElevationPoint::new(
            "road-1",
            50.0,
            1.0,
            original.roads[0].elevation_profile.clone(),
        );

        let result = command.execute(&original).unwrap();

        assert_eq!(result.roads[0].elevation_profile.len(), 2);
        assert!(
            !result.roads[0]
                .elevation_profile
                .iter()
                .any(|entry| (entry.s - 50.0).abs() < 1e-9)
        );
    }

    #[test]
    fn test_delete_elevation_point_undo_restores_original_project() {
        let original = project_with_elevation_profile();
        let command = DeleteElevationPoint::new(
            "road-1",
            50.0,
            1.0,
            original.roads[0].elevation_profile.clone(),
        );
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_delete_elevation_point_execute_missing_station_returns_error() {
        let project = project_with_elevation_profile();
        let command = DeleteElevationPoint::new(
            "road-1",
            999.0,
            1.0,
            project.roads[0].elevation_profile.clone(),
        );

        assert_operation_failed(command.execute(&project), "No elevation point");
    }

    #[test]
    fn test_move_elevation_point_execute_updates_station_and_height() {
        let original = project_with_elevation_profile();
        let command = MoveElevationPoint::new(
            "road-1",
            50.0,
            60.0,
            7.0,
            1.0,
            original.roads[0].elevation_profile.clone(),
        );

        let result = command.execute(&original).unwrap();

        assert!(
            result.roads[0]
                .elevation_profile
                .iter()
                .any(|entry| (entry.s - 60.0).abs() < 1e-9 && (entry.a - 7.0).abs() < 1e-9)
        );
    }

    #[test]
    fn test_move_elevation_point_undo_restores_original_project() {
        let original = project_with_elevation_profile();
        let command = MoveElevationPoint::new(
            "road-1",
            50.0,
            60.0,
            7.0,
            1.0,
            original.roads[0].elevation_profile.clone(),
        );
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_move_elevation_point_execute_missing_station_returns_error() {
        let project = project_with_elevation_profile();
        let command = MoveElevationPoint::new(
            "road-1",
            999.0,
            60.0,
            7.0,
            1.0,
            project.roads[0].elevation_profile.clone(),
        );

        assert_operation_failed(command.execute(&project), "No elevation point");
    }

    #[test]
    fn test_smooth_elevation_execute_smooths_profile() {
        let original = project_with_elevation_profile();
        let command =
            SmoothElevation::new("road-1", 1, original.roads[0].elevation_profile.clone());

        let result = command.execute(&original).unwrap();

        assert!(result.roads[0].elevation_profile[1].a < 5.0);
    }

    #[test]
    fn test_smooth_elevation_undo_restores_original_project() {
        let original = project_with_elevation_profile();
        let command =
            SmoothElevation::new("road-1", 1, original.roads[0].elevation_profile.clone());
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_smooth_elevation_execute_missing_road_returns_error() {
        let project = project_with_elevation_profile();
        let command = SmoothElevation::new("missing-road", 1, vec![]);

        assert_operation_failed(command.execute(&project), "not found");
    }
}
