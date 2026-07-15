#![allow(unused_imports)]
use super::super::*;
use super::*;
use crate::model::*;

// ── Minimal file ─────────────────────────────────

#[test]
fn test_parse_minimal() {
    let xml = include_str!("../../../../../tests/fixtures/xodr/minimal.xodr");
    let project = parse_xodr(xml).unwrap();
    assert_eq!(project.header.rev_major, 1);
    assert_eq!(project.header.rev_minor, 6);
    assert_eq!(project.header.name, "Minimal");
    assert!(project.roads.is_empty());
    assert!(project.junctions.is_empty());
}


// ── Single road file ─────────────────────────────

#[test]
fn test_parse_single_road() {
    let xml = include_str!("../../../../../tests/fixtures/xodr/single_road.xodr");
    let project = parse_xodr(xml).unwrap();

    assert_eq!(project.roads.len(), 1);
    let road = &project.roads[0];
    assert_eq!(road.id, "1");
    assert_eq!(road.name, "MainStreet");
    assert!((road.length - 100.0).abs() < f64::EPSILON);
    assert!(road.junction_id.is_none());
}


#[test]
fn test_parse_header_geo_reference() {
    let xml = include_str!("../../../../../tests/fixtures/xodr/single_road.xodr");
    let project = parse_xodr(xml).unwrap();

    let geo = project.header.geo_reference.as_ref().unwrap();
    assert!((geo.origin_lat - 31.23).abs() < 1e-10);
    assert!((geo.origin_long - 121.47).abs() < 1e-10);
}


#[test]
fn test_parse_road_link() {
    let xml = include_str!("../../../../../tests/fixtures/xodr/single_road.xodr");
    let project = parse_xodr(xml).unwrap();

    let link = project.roads[0].link.as_ref().unwrap();
    let pred = link.predecessor.as_ref().unwrap();
    assert_eq!(pred.element_type, LinkElementType::Road);
    assert_eq!(pred.element_id, "0");
    assert_eq!(pred.contact_point, Some(ContactPoint::End));

    let succ = link.successor.as_ref().unwrap();
    assert_eq!(succ.element_type, LinkElementType::Junction);
    assert_eq!(succ.element_id, "10");
}


#[test]
fn test_parse_plan_view() {
    let xml = include_str!("../../../../../tests/fixtures/xodr/single_road.xodr");
    let project = parse_xodr(xml).unwrap();

    let plan_view = &project.roads[0].plan_view;
    assert_eq!(plan_view.len(), 3);

    // First: line
    assert!(matches!(plan_view[0].geo_type, GeometryType::Line));
    assert!((plan_view[0].length - 50.0).abs() < f64::EPSILON);

    // Second: arc
    if let GeometryType::Arc { curvature } = plan_view[1].geo_type {
        assert!((curvature - 0.02).abs() < 1e-10);
    } else {
        panic!("Expected Arc geometry");
    }

    // Third: spiral
    if let GeometryType::Spiral {
        curv_start,
        curv_end,
    } = plan_view[2].geo_type
    {
        assert!((curv_start - 0.02).abs() < 1e-10);
        assert!((curv_end).abs() < 1e-10);
    } else {
        panic!("Expected Spiral geometry");
    }
}


#[test]
fn test_parse_elevation_profile() {
    let xml = include_str!("../../../../../tests/fixtures/xodr/single_road.xodr");
    let project = parse_xodr(xml).unwrap();

    let elevations = &project.roads[0].elevation_profile;
    assert_eq!(elevations.len(), 2);
    assert!((elevations[0].a).abs() < f64::EPSILON);
    assert!((elevations[0].b - 0.01).abs() < 1e-10);
    assert!((elevations[1].a - 1.0).abs() < f64::EPSILON);
    assert!((elevations[1].s - 50.0).abs() < f64::EPSILON);
}


