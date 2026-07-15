#![allow(unused_imports)]
use super::super::*;
use super::*;
use crate::Command;


#[test]
fn test_set_crossfall() {
    let project = make_project_with_road();
    let new_profile = vec![Crossfall {
        s: 0.0,
        a: 0.03,
        b: 0.0,
        c: 0.0,
        d: 0.0,
        side: CrossfallSide::Both,
    }];
    let cmd = SetCrossfall::new("road_1", vec![], new_profile);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].lateral_profile.crossfalls.len(), 1);
    assert_eq!(
        result.roads[0].lateral_profile.crossfalls[0].side,
        CrossfallSide::Both
    );
}


#[test]
fn test_set_crossfall_undo() {
    let project = make_project_with_road();
    let new_profile = vec![Crossfall {
        s: 0.0,
        a: 0.03,
        b: 0.0,
        c: 0.0,
        d: 0.0,
        side: CrossfallSide::Left,
    }];
    let cmd = SetCrossfall::new("road_1", vec![], new_profile);
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert!(undone.roads[0].lateral_profile.crossfalls.is_empty());
}
