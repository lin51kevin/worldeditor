#![allow(unused_imports)]
use super::super::*;
use super::*;
use crate::Command;


// ── Phase 4: Batch / Transform / Junction tests ──

#[test]
fn test_batch_command_multiple_ops() {
    let project = make_project_with_road();
    let entries = vec![BatchEntry::UpdateRoadName {
        road_id: "road_1".into(),
        old_name: String::new(),
        new_name: "Renamed".into(),
    }];
    let cmd = BatchCommand::new("batch test", project.clone(), entries);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].name, "Renamed");
}


#[test]
fn test_batch_command_undo_restores_snapshot() {
    let project = make_project_with_road();
    let entries = vec![BatchEntry::UpdateRoadName {
        road_id: "road_1".into(),
        old_name: String::new(),
        new_name: "Changed".into(),
    }];
    let cmd = BatchCommand::new("batch", project.clone(), entries);
    let modified = cmd.execute(&project).unwrap();
    assert_eq!(modified.roads[0].name, "Changed");
    let undone = cmd.undo(&modified).unwrap();
    assert_eq!(undone.roads[0].name, project.roads[0].name);
}


#[test]
fn test_batch_command_delete_roads() {
    let project = make_project_with_road();
    let entries = vec![BatchEntry::DeleteRoad {
        road_id: "road_1".into(),
    }];
    let cmd = BatchCommand::new("batch delete", project.clone(), entries);
    let result = cmd.execute(&project).unwrap();
    assert!(result.roads.is_empty());
}


#[test]
fn test_batch_command_transform_road() {
    let project = make_project_with_road();
    let orig_x = project.roads[0].plan_view[0].x;
    let entries = vec![BatchEntry::TransformRoad {
        road_id: "road_1".into(),
        dx: 100.0,
        dy: 200.0,
        dz: 0.0,
    }];
    let cmd = BatchCommand::new("batch move", project.clone(), entries);
    let result = cmd.execute(&project).unwrap();
    assert!((result.roads[0].plan_view[0].x - (orig_x + 100.0)).abs() < 1e-9);
}


#[test]
fn test_batch_command_invalid_road() {
    let project = make_project_with_road();
    let entries = vec![BatchEntry::UpdateRoadName {
        road_id: "nonexistent".into(),
        old_name: String::new(),
        new_name: "Fail".into(),
    }];
    let cmd = BatchCommand::new("batch fail", project.clone(), entries);
    assert!(cmd.execute(&project).is_err());
}