#[test]
fn test_parse_lane_sections() {
    let xml = include_str!("../../../../../tests/fixtures/xodr/single_road.xodr");
    let project = parse_xodr(xml).unwrap();

    let sections = &project.roads[0].lane_sections;
    assert_eq!(sections.len(), 2);

    // First section: left + center + right
    let s0 = &sections[0];
    assert!((s0.s).abs() < f64::EPSILON);
    assert_eq!(s0.left.len(), 2);
    assert_eq!(s0.center.len(), 1);
    assert_eq!(s0.right.len(), 2);

    // Left lanes have positive IDs
    assert_eq!(s0.left[0].id, 2);
    assert_eq!(s0.left[0].lane_type, LaneType::Sidewalk);
    assert_eq!(s0.left[1].id, 1);
    assert_eq!(s0.left[1].lane_type, LaneType::Driving);

    // Center lane
    assert_eq!(s0.center[0].id, 0);
    assert_eq!(s0.center[0].lane_type, LaneType::None);

    // Right lanes have negative IDs
    assert_eq!(s0.right[0].id, -1);
    assert_eq!(s0.right[0].lane_type, LaneType::Driving);
    assert_eq!(s0.right[1].id, -2);
}


#[test]
fn test_parse_lane_width() {
    let xml = include_str!("../../../../../tests/fixtures/xodr/single_road.xodr");
    let project = parse_xodr(xml).unwrap();

    let lane = &project.roads[0].lane_sections[0].right[0];
    assert_eq!(lane.width.len(), 1);
    assert!((lane.width[0].a - 3.5).abs() < f64::EPSILON);
}


#[test]
fn test_parse_lane_link() {
    let xml = include_str!("../../../../../tests/fixtures/xodr/single_road.xodr");
    let project = parse_xodr(xml).unwrap();

    let lane = &project.roads[0].lane_sections[0].left[1]; // id=1 driving
    let link = lane.link.as_ref().unwrap();
    assert_eq!(link.predecessor, Some(1));
    assert_eq!(link.successor, Some(1));
}


#[test]
fn test_parse_road_mark() {
    let xml = include_str!("../../../../../tests/fixtures/xodr/single_road.xodr");
    let project = parse_xodr(xml).unwrap();

    let lane = &project.roads[0].lane_sections[0].center[0];
    assert_eq!(lane.road_marks.len(), 1);
    assert_eq!(lane.road_marks[0].mark_type, RoadMarkType::Solid);
    assert_eq!(lane.road_marks[0].color, RoadMarkColor::Yellow);
}


// ── Junction file ────────────────────────────────

#[test]
fn test_parse_junction() {
    let xml = include_str!("../../../../../tests/fixtures/xodr/junction.xodr");
    let project = parse_xodr(xml).unwrap();

    assert_eq!(project.roads.len(), 3);
    assert_eq!(project.junctions.len(), 1);

    let junction = &project.junctions[0];
    assert_eq!(junction.id, "100");
    assert_eq!(junction.name, "MainJunction");
    assert_eq!(junction.connections.len(), 2);

    let conn0 = &junction.connections[0];
    assert_eq!(conn0.incoming_road, "1");
    assert_eq!(conn0.connecting_road, "3");
    assert_eq!(conn0.contact_point, ContactPoint::Start);
    assert_eq!(conn0.lane_links.len(), 1);
    assert_eq!(conn0.lane_links[0].from, -1);
    assert_eq!(conn0.lane_links[0].to, -1);
}


#[test]
fn test_parse_junction_road_link() {
    let xml = include_str!("../../../../../tests/fixtures/xodr/junction.xodr");
    let project = parse_xodr(xml).unwrap();

    // Road 3 is a connecting road in junction 100
    let road3 = &project.roads[2];
    assert_eq!(road3.junction_id.as_deref(), Some("100"));
}


// ── Error handling tests ─────────────────────────

#[test]
fn test_parse_invalid_xml() {
    let result = parse_xodr("<not valid xml");
    // Invalid XML should return an error
    assert!(result.is_err());
}


#[test]
fn test_parse_empty_string() {
    let result = parse_xodr("");
    assert!(result.is_ok()); // empty document yields empty project
}
