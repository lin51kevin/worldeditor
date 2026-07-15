#![allow(unused_imports)]
use super::super::*;
use super::*;
use crate::model::*;


// ── Write-only tests ────────────────────────────

#[test]
fn test_write_produces_valid_xml() {
    let project = Project::default();
    let xml = write_xodr(&project).unwrap();
    assert!(xml.contains("<?xml"));
    assert!(xml.contains("<OpenDRIVE>"));
    assert!(xml.contains("</OpenDRIVE>"));
    assert!(xml.contains("<header"));
}


#[test]
fn test_write_road_with_junction() {
    let project = Project {
        name: String::new(),
        header: Header::default(),
        roads: vec![Road {
            id: "5".to_string(),
            name: String::new(),
            length: 50.0,
            junction_id: Some("10".to_string()),
            render_hidden: false,
            link: None,
            plan_view: vec![Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length: 50.0,
                geo_type: GeometryType::Line,
            }],
            elevation_profile: vec![],
            lane_sections: vec![],
            lane_offsets: vec![],
            lateral_profile: LateralProfile::default(),
            bridges: vec![],
            tunnels: vec![],
            signals: vec![],
            objects: vec![],
            speed: None,
            spline_edit_data: None,
        }],
        junctions: vec![],
        ..Default::default()
    };
    let xml = write_xodr(&project).unwrap();
    assert!(xml.contains(r#"junction="10""#));
}


// ── Road Link ───────────────────────────────────

#[test]
fn test_write_road_link() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.link = Some(RoadLink {
                predecessor: Some(LinkElement {
                    element_type: LinkElementType::Road,
                    element_id: "0".into(),
                    contact_point: Some(ContactPoint::End),
                }),
                successor: Some(LinkElement {
                    element_type: LinkElementType::Junction,
                    element_id: "10".into(),
                    contact_point: None,
                }),
            });
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains("<link>"));
    assert!(xml.contains(r#"elementType="road""#));
    assert!(xml.contains(r#"contactPoint="end""#));
    assert!(xml.contains(r#"elementType="junction""#));
}


#[test]
fn test_write_road_link_roundtrip() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.link = Some(RoadLink {
                predecessor: Some(LinkElement {
                    element_type: LinkElementType::Road,
                    element_id: "99".into(),
                    contact_point: Some(ContactPoint::Start),
                }),
                successor: None,
            });
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    let re = parse_xodr(&xml).unwrap();
    let link = re.roads[0].link.as_ref().unwrap();
    assert!(link.successor.is_none());
    let pred = link.predecessor.as_ref().unwrap();
    assert_eq!(pred.element_id, "99");
    assert_eq!(pred.contact_point, Some(ContactPoint::Start));
}


// ── Junction ────────────────────────────────────

#[test]
fn test_write_junction_empty_connections() {
    let p = project_with(
        vec![],
        vec![Junction {
            id: "j1".into(),
            name: "EmptyJunction".into(),
            connections: vec![],
        }],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains(r#"<junction"#));
    assert!(xml.contains(r#"id="j1""#));
}


// ── Header geo reference ────────────────────────

#[test]
fn test_write_header_no_geo_reference() {
    let p = Project {
        name: String::new(),
        header: Header {
            geo_reference: None,
            ..Header::default()
        },
        roads: vec![],
        junctions: vec![],
        ..Default::default()
    };
    let xml = write_xodr(&p).unwrap();
    // header should be self-closing without geoReference child
    assert!(!xml.contains("<geoReference"));
    assert!(xml.contains("<header"));
}


#[test]
fn test_write_header_with_geo_reference() {
    let p = Project {
        name: String::new(),
        header: Header {
            geo_reference: Some(GeoReference {
                origin_lat: 31.23,
                origin_long: 121.47,
                origin_alt: 0.0,
                origin_hdg: 0.0,
            }),
            ..Header::default()
        },
        roads: vec![],
        junctions: vec![],
        ..Default::default()
    };
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains("<geoReference"));
    assert!(xml.contains(r#"originLat="31.23""#));
}


// ── Full complex roundtrip ──────────────────────

#[test]
fn test_write_complex_project_roundtrip() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.link = Some(RoadLink {
                predecessor: Some(LinkElement {
                    element_type: LinkElementType::Road,
                    element_id: "0".into(),
                    contact_point: Some(ContactPoint::End),
                }),
                successor: None,
            });
            r.elevation_profile = vec![Elevation {
                s: 0.0,
                a: 0.0,
                b: 0.01,
                c: 0.0,
                d: 0.0,
            }];
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
            }];
            r.signals = vec![Signal {
                id: "s1".into(),
                name: "Sig".into(),
                s: 10.0,
                t: 1.0,
                z_offset: 0.0,
                h_offset: 0.0,
                width: 0.5,
                height: 0.5,
                is_dynamic: false,
                orientation: "+".into(),
                signal_type: "100".into(),
                signal_subtype: "".into(),
                value: None,
                country: String::new(),
                unit: String::new(),
                validities: Vec::new(),
            }];
            r.objects = vec![RoadObject {
                id: "o1".into(),
                name: "Wall".into(),
                object_type: ObjectType::Wall,
                position: Point3D {
                    x: 5.0,
                    y: -1.0,
                    z: 0.0,
                    id: None,
                },
                orientation: 0.0,
                hdg: 0.0,
                pitch: 0.0,
                roll: 0.0,
                width: 0.3,
                height: 2.0,
                length: 0.0,
                corners: vec![],
                corner_type: CornerType::Local,
                validity: None,
                from_object_ref: false,
                user_data: Vec::new(),
            }];
            r.bridges = vec![Bridge {
                id: "b1".into(),
                s: 20.0,
                length: 10.0,
                bridge_type: "steel".into(),
            }];
            r.tunnels = vec![Tunnel {
                id: "t1".into(),
                s: 40.0,
                length: 20.0,
                tunnel_type: "standard".into(),
            }];
            r
        }],
        vec![Junction {
            id: "j1".into(),
            name: "TestJunction".into(),
            connections: vec![JunctionConnection {
                id: "c1".into(),
                incoming_road: "r1".into(),
                connecting_road: "r2".into(),
                contact_point: ContactPoint::Start,
                lane_links: vec![JunctionLaneLink { from: -1, to: -1 }],
            }],
        }],
    );
    let xml = write_xodr(&p).unwrap();
    let re = parse_xodr(&xml).unwrap();

    assert_eq!(re.roads.len(), 1);
    assert_eq!(re.junctions.len(), 1);
    assert_eq!(re.roads[0].signals.len(), 1);
    assert_eq!(re.roads[0].objects.len(), 1);
    assert_eq!(re.roads[0].elevation_profile.len(), 1);
    assert_eq!(re.roads[0].lane_sections.len(), 1);
    assert_eq!(re.roads[0].lane_sections[0].left.len(), 1);
    assert_eq!(re.roads[0].lane_sections[0].right.len(), 1);
    assert_eq!(re.junctions[0].connections.len(), 1);
    assert_eq!(re.junctions[0].connections[0].lane_links.len(), 1);
    assert!(re.roads[0].link.is_some());
}
