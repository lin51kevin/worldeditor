#![allow(unused_imports)]
use super::super::*;
use super::*;
use crate::Command;


// ── AddLaneSection tests ─────────────────────────

#[test]
fn test_add_lane_section() {
    let project = make_project();
    let section = LaneSection {
        s: 0.0,
        single_side: false,
        render_hidden: false,
        left: vec![],
        center: vec![Lane {
            id: 0,
            lane_type: LaneType::None,
            level: 0,
            render_hidden: false,
            link: None,
            width: vec![],
            borders: vec![],
            road_marks: vec![],
        }],
        right: vec![Lane {
            id: -1,
            lane_type: LaneType::Driving,
            level: 0,
            render_hidden: false,
            link: None,
            width: vec![LaneWidth {
                s_offset: 0.0,
                a: 3.5,
                b: 0.0,
                c: 0.0,
                d: 0.0,
            }],
            borders: vec![],
            road_marks: vec![],
        }],
    };
    let cmd = AddLaneSection::new("1", section);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].lane_sections.len(), 1);
}


#[test]
fn test_add_lane_section_undo() {
    let project = make_project();
    let section = LaneSection {
        s: 0.0,
        single_side: false,
        render_hidden: false,
        left: vec![],
        center: vec![],
        right: vec![],
    };
    let cmd = AddLaneSection::new("1", section);
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert_eq!(undone.roads[0].lane_sections.len(), 0);
}


// ── CreateRoadFromSpline tests ────────────────────

#[test]
fn test_create_road_from_spline_single_lane() {
    use we_core::spline::{EditableSpline, SplineKnot, SplineOutputMode};

    let project = Project::default();
    let spline = EditableSpline::from_knots(vec![
        SplineKnot::new(0.0, 0.0, 0.0),
        SplineKnot::new(100.0, 0.0, 0.0),
    ]);
    let template = RoadTemplate::single_lane();
    let cmd = CreateRoadFromSpline::new("road_1", spline, template, SplineOutputMode::Classify);
    let result = cmd.execute(&project).unwrap();

    assert_eq!(result.roads.len(), 1);
    let road = &result.roads[0];
    assert_eq!(road.id, "road_1");
    assert!(road.length > 99.0 && road.length < 101.0); // Allow small tolerance
    assert_eq!(road.lane_sections.len(), 1);
    assert_eq!(road.lane_sections[0].left.len(), 1);
    assert_eq!(road.lane_sections[0].right.len(), 1);
}


#[test]
fn test_create_road_from_spline_dual_lanes() {
    use we_core::spline::{EditableSpline, SplineKnot, SplineOutputMode};

    let project = Project::default();
    let spline = EditableSpline::from_knots(vec![
        SplineKnot::new(0.0, 0.0, 0.0),
        SplineKnot::new(50.0, 0.0, 0.0),
    ]);
    let template = RoadTemplate::dual_two_lane();
    let cmd = CreateRoadFromSpline::new("road_1", spline, template, SplineOutputMode::Classify);
    let result = cmd.execute(&project).unwrap();

    let road = &result.roads[0];
    assert_eq!(road.lane_sections[0].left.len(), 2);
    assert_eq!(road.lane_sections[0].right.len(), 2);
}


// ── AddLane tests ─────────────────────────────────────

#[test]
fn test_add_lane() {
    let mut project = Project::default();
    let geometries = vec![Geometry {
        s: 0.0,
        x: 0.0,
        y: 0.0,
        hdg: 0.0,
        length: 100.0,
        geo_type: GeometryType::Line,
    }];
    let road = Road::from_centerline("1", geometries);
    project.roads.push(road);
    let new_lane = Lane {
        id: 2,
        lane_type: LaneType::Driving,
        level: 0,
        render_hidden: false,
        link: None,
        width: vec![LaneWidth {
            s_offset: 0.0,
            a: 3.5,
            b: 0.0,
            c: 0.0,
            d: 0.0,
        }],
        borders: vec![],
        road_marks: vec![],
    };
    let cmd = AddLane::new("1", 0.0, LaneSide::Left, new_lane);
    let result = cmd.execute(&project).unwrap();
    let section = &result.roads[0].lane_sections[0];
    assert_eq!(section.left.len(), 2);
    assert!(section.left.iter().any(|l| l.id == 2));
    let undone = cmd.undo(&result).unwrap();
    let section = &undone.roads[0].lane_sections[0];
    assert_eq!(section.left.len(), 1);
    assert!(!section.left.iter().any(|l| l.id == 2));
}


#[test]
fn test_add_lane_right() {
    let mut project = Project::default();
    let road = Road::from_centerline(
        "1",
        vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 100.0,
            geo_type: GeometryType::Line,
        }],
    );
    project.roads.push(road);
    let new_lane = Lane {
        id: -2,
        lane_type: LaneType::Driving,
        level: 0,
        render_hidden: false,
        link: None,
        width: vec![LaneWidth {
            s_offset: 0.0,
            a: 3.5,
            b: 0.0,
            c: 0.0,
            d: 0.0,
        }],
        borders: vec![],
        road_marks: vec![],
    };
    let cmd = AddLane::new("1", 0.0, LaneSide::Right, new_lane);
    let result = cmd.execute(&project).unwrap();
    let section = &result.roads[0].lane_sections[0];
    assert_eq!(section.right.len(), 2);
    assert!(section.right.iter().any(|l| l.id == -2));
}


