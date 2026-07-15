#![allow(unused_imports)]
use super::super::*;
use super::*;
use crate::Command;


#[test]
fn test_add_object() {
    let project = make_project();
    let cmd = AddObject::new("1", make_road_object("obj-1"));
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].objects.len(), 1);
}


#[test]
fn test_add_object_duplicate() {
    let mut project = make_project();
    project.roads[0].objects.push(make_road_object("obj-1"));
    let cmd = AddObject::new("1", make_road_object("obj-1"));
    assert!(cmd.execute(&project).is_err());
}


#[test]
fn test_add_object_undo() {
    let project = make_project();
    let cmd = AddObject::new("1", make_road_object("obj-1"));
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert_eq!(undone.roads[0].objects.len(), 0);
}


// ── DeleteObject tests ────────────────────────────────

#[test]
fn test_delete_object() {
    let mut project = make_project();
    let obj = make_road_object("obj-1");
    project.roads[0].objects.push(obj.clone());
    let cmd = DeleteObject::with_snapshot("1", "obj-1", obj);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].objects.len(), 0);
}


#[test]
fn test_delete_object_undo() {
    let mut project = make_project();
    let obj = make_road_object("obj-1");
    project.roads[0].objects.push(obj.clone());
    let cmd = DeleteObject::with_snapshot("1", "obj-1", obj);
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert_eq!(undone.roads[0].objects.len(), 1);
}


// ── UpdateObject tests ────────────────────────────────

#[test]
fn test_update_object() {
    let mut project = make_project();
    let old_obj = make_road_object("obj-1");
    project.roads[0].objects.push(old_obj.clone());
    let mut new_obj = old_obj.clone();
    new_obj.name = "Updated Sign".into();
    new_obj.width = 2.0;
    let cmd = UpdateObject::new("1", old_obj, new_obj);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].objects[0].name, "Updated Sign");
    assert!((result.roads[0].objects[0].width - 2.0).abs() < f64::EPSILON);
}
