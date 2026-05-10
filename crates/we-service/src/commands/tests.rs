//! Tests for all editor commands.

use super::*;
use crate::Command;

fn make_project() -> Project {
    Project {
        name: "test".into(),
        header: Header::default(),
        roads: vec![Road::new("1", 100.0), Road::new("2", 200.0)],
        junctions: vec![],
    }
}

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
            id: 0, lane_type: LaneType::None, level: 0, render_hidden: false,
            link: None, width: vec![], borders: vec![], road_marks: vec![],
        }],
        right: vec![Lane {
            id: -1, lane_type: LaneType::Driving, level: 0, render_hidden: false,
            link: None,
            width: vec![LaneWidth { s_offset: 0.0, a: 3.5, b: 0.0, c: 0.0, d: 0.0 }],
            borders: vec![], road_marks: vec![],
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
        s: 0.0, single_side: false, render_hidden: false,
        left: vec![], center: vec![], right: vec![],
    };
    let cmd = AddLaneSection::new("1", section);
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert_eq!(undone.roads[0].lane_sections.len(), 0);
}

// ── AddJunction tests ────────────────────────────

#[test]
fn test_add_junction() {
    let project = Project::default();
    let junction = Junction { id: "100".into(), name: "J1".into(), connections: vec![] };
    let cmd = AddJunction::new(junction);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.junctions.len(), 1);
    assert_eq!(result.junctions[0].name, "J1");
}

#[test]
fn test_add_junction_duplicate() {
    let junction = Junction { id: "100".into(), name: "J1".into(), connections: vec![] };
    let mut project = Project::default();
    project.junctions.push(junction.clone());
    let cmd = AddJunction::new(junction);
    assert!(cmd.execute(&project).is_err());
}

#[test]
fn test_add_junction_undo() {
    let project = Project::default();
    let junction = Junction { id: "100".into(), name: "J1".into(), connections: vec![] };
    let cmd = AddJunction::new(junction);
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert_eq!(undone.junctions.len(), 0);
}

// ── DeleteJunction tests ─────────────────────────

#[test]
fn test_delete_junction() {
    let junction = Junction { id: "100".into(), name: "J1".into(), connections: vec![] };
    let mut project = Project::default();
    project.junctions.push(junction.clone());
    let cmd = DeleteJunction::with_snapshot("100", junction);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.junctions.len(), 0);
}

#[test]
fn test_delete_junction_undo() {
    let junction = Junction { id: "100".into(), name: "J1".into(), connections: vec![] };
    let mut project = Project::default();
    project.junctions.push(junction.clone());
    let cmd = DeleteJunction::with_snapshot("100", junction);
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert_eq!(undone.junctions.len(), 1);
}

// ── SetRoadGeometry tests ────────────────────────

#[test]
fn test_set_road_geometry() {
    let project = make_project();
    let new_geos = vec![Geometry {
        s: 0.0, x: 0.0, y: 0.0, hdg: 0.0, length: 75.0, geo_type: GeometryType::Line,
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
        s: 0.0, x: 0.0, y: 0.0, hdg: 0.0, length: 100.0, geo_type: GeometryType::Line,
    }];
    let new_geos = vec![Geometry {
        s: 0.0, x: 0.0, y: 0.0, hdg: 0.0, length: 75.0, geo_type: GeometryType::Line,
    }];
    let cmd = SetRoadGeometry::new("1", old_geos, new_geos);
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert_eq!(undone.roads[0].plan_view.len(), 1);
    assert!((undone.roads[0].length - 100.0).abs() < f64::EPSILON);
}

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

// ── CreateRoadFromCenterline tests ────────────────────

#[test]
fn test_create_road_from_centerline() {
    let project = Project::default();
    let geometries = vec![Geometry {
        s: 0.0, x: 0.0, y: 0.0, hdg: 0.0, length: 100.0, geo_type: GeometryType::Line,
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
        s: 0.0, x: 0.0, y: 0.0, hdg: 0.0, length: 100.0, geo_type: GeometryType::Line,
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
        s: 0.0, x: 0.0, y: 0.0, hdg: 0.0, length: 100.0, geo_type: GeometryType::Line,
    }];
    let cmd = CreateRoadFromCenterline::new("1", geometries);
    assert!(cmd.execute(&project).is_err());
}

