#![allow(unused_imports)]
use super::super::*;
use super::*;
use crate::Command;


// ── SetRoadElevation tests ────────────────────────────

#[test]
fn test_set_road_elevation() {
    let project = make_project();
    let new_elevs = vec![Elevation {
        s: 0.0,
        a: 5.0,
        b: 0.1,
        c: 0.0,
        d: 0.0,
    }];
    let cmd = SetRoadElevation::new("1", vec![], new_elevs);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].elevation_profile.len(), 1);
    assert!((result.roads[0].elevation_profile[0].a - 5.0).abs() < f64::EPSILON);
}


#[test]
fn test_set_road_elevation_undo() {
    let project = make_project();
    let new_elevs = vec![Elevation {
        s: 0.0,
        a: 5.0,
        b: 0.1,
        c: 0.0,
        d: 0.0,
    }];
    let cmd = SetRoadElevation::new("1", vec![], new_elevs);
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert_eq!(undone.roads[0].elevation_profile.len(), 0);
}


#[test]
fn test_set_superelevation() {
    let project = make_project_with_road();
    let new_profile = vec![Superelevation {
        s: 0.0,
        a: 0.02,
        b: 0.0,
        c: 0.0,
        d: 0.0,
    }];
    let cmd = SetSuperelevation::new("road_1", vec![], new_profile);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].lateral_profile.superelevations.len(), 1);
    assert!((result.roads[0].lateral_profile.superelevations[0].a - 0.02).abs() < 1e-9);
}


#[test]
fn test_set_superelevation_undo() {
    let project = make_project_with_road();
    let new_profile = vec![Superelevation {
        s: 0.0,
        a: 0.05,
        b: 0.0,
        c: 0.0,
        d: 0.0,
    }];
    let cmd = SetSuperelevation::new("road_1", vec![], new_profile);
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert!(undone.roads[0].lateral_profile.superelevations.is_empty());
}


#[test]
fn test_translate_road_with_elevation() {
    let project = make_project_with_road();
    let cmd = TranslateRoad::new("road_1", 0.0, 0.0, 10.0);
    let result = cmd.execute(&project).unwrap();
    assert!(!result.roads[0].elevation_profile.is_empty());
    assert!((result.roads[0].elevation_profile[0].a - 10.0).abs() < 1e-9);
}


#[test]
fn test_add_elevation_point() {
    let project = make_project_with_elevation();
    let old = project.roads[0].elevation_profile.clone();
    let cmd = AddElevationPoint::new("road_1", 25.0, 3.0, old);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].elevation_profile.len(), 4);
}


#[test]
fn test_add_elevation_point_undo() {
    let project = make_project_with_elevation();
    let old = project.roads[0].elevation_profile.clone();
    let cmd = AddElevationPoint::new("road_1", 25.0, 3.0, old);
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert_eq!(undone.roads[0].elevation_profile.len(), 3);
}


#[test]
fn test_delete_elevation_point() {
    let project = make_project_with_elevation();
    let old = project.roads[0].elevation_profile.clone();
    let cmd = DeleteElevationPoint::new("road_1", 50.0, 1.0, old);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].elevation_profile.len(), 2);
}


#[test]
fn test_delete_elevation_point_not_found() {
    let project = make_project_with_elevation();
    let old = project.roads[0].elevation_profile.clone();
    let cmd = DeleteElevationPoint::new("road_1", 999.0, 1.0, old);
    assert!(cmd.execute(&project).is_err());
}


#[test]
fn test_delete_elevation_point_undo() {
    let project = make_project_with_elevation();
    let old = project.roads[0].elevation_profile.clone();
    let cmd = DeleteElevationPoint::new("road_1", 50.0, 1.0, old);
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert_eq!(undone.roads[0].elevation_profile.len(), 3);
}


#[test]
fn test_move_elevation_point() {
    let project = make_project_with_elevation();
    let old = project.roads[0].elevation_profile.clone();
    let cmd = MoveElevationPoint::new("road_1", 50.0, 60.0, 7.0, 1.0, old);
    let result = cmd.execute(&project).unwrap();
    let moved = &result.roads[0].elevation_profile[1];
    assert!((moved.s - 60.0).abs() < 1e-9);
    assert!((moved.a - 7.0).abs() < 1e-9);
}


#[test]
fn test_move_elevation_point_undo() {
    let project = make_project_with_elevation();
    let old = project.roads[0].elevation_profile.clone();
    let cmd = MoveElevationPoint::new("road_1", 50.0, 60.0, 7.0, 1.0, old);
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert!((undone.roads[0].elevation_profile[1].s - 50.0).abs() < 1e-9);
}


#[test]
fn test_smooth_elevation() {
    let project = make_project_with_elevation();
    let old = project.roads[0].elevation_profile.clone();
    let cmd = SmoothElevation::new("road_1", 2, old);
    let result = cmd.execute(&project).unwrap();
    assert!(result.roads[0].elevation_profile[1].a < 5.0);
}


#[test]
fn test_smooth_elevation_undo() {
    let project = make_project_with_elevation();
    let old = project.roads[0].elevation_profile.clone();
    let cmd = SmoothElevation::new("road_1", 2, old);
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert!((undone.roads[0].elevation_profile[1].a - 5.0).abs() < 1e-9);
}
