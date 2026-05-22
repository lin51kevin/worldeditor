//! NIO autonomous driving map format.
//!
//! Phase 2 provides a compact JSON-backed binary payload so the import/export
//! pipeline is working end-to-end. The file extension stays `.pb` / `.bin`
//! and the internal representation can be upgraded later without changing the
//! frontend plugin contract.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use we_core::model::{
    Geometry, GeometryType, Lane, LaneSection, LaneType, LaneWidth, Project, Road,
};

#[derive(Error, Debug)]
pub enum NioProtoError {
    #[error("Invalid NIO data: {0}")]
    InvalidData(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NioMap {
    version: String,
    map_name: String,
    roads: Vec<NioRoad>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NioRoad {
    id: String,
    length: f64,
    centerline: Vec<NioGeometry>,
    #[serde(default)]
    lanes: Vec<NioLane>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NioGeometry {
    x: f64,
    y: f64,
    hdg: f64,
    length: f64,
    #[serde(rename = "type")]
    geometry_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NioLane {
    id: i32,
    #[serde(rename = "type")]
    lane_type: String,
    width: f64,
}

/// Import a project from NIO bytes.
pub fn import_from_nio(bytes: &[u8]) -> Result<Project, NioProtoError> {
    if bytes.is_empty() {
        return Err(NioProtoError::InvalidData("empty input".into()));
    }

    let text = std::str::from_utf8(bytes)
        .map_err(|e| NioProtoError::InvalidData(format!("input is not utf-8: {e}")))?;
    let map: NioMap = serde_json::from_str(text)
        .map_err(|e| NioProtoError::InvalidData(format!("invalid nio json: {e}")))?;

    let roads = map
        .roads
        .into_iter()
        .map(import_road)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Project {
        name: map.map_name,
        roads,
        ..Default::default()
    })
}

/// Export a project to NIO bytes.
pub fn export_to_nio(project: &Project) -> Result<Vec<u8>, NioProtoError> {
    let map = NioMap {
        version: "1.0".into(),
        map_name: project.name.clone(),
        roads: project.roads.iter().map(export_road).collect(),
    };

    serde_json::to_vec(&map)
        .map_err(|e| NioProtoError::InvalidData(format!("failed to serialize nio json: {e}")))
}

fn import_road(road: NioRoad) -> Result<Road, NioProtoError> {
    if road.centerline.is_empty() {
        return Err(NioProtoError::InvalidData(format!(
            "road '{}' has empty centerline",
            road.id
        )));
    }

    let plan_view = road
        .centerline
        .into_iter()
        .map(|geometry| match geometry.geometry_type.as_str() {
            "line" | "Line" => Ok(Geometry {
                s: 0.0,
                x: geometry.x,
                y: geometry.y,
                hdg: geometry.hdg,
                length: geometry.length,
                geo_type: GeometryType::Line,
            }),
            other => Err(NioProtoError::InvalidData(format!(
                "unsupported nio geometry type '{other}'"
            ))),
        })
        .collect::<Result<Vec<_>, _>>()?;

    let mut imported = Road::from_centerline(road.id, plan_view);
    imported.length = road.length.max(imported.length);

    if !road.lanes.is_empty() {
        imported.lane_sections = vec![build_lane_section(&road.lanes)];
    }

    Ok(imported)
}

fn build_lane_section(lanes: &[NioLane]) -> LaneSection {
    let mut section = LaneSection {
        s: 0.0,
        single_side: false,
        render_hidden: false,
        left: Vec::new(),
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
        right: Vec::new(),
    };

    for lane in lanes {
        let converted = Lane {
            id: lane.id,
            lane_type: map_lane_type(&lane.lane_type),
            level: 0,
            render_hidden: false,
            link: None,
            width: vec![LaneWidth {
                s_offset: 0.0,
                a: lane.width,
                b: 0.0,
                c: 0.0,
                d: 0.0,
            }],
            borders: vec![],
            road_marks: vec![],
        };

        if lane.id > 0 {
            section.left.push(converted);
        } else if lane.id < 0 {
            section.right.push(converted);
        }
    }

    section.left.sort_by_key(|lane| lane.id);
    section.right.sort_by_key(|lane| lane.id);
    section
}

fn map_lane_type(value: &str) -> LaneType {
    match value.to_ascii_lowercase().as_str() {
        "driving" => LaneType::Driving,
        "shoulder" => LaneType::Shoulder,
        "sidewalk" => LaneType::Sidewalk,
        "parking" => LaneType::Parking,
        _ => LaneType::Driving,
    }
}

fn export_road(road: &Road) -> NioRoad {
    let lanes = road
        .lane_sections
        .first()
        .map(|section| {
            section
                .left
                .iter()
                .chain(section.right.iter())
                .map(|lane| NioLane {
                    id: lane.id,
                    lane_type: format!("{:?}", lane.lane_type).to_ascii_lowercase(),
                    width: lane.width.first().map(|width| width.a).unwrap_or(3.5),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    NioRoad {
        id: road.id.clone(),
        length: road.length,
        centerline: road
            .plan_view
            .iter()
            .filter_map(|geometry| match geometry.geo_type {
                GeometryType::Line => Some(NioGeometry {
                    x: geometry.x,
                    y: geometry.y,
                    hdg: geometry.hdg,
                    length: geometry.length,
                    geometry_type: "line".into(),
                }),
                _ => None,
            })
            .collect(),
        lanes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use we_core::model::{Geometry, GeometryType};

    #[test]
    fn test_import_empty_input_fails() {
        assert!(matches!(
            import_from_nio(&[]),
            Err(NioProtoError::InvalidData(_))
        ));
    }

    #[test]
    fn test_import_invalid_json_fails() {
        assert!(matches!(
            import_from_nio(b"not json"),
            Err(NioProtoError::InvalidData(_))
        ));
    }

    #[test]
    fn test_import_minimal_project_succeeds() {
        let project =
            import_from_nio(br#"{"version":"1.0","map_name":"test","roads":[]}"#).unwrap();
        assert_eq!(project.name, "test");
        assert!(project.roads.is_empty());
    }

    #[test]
    fn test_import_single_road_with_centerline() {
        let payload = br#"{
            "version":"1.0",
            "map_name":"one_road",
            "roads":[{
                "id":"r1",
                "length":100.0,
                "centerline":[{"x":0.0,"y":0.0,"hdg":0.0,"length":100.0,"type":"line"}]
            }]
        }"#;

        let project = import_from_nio(payload).unwrap();
        assert_eq!(project.roads.len(), 1);
        assert_eq!(project.roads[0].id, "r1");
        assert_eq!(project.roads[0].plan_view.len(), 1);
    }

    #[test]
    fn test_import_road_with_lanes() {
        let payload = br#"{
            "version":"1.0",
            "map_name":"lane_test",
            "roads":[{
                "id":"r1",
                "length":50.0,
                "centerline":[{"x":0.0,"y":0.0,"hdg":0.0,"length":50.0,"type":"line"}],
                "lanes":[{"id":-1,"type":"driving","width":3.5},{"id":1,"type":"shoulder","width":2.0}]
            }]
        }"#;

        let project = import_from_nio(payload).unwrap();
        assert_eq!(project.roads[0].lane_sections.len(), 1);
        assert_eq!(project.roads[0].lane_sections[0].right.len(), 1);
        assert_eq!(project.roads[0].lane_sections[0].left.len(), 1);
    }

    #[test]
    fn test_export_empty_project() {
        let bytes = export_to_nio(&Project::default()).unwrap();
        let json = String::from_utf8(bytes).unwrap();
        assert!(json.contains("\"roads\":[]"));
    }

    #[test]
    fn test_export_project_with_name() {
        let project = Project {
            name: "export_test".into(),
            ..Default::default()
        };
        let bytes = export_to_nio(&project).unwrap();
        let json = String::from_utf8(bytes).unwrap();
        assert!(json.contains("\"map_name\":\"export_test\""));
    }

    #[test]
    fn test_export_single_road() {
        let road = Road::from_centerline(
            "r1",
            vec![Geometry {
                s: 0.0,
                x: 10.0,
                y: 20.0,
                hdg: 0.5,
                length: 100.0,
                geo_type: GeometryType::Line,
            }],
        );
        let project = Project {
            name: "road_export".into(),
            roads: vec![road],
            ..Default::default()
        };
        let bytes = export_to_nio(&project).unwrap();
        let json = String::from_utf8(bytes).unwrap();
        assert!(json.contains("\"id\":\"r1\""));
        assert!(json.contains("\"x\":10.0"));
    }

    #[test]
    fn test_roundtrip_preserves_road_geometry() {
        let road = Road::from_centerline(
            "roundtrip_road",
            vec![Geometry {
                s: 0.0,
                x: 100.0,
                y: 200.0,
                hdg: 1.57,
                length: 50.0,
                geo_type: GeometryType::Line,
            }],
        );
        let original = Project {
            name: "roundtrip_test".into(),
            roads: vec![road],
            ..Default::default()
        };

        let bytes = export_to_nio(&original).unwrap();
        let imported = import_from_nio(&bytes).unwrap();
        assert_eq!(imported.roads.len(), 1);
        assert_eq!(imported.roads[0].id, "roundtrip_road");
        assert!((imported.roads[0].plan_view[0].x - 100.0).abs() < 1e-6);
        assert!((imported.roads[0].plan_view[0].y - 200.0).abs() < 1e-6);
    }
}
