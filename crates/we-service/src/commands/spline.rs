//! Spline/knot editing commands.

use we_core::model::*;

use crate::{Command, EditorError};

use super::find_road_mut;

// ── ModifyRoadKnots ──────────────────────────────────

/// Modify a road's geometry by editing its spline knots and rebuilding.
///
/// This is the core spline editing command — it:
/// 1. Takes the new spline knot state
/// 2. Converts knots → OpenDRIVE geometry (plan_view)
/// 3. Updates road length
/// 4. Stores old state for undo
#[derive(Debug, Clone)]
pub struct ModifyRoadKnots {
    pub road_id: String,
    /// Old plan_view for undo.
    pub old_plan_view: Vec<Geometry>,
    pub old_length: f64,
    /// New knots to convert and apply.
    pub new_knots: Vec<we_core::spline::SplineKnot>,
    /// Geometry output mode.
    pub output_mode: we_core::spline::SplineOutputMode,
}

impl ModifyRoadKnots {
    pub fn new(
        road_id: impl Into<String>,
        old_plan_view: Vec<Geometry>,
        old_length: f64,
        new_knots: Vec<we_core::spline::SplineKnot>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            old_plan_view,
            old_length,
            new_knots,
            output_mode: we_core::spline::SplineOutputMode::Classify,
        }
    }
}

impl Command for ModifyRoadKnots {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;

        let spline = we_core::spline::EditableSpline::from_knots(self.new_knots.clone());
        let new_geos = we_core::spline::spline_to_geometries_with_mode(&spline, self.output_mode);

        if new_geos.is_empty() {
            return Err(EditorError::OperationFailed(
                "Spline conversion produced no geometry".into(),
            ));
        }

        road.plan_view = new_geos;
        road.length = road.plan_view.iter().map(|g| g.length).sum();

        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.plan_view = self.old_plan_view.clone();
        road.length = self.old_length;
        Ok(p)
    }

    fn description(&self) -> &str {
        "Modify Road Knots"
    }
}

// ── MoveKnot ─────────────────────────────────────────

/// Parameters for a knot move operation.
#[derive(Debug, Clone)]
pub struct MoveKnotParams {
    /// Original spline knots (for computing displacement).
    pub original_knots: Vec<we_core::spline::SplineKnot>,
    /// Index of the primary knot being moved.
    pub knot_index: usize,
    /// New position for the primary knot.
    pub new_position: [f64; 3],
    /// Soft selection factors: (index, influence). Empty = no soft selection.
    pub soft_factors: Vec<(usize, f64)>,
    /// Movement constraint.
    pub constraint: we_core::spline::MoveConstraint,
}

/// Move a knot on a road's spline and rebuild the road geometry.
///
/// Supports soft selection — neighbors are moved proportionally.
#[derive(Debug, Clone)]
pub struct MoveKnot {
    pub road_id: String,
    pub old_plan_view: Vec<Geometry>,
    pub old_length: f64,
    pub params: MoveKnotParams,
    pub output_mode: we_core::spline::SplineOutputMode,
}

impl MoveKnot {
    pub fn new(
        road_id: impl Into<String>,
        old_plan_view: Vec<Geometry>,
        old_length: f64,
        params: MoveKnotParams,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            old_plan_view,
            old_length,
            params,
            output_mode: we_core::spline::SplineOutputMode::Classify,
        }
    }
}

impl Command for MoveKnot {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;

        let mut spline =
            we_core::spline::EditableSpline::from_knots(self.params.original_knots.clone());

        if self.params.knot_index >= spline.knots.len() {
            return Err(EditorError::OperationFailed(format!(
                "Knot index {} out of range ({})",
                self.params.knot_index,
                spline.knots.len()
            )));
        }

        // Compute displacement with constraint
        let old_pos = spline.knots[self.params.knot_index].position;
        let raw_displacement = [
            self.params.new_position[0] - old_pos[0],
            self.params.new_position[1] - old_pos[1],
            self.params.new_position[2] - old_pos[2],
        ];
        let displacement =
            we_core::spline::constrain_displacement(raw_displacement, self.params.constraint);

