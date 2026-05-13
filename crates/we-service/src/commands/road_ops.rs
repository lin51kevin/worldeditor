//! Road transformation commands: Clone, Reverse, Mirror, OptimizeKnots, SwapCenterline.

use we_core::{
    model::{Project, Road},
    road_ops::{self, OptimizeConfig},
};

use crate::{Command, EditorError};

use super::find_road_mut;

// ── CloneRoad ────────────────────────────────────────────────────────────────

/// Clone an existing road with a new ID and an XY position offset.
///
/// The clone has no predecessor/successor links. The original is untouched.
#[derive(Debug, Clone)]
pub struct CloneRoad {
    /// ID of the road to clone.
    pub source_id: String,
    /// ID to assign to the new road.
    pub new_id: String,
    /// (dx, dy) offset applied to every geometry segment of the clone.
    pub offset_xy: [f64; 2],
}

impl CloneRoad {
    pub fn new(
        source_id: impl Into<String>,
        new_id: impl Into<String>,
        offset_xy: [f64; 2],
    ) -> Self {
        Self {
            source_id: source_id.into(),
            new_id: new_id.into(),
            offset_xy,
        }
    }
}

impl Command for CloneRoad {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let source = project
            .roads
            .iter()
            .find(|r| r.id == self.source_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Road '{}' not found", self.source_id))
            })?;

        if project.roads.iter().any(|r| r.id == self.new_id) {
            return Err(EditorError::OperationFailed(format!(
                "Road '{}' already exists",
                self.new_id
            )));
        }

        let cloned = road_ops::clone_road(source, &self.new_id, self.offset_xy);
        let mut p = project.clone();
        p.roads.push(cloned);
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        p.roads.retain(|r| r.id != self.new_id);
        Ok(p)
    }

    fn description(&self) -> &str {
        "Clone Road"
    }
}

// ── ReverseRoad ──────────────────────────────────────────────────────────────

/// Reverse the travel direction of a road.
///
/// Geometry segments are reordered, lane sides are swapped, and
/// predecessor/successor links are exchanged.
#[derive(Debug, Clone)]
pub struct ReverseRoad {
    pub road_id: String,
    /// Snapshot before reversal for undo.
    snapshot: Option<Road>,
}

impl ReverseRoad {
    pub fn new(road_id: impl Into<String>) -> Self {
        Self {
            road_id: road_id.into(),
            snapshot: None,
        }
    }

    pub fn with_snapshot(road_id: impl Into<String>, road: Road) -> Self {
        Self {
            road_id: road_id.into(),
            snapshot: Some(road),
        }
    }
}

impl Command for ReverseRoad {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let source = project
            .roads
            .iter()
            .find(|r| r.id == self.road_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Road '{}' not found", self.road_id))
            })?;

        let reversed = road_ops::reverse_road(source);
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        *road = reversed;
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let snap = self
            .snapshot
            .as_ref()
            .ok_or_else(|| EditorError::OperationFailed("Cannot undo: no snapshot".into()))?;
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        *road = snap.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Reverse Road"
    }
}

// ── MirrorRoad ───────────────────────────────────────────────────────────────

/// Mirror a road's lane layout (left ↔ right), keeping the reference line.
#[derive(Debug, Clone)]
pub struct MirrorRoad {
    pub road_id: String,
    snapshot: Option<Road>,
}

impl MirrorRoad {
    pub fn new(road_id: impl Into<String>) -> Self {
        Self {
            road_id: road_id.into(),
            snapshot: None,
        }
    }

    pub fn with_snapshot(road_id: impl Into<String>, road: Road) -> Self {
        Self {
            road_id: road_id.into(),
            snapshot: Some(road),
        }
    }
}

impl Command for MirrorRoad {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let source = project
            .roads
            .iter()
            .find(|r| r.id == self.road_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Road '{}' not found", self.road_id))
            })?;

        let mirrored = road_ops::mirror_road(source);
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        *road = mirrored;
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let snap = self
            .snapshot
            .as_ref()
            .ok_or_else(|| EditorError::OperationFailed("Cannot undo: no snapshot".into()))?;
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        *road = snap.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Mirror Road"
    }
}

// ── OptimizeRoadKnots ────────────────────────────────────────────────────────

/// Remove redundant knots from a road's reference-line spline.
///
/// Uses Douglas–Peucker simplification with configurable XY and Z tolerances.
#[derive(Debug, Clone)]
pub struct OptimizeRoadKnots {
    pub road_id: String,
    pub config: OptimizeConfig,
    snapshot: Option<Road>,
}

impl OptimizeRoadKnots {
    pub fn new(road_id: impl Into<String>) -> Self {
        Self {
            road_id: road_id.into(),
            config: OptimizeConfig::default(),
            snapshot: None,
        }
    }