// ── DeleteLane tests ──────────────────────────────────

#[test]
fn test_delete_lane() {
    let mut project = Project::default();
    let road = Road::from_centerline(
        "1",
        vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 100.0,
            geo_type: GeometryType::Line,
        }],
    );
    let lane_snapshot = road.lane_sections[0].left[0].clone();
    project.roads.push(road);
    let cmd = DeleteLane::with_snapshot("1", 0.0, 1, lane_snapshot);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].lane_sections[0].left.len(), 0);
    assert_eq!(result.roads[0].lane_sections[0].right.len(), 1);
    let undone = cmd.undo(&result).unwrap();
    assert_eq!(undone.roads[0].lane_sections[0].left.len(), 1);
    assert_eq!(undone.roads[0].lane_sections[0].left[0].id, 1);
}


// ── UpdateLaneWidth tests ─────────────────────────────

#[test]
fn test_update_lane_width() {
    let mut project = Project::default();
    let road = Road::from_centerline(
        "1",
        vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 100.0,
            geo_type: GeometryType::Line,
        }],
    );
    let old_widths = road.lane_sections[0].left[0].width.clone();
    project.roads.push(road);
    let new_widths = vec![LaneWidth {
        s_offset: 0.0,
        a: 4.0,
        b: 0.0,
        c: 0.0,
        d: 0.0,
    }];
    let cmd = UpdateLaneWidth::new("1", 0.0, 1, old_widths, new_widths);
    let result = cmd.execute(&project).unwrap();
    assert!((result.roads[0].lane_sections[0].left[0].width[0].a - 4.0).abs() < f64::EPSILON);
    let undone = cmd.undo(&result).unwrap();
    assert!((undone.roads[0].lane_sections[0].left[0].width[0].a - 3.5).abs() < f64::EPSILON);
}


// ── UpdateLaneType tests ──────────────────────────────

#[test]
fn test_update_lane_type() {
    let mut project = Project::default();
    let road = Road::from_centerline(
        "1",
        vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 100.0,
            geo_type: GeometryType::Line,
        }],
    );
    project.roads.push(road);
    let cmd = UpdateLaneType::new("1", 0.0, 1, LaneType::Driving, LaneType::Sidewalk);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(
        result.roads[0].lane_sections[0].left[0].lane_type,
        LaneType::Sidewalk
    );
    let undone = cmd.undo(&result).unwrap();
    assert_eq!(
        undone.roads[0].lane_sections[0].left[0].lane_type,
        LaneType::Driving
    );
}


#[test]
fn test_split_lane_section() {
    let project = make_project_with_road();
    let old_sections = project.roads[0].lane_sections.clone();
    let cmd = SplitLaneSection::new("road_1", 0.0, 50.0, old_sections);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].lane_sections.len(), 2);
    assert!((result.roads[0].lane_sections[0].s).abs() < 1e-9);
    assert!((result.roads[0].lane_sections[1].s - 50.0).abs() < 1e-9);
    assert_eq!(
        result.roads[0].lane_sections[1].left.len(),
        result.roads[0].lane_sections[0].left.len()
    );
}


#[test]
fn test_split_lane_section_undo() {
    let project = make_project_with_road();
    let old_sections = project.roads[0].lane_sections.clone();
    let cmd = SplitLaneSection::new("road_1", 0.0, 50.0, old_sections.clone());
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert_eq!(undone.roads[0].lane_sections.len(), old_sections.len());
}


#[test]
fn test_split_lane_section_too_close() {
    let project = make_project_with_road();
    let old_sections = project.roads[0].lane_sections.clone();
    let cmd = SplitLaneSection::new("road_1", 0.0, 0.0, old_sections);
    assert!(cmd.execute(&project).is_err());
}


#[test]
fn test_split_lane_section_beyond_end() {
    let project = make_project_with_road();
    let old_sections = project.roads[0].lane_sections.clone();
    let cmd = SplitLaneSection::new("road_1", 0.0, 999.0, old_sections);
    assert!(cmd.execute(&project).is_err());
}


#[test]
fn test_split_lane_section_preserves_widths() {
    let mut project = make_project_with_road();
    project.roads[0].lane_sections[0].right[0].width = vec![LaneWidth {
        s_offset: 0.0,
        a: 3.5,
        b: 0.01,
        c: 0.0,
        d: 0.0,
    }];
    let old_sections = project.roads[0].lane_sections.clone();
    let cmd = SplitLaneSection::new("road_1", 0.0, 50.0, old_sections);
    let result = cmd.execute(&project).unwrap();
    let new_a = result.roads[0].lane_sections[1].right[0].width[0].a;
    assert!((new_a - 4.0).abs() < 1e-6);
}