        // Apply with soft selection
        if self.params.soft_factors.is_empty() {
            let new_pos = [
                old_pos[0] + displacement[0],
                old_pos[1] + displacement[1],
                old_pos[2] + displacement[2],
            ];
            spline.move_knot(self.params.knot_index, new_pos);
        } else {
            we_core::spline::apply_soft_selection_move(
                &mut spline,
                &self.params.soft_factors,
                displacement,
            );
        }

        // Convert back to OpenDRIVE
        let new_geos = we_core::spline::spline_to_geometries_with_mode(&spline, self.output_mode);
        if new_geos.is_empty() {
            return Err(EditorError::OperationFailed(
                "Spline conversion produced no geometry".into(),
            ));
        }

        road.plan_view = new_geos;
        road.length = road.plan_view.iter().map(|g| g.length).sum();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.plan_view = self.old_plan_view.clone();
        road.length = self.old_length;
        Ok(p)
    }

    fn description(&self) -> &str {
        "Move Knot"
    }
}

// ── InsertKnot ───────────────────────────────────────

/// Insert a new knot into a road's spline and rebuild geometry.
#[derive(Debug, Clone)]
pub struct InsertKnot {
    pub road_id: String,
    pub old_plan_view: Vec<Geometry>,
    pub old_length: f64,
    /// The knots before insertion.
    pub original_knots: Vec<we_core::spline::SplineKnot>,
    /// Position for the new knot.
    pub position: [f64; 3],
    /// Index where to insert (computed from `find_insertion_index` if not specified).
    pub insert_index: Option<usize>,
    /// Geometry output mode.
    pub output_mode: we_core::spline::SplineOutputMode,
}

impl InsertKnot {
    pub fn new(
        road_id: impl Into<String>,
        old_plan_view: Vec<Geometry>,
        old_length: f64,
        original_knots: Vec<we_core::spline::SplineKnot>,
        position: [f64; 3],
        insert_index: Option<usize>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            old_plan_view,
            old_length,
            original_knots,
            position,
            insert_index,
            output_mode: we_core::spline::SplineOutputMode::Classify,
        }
    }
}

impl Command for InsertKnot {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;

        let mut spline = we_core::spline::EditableSpline::from_knots(self.original_knots.clone());

        let idx = self.insert_index.unwrap_or_else(|| {
            we_core::spline::find_insertion_index(&spline, self.position[0], self.position[1])
        });

        let mut knot =
            we_core::spline::SplineKnot::new(self.position[0], self.position[1], self.position[2]);
        knot.knot_type = we_core::spline::KnotType::Key;
        spline.insert(idx, knot);
        spline.recompute_stations();
        spline.compute_tangents();

        let new_geos = we_core::spline::spline_to_geometries_with_mode(&spline, self.output_mode);
        if new_geos.is_empty() {
            return Err(EditorError::OperationFailed(
                "Spline conversion produced no geometry after insert".into(),
            ));
        }

        road.plan_view = new_geos;
        road.length = road.plan_view.iter().map(|g| g.length).sum();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.plan_view = self.old_plan_view.clone();
        road.length = self.old_length;
        Ok(p)
    }

    fn description(&self) -> &str {
        "Insert Knot"
    }
}

// ── DeleteKnot ───────────────────────────────────────

/// Remove a knot from a road's spline and rebuild geometry.
#[derive(Debug, Clone)]
pub struct DeleteKnot {
    pub road_id: String,
    pub old_plan_view: Vec<Geometry>,
    pub old_length: f64,
    pub original_knots: Vec<we_core::spline::SplineKnot>,
    pub knot_index: usize,
    pub output_mode: we_core::spline::SplineOutputMode,
}

impl DeleteKnot {
    pub fn new(
        road_id: impl Into<String>,
        old_plan_view: Vec<Geometry>,
        old_length: f64,
        original_knots: Vec<we_core::spline::SplineKnot>,
        knot_index: usize,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            old_plan_view,
            old_length,
            original_knots,
            knot_index,
            output_mode: we_core::spline::SplineOutputMode::Classify,
        }
    }
}