    pub fn with_config(road_id: impl Into<String>, config: OptimizeConfig) -> Self {
        Self {
            road_id: road_id.into(),
            config,
            snapshot: None,
        }
    }

    pub fn with_snapshot(road_id: impl Into<String>, config: OptimizeConfig, road: Road) -> Self {
        Self {
            road_id: road_id.into(),
            config,
            snapshot: Some(road),
        }
    }
}

impl Command for OptimizeRoadKnots {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let source = project
            .roads
            .iter()
            .find(|r| r.id == self.road_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Road '{}' not found", self.road_id))
            })?;

        let (optimized, _removed) = road_ops::optimize_road_knots(source, &self.config);
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        *road = optimized;
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let snap = self
            .snapshot
            .as_ref()
            .ok_or_else(|| EditorError::OperationFailed("Cannot undo: no snapshot".into()))?;
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        *road = snap.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Optimize Road Knots"
    }
}

// ── SwapCenterline ───────────────────────────────────────────────────────────

/// Swap the road's reference line with the outer edge of a target lane.
///
/// The target lane's outer edge becomes the new reference line.
/// Lane sections are rebuilt; links are cleared (geometry changed).
#[derive(Debug, Clone)]
pub struct SwapCenterline {
    pub road_id: String,
    /// Lane ID whose outer edge becomes the new centerline (non-zero).
    pub target_lane_id: i32,
    snapshot: Option<Road>,
}

impl SwapCenterline {
    pub fn new(road_id: impl Into<String>, target_lane_id: i32) -> Self {
        Self {
            road_id: road_id.into(),
            target_lane_id,
            snapshot: None,
        }
    }

    pub fn with_snapshot(road_id: impl Into<String>, target_lane_id: i32, road: Road) -> Self {
        Self {
            road_id: road_id.into(),
            target_lane_id,
            snapshot: Some(road),
        }
    }
}

