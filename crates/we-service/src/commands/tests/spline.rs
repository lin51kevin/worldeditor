#![allow(unused_imports)]
use super::super::*;
use super::*;
use crate::Command;


#[test]
fn test_create_road_from_spline_empty_knots() {
    use we_core::spline::{EditableSpline, SplineOutputMode};

    let project = Project::default();
    let spline = EditableSpline::new();
    let template = RoadTemplate::single_lane();
    let cmd = CreateRoadFromSpline::new("road_1", spline, template, SplineOutputMode::Classify);
    assert!(cmd.execute(&project).is_err());
}


#[test]
fn test_create_road_from_spline_single_knot() {
    use we_core::spline::{EditableSpline, SplineKnot, SplineOutputMode};

    let project = Project::default();
    let spline = EditableSpline::from_knots(vec![SplineKnot::new(0.0, 0.0, 0.0)]);
    let template = RoadTemplate::single_lane();
    let cmd = CreateRoadFromSpline::new("road_1", spline, template, SplineOutputMode::Classify);
    assert!(cmd.execute(&project).is_err());
}


#[test]
fn test_modify_road_knots_execute() {
    let project = make_project_with_road();
    let cmd = ModifyRoadKnots::new(
        "road_1",
        project.roads[0].plan_view.clone(),
        project.roads[0].length,
        make_straight_knots(),
    );
    let result = cmd.execute(&project).unwrap();
    assert!(!result.roads[0].plan_view.is_empty());
    assert!(result.roads[0].length > 0.0);
}


#[test]
fn test_modify_road_knots_undo() {
    let project = make_project_with_road();
    let old_pv = project.roads[0].plan_view.clone();
    let old_len = project.roads[0].length;
    let cmd = ModifyRoadKnots::new("road_1", old_pv.clone(), old_len, make_straight_knots());
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert_eq!(undone.roads[0].plan_view.len(), old_pv.len());
    assert!((undone.roads[0].length - old_len).abs() < 1e-6);
}


#[test]
fn test_modify_road_knots_invalid_road() {
    let project = make_project_with_road();
    let cmd = ModifyRoadKnots::new("nonexistent", vec![], 0.0, make_straight_knots());
    assert!(cmd.execute(&project).is_err());
}


#[test]
fn test_move_knot_execute() {
    let project = make_project_with_road();
    let cmd = MoveKnot::new(
        "road_1",
        project.roads[0].plan_view.clone(),
        project.roads[0].length,
        MoveKnotParams {
            original_knots: make_straight_knots(),
            knot_index: 1,
            new_position: [50.0, 20.0, 0.0],
            soft_factors: vec![],
            constraint: we_core::spline::MoveConstraint::Free,
        },
    );
    let result = cmd.execute(&project).unwrap();
    assert!(!result.roads[0].plan_view.is_empty());
    assert!(
        result.roads[0]
            .plan_view
            .iter()
            .any(|g| { matches!(g.geo_type, GeometryType::ParamPoly3 { .. }) })
    );
}


#[test]
fn test_move_knot_with_constraint() {
    let project = make_project_with_road();
    let cmd = MoveKnot::new(
        "road_1",
        project.roads[0].plan_view.clone(),
        project.roads[0].length,
        MoveKnotParams {
            original_knots: make_straight_knots(),
            knot_index: 1,
            new_position: [50.0, 20.0, 5.0],
            soft_factors: vec![],
            constraint: we_core::spline::MoveConstraint::XAxis,
        },
    );
    let result = cmd.execute(&project).unwrap();
    assert!(!result.roads[0].plan_view.is_empty());
}


#[test]
fn test_move_knot_with_soft_selection() {
    let project = make_project_with_road();
    let cmd = MoveKnot::new(
        "road_1",
        project.roads[0].plan_view.clone(),
        project.roads[0].length,
        MoveKnotParams {
            original_knots: make_straight_knots(),
            knot_index: 1,
            new_position: [50.0, 10.0, 0.0],
            soft_factors: vec![(0, 0.3), (1, 1.0), (2, 0.3)],
            constraint: we_core::spline::MoveConstraint::Free,
        },
    );
    let result = cmd.execute(&project).unwrap();
    assert!(!result.roads[0].plan_view.is_empty());
}


#[test]
fn test_move_knot_undo() {
    let project = make_project_with_road();
    let old_pv = project.roads[0].plan_view.clone();
    let old_len = project.roads[0].length;
    let cmd = MoveKnot::new(
        "road_1",
        old_pv.clone(),
        old_len,
        MoveKnotParams {
            original_knots: make_straight_knots(),
            knot_index: 1,
            new_position: [50.0, 20.0, 0.0],
            soft_factors: vec![],
            constraint: we_core::spline::MoveConstraint::Free,
        },
    );
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert_eq!(undone.roads[0].plan_view.len(), old_pv.len());
    assert!((undone.roads[0].length - old_len).abs() < 1e-6);
}


