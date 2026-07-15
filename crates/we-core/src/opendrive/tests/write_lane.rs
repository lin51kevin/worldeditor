#![allow(unused_imports)]
use super::super::*;
use super::*;
use crate::model::*;


// ── Lanes ───────────────────────────────────────

#[test]
fn test_write_lane_section_with_all_groups() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.lane_sections = vec![LaneSection {
                s: 0.0,
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
                    road_marks: vec![RoadMark {
                        s_offset: 0.0,
                        mark_type: RoadMarkType::Solid,
                        weight: RoadMarkWeight::Standard,
                        color: RoadMarkColor::Yellow,
                        material: "standard".into(),
                        width: 0.15,
                        lane_change: String::new(),
                        height: 0.02,
                    }],
                }],
                right: vec![Lane {
                    id: -1,
                    lane_type: LaneType::Driving,
                    level: 0,
                    render_hidden: false,
                    link: Some(LaneLink {
                        predecessor: Some(1),
                        successor: Some(-1),
                    }),
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
            }];
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains("<lanes>"));
    assert!(xml.contains("<left>"));
    assert!(xml.contains("<center>"));
    assert!(xml.contains("<right>"));
    assert!(xml.contains(r#"type="driving""#));
    assert!(xml.contains(r#"type="none""#));
    assert!(xml.contains("<roadMark"));
    assert!(xml.contains(r#"type="solid""#));
    assert!(xml.contains(r#"color="yellow""#));
}


#[test]
fn test_write_lane_section_single_side() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.lane_sections = vec![LaneSection {
                s: 0.0,
                single_side: true,
                render_hidden: false,
                left: vec![],
                center: vec![],
                right: vec![],
            }];
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains(r#"singleSide="1""#));
}


#[test]
fn test_write_lane_no_children_self_closing() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.lane_sections = vec![LaneSection {
                s: 0.0,
                single_side: false,
                render_hidden: false,
                left: vec![Lane {
                    id: 1,
                    lane_type: LaneType::Sidewalk,
                    level: 0,
                    render_hidden: false,
                    link: None,
                    width: vec![],
                    borders: vec![],
                    road_marks: vec![],
                }],
                center: vec![],
                right: vec![],
            }];
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    // Self-closing lane element: <lane ... />
    assert!(xml.contains(r#"type="sidewalk""#));
}


#[test]
fn test_write_lane_link_roundtrip() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.lane_sections = vec![LaneSection {
                s: 0.0,
                single_side: false,
                render_hidden: false,
                left: vec![],
                center: vec![],
                right: vec![Lane {
                    id: -1,
                    lane_type: LaneType::Driving,
                    level: 0,
                    render_hidden: false,
                    link: Some(LaneLink {
                        predecessor: Some(2),
                        successor: Some(-3),
                    }),
                    width: vec![LaneWidth {
                        s_offset: 0.0,
                        a: 3.0,
                        b: 0.0,
                        c: 0.0,
                        d: 0.0,
                    }],
                    borders: vec![],
                    road_marks: vec![],
                }],
            }];
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    let re = parse_xodr(&xml).unwrap();
    let link = re.roads[0].lane_sections[0].right[0].link.as_ref().unwrap();
    assert_eq!(link.predecessor, Some(2));
    assert_eq!(link.successor, Some(-3));
}


// ── Lane Offsets ────────────────────────────────

#[test]
fn test_write_lane_offsets() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.lane_offsets = vec![
                LaneOffset {
                    s: 0.0,
                    a: 1.0,
                    b: 0.0,
                    c: 0.0,
                    d: 0.0,
                },
                LaneOffset {
                    s: 50.0,
                    a: -1.0,
                    b: 0.0,
                    c: 0.0,
                    d: 0.0,
                },
            ];
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert_eq!(xml.matches("<laneOffset ").count(), 2);
}


#[test]
fn test_write_junction_connection_no_lane_links() {
    let p = project_with(
        vec![],
        vec![Junction {
            id: "j2".into(),
            name: "J".into(),
            connections: vec![JunctionConnection {
                id: "c1".into(),
                incoming_road: "r1".into(),
                connecting_road: "r2".into(),
                contact_point: ContactPoint::Start,
                lane_links: vec![],
            }],
        }],
    );
    let xml = write_xodr(&p).unwrap();
    // Self-closing connection element
    assert!(xml.contains(r#"contactPoint="start""#));
}


#[test]
fn test_write_junction_connection_with_lane_links() {
    let p = project_with(
        vec![],
        vec![Junction {
            id: "j3".into(),
            name: "J".into(),
            connections: vec![JunctionConnection {
                id: "c1".into(),
                incoming_road: "r1".into(),
                connecting_road: "r3".into(),
                contact_point: ContactPoint::End,
                lane_links: vec![
                    JunctionLaneLink { from: -1, to: -1 },
                    JunctionLaneLink { from: 1, to: 1 },
                ],
            }],
        }],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains(r#"contactPoint="end""#));
    assert_eq!(xml.matches("<laneLink ").count(), 2);
}


// ── Road mark types exhaustive ──────────────────

#[test]
fn test_write_all_road_mark_types() {
    let types: Vec<(RoadMarkType, &str)> = vec![
        (RoadMarkType::Solid, "solid"),
        (RoadMarkType::Broken, "broken"),
        (RoadMarkType::SolidBroken, "solid broken"),
        (RoadMarkType::BrokenSolid, "broken solid"),
        (RoadMarkType::BottsDots, "botts dots"),
        (RoadMarkType::Grass, "grass"),
        (RoadMarkType::Curb, "curb"),
        (RoadMarkType::SolidSolid, "solid solid"),
        (RoadMarkType::StopLine, "stop line"),
        (RoadMarkType::Custom, "custom"),
        (RoadMarkType::None, "none"),
    ];
    for (mt, expected) in types {
        let p = project_with(
            vec![{
                let mut r = base_road();
                r.lane_sections = vec![LaneSection {
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
                        road_marks: vec![RoadMark {
                            s_offset: 0.0,
                            mark_type: mt,
                            weight: RoadMarkWeight::Standard,
                            color: RoadMarkColor::White,
                            material: "standard".into(),
                            width: 0.12,
                            lane_change: String::new(),
                            height: 0.0,
                        }],
                    }],
                    right: vec![],
                }];
                r
            }],
            vec![],
        );
        let xml = write_xodr(&p).unwrap();
        assert!(
            xml.contains(&format!(r#"type="{expected}""#)),
            "Failed for road mark type {expected}"
        );
    }
}


// ── Road mark colors ────────────────────────────

#[test]
fn test_write_all_road_mark_colors() {
    let colors: Vec<(RoadMarkColor, &str)> = vec![
        (RoadMarkColor::Standard, "standard"),
        (RoadMarkColor::White, "white"),
        (RoadMarkColor::Yellow, "yellow"),
        (RoadMarkColor::Red, "red"),
        (RoadMarkColor::Blue, "blue"),
        (RoadMarkColor::Green, "green"),
        (RoadMarkColor::Orange, "orange"),
        (RoadMarkColor::Violet, "violet"),
    ];
    for (col, expected) in colors {
        let p = project_with(
            vec![{
                let mut r = base_road();
                r.lane_sections = vec![LaneSection {
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
                        road_marks: vec![RoadMark {
                            s_offset: 0.0,
                            mark_type: RoadMarkType::Solid,
                            weight: RoadMarkWeight::Standard,
                            color: col,
                            material: "standard".into(),
                            width: 0.12,
                            lane_change: String::new(),
                            height: 0.0,
                        }],
                    }],
                    right: vec![],
                }];
                r
            }],
            vec![],
        );
        let xml = write_xodr(&p).unwrap();
        assert!(
            xml.contains(&format!(r#"color="{expected}""#)),
            "Failed for color {expected}"
        );
    }
}


// ── Lane types exhaustive ───────────────────────

#[test]
fn test_write_all_lane_types() {
    let lane_types: Vec<(LaneType, &str)> = vec![
        (LaneType::Driving, "driving"),
        (LaneType::Shoulder, "shoulder"),
        (LaneType::Sidewalk, "sidewalk"),
        (LaneType::Border, "border"),
        (LaneType::Parking, "parking"),
        (LaneType::Median, "median"),
        (LaneType::Curb, "curb"),
        (LaneType::Stop, "stop"),
        (LaneType::Biking, "biking"),
        (LaneType::Restricted, "restricted"),
        (LaneType::Bidirectional, "bidirectional"),
        (LaneType::Rail, "rail"),
        (LaneType::Tram, "tram"),
        (LaneType::Bus, "bus"),
        (LaneType::Taxi, "taxi"),
        (LaneType::HOV, "hov"),
        (LaneType::Entry, "entry"),
        (LaneType::Exit, "exit"),
        (LaneType::OffRamp, "offRamp"),
        (LaneType::OnRamp, "onRamp"),
        (LaneType::ConnectingRamp, "connectingRamp"),
        (LaneType::Special1, "special1"),
        (LaneType::Special2, "special2"),
        (LaneType::Special3, "special3"),
        (LaneType::RoadWorks, "roadWorks"),
        (LaneType::None, "none"),
    ];
    for (lt, expected) in lane_types {
        let p = project_with(
            vec![{
                let mut r = base_road();
                r.lane_sections = vec![LaneSection {
                    s: 0.0,
                    single_side: false,
                    render_hidden: false,
                    left: vec![Lane {
                        id: 1,
                        lane_type: lt,
                        level: 0,
                        render_hidden: false,
                        link: None,
                        width: vec![],
                        borders: vec![],
                        road_marks: vec![],
                    }],
                    center: vec![],
                    right: vec![],
                }];
                r
            }],
            vec![],
        );
        let xml = write_xodr(&p).unwrap();
        assert!(
            xml.contains(&format!(r#"type="{expected}""#)),
            "Failed for lane type {expected}"
        );
    }
}


// ── Road mark weight ────────────────────────────

#[test]
fn test_write_road_mark_bold_weight() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.lane_sections = vec![LaneSection {
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
                    road_marks: vec![RoadMark {
                        s_offset: 0.0,
                        mark_type: RoadMarkType::Solid,
                        weight: RoadMarkWeight::Bold,
                        color: RoadMarkColor::White,
                        material: "standard".into(),
                        width: 0.3,
                        lane_change: "both".into(),
                        height: 0.0,
                    }],
                }],
                right: vec![],
            }];
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains(r#"weight="bold""#));
    assert!(xml.contains(r#"laneChange="both""#));
}
