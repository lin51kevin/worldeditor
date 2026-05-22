//! Domain models for WorldEditor.
//!
//! Core data structures representing roads, lanes, junctions, signals, etc.
//! All types are serializable and WASM compatible.

pub(crate) mod crg;
pub mod lane;
pub(crate) mod road;
pub mod road_link;
pub(crate) mod shape;
pub(crate) mod template;
pub(crate) mod traffic;
pub(crate) mod zone;

pub use crg::{CrgOrientation, CrgProfile, CrgReference};
pub use lane::{
    Lane, LaneBorder, LaneLink, LaneSection, LaneType, LaneWidth, RoadMark, RoadMarkColor,
    RoadMarkType, RoadMarkWeight,
};
pub use road::{
    Bridge, CornerType, Crossfall, CrossfallSide, Elevation, Geometry, GeometryType, LaneOffset,
    LateralProfile, ObjectType, ParamPoly3Range, Point3D, Road, RoadObject, Signal, Superelevation,
    Tunnel, Validity,
};
pub use road_link::{ContactPoint, LinkElement, LinkElementType, RoadLink};
pub use shape::{ShapeLayer, ShapeNode, ShapeRelation, ShapeRelationMember, ShapeTag, ShapeWay};
pub use template::RoadTemplate;
pub use traffic::{SignalController, SignalGroup, SignalPhase};
pub use zone::{Zone, ZoneStatus, ZoneType, ZoneVertex};

use serde::{Deserialize, Serialize};

/// OpenDRIVE file header metadata.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Header {
    pub rev_major: u32,
    pub rev_minor: u32,
    pub name: String,
    pub date: String,
    pub north: f64,
    pub south: f64,
    pub east: f64,
    pub west: f64,
    pub geo_reference: Option<GeoReference>,
}

/// Geographic reference point for coordinate transforms.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GeoReference {
    pub origin_lat: f64,
    pub origin_long: f64,
    pub origin_alt: f64,
    pub origin_hdg: f64,
}

/// A complete road network project.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Project {
    pub name: String,
    pub header: Header,
    pub roads: Vec<Road>,
    pub junctions: Vec<Junction>,
    /// Project-level traffic signals (not road-local).
    #[serde(default)]
    pub signals: Vec<Signal>,
    /// Project-level road objects.
    #[serde(default)]
    pub objects: Vec<RoadObject>,
    /// Shape vector layers (nodes, ways, relations for pre-road geometry).
    #[serde(default)]
    pub shape_layers: Vec<ShapeLayer>,
}

/// A junction connecting multiple roads.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Junction {
    pub id: String,
    pub name: String,
    pub connections: Vec<JunctionConnection>,
}

/// A connection within a junction.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JunctionConnection {
    pub id: String,
    pub incoming_road: String,
    pub connecting_road: String,
    pub contact_point: ContactPoint,
    pub lane_links: Vec<JunctionLaneLink>,
}

