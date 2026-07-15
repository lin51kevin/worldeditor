#![allow(unused_imports)]
use super::super::*;
use super::*;
use crate::model::*;


// ── Roundtrip tests (parse → write → parse) ─────

#[test]
fn test_roundtrip_minimal() {
    let xml = include_str!("../../../../../tests/fixtures/xodr/minimal.xodr");
    let project = parse_xodr(xml).unwrap();
    let written = write_xodr(&project).unwrap();
    let reparsed = parse_xodr(&written).unwrap();

    assert_eq!(reparsed.header.rev_major, project.header.rev_major);
    assert_eq!(reparsed.header.rev_minor, project.header.rev_minor);
    assert_eq!(reparsed.header.name, project.header.name);
}


#[test]
fn test_roundtrip_single_road() {
    let xml = include_str!("../../../../../tests/fixtures/xodr/single_road.xodr");
    let project = parse_xodr(xml).unwrap();
    let written = write_xodr(&project).unwrap();
    let reparsed = parse_xodr(&written).unwrap();

    assert_eq!(reparsed.roads.len(), project.roads.len());
    let orig = &project.roads[0];
    let copy = &reparsed.roads[0];
    assert_eq!(orig.id, copy.id);
    assert_eq!(orig.name, copy.name);
    assert!((orig.length - copy.length).abs() < 1e-10);
    assert_eq!(orig.plan_view.len(), copy.plan_view.len());
    assert_eq!(orig.elevation_profile.len(), copy.elevation_profile.len());
    assert_eq!(orig.lane_sections.len(), copy.lane_sections.len());
}


#[test]
fn test_roundtrip_junction() {
    let xml = include_str!("../../../../../tests/fixtures/xodr/junction.xodr");
    let project = parse_xodr(xml).unwrap();
    let written = write_xodr(&project).unwrap();
    let reparsed = parse_xodr(&written).unwrap();

    assert_eq!(reparsed.roads.len(), 3);
    assert_eq!(reparsed.junctions.len(), 1);
    assert_eq!(reparsed.junctions[0].connections.len(), 2);
    assert_eq!(reparsed.junctions[0].connections[0].lane_links.len(), 1);
}


#[test]
fn test_roundtrip_preserves_geo_reference() {
    let xml = include_str!("../../../../../tests/fixtures/xodr/single_road.xodr");
    let project = parse_xodr(xml).unwrap();
    let written = write_xodr(&project).unwrap();
    let reparsed = parse_xodr(&written).unwrap();

    let orig_geo = project.header.geo_reference.as_ref().unwrap();
    let copy_geo = reparsed.header.geo_reference.as_ref().unwrap();
    assert!((orig_geo.origin_lat - copy_geo.origin_lat).abs() < 1e-10);
    assert!((orig_geo.origin_long - copy_geo.origin_long).abs() < 1e-10);
}


#[test]
fn test_roundtrip_preserves_lane_links() {
    let xml = include_str!("../../../../../tests/fixtures/xodr/single_road.xodr");
    let project = parse_xodr(xml).unwrap();
    let written = write_xodr(&project).unwrap();
    let reparsed = parse_xodr(&written).unwrap();

    let orig_lane = &project.roads[0].lane_sections[0].right[0];
    let copy_lane = &reparsed.roads[0].lane_sections[0].right[0];
    assert_eq!(
        orig_lane.link.as_ref().map(|l| l.predecessor),
        copy_lane.link.as_ref().map(|l| l.predecessor)
    );
}