// ── CreateRoadFromSpline tests ────────────────────

#[test]
fn test_create_road_from_spline_single_lane() {
    use we_core::spline::{EditableSpline, SplineKnot};

    let project = Project::default();
    let spline = EditableSpline::from_knots(vec![
        SplineKnot::new(0.0, 0.0, 0.0),
        SplineKnot::new(100.0, 0.0, 0.0),
    ]);
    let template = RoadTemplate::single_lane();
    let cmd = CreateRoadFromSpline::new("road_1", spline, template);
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
    use we_core::spline::{EditableSpline, SplineKnot};

    let project = Project::default();
    let spline = EditableSpline::from_knots(vec![
        SplineKnot::new(0.0, 0.0, 0.0),
        SplineKnot::new(50.0, 0.0, 0.0),
    ]);
    let template = RoadTemplate::dual_two_lane();
    let cmd = CreateRoadFromSpline::new("road_1", spline, template);
    let result = cmd.execute(&project).unwrap();

    let road = &result.roads[0];
    assert_eq!(road.lane_sections[0].left.len(), 2);
    assert_eq!(road.lane_sections[0].right.len(), 2);
}

#[test]
fn test_create_road_from_spline_undo() {
    use we_core::spline::{EditableSpline, SplineKnot};

    let project = Project::default();
    let spline = EditableSpline::from_knots(vec![
        SplineKnot::new(0.0, 0.0, 0.0),
        SplineKnot::new(100.0, 0.0, 0.0),
    ]);
    let template = RoadTemplate::single_lane();
    let cmd = CreateRoadFromSpline::new("road_1", spline, template);
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert_eq!(undone.roads.len(), 0);
}

#[test]
fn test_create_road_from_spline_duplicate_id() {
    use we_core::spline::{EditableSpline, SplineKnot};

    let mut project = Project::default();
    project.roads.push(Road::new("road_1", 50.0));

    let spline = EditableSpline::from_knots(vec![
        SplineKnot::new(0.0, 0.0, 0.0),
        SplineKnot::new(100.0, 0.0, 0.0),
    ]);
    let template = RoadTemplate::single_lane();
    let cmd = CreateRoadFromSpline::new("road_1", spline, template);
    assert!(cmd.execute(&project).is_err());
}

#[test]
fn test_create_road_from_spline_empty_knots() {
    use we_core::spline::EditableSpline;

    let project = Project::default();
    let spline = EditableSpline::new();
    let template = RoadTemplate::single_lane();
    let cmd = CreateRoadFromSpline::new("road_1", spline, template);
    assert!(cmd.execute(&project).is_err());
}

#[test]
fn test_create_road_from_spline_single_knot() {
    use we_core::spline::{EditableSpline, SplineKnot};

    let project = Project::default();
    let spline = EditableSpline::from_knots(vec![SplineKnot::new(0.0, 0.0, 0.0)]);
    let template = RoadTemplate::single_lane();
    let cmd = CreateRoadFromSpline::new("road_1", spline, template);
    assert!(cmd.execute(&project).is_err());
}

// ── AddLane tests ─────────────────────────────────────

