#![allow(unused_imports)]
use super::super::*;
use super::*;
use crate::Command;


// ── AddJunction tests ────────────────────────────

#[test]
fn test_add_junction() {
    let project = Project::default();
    let junction = Junction {
        id: "100".into(),
        name: "J1".into(),
        connections: vec![],
    };
    let cmd = AddJunction::new(junction);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.junctions.len(), 1);
    assert_eq!(result.junctions[0].name, "J1");
}


#[test]
fn test_add_junction_duplicate() {
    let junction = Junction {
        id: "100".into(),
        name: "J1".into(),
        connections: vec![],
    };
    let mut project = Project::default();
    project.junctions.push(junction.clone());
    let cmd = AddJunction::new(junction);
    assert!(cmd.execute(&project).is_err());
}


#[test]
fn test_add_junction_undo() {
    let project = Project::default();
    let junction = Junction {
        id: "100".into(),
        name: "J1".into(),
        connections: vec![],
    };
    let cmd = AddJunction::new(junction);
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert_eq!(undone.junctions.len(), 0);
}


// ── DeleteJunction tests ─────────────────────────

#[test]
fn test_delete_junction() {
    let junction = Junction {
        id: "100".into(),
        name: "J1".into(),
        connections: vec![],
    };
    let mut project = Project::default();
    project.junctions.push(junction.clone());
    let cmd = DeleteJunction::with_snapshot("100", junction);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.junctions.len(), 0);
}


#[test]
fn test_delete_junction_undo() {
    let junction = Junction {
        id: "100".into(),
        name: "J1".into(),
        connections: vec![],
    };
    let mut project = Project::default();
    project.junctions.push(junction.clone());
    let cmd = DeleteJunction::with_snapshot("100", junction);
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert_eq!(undone.junctions.len(), 1);
}


// ── UpdateJunctionConnections tests ───────────────────

#[test]
fn test_update_junction_connections() {
    let mut project = Project::default();
    project.junctions.push(Junction {
        id: "100".into(),
        name: "J1".into(),
        connections: vec![],
    });
    let new_conns = vec![JunctionConnection {
        id: "c1".into(),
        incoming_road: "1".into(),
        connecting_road: "2".into(),
        contact_point: we_core::model::ContactPoint::Start,
        lane_links: vec![JunctionLaneLink { from: -1, to: 1 }],
    }];
    let cmd = UpdateJunctionConnections::new("100", vec![], new_conns);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.junctions[0].connections.len(), 1);
    let undone = cmd.undo(&result).unwrap();
    assert_eq!(undone.junctions[0].connections.len(), 0);
}


#[test]
fn test_update_junction() {
    let mut project = Project::default();
    project.junctions.push(Junction {
        id: "j1".into(),
        name: "Old".into(),
        connections: vec![],
    });
    let cmd = UpdateJunction::new("j1", "Old", "New Name");
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.junctions[0].name, "New Name");
}


#[test]
fn test_update_junction_undo() {
    let mut project = Project::default();
    project.junctions.push(Junction {
        id: "j1".into(),
        name: "Original".into(),
        connections: vec![],
    });
    let cmd = UpdateJunction::new("j1", "Original", "Modified");
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert_eq!(undone.junctions[0].name, "Original");
}


#[test]
fn test_update_junction_not_found() {
    let project = Project::default();
    let cmd = UpdateJunction::new("nonexistent", "x", "y");
    assert!(cmd.execute(&project).is_err());
}