impl Command for DeleteKnot {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;

        let mut spline = we_core::spline::EditableSpline::from_knots(self.original_knots.clone());

        if self.knot_index >= spline.knots.len() {
            return Err(EditorError::OperationFailed(format!(
                "Knot index {} out of range",
                self.knot_index
            )));
        }

        if spline.knots.len() <= 2 {
            return Err(EditorError::OperationFailed(
                "Cannot delete knot: road needs at least 2 knots".into(),
            ));
        }

        spline.remove(self.knot_index);
        spline.recompute_stations();
        spline.compute_tangents();

        let new_geos = we_core::spline::spline_to_geometries_with_mode(&spline, self.output_mode);
        if new_geos.is_empty() {
            return Err(EditorError::OperationFailed(
                "Spline conversion produced no geometry after delete".into(),
            ));
        }

        road.plan_view = new_geos;
        road.length = road.plan_view.iter().map(|g| g.length).sum();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.plan_view = self.old_plan_view.clone();
        road.length = self.old_length;
        Ok(p)
    }

    fn description(&self) -> &str {
        "Delete Knot"
    }
}

// ── SetKnotTangent ───────────────────────────────────

/// Manually set a knot's tangent and rebuild geometry.
#[derive(Debug, Clone)]
pub struct SetKnotTangent {
    pub road_id: String,
    pub old_plan_view: Vec<Geometry>,
    pub old_length: f64,
    pub original_knots: Vec<we_core::spline::SplineKnot>,
    pub knot_index: usize,
    pub new_tangent: [f64; 3],
    pub output_mode: we_core::spline::SplineOutputMode,
}

impl SetKnotTangent {
    pub fn new(
        road_id: impl Into<String>,
        old_plan_view: Vec<Geometry>,
        old_length: f64,
        original_knots: Vec<we_core::spline::SplineKnot>,
        knot_index: usize,
        new_tangent: [f64; 3],
    ) -> Self {
        Self {
            road_id: road_id.into(),
            old_plan_view,
            old_length,
            original_knots,
            knot_index,
            new_tangent,
            output_mode: we_core::spline::SplineOutputMode::Classify,
        }
    }
}

impl Command for SetKnotTangent {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;

        let mut spline = we_core::spline::EditableSpline::from_knots(self.original_knots.clone());

        if self.knot_index >= spline.knots.len() {
            return Err(EditorError::OperationFailed(format!(
                "Knot index {} out of range",
                self.knot_index
            )));
        }

        let len = (self.new_tangent[0].powi(2)
            + self.new_tangent[1].powi(2)
            + self.new_tangent[2].powi(2))
        .sqrt();
        if len <= 1e-12 {
            return Err(EditorError::OperationFailed("Zero-length tangent".into()));
        }
        let tangent = [
            self.new_tangent[0] / len,
            self.new_tangent[1] / len,
            self.new_tangent[2] / len,
        ];

        spline.knots[self.knot_index].tangent_in = tangent;
        spline.knots[self.knot_index].tangent_out = tangent;
        spline.knots[self.knot_index].tangent_mode = we_core::spline::TangentMode::Manual;

        let new_geos = we_core::spline::spline_to_geometries_with_mode(&spline, self.output_mode);
        if new_geos.is_empty() {
            return Err(EditorError::OperationFailed(
                "Spline conversion produced no geometry".into(),
            ));
        }