#[test]
fn test_add_lane() {
    let mut project = Project::default();
    let geometries = vec![Geometry {
        s: 0.0, x: 0.0, y: 0.0, hdg: 0.0, length: 100.0, geo_type: GeometryType::Line,
    }];
    let road = Road::from_centerline("1", geometries);
    project.roads.push(road);
    let new_lane = Lane {
        id: 2, lane_type: LaneType::Driving, level: 0, render_hidden: false,
        link: None,
        width: vec![LaneWidth { s_offset: 0.0, a: 3.5, b: 0.0, c: 0.0, d: 0.0 }],
        borders: vec![], road_marks: vec![],
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
    let road = Road::from_centerline("1", vec![Geometry {
        s: 0.0, x: 0.0, y: 0.0, hdg: 0.0, length: 100.0, geo_type: GeometryType::Line,
    }]);
    project.roads.push(road);
    let new_lane = Lane {
        id: -2, lane_type: LaneType::Driving, level: 0, render_hidden: false,
        link: None,
        width: vec![LaneWidth { s_offset: 0.0, a: 3.5, b: 0.0, c: 0.0, d: 0.0 }],
        borders: vec![], road_marks: vec![],
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
    let road = Road::from_centerline("1", vec![Geometry {
        s: 0.0, x: 0.0, y: 0.0, hdg: 0.0, length: 100.0, geo_type: GeometryType::Line,
    }]);
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
    let road = Road::from_centerline("1", vec![Geometry {
        s: 0.0, x: 0.0, y: 0.0, hdg: 0.0, length: 100.0, geo_type: GeometryType::Line,
    }]);
    let old_widths = road.lane_sections[0].left[0].width.clone();
    project.roads.push(road);
    let new_widths = vec![LaneWidth { s_offset: 0.0, a: 4.0, b: 0.0, c: 0.0, d: 0.0 }];
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
    let road = Road::from_centerline("1", vec![Geometry {
        s: 0.0, x: 0.0, y: 0.0, hdg: 0.0, length: 100.0, geo_type: GeometryType::Line,
    }]);
    project.roads.push(road);
    let cmd = UpdateLaneType::new("1", 0.0, 1, LaneType::Driving, LaneType::Sidewalk);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].lane_sections[0].left[0].lane_type, LaneType::Sidewalk);
    let undone = cmd.undo(&result).unwrap();
    assert_eq!(undone.roads[0].lane_sections[0].left[0].lane_type, LaneType::Driving);
}

// ── AddSignal tests ───────────────────────────────────

fn make_signal(id: &str) -> Signal {
    Signal {
        id: id.into(), name: "Test Signal".into(), s: 50.0, t: 3.0,
        z_offset: 2.5, h_offset: 0.0, width: 0.5, height: 0.8,
        signal_type: "1000001".into(), signal_subtype: "none".into(),
        value: None, orientation: "+".into(), is_dynamic: true,
    }
}

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

// ── AddObject tests ───────────────────────────────────

fn make_road_object(id: &str) -> RoadObject {
    RoadObject {
        id: id.into(), object_type: ObjectType::Sign, name: "Test Sign".into(),
        position: Point3D::new(10.0, 5.0, 0.0), orientation: 0.0,
        width: 1.0, height: 2.0, validity: None,
    }
}

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

// ── SetRoadElevation tests ────────────────────────────

#[test]
fn test_set_road_elevation() {
    let project = make_project();
    let new_elevs = vec![Elevation { s: 0.0, a: 5.0, b: 0.1, c: 0.0, d: 0.0 }];
    let cmd = SetRoadElevation::new("1", vec![], new_elevs);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].elevation_profile.len(), 1);
    assert!((result.roads[0].elevation_profile[0].a - 5.0).abs() < f64::EPSILON);
}

#[test]
fn test_set_road_elevation_undo() {
    let project = make_project();
    let new_elevs = vec![Elevation { s: 0.0, a: 5.0, b: 0.1, c: 0.0, d: 0.0 }];
    let cmd = SetRoadElevation::new("1", vec![], new_elevs);
    let after = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&after).unwrap();
    assert_eq!(undone.roads[0].elevation_profile.len(), 0);
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

// ── UpdateJunctionConnections tests ───────────────────

#[test]
fn test_update_junction_connections() {
    let mut project = Project::default();
    project.junctions.push(Junction { id: "100".into(), name: "J1".into(), connections: vec![] });
    let new_conns = vec![JunctionConnection {
        id: "c1".into(), incoming_road: "1".into(), connecting_road: "2".into(),
        contact_point: we_core::model::ContactPoint::Start,
        lane_links: vec![JunctionLaneLink { from: -1, to: 1 }],
    }];
    let cmd = UpdateJunctionConnections::new("100", vec![], new_conns);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.junctions[0].connections.len(), 1);
    let undone = cmd.undo(&result).unwrap();
    assert_eq!(undone.junctions[0].connections.len(), 0);
}

