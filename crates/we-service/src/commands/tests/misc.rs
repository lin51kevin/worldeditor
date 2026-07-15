#![allow(unused_imports)]
use super::super::*;
use super::*;
use crate::Command;


// ── Integration with ActionHistory ───────────────

#[test]
fn test_multi_step_undo_redo() {
    use crate::ActionHistory;

    let mut history = ActionHistory::new();
    let project = Project::default();

    let project = history
        .execute(Box::new(AddRoad::new(Road::new("1", 100.0))), &project)
        .unwrap();
    assert_eq!(project.roads.len(), 1);

    let project = history
        .execute(Box::new(AddRoad::new(Road::new("2", 200.0))), &project)
        .unwrap();
    assert_eq!(project.roads.len(), 2);

    let project = history
        .execute(Box::new(UpdateRoadName::new("1", "", "Highway")), &project)
        .unwrap();
    assert_eq!(project.roads[0].name, "Highway");

    let project = history.undo(&project).unwrap();
    assert_eq!(project.roads[0].name, "");

    let project = history.undo(&project).unwrap();
    assert_eq!(project.roads.len(), 1);

    let project = history.redo(&project).unwrap();
    assert_eq!(project.roads.len(), 2);

    let project = history.undo(&project).unwrap();
    let project = history.undo(&project).unwrap();
    assert_eq!(project.roads.len(), 0);
}
