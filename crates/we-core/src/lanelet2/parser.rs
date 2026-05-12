//! Lanelet2 OSM-XML parser.
//!
//! Parses Lanelet2 map files (OSM XML dialect) into the WorldEditor project model.

use crate::model::{Geometry, GeometryType, Project, Road};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum LaneletParseError {
    #[error("Invalid XML: {0}")]
    InvalidXml(String),
    #[error("No lanelets found in the file")]
    NoLanelets,
}

struct Ll2Node {
    id: String,
    lat: f64,
    lon: f64,
}

struct Ll2Way {
    id: String,
    node_refs: Vec<String>,
    tags: std::collections::HashMap<String, String>,
}

/// Import a Lanelet2 OSM-XML string into a [`Project`].
pub fn import_from_lanelet2(xml: &str) -> Result<Project, LaneletParseError> {
    if !xml.contains("<osm") {
        return Err(LaneletParseError::InvalidXml(
            "Missing <osm> root element".into(),
        ));
    }

    let nodes = parse_nodes(xml);
    let ways = parse_ways(xml);

    if nodes.is_empty() && ways.is_empty() {
        return Err(LaneletParseError::NoLanelets);
    }

    let node_map: std::collections::HashMap<&str, &Ll2Node> =
        nodes.iter().map(|n| (n.id.as_str(), n)).collect();

    let mut roads: Vec<Road> = Vec::new();

    for way in &ways {
        if !way.tags.contains_key("type") && !way.tags.contains_key("subtype") {
            continue;
        }
        let pts: Vec<(f64, f64)> = way
            .node_refs
            .iter()
            .filter_map(|nid| node_map.get(nid.as_str()))
            .map(|n| (n.lon, n.lat))
            .collect();

        if pts.len() < 2 {
            continue;
        }

        let start = pts[0];
        let end = pts[pts.len() - 1];
        let dx = end.0 - start.0;
        let dy = end.1 - start.1;
        let length = (dx * dx + dy * dy).sqrt().max(1.0);
        let hdg = dy.atan2(dx);

        let geom = Geometry {
            s: 0.0,
            x: start.0,
            y: start.1,
            hdg,
            length,
            geo_type: GeometryType::Line,
        };
        let road = Road::from_centerline(way.id.clone(), vec![geom]);
        roads.push(road);
    }

    if roads.is_empty() {
        return Err(LaneletParseError::NoLanelets);
    }

    Ok(Project { roads, ..Default::default() })
}

fn parse_nodes(xml: &str) -> Vec<Ll2Node> {
    let mut nodes = Vec::new();
    for line in xml.lines() {
        let t = line.trim();
        if t.starts_with("<node ") {
            let id = attr_value(t, "id").unwrap_or_default();
            let lat = attr_value(t, "lat").and_then(|s| s.parse().ok()).unwrap_or(0.0);
            let lon = attr_value(t, "lon").and_then(|s| s.parse().ok()).unwrap_or(0.0);
            nodes.push(Ll2Node { id, lat, lon });
        }
    }
    nodes
}

fn parse_ways(xml: &str) -> Vec<Ll2Way> {
    let mut ways = Vec::new();
    let mut current: Option<Ll2Way> = None;
    for line in xml.lines() {
        let t = line.trim();
        if t.starts_with("<way ") {
            let id = attr_value(t, "id").unwrap_or_default();
            current = Some(Ll2Way { id, node_refs: vec![], tags: Default::default() });
        } else if t == "</way>" {
            if let Some(way) = current.take() {
                ways.push(way);
            }
        } else if let Some(way) = current.as_mut() {
            if t.starts_with("<nd ") {
                if let Some(r) = attr_value(t, "ref") {
                    way.node_refs.push(r);
                }
            } else if t.starts_with("<tag ") {
                let k = attr_value(t, "k").unwrap_or_default();
                let v = attr_value(t, "v").unwrap_or_default();
                way.tags.insert(k, v);
            }
        }
    }
    ways
}

fn attr_value(line: &str, attr: &str) -> Option<String> {
    let needle = format!("{attr}=\"");
    let start = line.find(&needle)? + needle.len();
    let end = line[start..].find('"')? + start;
    Some(line[start..end].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASIC: &str = r#"<?xml version="1.0"?>
<osm version="0.6">
  <node id="1" lat="0.0" lon="0.0"/>
  <node id="2" lat="0.001" lon="0.001"/>
  <way id="100">
    <nd ref="1"/>
    <nd ref="2"/>
    <tag k="type" v="lanelet"/>
    <tag k="subtype" v="road"/>
  </way>
</osm>"#;

    #[test]
    fn test_parse_basic_lanelet() {
        let project = import_from_lanelet2(BASIC).unwrap();
        assert_eq!(project.roads.len(), 1);
    }

    #[test]
    fn test_parse_road_id_matches_way_id() {
        let project = import_from_lanelet2(BASIC).unwrap();
        assert_eq!(project.roads[0].id, "100");
    }

    #[test]
    fn test_parse_road_has_geometry() {
        let project = import_from_lanelet2(BASIC).unwrap();
        assert_eq!(project.roads[0].plan_view.len(), 1);
    }

    #[test]
    fn test_parse_no_osm_root_returns_error() {
        let result = import_from_lanelet2("<invalid>data</invalid>");
        assert!(matches!(result, Err(LaneletParseError::InvalidXml(_))));
    }

    #[test]
    fn test_parse_empty_osm_returns_error() {
        let result = import_from_lanelet2("<osm version=\"0.6\"></osm>");
        assert!(matches!(result, Err(LaneletParseError::NoLanelets)));
    }

    #[test]
    fn test_parse_way_without_type_tag_ignored() {
        let xml = r#"<osm version="0.6">
  <node id="1" lat="0.0" lon="0.0"/>
  <node id="2" lat="0.001" lon="0.001"/>
  <way id="200">
    <nd ref="1"/>
    <nd ref="2"/>
  </way>
</osm>"#;
        assert!(import_from_lanelet2(xml).is_err());
    }

    #[test]
    fn test_attr_value() {
        assert_eq!(attr_value("<node id=\"42\" lat=\"1.5\"/>", "id").as_deref(), Some("42"));
        assert_eq!(attr_value("<node id=\"42\" lat=\"1.5\"/>", "lat").as_deref(), Some("1.5"));
        assert_eq!(attr_value("<node id=\"42\"/>", "missing"), None);
    }
}