// ── Spline knot editing command tests ────────────

fn make_road_with_geometry() -> Road {
    Road::from_centerline("road_1", vec![Geometry {
        s: 0.0, x: 0.0, y: 0.0, hdg: 0.0, length: 100.0, geo_type: GeometryType::Line,
    }])
}

fn make_project_with_road() -> Project {
    Project {
        name: "test".into(),
        header: Header::default(),
        roads: vec![make_road_with_geometry()],
        junctions: vec![],
    }
}

fn make_straight_knots() -> Vec<we_core::spline::SplineKnot> {
    vec![
        we_core::spline::SplineKnot::with_tangent(0.0, 0.0, 0.0, 1.0, 0.0, 0.0),
        we_core::spline::SplineKnot::with_tangent(50.0, 0.0, 0.0, 1.0, 0.0, 0.0),
        we_core::spline::SplineKnot::with_tangent(100.0, 0.0, 0.0, 1.0, 0.0, 0.0),
    ]
}

#[test]
fn test_modify_road_knots_execute() {
    let project = make_project_with_road();
    let cmd = ModifyRoadKnots::new(
        "road_1", project.roads[0].plan_view.clone(),
        project.roads[0].length, make_straight_knots(),
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
        "road_1", project.roads[0].plan_view.clone(), project.roads[0].length,
        MoveKnotParams {
            original_knots: make_straight_knots(), knot_index: 1,
            new_position: [50.0, 20.0, 0.0], soft_factors: vec![],
            constraint: we_core::spline::MoveConstraint::Free,
        },
    );
    let result = cmd.execute(&project).unwrap();
    assert!(!result.roads[0].plan_view.is_empty());
    assert!(result.roads[0].plan_view.iter().any(|g| {
        matches!(g.geo_type, GeometryType::ParamPoly3 { .. })
    }));
}

