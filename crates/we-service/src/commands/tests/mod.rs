//! Tests for all editor commands, split by domain into submodules.

use super::*;

pub(super) fn make_project() -> Project {
    Project {
        name: "test".into(),
        header: Header::default(),
        roads: vec![Road::new("1", 100.0), Road::new("2", 200.0)],
        junctions: vec![],
        ..Default::default()
    }
}


// ── AddSignal tests ───────────────────────────────────

pub(super) fn make_signal(id: &str) -> Signal {
    Signal {
        id: id.into(),
        name: "Test Signal".into(),
        s: 50.0,
        t: 3.0,
        z_offset: 2.5,
        h_offset: 0.0,
        width: 0.5,
        height: 0.8,
        signal_type: "1000001".into(),
        signal_subtype: "none".into(),
        value: None,
        orientation: "+".into(),
        is_dynamic: true,
        country: String::new(),
        unit: String::new(),
        validities: Vec::new(),
    }
}


// ── AddObject tests ───────────────────────────────────

pub(super) fn make_road_object(id: &str) -> RoadObject {
    RoadObject {
        id: id.into(),
        object_type: ObjectType::Sign,
        name: "Test Sign".into(),
        position: Point3D::new(10.0, 5.0, 0.0),
        orientation: 0.0,
        hdg: 0.0,
        pitch: 0.0,
        roll: 0.0,
        width: 1.0,
        height: 2.0,
        length: 0.0,
        corners: vec![],
        corner_type: CornerType::Local,
        validity: None,
        from_object_ref: false,
        user_data: Vec::new(),
    }
}


// ── Spline knot editing command tests ────────────

pub(super) fn make_road_with_geometry() -> Road {
    Road::from_centerline(
        "road_1",
        vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 100.0,
            geo_type: GeometryType::Line,
        }],
    )
}


pub(super) fn make_project_with_road() -> Project {
    Project {
        name: "test".into(),
        header: Header::default(),
        roads: vec![make_road_with_geometry()],
        junctions: vec![],
        ..Default::default()
    }
}


pub(super) fn make_straight_knots() -> Vec<we_core::spline::SplineKnot> {
    vec![
        we_core::spline::SplineKnot::with_tangent(0.0, 0.0, 0.0, 1.0, 0.0, 0.0),
        we_core::spline::SplineKnot::with_tangent(50.0, 0.0, 0.0, 1.0, 0.0, 0.0),
        we_core::spline::SplineKnot::with_tangent(100.0, 0.0, 0.0, 1.0, 0.0, 0.0),
    ]
}


// ── Phase 3: Lane & Section editing command tests ─

pub(super) fn make_project_two_sections() -> Project {
    let mut road = Road::from_centerline(
        "road_1",
        vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 200.0,
            geo_type: GeometryType::Line,
        }],
    );
    let section2 = LaneSection {
        s: 100.0,
        single_side: false,
        render_hidden: false,
        left: vec![Lane {
            id: 1,
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
    road.lane_sections.push(section2);
    Project {
        name: "test".into(),
        header: Header::default(),
        roads: vec![road],
        junctions: vec![],
        ..Default::default()
    }
}


// ── Phase 5: Elevation editing command tests ──

pub(super) fn make_project_with_elevation() -> Project {
    let mut project = make_project_with_road();
    project.roads[0].elevation_profile = vec![
        Elevation {
            s: 0.0,
            a: 0.0,
            b: 0.0,
            c: 0.0,
            d: 0.0,
        },
        Elevation {
            s: 50.0,
            a: 5.0,
            b: 0.0,
            c: 0.0,
            d: 0.0,
        },
        Elevation {
            s: 100.0,
            a: 2.0,
            b: 0.0,
            c: 0.0,
            d: 0.0,
        },
    ];
    project
}

mod batch;
mod elevation;
mod junction;
mod lane;
mod misc;
mod object;
mod road;
mod shape;
mod signal;
mod spline;
