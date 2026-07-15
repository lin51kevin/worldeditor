#![allow(unused_imports)]
use super::super::*;
use super::*;
use crate::model::*;


// ── Bridges & Tunnels ───────────────────────────

#[test]
fn test_write_bridges() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.bridges = vec![Bridge {
                id: "br1".into(),
                s: 10.0,
                length: 30.0,
                bridge_type: "concrete".into(),
            }];
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains("<bridges>"));
    assert!(xml.contains(r#"id="br1""#));
    assert!(xml.contains(r#"type="concrete""#));
}


#[test]
fn test_write_tunnels() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.tunnels = vec![Tunnel {
                id: "tn1".into(),
                s: 20.0,
                length: 50.0,
                tunnel_type: "standard".into(),
            }];
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains("<tunnels>"));
    assert!(xml.contains(r#"id="tn1""#));
}


// ── Signals ────────────────────────���────────────

#[test]
fn test_write_signals() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.signals = vec![Signal {
                id: "sig1".into(),
                name: "StopSign".into(),
                s: 80.0,
                t: 2.0,
                z_offset: 3.0,
                h_offset: 0.0,
                width: 0.6,
                height: 0.6,
                is_dynamic: false,
                orientation: "+".into(),
                signal_type: "206".into(),
                signal_subtype: "-1".into(),
                value: Some("30".into()),
                country: String::new(),
                unit: String::new(),
                validities: Vec::new(),
            }];
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains("<signals>"));
    assert!(xml.contains(r#"id="sig1""#));
    assert!(xml.contains(r#"dynamic="false""#));
    assert!(xml.contains(r#"value="30""#));
}


#[test]
fn test_write_signal_dynamic() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.signals = vec![Signal {
                id: "tl1".into(),
                name: "TrafficLight".into(),
                s: 50.0,
                t: -2.0,
                z_offset: 5.0,
                h_offset: 0.0,
                width: 0.3,
                height: 0.8,
                is_dynamic: true,
                orientation: "-".into(),
                signal_type: "1000001".into(),
                signal_subtype: "-1".into(),
                value: None,
                country: String::new(),
                unit: String::new(),
                validities: Vec::new(),
            }];
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains(r#"dynamic="true""#));
    assert!(!xml.contains(r#"value="#));
}


// ── Objects ─────────────────────────────────────

#[test]
fn test_write_objects() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.objects = vec![RoadObject {
                id: "obj1".into(),
                name: "Guardrail".into(),
                object_type: ObjectType::Guardrail,
                position: Point3D {
                    x: 10.0,
                    y: 2.0,
                    z: 0.0,
                    id: None,
                },
                orientation: 0.0,
                hdg: 0.0,
                pitch: 0.0,
                roll: 0.0,
                width: 0.5,
                height: 0.8,
                length: 0.0,
                corners: vec![],
                corner_type: CornerType::Local,
                validity: Some(Validity {
                    from_lane: -1,
                    to_lane: -2,
                }),
                from_object_ref: false,
                user_data: Vec::new(),
            }];
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(xml.contains("<objects>"));
    assert!(xml.contains(r#"type="guardrail""#));
    assert!(xml.contains(r#"fromLane="-1""#));
    assert!(xml.contains(r#"toLane="-2""#));
}


#[test]
fn test_write_objects_all_types() {
    let types_and_expected: Vec<(ObjectType, &str)> = vec![
        (ObjectType::Sign, "sign"),
        (ObjectType::Guardrail, "guardrail"),
        (ObjectType::Barrier, "barrier"),
        (ObjectType::Curb, "curb"),
        (ObjectType::Wall, "wall"),
        (ObjectType::Pillar, "pillar"),
        (ObjectType::TrafficCone, "trafficCone"),
        (ObjectType::Custom("myObj".into()), "myObj"),
    ];
    for (ot, expected) in types_and_expected {
        let p = project_with(
            vec![{
                let mut r = base_road();
                r.objects = vec![RoadObject {
                    id: "o1".into(),
                    name: String::new(),
                    object_type: ot,
                    position: Point3D {
                        x: 0.0,
                        y: 0.0,
                        z: 0.0,
                        id: None,
                    },
                    orientation: 0.0,
                    hdg: 0.0,
                    pitch: 0.0,
                    roll: 0.0,
                    width: 1.0,
                    height: 1.0,
                    length: 0.0,
                    corners: vec![],
                    corner_type: CornerType::Local,
                    validity: None,
                    from_object_ref: false,
                    user_data: Vec::new(),
                }];
                r
            }],
            vec![],
        );
        let xml = write_xodr(&p).unwrap();
        assert!(
            xml.contains(&format!(r#"type="{expected}""#)),
            "Failed for object type {expected}"
        );
    }
}


#[test]
fn test_write_object_no_validity() {
    let p = project_with(
        vec![{
            let mut r = base_road();
            r.objects = vec![RoadObject {
                id: "obj2".into(),
                name: "Barrier".into(),
                object_type: ObjectType::Barrier,
                position: Point3D {
                    x: 5.0,
                    y: 1.0,
                    z: 0.0,
                    id: None,
                },
                orientation: 1.57,
                hdg: 0.0,
                pitch: 0.0,
                roll: 0.0,
                width: 0.2,
                height: 1.0,
                length: 0.0,
                corners: vec![],
                corner_type: CornerType::Local,
                validity: None,
                from_object_ref: false,
                user_data: Vec::new(),
            }];
            r
        }],
        vec![],
    );
    let xml = write_xodr(&p).unwrap();
    assert!(!xml.contains("validity="));
}