#[test]
fn test_move_knot_with_constraint() {
    let project = make_project_with_road();
    let cmd = MoveKnot::new(
        "road_1", project.roads[0].plan_view.clone(), project.roads[0].length,
        MoveKnotParams {
            original_knots: make_straight_knots(), knot_index: 1,
            new_position: [50.0, 20.0, 5.0], soft_factors: vec![],
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
        "road_1", project.roads[0].plan_view.clone(), project.roads[0].length,
        MoveKnotParams {
            original_knots: make_straight_knots(), knot_index: 1,
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
        "road_1", old_pv.clone(), old_len,
        MoveKnotParams {
            original_knots: make_straight_knots(), knot_index: 1,
            new_position: [50.0, 20.0, 0.0], soft_factors: vec![],
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
        "road_1", project.roads[0].plan_view.clone(), project.roads[0].length,
        MoveKnotParams {
            original_knots: make_straight_knots(), knot_index: 99,
            new_position: [0.0, 0.0, 0.0], soft_factors: vec![],
            constraint: we_core::spline::MoveConstraint::Free,
        },
    );
    assert!(cmd.execute(&project).is_err());
}

#[test]
fn test_insert_knot_execute() {
    let project = make_project_with_road();
    let cmd = InsertKnot::new(
        "road_1", project.roads[0].plan_view.clone(), project.roads[0].length,
        make_straight_knots(), [25.0, 5.0, 0.0], None,
    );
    let result = cmd.execute(&project).unwrap();
    assert!(!result.roads[0].plan_view.is_empty());
}

#[test]
fn test_insert_knot_at_index() {
    let project = make_project_with_road();
    let cmd = InsertKnot::new(
        "road_1", project.roads[0].plan_view.clone(), project.roads[0].length,
        make_straight_knots(), [25.0, 0.0, 0.0], Some(1),
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
        "road_1", old_pv.clone(), old_len, make_straight_knots(), [25.0, 5.0, 0.0], None,
    );
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert_eq!(undone.roads[0].plan_view.len(), old_pv.len());
}

#[test]
fn test_delete_knot_execute() {
    let project = make_project_with_road();
    let cmd = DeleteKnot::new(
        "road_1", project.roads[0].plan_view.clone(), project.roads[0].length,
        make_straight_knots(), 1,
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
        "road_1", project.roads[0].plan_view.clone(), project.roads[0].length, knots, 0,
    );
    assert!(cmd.execute(&project).is_err());
}

#[test]
fn test_delete_knot_out_of_range() {
    let project = make_project_with_road();
    let cmd = DeleteKnot::new(
        "road_1", project.roads[0].plan_view.clone(), project.roads[0].length,
        make_straight_knots(), 99,
    );
    assert!(cmd.execute(&project).is_err());
}

#[test]
fn test_set_knot_tangent_execute() {
    let project = make_project_with_road();
    let cmd = SetKnotTangent::new(
        "road_1", project.roads[0].plan_view.clone(), project.roads[0].length,
        make_straight_knots(), 1, [0.0, 1.0, 0.0],
    );
    let result = cmd.execute(&project).unwrap();
    assert!(!result.roads[0].plan_view.is_empty());
    assert!(result.roads[0].plan_view.iter().any(|g| {
        matches!(g.geo_type, GeometryType::ParamPoly3 { .. })
    }));
}

#[test]
fn test_set_knot_tangent_undo() {
    let project = make_project_with_road();
    let old_pv = project.roads[0].plan_view.clone();
    let old_len = project.roads[0].length;
    let cmd = SetKnotTangent::new(
        "road_1", old_pv.clone(), old_len, make_straight_knots(), 1, [0.0, 1.0, 0.0],
    );
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert_eq!(undone.roads[0].plan_view.len(), old_pv.len());
}

#[test]
fn test_set_knot_tangent_zero_error() {
    let project = make_project_with_road();
    let cmd = SetKnotTangent::new(
        "road_1", project.roads[0].plan_view.clone(), project.roads[0].length,
        make_straight_knots(), 1, [0.0, 0.0, 0.0],
    );
    assert!(cmd.execute(&project).is_err());
}

#[test]
fn test_set_knot_tangent_out_of_range() {
    let project = make_project_with_road();
    let cmd = SetKnotTangent::new(
        "road_1", project.roads[0].plan_view.clone(), project.roads[0].length,
        make_straight_knots(), 99, [1.0, 0.0, 0.0],
    );
    assert!(cmd.execute(&project).is_err());
}

// ── Phase 3: Lane & Section editing command tests ─

fn make_project_two_sections() -> Project {
    let mut road = Road::from_centerline("road_1", vec![Geometry {
        s: 0.0, x: 0.0, y: 0.0, hdg: 0.0, length: 200.0, geo_type: GeometryType::Line,
    }]);
    let section2 = LaneSection {
        s: 100.0, single_side: false, render_hidden: false,
        left: vec![Lane {
            id: 1, lane_type: LaneType::Driving, level: 0, render_hidden: false,
            link: None, width: vec![LaneWidth { s_offset: 0.0, a: 3.5, b: 0.0, c: 0.0, d: 0.0 }],
            borders: vec![], road_marks: vec![],
        }],
        center: vec![Lane {
            id: 0, lane_type: LaneType::None, level: 0, render_hidden: false,
            link: None, width: vec![], borders: vec![], road_marks: vec![],
        }],
        right: vec![Lane {
            id: -1, lane_type: LaneType::Driving, level: 0, render_hidden: false,
            link: None, width: vec![LaneWidth { s_offset: 0.0, a: 3.5, b: 0.0, c: 0.0, d: 0.0 }],
            borders: vec![], road_marks: vec![],
        }],
    };
    road.lane_sections.push(section2);
    Project {
        name: "test".into(), header: Header::default(),
        roads: vec![road], junctions: vec![],
    }
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
    project.roads[0].lane_sections[0].right[0].width = vec![
        LaneWidth { s_offset: 0.0, a: 3.5, b: 0.01, c: 0.0, d: 0.0 },
    ];
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
    let new_link = Some(LaneLink { predecessor: Some(-1), successor: Some(-2) });
    let cmd = SetLaneLink::new("road_1", 0.0, -1, None, new_link);
    let result = cmd.execute(&project).unwrap();
    let lane = result.roads[0].lane_sections[0].right.iter().find(|l| l.id == -1).unwrap();
    assert!(lane.link.is_some());
    assert_eq!(lane.link.as_ref().unwrap().predecessor, Some(-1));
}

#[test]
fn test_set_lane_link_undo() {
    let project = make_project_with_road();
    let new_link = Some(LaneLink { predecessor: Some(-1), successor: None });
    let cmd = SetLaneLink::new("road_1", 0.0, -1, None, new_link);
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    let lane = undone.roads[0].lane_sections[0].right.iter().find(|l| l.id == -1).unwrap();
    assert!(lane.link.is_none());
}

#[test]
fn test_set_lane_road_mark() {
    let project = make_project_with_road();
    let new_marks = vec![RoadMark {
        s_offset: 0.0, mark_type: RoadMarkType::Solid, weight: RoadMarkWeight::Standard,
        color: RoadMarkColor::White, material: "standard".into(), width: 0.15,
        lane_change: "none".into(), height: 0.02,
    }];
    let cmd = SetLaneRoadMark::new("road_1", 0.0, -1, vec![], new_marks);
    let result = cmd.execute(&project).unwrap();
    let lane = result.roads[0].lane_sections[0].right.iter().find(|l| l.id == -1).unwrap();
    assert_eq!(lane.road_marks.len(), 1);
    assert_eq!(lane.road_marks[0].mark_type, RoadMarkType::Solid);
}

#[test]
fn test_set_lane_road_mark_undo() {
    let project = make_project_with_road();
    let new_marks = vec![RoadMark {
        s_offset: 0.0, mark_type: RoadMarkType::Broken, weight: RoadMarkWeight::Standard,
        color: RoadMarkColor::Yellow, material: "standard".into(), width: 0.15,
        lane_change: "increase".into(), height: 0.02,
    }];
    let cmd = SetLaneRoadMark::new("road_1", 0.0, -1, vec![], new_marks);
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    let lane = undone.roads[0].lane_sections[0].right.iter().find(|l| l.id == -1).unwrap();
    assert!(lane.road_marks.is_empty());
}

#[test]
fn test_set_lane_offset() {
    let project = make_project_with_road();
    let new_offsets = vec![LaneOffset { s: 0.0, a: 0.5, b: 0.0, c: 0.0, d: 0.0 }];
    let cmd = SetLaneOffset::new("road_1", vec![], new_offsets);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].lane_offsets.len(), 1);
    assert!((result.roads[0].lane_offsets[0].a - 0.5).abs() < 1e-9);
}

#[test]
fn test_set_lane_offset_undo() {
    let project = make_project_with_road();
    let new_offsets = vec![LaneOffset { s: 0.0, a: 1.0, b: 0.0, c: 0.0, d: 0.0 }];
    let cmd = SetLaneOffset::new("road_1", vec![], new_offsets);
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert!(undone.roads[0].lane_offsets.is_empty());
}

#[test]
fn test_set_superelevation() {
    let project = make_project_with_road();
    let new_profile = vec![Superelevation { s: 0.0, a: 0.02, b: 0.0, c: 0.0, d: 0.0 }];
    let cmd = SetSuperelevation::new("road_1", vec![], new_profile);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].lateral_profile.superelevations.len(), 1);
    assert!((result.roads[0].lateral_profile.superelevations[0].a - 0.02).abs() < 1e-9);
}