        road.plan_view = new_geos;
        road.length = road.plan_view.iter().map(|g| g.length).sum();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.plan_view = self.old_plan_view.clone();
        road.length = self.old_length;
        Ok(p)
    }

    fn description(&self) -> &str {
        "Set Knot Tangent"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use we_core::spline::{MoveConstraint, SplineKnot};

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

    fn make_straight_knots() -> Vec<SplineKnot> {
        vec![
            SplineKnot::with_tangent(0.0, 0.0, 0.0, 1.0, 0.0, 0.0),
            SplineKnot::with_tangent(50.0, 0.0, 0.0, 1.0, 0.0, 0.0),
            SplineKnot::with_tangent(100.0, 0.0, 0.0, 1.0, 0.0, 0.0),
        ]
    }

    fn make_curved_knots() -> Vec<SplineKnot> {
        vec![
            SplineKnot::with_tangent(0.0, 0.0, 0.0, 1.0, 0.0, 0.0),
            SplineKnot::with_tangent(50.0, 20.0, 0.0, 1.0, 0.0, 0.0),
            SplineKnot::with_tangent(100.0, 0.0, 0.0, 1.0, 0.0, 0.0),
        ]
    }

    fn assert_plan_view_restored(project: &Project, old_plan_view: &[Geometry], old_length: f64) {
        assert_eq!(project.roads[0].plan_view.len(), old_plan_view.len());
        assert!((project.roads[0].length - old_length).abs() < 1e-6);
        assert!((project.roads[0].plan_view[0].x - old_plan_view[0].x).abs() < 1e-6);
        assert!((project.roads[0].plan_view[0].y - old_plan_view[0].y).abs() < 1e-6);
    }

    #[test]
    fn test_modify_road_knots_execute_updates_plan_view() {
        let project = make_project();
        let old_length = project.roads[0].length;
        let cmd = ModifyRoadKnots::new(
            "road-1",
            project.roads[0].plan_view.clone(),
            old_length,
            make_curved_knots(),
        );

        let result = cmd.execute(&project).unwrap();

        assert!(!result.roads[0].plan_view.is_empty());
        assert!(result.roads[0].length > old_length);
    }

    #[test]
    fn test_modify_road_knots_undo_restores_plan_view() {
        let project = make_project();
        let old_plan_view = project.roads[0].plan_view.clone();
        let old_length = project.roads[0].length;
        let cmd = ModifyRoadKnots::new(
            "road-1",
            old_plan_view.clone(),
            old_length,
            make_curved_knots(),
        );

        let executed = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&executed).unwrap();

        assert_plan_view_restored(&undone, &old_plan_view, old_length);
    }

    #[test]
    fn test_modify_road_knots_execute_missing_road_returns_error() {
        let project = make_project();
        let cmd = ModifyRoadKnots::new("missing-road", vec![], 0.0, make_curved_knots());

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_move_knot_execute_moves_knot_geometry() {
        let project = make_project();
        let old_length = project.roads[0].length;
        let cmd = MoveKnot::new(
            "road-1",
            project.roads[0].plan_view.clone(),
            old_length,
            MoveKnotParams {
                original_knots: make_straight_knots(),
                knot_index: 1,
                new_position: [50.0, 20.0, 0.0],
                soft_factors: vec![],
                constraint: MoveConstraint::Free,
            },
        );

        let result = cmd.execute(&project).unwrap();

        assert!(!result.roads[0].plan_view.is_empty());
        assert!(result.roads[0].length > old_length);
    }

    #[test]
    fn test_move_knot_undo_restores_plan_view() {
        let project = make_project();
        let old_plan_view = project.roads[0].plan_view.clone();
        let old_length = project.roads[0].length;
        let cmd = MoveKnot::new(
            "road-1",
            old_plan_view.clone(),
            old_length,
            MoveKnotParams {
                original_knots: make_straight_knots(),
                knot_index: 1,
                new_position: [50.0, 20.0, 0.0],
                soft_factors: vec![],
                constraint: MoveConstraint::Free,
            },
        );

        let executed = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&executed).unwrap();

        assert_plan_view_restored(&undone, &old_plan_view, old_length);
    }

    #[test]
    fn test_move_knot_execute_out_of_range_returns_error() {
        let project = make_project();
        let cmd = MoveKnot::new(
            "road-1",
            project.roads[0].plan_view.clone(),
            project.roads[0].length,
            MoveKnotParams {
                original_knots: make_straight_knots(),
                knot_index: 9,
                new_position: [50.0, 20.0, 0.0],
                soft_factors: vec![],
                constraint: MoveConstraint::Free,
            },
        );

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_insert_knot_execute_inserts_knot_geometry() {
        let project = make_project();
        let old_length = project.roads[0].length;
        let cmd = InsertKnot::new(
            "road-1",
            project.roads[0].plan_view.clone(),
            old_length,
            make_straight_knots(),
            [25.0, 10.0, 0.0],
            None,
        );

        let result = cmd.execute(&project).unwrap();

        assert!(!result.roads[0].plan_view.is_empty());
        assert!(result.roads[0].length > old_length);
    }

    #[test]
    fn test_insert_knot_undo_restores_plan_view() {
        let project = make_project();
        let old_plan_view = project.roads[0].plan_view.clone();
        let old_length = project.roads[0].length;
        let cmd = InsertKnot::new(
            "road-1",
            old_plan_view.clone(),
            old_length,
            make_straight_knots(),
            [25.0, 10.0, 0.0],
            None,
        );

        let executed = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&executed).unwrap();

        assert_plan_view_restored(&undone, &old_plan_view, old_length);
    }

    #[test]
    fn test_insert_knot_execute_missing_road_returns_error() {
        let project = make_project();
        let cmd = InsertKnot::new(
            "missing-road",
            project.roads[0].plan_view.clone(),
            project.roads[0].length,
            make_straight_knots(),
            [25.0, 10.0, 0.0],
            None,
        );

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_delete_knot_execute_removes_knot_geometry() {
        let project = make_project();
        let cmd = DeleteKnot::new(
            "road-1",
            project.roads[0].plan_view.clone(),
            project.roads[0].length,
            make_straight_knots(),
            1,
        );

        let result = cmd.execute(&project).unwrap();

        assert!(!result.roads[0].plan_view.is_empty());
        assert!(matches!(
            result.roads[0].plan_view[0].geo_type,
            GeometryType::Line
        ));
    }

    #[test]
    fn test_delete_knot_undo_restores_plan_view() {
        let project = make_project();
        let old_plan_view = project.roads[0].plan_view.clone();
        let old_length = project.roads[0].length;
        let cmd = DeleteKnot::new(
            "road-1",
            old_plan_view.clone(),
            old_length,
            make_straight_knots(),
            1,
        );

        let executed = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&executed).unwrap();

        assert_plan_view_restored(&undone, &old_plan_view, old_length);
    }

    #[test]
    fn test_delete_knot_execute_out_of_range_returns_error() {
        let project = make_project();
        let cmd = DeleteKnot::new(
            "road-1",
            project.roads[0].plan_view.clone(),
            project.roads[0].length,
            make_straight_knots(),
            9,
        );

        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_set_knot_tangent_execute_updates_geometry() {
        let project = make_project();
        let cmd = SetKnotTangent::new(
            "road-1",
            project.roads[0].plan_view.clone(),
            project.roads[0].length,
            make_straight_knots(),
            1,
            [0.0, 1.0, 0.0],
        );

        let result = cmd.execute(&project).unwrap();

        assert!(!result.roads[0].plan_view.is_empty());
        assert!(
            result.roads[0]
                .plan_view
                .iter()
                .any(|geometry| !matches!(geometry.geo_type, GeometryType::Line))
        );
    }

    #[test]
    fn test_set_knot_tangent_undo_restores_plan_view() {
        let project = make_project();
        let old_plan_view = project.roads[0].plan_view.clone();
        let old_length = project.roads[0].length;
        let cmd = SetKnotTangent::new(
            "road-1",
            old_plan_view.clone(),
            old_length,
            make_straight_knots(),
            1,
            [0.0, 1.0, 0.0],
        );

        let executed = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&executed).unwrap();

        assert_plan_view_restored(&undone, &old_plan_view, old_length);
    }

    #[test]
    fn test_set_knot_tangent_execute_zero_tangent_returns_error() {
        let project = make_project();
        let cmd = SetKnotTangent::new(
            "road-1",
            project.roads[0].plan_view.clone(),
            project.roads[0].length,
            make_straight_knots(),
            1,
            [0.0, 0.0, 0.0],
        );

        assert!(cmd.execute(&project).is_err());
    }
}
