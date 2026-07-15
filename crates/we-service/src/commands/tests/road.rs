#![allow(unused_imports)]
use super::super::*;
use super::*;
use crate::Command;


// ── AddRoad tests ────────────────────────────────

#[test]
fn test_add_road() {
    let project = Project::default();
    let cmd = AddRoad::new(Road::new("1", 50.0));
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads.len(), 1);
    assert_eq!(result.roads[0].id, "1");
}


#[test]
fn test_add_road_duplicate() {
    let project = make_project();
    let cmd = AddRoad::new(Road::new("1", 50.0));
    assert!(cmd.execute(&project).is_err());
}


#[test]
fn test_add_road_undo() {
    let project = Project::default();
    let cmd = AddRoad::new(Road::new("1", 50.0));
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert_eq!(undone.roads.len(), 0);
}


// ── DeleteRoad tests ─────────────────────────────

#[test]
fn test_delete_road() {
    let project = make_project();
    let road = project.roads[0].clone();
    let cmd = DeleteRoad::with_snapshot("1", road);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads.len(), 1);
    assert_eq!(result.roads[0].id, "2");
}


#[test]
fn test_delete_road_not_found() {
    let project = make_project();
    let cmd = DeleteRoad::new("999");
    assert!(cmd.execute(&project).is_err());
}


#[test]
fn test_delete_road_undo() {
    let project = make_project();
    let road = project.roads[0].clone();
    let cmd = DeleteRoad::with_snapshot("1", road);
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert_eq!(undone.roads.len(), 2);
}


// ── UpdateRoadName tests ─────────────────────────

#[test]
fn test_rename_road() {
    let mut project = make_project();
    project.roads[0].name = "OldName".into();
    let cmd = UpdateRoadName::new("1", "OldName", "NewName");
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].name, "NewName");
}


#[test]
fn test_rename_road_undo() {
    let mut project = make_project();
    project.roads[0].name = "OldName".into();
    let cmd = UpdateRoadName::new("1", "OldName", "NewName");
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert_eq!(undone.roads[0].name, "OldName");
}


// ── SetRoadGeometry tests ────────────────────────

#[test]
fn test_set_road_geometry() {
    let project = make_project();
    let new_geos = vec![Geometry {
        s: 0.0,
        x: 0.0,
        y: 0.0,
        hdg: 0.0,
        length: 75.0,
        geo_type: GeometryType::Line,
    }];
    let cmd = SetRoadGeometry::new("1", vec![], new_geos);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].plan_view.len(), 1);
    assert!((result.roads[0].length - 75.0).abs() < f64::EPSILON);
}


#[test]
fn test_set_road_geometry_undo() {
    let project = make_project();
    let old_geos = vec![Geometry {
        s: 0.0,
        x: 0.0,
        y: 0.0,
        hdg: 0.0,
        length: 100.0,
        geo_type: GeometryType::Line,
    }];
    let new_geos = vec![Geometry {
        s: 0.0,
        x: 0.0,
        y: 0.0,
        hdg: 0.0,
        length: 75.0,
        geo_type: GeometryType::Line,
    }];
    let cmd = SetRoadGeometry::new("1", old_geos, new_geos);
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert_eq!(undone.roads[0].plan_view.len(), 1);
    assert!((undone.roads[0].length - 100.0).abs() < f64::EPSILON);
}


// ── CreateRoadFromCenterline tests ────────────────────

#[test]
fn test_create_road_from_centerline() {
    let project = Project::default();
    let geometries = vec![Geometry {
        s: 0.0,
        x: 0.0,
        y: 0.0,
        hdg: 0.0,
        length: 100.0,
        geo_type: GeometryType::Line,
    }];
    let cmd = CreateRoadFromCenterline::new("1", geometries);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads.len(), 1);
    let road = &result.roads[0];
    assert_eq!(road.id, "1");
    assert!((road.length - 100.0).abs() < f64::EPSILON);
    assert_eq!(road.plan_view.len(), 1);
    assert_eq!(road.lane_sections.len(), 1);
    let section = &road.lane_sections[0];
    assert_eq!(section.left.len(), 1);
    assert_eq!(section.left[0].id, 1);
    assert_eq!(section.right.len(), 1);
    assert_eq!(section.right[0].id, -1);
    assert_eq!(section.center.len(), 1);
    assert_eq!(section.center[0].id, 0);
}


#[test]
fn test_create_road_from_centerline_undo() {
    let project = Project::default();
    let geometries = vec![Geometry {
        s: 0.0,
        x: 0.0,
        y: 0.0,
        hdg: 0.0,
        length: 100.0,
        geo_type: GeometryType::Line,
    }];
    let cmd = CreateRoadFromCenterline::new("1", geometries);
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert_eq!(undone.roads.len(), 0);
}