#[test]
fn test_set_superelevation_undo() {
    let project = make_project_with_road();
    let new_profile = vec![Superelevation { s: 0.0, a: 0.05, b: 0.0, c: 0.0, d: 0.0 }];
    let cmd = SetSuperelevation::new("road_1", vec![], new_profile);
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert!(undone.roads[0].lateral_profile.superelevations.is_empty());
}

#[test]
fn test_set_crossfall() {
    let project = make_project_with_road();
    let new_profile = vec![Crossfall {
        s: 0.0, a: 0.03, b: 0.0, c: 0.0, d: 0.0, side: CrossfallSide::Both,
    }];
    let cmd = SetCrossfall::new("road_1", vec![], new_profile);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].lateral_profile.crossfalls.len(), 1);
    assert_eq!(result.roads[0].lateral_profile.crossfalls[0].side, CrossfallSide::Both);
}

#[test]
fn test_set_crossfall_undo() {
    let project = make_project_with_road();
    let new_profile = vec![Crossfall {
        s: 0.0, a: 0.03, b: 0.0, c: 0.0, d: 0.0, side: CrossfallSide::Left,
    }];
    let cmd = SetCrossfall::new("road_1", vec![], new_profile);
    let modified = cmd.execute(&project).unwrap();
    let undone = cmd.undo(&modified).unwrap();
    assert!(undone.roads[0].lateral_profile.crossfalls.is_empty());
}