#[test]
fn test_merge_lane_sections() {
    let project = make_project_two_sections();
    let old_sections = project.roads[0].lane_sections.clone();
    let cmd = MergeLaneSections::new("road_1", 0.0, old_sections);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].lane_sections.len(), 1);
}


#[test]
fn test_merge_lane_sections_undo() {
    let project = make_project_two_sections();
    let old_sections = project.roads[0].lane_sections.clone();
    let cmd = MergeLaneSections::new("road_1", 0.0, old_sections.clone());
    let merged = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&merged).unwrap();
    assert_eq!(undone.roads[0].lane_sections.len(), old_sections.len());
}


#[test]
fn test_merge_lane_sections_no_successor() {
    let project = make_project_two_sections();
    let old_sections = project.roads[0].lane_sections.clone();
    let cmd = MergeLaneSections::new("road_1", 100.0, old_sections);
    assert!(cmd.execute(&project).is_err());
}


#[test]
fn test_delete_lane_section() {
    let project = make_project_two_sections();
    let snapshot = project.roads[0].lane_sections[1].clone();
    let cmd = DeleteLaneSection::with_snapshot("road_1", 100.0, snapshot);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].lane_sections.len(), 1);
}


#[test]
fn test_delete_lane_section_undo() {
    let project = make_project_two_sections();
    let snapshot = project.roads[0].lane_sections[1].clone();
    let cmd = DeleteLaneSection::with_snapshot("road_1", 100.0, snapshot);
    let deleted = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&deleted).unwrap();
    assert_eq!(undone.roads[0].lane_sections.len(), 2);
}


#[test]
fn test_delete_lane_section_last_one_error() {
    let project = make_project_with_road();
    let cmd = DeleteLaneSection::new("road_1", 0.0);
    assert!(cmd.execute(&project).is_err());
}


#[test]
fn test_set_lane_link() {
    let project = make_project_with_road();
    let new_link = Some(LaneLink {
        predecessor: Some(-1),
        successor: Some(-2),
    });
    let cmd = SetLaneLink::new("road_1", 0.0, -1, None, new_link);
    let result = cmd.execute(&project).unwrap();
    let lane = result.roads[0].lane_sections[0]
        .right
        .iter()
        .find(|l| l.id == -1)
        .unwrap();
    assert!(lane.link.is_some());
    assert_eq!(lane.link.as_ref().unwrap().predecessor, Some(-1));
}


#[test]
fn test_set_lane_link_undo() {
    let project = make_project_with_road();
    let new_link = Some(LaneLink {
        predecessor: Some(-1),
        successor: None,
    });
    let cmd = SetLaneLink::new("road_1", 0.0, -1, None, new_link);
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    let lane = undone.roads[0].lane_sections[0]
        .right
        .iter()
        .find(|l| l.id == -1)
        .unwrap();
    assert!(lane.link.is_none());
}


#[test]
fn test_set_lane_road_mark() {
    let project = make_project_with_road();
    let new_marks = vec![RoadMark {
        s_offset: 0.0,
        mark_type: RoadMarkType::Solid,
        weight: RoadMarkWeight::Standard,
        color: RoadMarkColor::White,
        material: "standard".into(),
        width: 0.15,
        lane_change: "none".into(),
        height: 0.02,
    }];
    let cmd = SetLaneRoadMark::new("road_1", 0.0, -1, vec![], new_marks);
    let result = cmd.execute(&project).unwrap();
    let lane = result.roads[0].lane_sections[0]
        .right
        .iter()
        .find(|l| l.id == -1)
        .unwrap();
    assert_eq!(lane.road_marks.len(), 1);
    assert_eq!(lane.road_marks[0].mark_type, RoadMarkType::Solid);
}


#[test]
fn test_set_lane_road_mark_undo() {
    let project = make_project_with_road();
    let new_marks = vec![RoadMark {
        s_offset: 0.0,
        mark_type: RoadMarkType::Broken,
        weight: RoadMarkWeight::Standard,
        color: RoadMarkColor::Yellow,
        material: "standard".into(),
        width: 0.15,
        lane_change: "increase".into(),
        height: 0.02,
    }];
    let cmd = SetLaneRoadMark::new("road_1", 0.0, -1, vec![], new_marks);
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    let lane = undone.roads[0].lane_sections[0]
        .right
        .iter()
        .find(|l| l.id == -1)
        .unwrap();
    assert!(lane.road_marks.is_empty());
}


#[test]
fn test_set_lane_offset() {
    let project = make_project_with_road();
    let new_offsets = vec![LaneOffset {
        s: 0.0,
        a: 0.5,
        b: 0.0,
        c: 0.0,
        d: 0.0,
    }];
    let cmd = SetLaneOffset::new("road_1", vec![], new_offsets);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].lane_offsets.len(), 1);
    assert!((result.roads[0].lane_offsets[0].a - 0.5).abs() < 1e-9);
}


#[test]
fn test_set_lane_offset_undo() {
    let project = make_project_with_road();
    let new_offsets = vec![LaneOffset {
        s: 0.0,
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 0.0,
    }];
    let cmd = SetLaneOffset::new("road_1", vec![], new_offsets);
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert!(undone.roads[0].lane_offsets.is_empty());
}
