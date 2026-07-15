#![allow(unused_imports)]
use super::super::*;
use super::*;
use crate::Command;


#[test]
fn test_add_signal() {
    let project = make_project();
    let cmd = AddSignal::new("1", make_signal("sig-1"));
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].signals.len(), 1);
    assert_eq!(result.roads[0].signals[0].id, "sig-1");
}


#[test]
fn test_add_signal_duplicate() {
    let mut project = make_project();
    project.roads[0].signals.push(make_signal("sig-1"));
    let cmd = AddSignal::new("1", make_signal("sig-1"));
    assert!(cmd.execute(&project).is_err());
}


#[test]
fn test_add_signal_undo() {
    let project = make_project();
    let cmd = AddSignal::new("1", make_signal("sig-1"));
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert_eq!(undone.roads[0].signals.len(), 0);
}


// ── DeleteSignal tests ────────────────────────────────

#[test]
fn test_delete_signal() {
    let mut project = make_project();
    let signal = make_signal("sig-1");
    project.roads[0].signals.push(signal.clone());
    let cmd = DeleteSignal::with_snapshot("1", "sig-1", signal);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].signals.len(), 0);
}


#[test]
fn test_delete_signal_undo() {
    let mut project = make_project();
    let signal = make_signal("sig-1");
    project.roads[0].signals.push(signal.clone());
    let cmd = DeleteSignal::with_snapshot("1", "sig-1", signal);
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert_eq!(undone.roads[0].signals.len(), 1);
}


// ── UpdateSignal tests ────────────────────────────────

#[test]
fn test_update_signal() {
    let mut project = make_project();
    let old_signal = make_signal("sig-1");
    project.roads[0].signals.push(old_signal.clone());
    let mut new_signal = old_signal.clone();
    new_signal.s = 75.0;
    new_signal.name = "Updated".into();
    let cmd = UpdateSignal::new("1", old_signal, new_signal);
    let result = cmd.execute(&project).unwrap();
    assert!((result.roads[0].signals[0].s - 75.0).abs() < f64::EPSILON);
    assert_eq!(result.roads[0].signals[0].name, "Updated");
}


#[test]
fn test_update_signal_undo() {
    let mut project = make_project();
    let old_signal = make_signal("sig-1");
    project.roads[0].signals.push(old_signal.clone());
    let mut new_signal = old_signal.clone();
    new_signal.s = 75.0;
    let cmd = UpdateSignal::new("1", old_signal, new_signal);
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert!((undone.roads[0].signals[0].s - 50.0).abs() < f64::EPSILON);
}