impl Command for SwapCenterline {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let source = project
            .roads
            .iter()
            .find(|r| r.id == self.road_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Road '{}' not found", self.road_id))
            })?;

        let swapped = road_ops::swap_centerline_with_edge(source, self.target_lane_id);
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        *road = swapped;
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let snap = self
            .snapshot
            .as_ref()
            .ok_or_else(|| EditorError::OperationFailed("Cannot undo: no snapshot".into()))?;
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        *road = snap.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Swap Centerline with Lane Edge"
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use we_core::model::{Geometry, GeometryType, Header, Project};

    fn make_project() -> Project {
        use we_core::model::Road;
        let road = Road::from_centerline(
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
        Project {
            name: "test".into(),
            header: Header::default(),
            roads: vec![road],
            junctions: vec![],
            ..Default::default()
        }
    }

    // ── CloneRoad ──────────────────────────────────────────────────────────────

    #[test]
    fn test_clone_road_cmd_adds_road() {
        let project = make_project();
        let cmd = CloneRoad::new("road-1", "road-2", [20.0, 0.0]);
        let result = cmd.execute(&project).unwrap();
        assert_eq!(result.roads.len(), 2);
    }

    #[test]
    fn test_clone_road_cmd_new_id() {
        let project = make_project();
        let cmd = CloneRoad::new("road-1", "road-copy", [0.0, 0.0]);
        let result = cmd.execute(&project).unwrap();
        assert!(result.roads.iter().any(|r| r.id == "road-copy"));
    }

    #[test]
    fn test_clone_road_cmd_source_missing() {
        let project = make_project();
        let cmd = CloneRoad::new("missing", "road-2", [0.0, 0.0]);
        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_clone_road_cmd_duplicate_new_id() {
        let project = make_project();
        let cmd = CloneRoad::new("road-1", "road-1", [0.0, 0.0]);
        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_clone_road_cmd_undo_removes_clone() {
        let project = make_project();
        let cmd = CloneRoad::new("road-1", "road-2", [0.0, 0.0]);
        let after = cmd.execute(&project).unwrap();
        assert_eq!(after.roads.len(), 2);
        let undone = cmd.undo(&after).unwrap();
        assert_eq!(undone.roads.len(), 1);
        assert_eq!(undone.roads[0].id, "road-1");
    }

    #[test]
    fn test_clone_road_cmd_applies_offset() {
        let project = make_project();
        let cmd = CloneRoad::new("road-1", "road-2", [50.0, 30.0]);
        let result = cmd.execute(&project).unwrap();
        let clone = result.roads.iter().find(|r| r.id == "road-2").unwrap();
        assert!((clone.plan_view[0].x - 50.0).abs() < 1e-9);
        assert!((clone.plan_view[0].y - 30.0).abs() < 1e-9);
    }

    // ── ReverseRoad ────────────────────────────────────────────────────────────

    #[test]
    fn test_reverse_road_cmd_reverses_geometry() {
        let project = make_project();
        let snap = project.roads[0].clone();
        let cmd = ReverseRoad::with_snapshot("road-1", snap);
        let result = cmd.execute(&project).unwrap();
        let road = &result.roads[0];
        // After reversal the line now starts at x=100
        assert!((road.plan_view[0].x - 100.0).abs() < 1e-6);
    }

    #[test]
    fn test_reverse_road_cmd_road_not_found() {
        let project = make_project();
        let cmd = ReverseRoad::new("nonexistent");
        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_reverse_road_cmd_undo_restores_original() {
        let project = make_project();
        let original_x = project.roads[0].plan_view[0].x;
        let snap = project.roads[0].clone();
        let cmd = ReverseRoad::with_snapshot("road-1", snap);
        let after = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&after).unwrap();
        assert!((undone.roads[0].plan_view[0].x - original_x).abs() < 1e-9);
    }

    #[test]
    fn test_reverse_road_cmd_undo_without_snapshot_fails() {
        let project = make_project();
        let cmd = ReverseRoad::new("road-1");
        let after = cmd.execute(&project).unwrap();
        assert!(cmd.undo(&after).is_err());
    }

    // ── MirrorRoad ─────────────────────────────────────────────────────────────

    #[test]
    fn test_mirror_road_cmd_swaps_lanes() {
        let project = make_project();
        let snap = project.roads[0].clone();
        let cmd = MirrorRoad::with_snapshot("road-1", snap);
        let result = cmd.execute(&project).unwrap();
        let road = &result.roads[0];
        // After mirror: left lanes have positive IDs, right have negative
        for lane in &road.lane_sections[0].left {
            assert!(lane.id >= 0, "left lane id should be >= 0, got {}", lane.id);
        }
        for lane in &road.lane_sections[0].right {
            assert!(
                lane.id <= 0,
                "right lane id should be <= 0, got {}",
                lane.id
            );
        }
    }

    #[test]
    fn test_mirror_road_cmd_road_not_found() {
        let project = make_project();
        let cmd = MirrorRoad::new("nonexistent");
        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_mirror_road_cmd_undo_restores() {
        let project = make_project();
        let snap = project.roads[0].clone();
        let original_left_ids: Vec<i32> = snap.lane_sections[0].left.iter().map(|l| l.id).collect();
        let cmd = MirrorRoad::with_snapshot("road-1", snap.clone());
        let after = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&after).unwrap();
        let restored_left_ids: Vec<i32> = undone.roads[0].lane_sections[0]
            .left
            .iter()
            .map(|l| l.id)
            .collect();
        assert_eq!(restored_left_ids, original_left_ids);
    }

    // ── OptimizeRoadKnots ──────────────────────────────────────────────────────

    #[test]
    fn test_optimize_road_cmd_road_not_found() {
        let project = make_project();
        let cmd = OptimizeRoadKnots::new("nonexistent");
        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_optimize_road_cmd_produces_valid_road() {
        let project = make_project();
        let snap = project.roads[0].clone();
        let cmd = OptimizeRoadKnots::with_snapshot("road-1", OptimizeConfig::default(), snap);
        let result = cmd.execute(&project).unwrap();
        let road = &result.roads[0];
        assert!(!road.plan_view.is_empty());
        assert!(road.length > 0.0);
    }

    #[test]
    fn test_optimize_road_cmd_undo_restores() {
        let project = make_project();
        let snap = project.roads[0].clone();
        let original_geo_len = snap.plan_view.len();
        let cmd = OptimizeRoadKnots::with_snapshot("road-1", OptimizeConfig::default(), snap);
        let after = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&after).unwrap();
        assert_eq!(undone.roads[0].plan_view.len(), original_geo_len);
    }

    // ── SwapCenterline ─────────────────────────────────────────────────────────

    #[test]
    fn test_swap_centerline_cmd_produces_valid_road() {
        let project = make_project();
        let snap = project.roads[0].clone();
        let cmd = SwapCenterline::with_snapshot("road-1", 1, snap);
        let result = cmd.execute(&project).unwrap();
        assert!(!result.roads[0].plan_view.is_empty());
        assert!(result.roads[0].length > 0.0);
    }

    #[test]
    fn test_swap_centerline_cmd_road_not_found() {
        let project = make_project();
        let cmd = SwapCenterline::new("missing", 1);
        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_swap_centerline_cmd_undo_restores() {
        let project = make_project();
        let snap = project.roads[0].clone();
        let orig_x = snap.plan_view[0].x;
        let cmd = SwapCenterline::with_snapshot("road-1", 1, snap);
        let after = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&after).unwrap();
        assert!((undone.roads[0].plan_view[0].x - orig_x).abs() < 1e-9);
    }

    #[test]
    fn test_swap_centerline_cmd_undo_without_snapshot_fails() {
        let project = make_project();
        let cmd = SwapCenterline::new("road-1", 1);
        let after = cmd.execute(&project).unwrap();
        assert!(cmd.undo(&after).is_err());
    }
}
