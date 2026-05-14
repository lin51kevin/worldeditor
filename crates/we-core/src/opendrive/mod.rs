//! OpenDRIVE format parser and writer.
//!
//! Supports reading and writing `.xodr` files (OpenDRIVE 1.4–1.6).
//! Pure Rust, WASM compatible.

mod parser;
pub mod validator;
mod writer;

use crate::model::Project;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum OpenDriveError {
    #[error("XML parsing error: {0}")]
    XmlError(#[from] quick_xml::Error),
    #[error("Invalid OpenDRIVE structure: {0}")]
    InvalidStructure(String),
    #[error("Unsupported OpenDRIVE version: {0}")]
    UnsupportedVersion(String),
}

/// Parse an OpenDRIVE XML string into a Project.
pub fn parse_xodr(xml: &str) -> Result<Project, OpenDriveError> {
    parser::parse(xml)
}

/// Serialize a Project to OpenDRIVE XML string.
pub fn write_xodr(project: &Project) -> Result<String, OpenDriveError> {
    writer::write(project)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;

    // ── Minimal file ─────────────────────────────────

    #[test]
    fn test_parse_minimal() {
        let xml = include_str!("../../../../tests/fixtures/xodr/minimal.xodr");
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
        let xml = include_str!("../../../../tests/fixtures/xodr/single_road.xodr");
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
        let xml = include_str!("../../../../tests/fixtures/xodr/single_road.xodr");
        let project = parse_xodr(xml).unwrap();

        let geo = project.header.geo_reference.as_ref().unwrap();
        assert!((geo.origin_lat - 31.23).abs() < 1e-10);
        assert!((geo.origin_long - 121.47).abs() < 1e-10);
    }

    #[test]
    fn test_parse_road_link() {
        let xml = include_str!("../../../../tests/fixtures/xodr/single_road.xodr");
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
        let xml = include_str!("../../../../tests/fixtures/xodr/single_road.xodr");
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
        let xml = include_str!("../../../../tests/fixtures/xodr/single_road.xodr");
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
        let xml = include_str!("../../../../tests/fixtures/xodr/single_road.xodr");
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
        let xml = include_str!("../../../../tests/fixtures/xodr/single_road.xodr");
        let project = parse_xodr(xml).unwrap();

        let lane = &project.roads[0].lane_sections[0].right[0];
        assert_eq!(lane.width.len(), 1);
        assert!((lane.width[0].a - 3.5).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_lane_link() {
        let xml = include_str!("../../../../tests/fixtures/xodr/single_road.xodr");
        let project = parse_xodr(xml).unwrap();

        let lane = &project.roads[0].lane_sections[0].left[1]; // id=1 driving
        let link = lane.link.as_ref().unwrap();
        assert_eq!(link.predecessor, Some(1));
        assert_eq!(link.successor, Some(1));
    }

    #[test]
    fn test_parse_road_mark() {
        let xml = include_str!("../../../../tests/fixtures/xodr/single_road.xodr");
        let project = parse_xodr(xml).unwrap();

        let lane = &project.roads[0].lane_sections[0].center[0];
        assert_eq!(lane.road_marks.len(), 1);
        assert_eq!(lane.road_marks[0].mark_type, RoadMarkType::Solid);
        assert_eq!(lane.road_marks[0].color, RoadMarkColor::Yellow);
    }

    // ── Junction file ────────────────────────────────

    #[test]
    fn test_parse_junction() {
        let xml = include_str!("../../../../tests/fixtures/xodr/junction.xodr");
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
        let xml = include_str!("../../../../tests/fixtures/xodr/junction.xodr");
        let project = parse_xodr(xml).unwrap();

        // Road 3 is a connecting road in junction 100
        let road3 = &project.roads[2];
        assert_eq!(road3.junction_id.as_deref(), Some("100"));
    }

    // ── Roundtrip tests (parse → write → parse) ─────

    #[test]
    fn test_roundtrip_minimal() {
        let xml = include_str!("../../../../tests/fixtures/xodr/minimal.xodr");
        let project = parse_xodr(xml).unwrap();
        let written = write_xodr(&project).unwrap();
        let reparsed = parse_xodr(&written).unwrap();

        assert_eq!(reparsed.header.rev_major, project.header.rev_major);
        assert_eq!(reparsed.header.rev_minor, project.header.rev_minor);
        assert_eq!(reparsed.header.name, project.header.name);
    }

    #[test]
    fn test_roundtrip_single_road() {
        let xml = include_str!("../../../../tests/fixtures/xodr/single_road.xodr");
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
        let xml = include_str!("../../../../tests/fixtures/xodr/junction.xodr");
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
        let xml = include_str!("../../../../tests/fixtures/xodr/single_road.xodr");
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
        let xml = include_str!("../../../../tests/fixtures/xodr/single_road.xodr");
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
            }],
            junctions: vec![],
            ..Default::default()
        };
        let xml = write_xodr(&project).unwrap();
        assert!(xml.contains(r#"junction="10""#));
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

    // ══════════════════════════════════════════════════
    // Writer unit tests — cover every branch in writer.rs
    // ══════════════════════════════════════════════════

    // Helper: build a minimal Road to reduce boilerplate
    fn base_road() -> Road {
        Road {
            id: "r1".into(),
            name: "TestRoad".into(),
            length: 100.0,
            junction_id: None,
            render_hidden: false,
            link: None,
            plan_view: vec![Geometry {
                s: 0.0,
                x: 1.5,
                y: -2.3,
                hdg: 0.785,
                length: 100.0,
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
        }
    }

    fn project_with(roads: Vec<Road>, junctions: Vec<Junction>) -> Project {
        Project {
            name: String::new(),
            header: Header::default(),
            roads,
            junctions,
            ..Default::default()
        }
    }

    // ── f() formatting ──────────────────────────────

    #[test]
    fn test_write_f_zero() {
        let p = project_with(vec![{
            let mut r = base_road();
            r.plan_view[0].x = 0.0;
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains(r#"x="0""#));
    }

    #[test]
    fn test_write_f_integer() {
        let p = project_with(vec![{
            let mut r = base_road();
            r.plan_view[0].x = 42.0;
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains(r#"x="42.0""#));
    }

    #[test]
    fn test_write_f_fractional() {
        let p = project_with(vec![{
            let mut r = base_road();
            r.plan_view[0].x = 1.234;
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains(r#"x="1.234""#));
    }

    // ── Geometry types ──────────────────────────────

    #[test]
    fn test_write_arc_geometry() {
        let p = project_with(vec![{
            let mut r = base_road();
            r.plan_view[0].geo_type = GeometryType::Arc { curvature: 0.05 };
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains("<arc"));
        assert!(xml.contains(r#"curvature="0.05""#));
    }

    #[test]
    fn test_write_spiral_geometry() {
        let p = project_with(vec![{
            let mut r = base_road();
            r.plan_view[0].geo_type = GeometryType::Spiral {
                curv_start: 0.0,
                curv_end: 0.1,
            };
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains("<spiral"));
        assert!(xml.contains(r#"curvStart="0""#));
        assert!(xml.contains(r#"curvEnd="0.1""#));
    }

    #[test]
    fn test_write_poly3_geometry() {
        let p = project_with(vec![{
            let mut r = base_road();
            r.plan_view[0].geo_type = GeometryType::Poly3 {
                a: 1.0,
                b: 2.0,
                c: 3.0,
                d: 4.0,
            };
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains("<poly3"));
        assert!(xml.contains(r#"a="1.0""#));
        assert!(xml.contains(r#"d="4.0""#));
    }

    #[test]
    fn test_write_param_poly3_geometry_arclength() {
        let p = project_with(vec![{
            let mut r = base_road();
            r.plan_view[0].geo_type = GeometryType::ParamPoly3 {
                a_u: 0.0,
                b_u: 1.0,
                c_u: 0.0,
                d_u: 0.0,
                a_v: 0.0,
                b_v: 0.0,
                c_v: 1.0,
                d_v: 0.0,
                p_range: ParamPoly3Range::ArcLength,
            };
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains("<paramPoly3"));
        assert!(xml.contains(r#"pRange="arcLength""#));
        assert!(xml.contains(r#"bU="1.0""#));
    }

    #[test]
    fn test_write_param_poly3_geometry_normalized() {
        let p = project_with(vec![{
            let mut r = base_road();
            r.plan_view[0].geo_type = GeometryType::ParamPoly3 {
                a_u: 0.0,
                b_u: 1.0,
                c_u: 0.0,
                d_u: 0.0,
                a_v: 0.0,
                b_v: 0.0,
                c_v: 1.0,
                d_v: 0.0,
                p_range: ParamPoly3Range::Normalized,
            };
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains(r#"pRange="normalized""#));
    }

    // ── Elevation ───────────────────────────────────

    #[test]
    fn test_write_elevation_profile() {
        let p = project_with(vec![{
            let mut r = base_road();
            r.elevation_profile = vec![
                Elevation { s: 0.0, a: 0.0, b: 0.01, c: 0.0, d: 0.0 },
                Elevation { s: 50.0, a: 1.0, b: -0.01, c: 0.0, d: 0.0 },
            ];
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains("<elevationProfile>"));
        assert!(xml.contains("</elevationProfile>"));
        let count = xml.matches("<elevation ").count();
        assert_eq!(count, 2);
    }

    #[test]
    fn test_write_elevation_roundtrip() {
        let p = project_with(vec![{
            let mut r = base_road();
            r.elevation_profile = vec![
                Elevation { s: 0.0, a: 5.5, b: 0.01, c: 0.002, d: -0.0001 },
            ];
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        let re = parse_xodr(&xml).unwrap();
        let elev = &re.roads[0].elevation_profile[0];
        assert!((elev.a - 5.5).abs() < 1e-10);
        assert!((elev.b - 0.01).abs() < 1e-10);
        assert!((elev.c - 0.002).abs() < 1e-10);
        assert!((elev.d - (-0.0001)).abs() < 1e-10);
    }

    // ── Lanes ───────────────────────────────────────

    #[test]
    fn test_write_lane_section_with_all_groups() {
        let p = project_with(vec![{
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
                    width: vec![LaneWidth { s_offset: 0.0, a: 3.5, b: 0.0, c: 0.0, d: 0.0 }],
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
                    link: Some(LaneLink { predecessor: Some(1), successor: Some(-1) }),
                    width: vec![LaneWidth { s_offset: 0.0, a: 3.5, b: 0.0, c: 0.0, d: 0.0 }],
                    borders: vec![],
                    road_marks: vec![],
                }],
            }];
            r
        }], vec![]);
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
        let p = project_with(vec![{
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
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains(r#"singleSide="1""#));
    }

    #[test]
    fn test_write_lane_no_children_self_closing() {
        let p = project_with(vec![{
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
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        // Self-closing lane element: <lane ... />
        assert!(xml.contains(r#"type="sidewalk""#));
    }

    #[test]
    fn test_write_lane_link_roundtrip() {
        let p = project_with(vec![{
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
                    link: Some(LaneLink { predecessor: Some(2), successor: Some(-3) }),
                    width: vec![LaneWidth { s_offset: 0.0, a: 3.0, b: 0.0, c: 0.0, d: 0.0 }],
                    borders: vec![],
                    road_marks: vec![],
                }],
            }];
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        let re = parse_xodr(&xml).unwrap();
        let link = re.roads[0].lane_sections[0].right[0].link.as_ref().unwrap();
        assert_eq!(link.predecessor, Some(2));
        assert_eq!(link.successor, Some(-3));
    }

    // ── Lane Offsets ────────────────────────────────

    #[test]
    fn test_write_lane_offsets() {
        let p = project_with(vec![{
            let mut r = base_road();
            r.lane_offsets = vec![
                LaneOffset { s: 0.0, a: 1.0, b: 0.0, c: 0.0, d: 0.0 },
                LaneOffset { s: 50.0, a: -1.0, b: 0.0, c: 0.0, d: 0.0 },
            ];
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert_eq!(xml.matches("<laneOffset ").count(), 2);
    }

    // ── Lateral Profile ─────────────────────────────

    #[test]
    fn test_write_superelevation() {
        let p = project_with(vec![{
            let mut r = base_road();
            r.lateral_profile = LateralProfile {
                superelevations: vec![Superelevation { s: 0.0, a: 0.02, b: 0.0, c: 0.0, d: 0.0 }],
                crossfalls: vec![],
            };
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains("<lateralProfile>"));
        assert!(xml.contains("<superelevation "));
    }

    #[test]
    fn test_write_crossfall() {
        let p = project_with(vec![{
            let mut r = base_road();
            r.lateral_profile = LateralProfile {
                superelevations: vec![],
                crossfalls: vec![
                    Crossfall { s: 0.0, a: 0.01, b: 0.0, c: 0.0, d: 0.0, side: CrossfallSide::Both },
                    Crossfall { s: 50.0, a: -0.01, b: 0.0, c: 0.0, d: 0.0, side: CrossfallSide::Left },
                ],
            };
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains(r#"side="both""#));
        assert!(xml.contains(r#"side="left""#));
    }

    #[test]
    fn test_write_crossfall_right() {
        let p = project_with(vec![{
            let mut r = base_road();
            r.lateral_profile = LateralProfile {
                superelevations: vec![],
                crossfalls: vec![
                    Crossfall { s: 0.0, a: 0.01, b: 0.0, c: 0.0, d: 0.0, side: CrossfallSide::Right },
                ],
            };
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains(r#"side="right""#));
    }

    // ── Bridges & Tunnels ───────────────────────────

    #[test]
    fn test_write_bridges() {
        let p = project_with(vec![{
            let mut r = base_road();
            r.bridges = vec![Bridge {
                id: "br1".into(),
                s: 10.0,
                length: 30.0,
                bridge_type: "concrete".into(),
            }];
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains("<bridges>"));
        assert!(xml.contains(r#"id="br1""#));
        assert!(xml.contains(r#"type="concrete""#));
    }

    #[test]
    fn test_write_tunnels() {
        let p = project_with(vec![{
            let mut r = base_road();
            r.tunnels = vec![Tunnel {
                id: "tn1".into(),
                s: 20.0,
                length: 50.0,
                tunnel_type: "standard".into(),
            }];
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains("<tunnels>"));
        assert!(xml.contains(r#"id="tn1""#));
    }

    // ── Signals ────────────────────────���────────────

    #[test]
    fn test_write_signals() {
        let p = project_with(vec![{
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
            }];
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains("<signals>"));
        assert!(xml.contains(r#"id="sig1""#));
        assert!(xml.contains(r#"dynamic="false""#));
        assert!(xml.contains(r#"value="30""#));
    }

    #[test]
    fn test_write_signal_dynamic() {
        let p = project_with(vec![{
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
            }];
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains(r#"dynamic="true""#));
        assert!(!xml.contains(r#"value="#));
    }

    // ── Objects ─────────────────────────────────────

    #[test]
    fn test_write_objects() {
        let p = project_with(vec![{
            let mut r = base_road();
            r.objects = vec![RoadObject {
                id: "obj1".into(),
                name: "Guardrail".into(),
                object_type: ObjectType::Guardrail,
                position: Point3D { x: 10.0, y: 2.0, z: 0.0, id: None },
                orientation: 0.0,
                hdg: 0.0,
                width: 0.5,
                height: 0.8,
                length: 0.0,
                corners: vec![],
                validity: Some(Validity { from_lane: -1, to_lane: -2 }),
            }];
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains("<objects>"));
        assert!(xml.contains("<roadObjects>"));
        assert!(xml.contains(r#"type="guardrail""#));
        assert!(xml.contains(r#"validity="-1 -2""#));
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
            let p = project_with(vec![{
                let mut r = base_road();
                r.objects = vec![RoadObject {
                    id: "o1".into(),
                    name: String::new(),
                    object_type: ot,
                    position: Point3D { x: 0.0, y: 0.0, z: 0.0, id: None },
                    orientation: 0.0,
                    hdg: 0.0,
                    width: 1.0,
                    height: 1.0,
                    length: 0.0,
                    corners: vec![],
                    validity: None,
                }];
                r
            }], vec![]);
            let xml = write_xodr(&p).unwrap();
            assert!(xml.contains(&format!(r#"type="{expected}""#)), "Failed for object type {expected}");
        }
    }

    #[test]
    fn test_write_object_no_validity() {
        let p = project_with(vec![{
            let mut r = base_road();
            r.objects = vec![RoadObject {
                id: "obj2".into(),
                name: "Barrier".into(),
                object_type: ObjectType::Barrier,
                position: Point3D { x: 5.0, y: 1.0, z: 0.0, id: None },
                orientation: 1.57,
                hdg: 0.0,
                width: 0.2,
                height: 1.0,
                length: 0.0,
                corners: vec![],
                validity: None,
            }];
            r
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(!xml.contains("validity="));
    }

    // ── Road Link ───────────────────────────────────

    #[test]
    fn test_write_road_link() {
        let p = project_with(vec![{
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
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains("<link>"));
        assert!(xml.contains(r#"elementType="road""#));
        assert!(xml.contains(r#"contactPoint="end""#));
        assert!(xml.contains(r#"elementType="junction""#));
    }

    #[test]
    fn test_write_road_link_roundtrip() {
        let p = project_with(vec![{
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
        }], vec![]);
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
        let p = project_with(vec![], vec![Junction {
            id: "j1".into(),
            name: "EmptyJunction".into(),
            connections: vec![],
        }]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains(r#"<junction"#));
        assert!(xml.contains(r#"id="j1""#));
    }

    #[test]
    fn test_write_junction_connection_no_lane_links() {
        let p = project_with(vec![], vec![Junction {
            id: "j2".into(),
            name: "J".into(),
            connections: vec![JunctionConnection {
                id: "c1".into(),
                incoming_road: "r1".into(),
                connecting_road: "r2".into(),
                contact_point: ContactPoint::Start,
                lane_links: vec![],
            }],
        }]);
        let xml = write_xodr(&p).unwrap();
        // Self-closing connection element
        assert!(xml.contains(r#"contactPoint="start""#));
    }

    #[test]
    fn test_write_junction_connection_with_lane_links() {
        let p = project_with(vec![], vec![Junction {
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
        }]);
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
            let p = project_with(vec![{
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
            }], vec![]);
            let xml = write_xodr(&p).unwrap();
            assert!(xml.contains(&format!(r#"type="{expected}""#)), "Failed for road mark type {expected}");
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
            let p = project_with(vec![{
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
            }], vec![]);
            let xml = write_xodr(&p).unwrap();
            assert!(xml.contains(&format!(r#"color="{expected}""#)), "Failed for color {expected}");
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
            let p = project_with(vec![{
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
            }], vec![]);
            let xml = write_xodr(&p).unwrap();
            assert!(xml.contains(&format!(r#"type="{expected}""#)), "Failed for lane type {expected}");
        }
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

    // ── Road mark weight ────────────────────────────

    #[test]
    fn test_write_road_mark_bold_weight() {
        let p = project_with(vec![{
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
        }], vec![]);
        let xml = write_xodr(&p).unwrap();
        assert!(xml.contains(r#"weight="bold""#));
        assert!(xml.contains(r#"laneChange="both""#));
    }

    // ── Full complex roundtrip ──────────────────────

    #[test]
    fn test_write_complex_project_roundtrip() {
        let p = project_with(vec![{
            let mut r = base_road();
            r.link = Some(RoadLink {
                predecessor: Some(LinkElement {
                    element_type: LinkElementType::Road,
                    element_id: "0".into(),
                    contact_point: Some(ContactPoint::End),
                }),
                successor: None,
            });
            r.elevation_profile = vec![Elevation { s: 0.0, a: 0.0, b: 0.01, c: 0.0, d: 0.0 }];
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
                    width: vec![LaneWidth { s_offset: 0.0, a: 3.5, b: 0.0, c: 0.0, d: 0.0 }],
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
                    width: vec![LaneWidth { s_offset: 0.0, a: 3.5, b: 0.0, c: 0.0, d: 0.0 }],
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
            }];
            r.objects = vec![RoadObject {
                id: "o1".into(),
                name: "Wall".into(),
                object_type: ObjectType::Wall,
                position: Point3D { x: 5.0, y: -1.0, z: 0.0, id: None },
                orientation: 0.0,
                hdg: 0.0,
                width: 0.3,
                height: 2.0,
                length: 0.0,
                corners: vec![],
                validity: None,
            }];
            r.bridges = vec![Bridge { id: "b1".into(), s: 20.0, length: 10.0, bridge_type: "steel".into() }];
            r.tunnels = vec![Tunnel { id: "t1".into(), s: 40.0, length: 20.0, tunnel_type: "standard".into() }];
            r
        }], vec![Junction {
            id: "j1".into(),
            name: "TestJunction".into(),
            connections: vec![JunctionConnection {
                id: "c1".into(),
                incoming_road: "r1".into(),
                connecting_road: "r2".into(),
                contact_point: ContactPoint::Start,
                lane_links: vec![JunctionLaneLink { from: -1, to: -1 }],
            }],
        }]);
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
}