/// Lane link within a junction connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JunctionLaneLink {
    pub from: i32,
    pub to: i32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_project_default() {
        let project = Project::default();
        assert!(project.roads.is_empty());
        assert!(project.junctions.is_empty());
    }

    #[test]
    fn test_project_serialization() {
        let project = Project {
            name: "test".to_string(),
            header: Header::default(),
            roads: vec![],
            junctions: vec![],
            ..Default::default()
        };
        let json = serde_json::to_string(&project).unwrap();
        let deserialized: Project = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "test");
    }

    #[test]
    fn test_header_default() {
        let header = Header::default();
        assert_eq!(header.rev_major, 0);
        assert_eq!(header.rev_minor, 0);
        assert!(header.name.is_empty());
        assert!(header.date.is_empty());
        assert!((header.north - 0.0).abs() < f64::EPSILON);
        assert!((header.south - 0.0).abs() < f64::EPSILON);
        assert!((header.east - 0.0).abs() < f64::EPSILON);
        assert!((header.west - 0.0).abs() < f64::EPSILON);
        assert!(header.geo_reference.is_none());
    }

    #[test]
    fn test_geo_reference_default() {
        let geo_reference = GeoReference::default();
        assert!((geo_reference.origin_lat - 0.0).abs() < f64::EPSILON);
        assert!((geo_reference.origin_long - 0.0).abs() < f64::EPSILON);
        assert!((geo_reference.origin_alt - 0.0).abs() < f64::EPSILON);
        assert!((geo_reference.origin_hdg - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_junction_serialization() {
        let junction = Junction {
            id: "junction-1".to_string(),
            name: "Main Junction".to_string(),
            connections: vec![JunctionConnection {
                id: "connection-1".to_string(),
                incoming_road: "road-a".to_string(),
                connecting_road: "road-b".to_string(),
                contact_point: ContactPoint::Start,
                lane_links: vec![JunctionLaneLink { from: -1, to: 1 }],
            }],
        };

        let json = serde_json::to_string(&junction).unwrap();
        let deserialized: Junction = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.id, "junction-1");
        assert_eq!(deserialized.name, "Main Junction");
        assert_eq!(deserialized.connections.len(), 1);
        assert_eq!(deserialized.connections[0].incoming_road, "road-a");
        assert_eq!(deserialized.connections[0].connecting_road, "road-b");
        assert_eq!(
            deserialized.connections[0].contact_point,
            ContactPoint::Start
        );
        assert_eq!(deserialized.connections[0].lane_links.len(), 1);
        assert_eq!(deserialized.connections[0].lane_links[0].from, -1);
        assert_eq!(deserialized.connections[0].lane_links[0].to, 1);
    }

    #[test]
    fn test_junction_lane_link() {
        let lane_link = JunctionLaneLink { from: -2, to: 2 };
        let json = serde_json::to_string(&lane_link).unwrap();
        let deserialized: JunctionLaneLink = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.from, -2);
        assert_eq!(deserialized.to, 2);
    }

    #[test]
    fn test_project_with_roads_and_junctions() {
        let project = Project {
            name: "network".to_string(),
            header: Header {
                rev_major: 1,
                rev_minor: 8,
                name: "network".to_string(),
                date: "2025-01-01".to_string(),
                north: 100.0,
                south: -100.0,
                east: 200.0,
                west: -200.0,
                geo_reference: Some(GeoReference {
                    origin_lat: 39.9042,
                    origin_long: 116.4074,
                    origin_alt: 50.0,
                    origin_hdg: 0.1,
                }),
            },
            roads: vec![Road::from_centerline(
                "road-1",
                vec![Geometry {
                    s: 0.0,
                    x: 0.0,
                    y: 0.0,
                    hdg: 0.0,
                    length: 25.0,
                    geo_type: GeometryType::Line,
                }],
            )],
            junctions: vec![Junction {
                id: "junction-1".to_string(),
                name: "Crossing".to_string(),
                connections: vec![JunctionConnection {
                    id: "connection-1".to_string(),
                    incoming_road: "road-1".to_string(),
                    connecting_road: "road-2".to_string(),
                    contact_point: ContactPoint::End,
                    lane_links: vec![JunctionLaneLink { from: -1, to: 1 }],
                }],
            }],
            ..Default::default()
        };

        let json = serde_json::to_string(&project).unwrap();
        let deserialized: Project = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "network");
        assert_eq!(deserialized.roads.len(), 1);
        assert_eq!(deserialized.junctions.len(), 1);
        assert_eq!(deserialized.roads[0].id, "road-1");
        assert!((deserialized.roads[0].length - 25.0).abs() < f64::EPSILON);
        assert_eq!(deserialized.roads[0].lane_sections.len(), 1);
        assert_eq!(
            deserialized.junctions[0].connections[0].contact_point,
            ContactPoint::End
        );
        assert!(deserialized.header.geo_reference.is_some());
    }
}