#[test]
fn test_create_road_from_centerline_duplicate() {
    let mut project = Project::default();
    project.roads.push(Road::new("1", 50.0));
    let geometries = vec![Geometry {
        s: 0.0,
        x: 0.0,
        y: 0.0,
        hdg: 0.0,
        length: 100.0,
        geo_type: GeometryType::Line,
    }];
    let cmd = CreateRoadFromCenterline::new("1", geometries);
    assert!(cmd.execute(&project).is_err());
}


#[test]
fn test_create_road_from_spline_undo() {
    use we_core::spline::{EditableSpline, SplineKnot, SplineOutputMode};

    let project = Project::default();
    let spline = EditableSpline::from_knots(vec![
        SplineKnot::new(0.0, 0.0, 0.0),
        SplineKnot::new(100.0, 0.0, 0.0),
    ]);
    let template = RoadTemplate::single_lane();
    let cmd = CreateRoadFromSpline::new("road_1", spline, template, SplineOutputMode::Classify);
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert_eq!(undone.roads.len(), 0);
}


#[test]
fn test_create_road_from_spline_duplicate_id() {
    use we_core::spline::{EditableSpline, SplineKnot, SplineOutputMode};

    let mut project = Project::default();
    project.roads.push(Road::new("road_1", 50.0));

    let spline = EditableSpline::from_knots(vec![
        SplineKnot::new(0.0, 0.0, 0.0),
        SplineKnot::new(100.0, 0.0, 0.0),
    ]);
    let template = RoadTemplate::single_lane();
    let cmd = CreateRoadFromSpline::new("road_1", spline, template, SplineOutputMode::Classify);
    assert!(cmd.execute(&project).is_err());
}


// ── SetRoadLink tests ─────────────────────────────────

#[test]
fn test_set_road_link() {
    let project = make_project();
    let new_link = Some(RoadLink {
        predecessor: Some(LinkElement {
            element_type: LinkElementType::Road,
            element_id: "2".into(),
            contact_point: Some(we_core::model::ContactPoint::End),
        }),
        successor: None,
    });
    let cmd = SetRoadLink::new("1", None, new_link);
    let result = cmd.execute(&project).unwrap();
    assert!(result.roads[0].link.is_some());
}


#[test]
fn test_translate_road() {
    let project = make_project_with_road();
    let orig_x = project.roads[0].plan_view[0].x;
    let orig_y = project.roads[0].plan_view[0].y;
    let cmd = TranslateRoad::new("road_1", 50.0, 30.0, 0.0);
    let result = cmd.execute(&project).unwrap();
    assert!((result.roads[0].plan_view[0].x - (orig_x + 50.0)).abs() < 1e-9);
    assert!((result.roads[0].plan_view[0].y - (orig_y + 30.0)).abs() < 1e-9);
}


#[test]
fn test_translate_road_undo() {
    let project = make_project_with_road();
    let orig_x = project.roads[0].plan_view[0].x;
    let cmd = TranslateRoad::new("road_1", 50.0, 30.0, 5.0);
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert!((undone.roads[0].plan_view[0].x - orig_x).abs() < 1e-9);
}


#[test]
fn test_rotate_road() {
    let project = make_project_with_road();
    let angle = std::f64::consts::FRAC_PI_2;
    let cmd = RotateRoad::new("road_1", [0.0, 0.0], angle);
    let result = cmd.execute(&project).unwrap();
    assert!((result.roads[0].plan_view[0].hdg - angle).abs() < 1e-9);
}


#[test]
fn test_rotate_road_around_pivot() {
    let mut project = make_project_with_road();
    project.roads[0].plan_view[0].x = 100.0;
    project.roads[0].plan_view[0].y = 0.0;
    let angle = std::f64::consts::FRAC_PI_2;
    let cmd = RotateRoad::new("road_1", [0.0, 0.0], angle);
    let result = cmd.execute(&project).unwrap();
    assert!(result.roads[0].plan_view[0].x.abs() < 1e-6);
    assert!((result.roads[0].plan_view[0].y - 100.0).abs() < 1e-6);
}


#[test]
fn test_rotate_road_undo() {
    let project = make_project_with_road();
    let orig_hdg = project.roads[0].plan_view[0].hdg;
    let cmd = RotateRoad::new("road_1", [0.0, 0.0], 1.0);
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert!((undone.roads[0].plan_view[0].hdg - orig_hdg).abs() < 1e-9);
}