// ── Phase 4: Batch / Transform / Junction tests ──

#[test]
fn test_batch_command_multiple_ops() {
    let project = make_project_with_road();
    let entries = vec![BatchEntry::UpdateRoadName {
        road_id: "road_1".into(), old_name: String::new(), new_name: "Renamed".into(),
    }];
    let cmd = BatchCommand::new("batch test", project.clone(), entries);
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.roads[0].name, "Renamed");
}

#[test]
fn test_batch_command_undo_restores_snapshot() {
    let project = make_project_with_road();
    let entries = vec![BatchEntry::UpdateRoadName {
        road_id: "road_1".into(), old_name: String::new(), new_name: "Changed".into(),
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
    let entries = vec![BatchEntry::DeleteRoad { road_id: "road_1".into() }];
    let cmd = BatchCommand::new("batch delete", project.clone(), entries);
    let result = cmd.execute(&project).unwrap();
    assert!(result.roads.is_empty());
}

#[test]
fn test_batch_command_transform_road() {
    let project = make_project_with_road();
    let orig_x = project.roads[0].plan_view[0].x;
    let entries = vec![BatchEntry::TransformRoad {
        road_id: "road_1".into(), dx: 100.0, dy: 200.0, dz: 0.0,
    }];
    let cmd = BatchCommand::new("batch move", project.clone(), entries);
    let result = cmd.execute(&project).unwrap();
    assert!((result.roads[0].plan_view[0].x - (orig_x + 100.0)).abs() < 1e-9);
}

#[test]
fn test_batch_command_invalid_road() {
    let project = make_project_with_road();
    let entries = vec![BatchEntry::UpdateRoadName {
        road_id: "nonexistent".into(), old_name: String::new(), new_name: "Fail".into(),
    }];
    let cmd = BatchCommand::new("batch fail", project.clone(), entries);
    assert!(cmd.execute(&project).is_err());
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
fn test_translate_road_with_elevation() {
    let project = make_project_with_road();
    let cmd = TranslateRoad::new("road_1", 0.0, 0.0, 10.0);
    let result = cmd.execute(&project).unwrap();
    assert!(!result.roads[0].elevation_profile.is_empty());
    assert!((result.roads[0].elevation_profile[0].a - 10.0).abs() < 1e-9);
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

#[test]
fn test_update_junction() {
    let mut project = Project::default();
    project.junctions.push(Junction { id: "j1".into(), name: "Old".into(), connections: vec![] });
    let cmd = UpdateJunction::new("j1", "Old", "New Name");
    let result = cmd.execute(&project).unwrap();
    assert_eq!(result.junctions[0].name, "New Name");
}

#[test]
fn test_update_junction_undo() {
    let mut project = Project::default();
    project.junctions.push(Junction { id: "j1".into(), name: "Original".into(), connections: vec![] });
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

// ── Phase 5: Elevation editing command tests ──

fn make_project_with_elevation() -> Project {
    let mut project = make_project_with_road();
    project.roads[0].elevation_profile = vec![
        Elevation { s: 0.0, a: 0.0, b: 0.0, c: 0.0, d: 0.0 },
        Elevation { s: 50.0, a: 5.0, b: 0.0, c: 0.0, d: 0.0 },
        Elevation { s: 100.0, a: 2.0, b: 0.0, c: 0.0, d: 0.0 },
    ];
    project
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