#[test]
fn test_move_knot_out_of_range() {
    let project = make_project_with_road();
    let cmd = MoveKnot::new(
        "road_1",
        project.roads[0].plan_view.clone(),
        project.roads[0].length,
        MoveKnotParams {
            original_knots: make_straight_knots(),
            knot_index: 99,
            new_position: [0.0, 0.0, 0.0],
            soft_factors: vec![],
            constraint: we_core::spline::MoveConstraint::Free,
        },
    );
    assert!(cmd.execute(&project).is_err());
}


#[test]
fn test_insert_knot_execute() {
    let project = make_project_with_road();
    let cmd = InsertKnot::new(
        "road_1",
        project.roads[0].plan_view.clone(),
        project.roads[0].length,
        make_straight_knots(),
        [25.0, 5.0, 0.0],
        None,
    );
    let result = cmd.execute(&project).unwrap();
    assert!(!result.roads[0].plan_view.is_empty());
}


#[test]
fn test_insert_knot_at_index() {
    let project = make_project_with_road();
    let cmd = InsertKnot::new(
        "road_1",
        project.roads[0].plan_view.clone(),
        project.roads[0].length,
        make_straight_knots(),
        [25.0, 0.0, 0.0],
        Some(1),
    );
    let result = cmd.execute(&project).unwrap();
    assert!(!result.roads[0].plan_view.is_empty());
}


#[test]
fn test_insert_knot_undo() {
    let project = make_project_with_road();
    let old_pv = project.roads[0].plan_view.clone();
    let old_len = project.roads[0].length;
    let cmd = InsertKnot::new(
        "road_1",
        old_pv.clone(),
        old_len,
        make_straight_knots(),
        [25.0, 5.0, 0.0],
        None,
    );
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert_eq!(undone.roads[0].plan_view.len(), old_pv.len());
}


#[test]
fn test_delete_knot_execute() {
    let project = make_project_with_road();
    let cmd = DeleteKnot::new(
        "road_1",
        project.roads[0].plan_view.clone(),
        project.roads[0].length,
        make_straight_knots(),
        1,
    );
    let result = cmd.execute(&project).unwrap();
    assert!(!result.roads[0].plan_view.is_empty());
}


#[test]
fn test_delete_knot_undo() {
    let project = make_project_with_road();
    let old_pv = project.roads[0].plan_view.clone();
    let old_len = project.roads[0].length;
    let cmd = DeleteKnot::new("road_1", old_pv.clone(), old_len, make_straight_knots(), 1);
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert_eq!(undone.roads[0].plan_view.len(), old_pv.len());
    assert!((undone.roads[0].length - old_len).abs() < 1e-6);
}


#[test]
fn test_delete_knot_minimum_knots_error() {
    let project = make_project_with_road();
    let knots = vec![
        we_core::spline::SplineKnot::with_tangent(0.0, 0.0, 0.0, 1.0, 0.0, 0.0),
        we_core::spline::SplineKnot::with_tangent(100.0, 0.0, 0.0, 1.0, 0.0, 0.0),
    ];
    let cmd = DeleteKnot::new(
        "road_1",
        project.roads[0].plan_view.clone(),
        project.roads[0].length,
        knots,
        0,
    );
    assert!(cmd.execute(&project).is_err());
}


#[test]
fn test_delete_knot_out_of_range() {
    let project = make_project_with_road();
    let cmd = DeleteKnot::new(
        "road_1",
        project.roads[0].plan_view.clone(),
        project.roads[0].length,
        make_straight_knots(),
        99,
    );
    assert!(cmd.execute(&project).is_err());
}


#[test]
fn test_set_knot_tangent_execute() {
    let project = make_project_with_road();
    let cmd = SetKnotTangent::new(
        "road_1",
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
            .any(|g| { matches!(g.geo_type, GeometryType::ParamPoly3 { .. }) })
    );
}


#[test]
fn test_set_knot_tangent_undo() {
    let project = make_project_with_road();
    let old_pv = project.roads[0].plan_view.clone();
    let old_len = project.roads[0].length;
    let cmd = SetKnotTangent::new(
        "road_1",
        old_pv.clone(),
        old_len,
        make_straight_knots(),
        1,
        [0.0, 1.0, 0.0],
    );
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert_eq!(undone.roads[0].plan_view.len(), old_pv.len());
}


#[test]
fn test_set_knot_tangent_zero_error() {
    let project = make_project_with_road();
    let cmd = SetKnotTangent::new(
        "road_1",
        project.roads[0].plan_view.clone(),
        project.roads[0].length,
        make_straight_knots(),
        1,
        [0.0, 0.0, 0.0],
    );
    assert!(cmd.execute(&project).is_err());
}


#[test]
fn test_set_knot_tangent_out_of_range() {
    let project = make_project_with_road();
    let cmd = SetKnotTangent::new(
        "road_1",
        project.roads[0].plan_view.clone(),
        project.roads[0].length,
        make_straight_knots(),
        99,
        [1.0, 0.0, 0.0],
    );
    assert!(cmd.execute(&project).is_err());
}
