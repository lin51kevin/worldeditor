//! OpenStreetMap XML export for road network data.
//!
//! Generates an OSM XML document where:
//! - Each road start/end point becomes an OSM `<node>`
//! - Each road becomes an OSM `<way>` referencing its endpoint nodes
//! - Junctions produce `<relation>` elements

use crate::model::{Project, Road};

/// Export a project as an OpenStreetMap XML string.
///
/// Nodes are assigned negative IDs (OSM convention for new/unsaved elements).
pub fn export_to_osm(project: &Project) -> String {
    let mut output = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<osm version=\"0.6\" generator=\"WorldEditor Next\">\n",
    );

    let mut node_id: i64 = -1;
    let mut way_id: i64 = -1;
    // (road_id, start_nid, end_nid)
    let mut road_node_ids: Vec<(String, i64, i64)> = Vec::new();

    // Emit nodes for each road endpoint
    for road in &project.roads {
        let (sx, sy) = road_start(road);
        let (ex, ey) = road_end(road);

        let start_nid = node_id;
        output.push_str(&format!(
            "  <node id=\"{}\" lat=\"{}\" lon=\"{}\"/>\n",
            start_nid, sy, sx
        ));
        node_id -= 1;

        let end_nid = node_id;
        output.push_str(&format!(
            "  <node id=\"{}\" lat=\"{}\" lon=\"{}\"/>\n",
            end_nid, ey, ex
        ));
        node_id -= 1;

        road_node_ids.push((road.id.clone(), start_nid, end_nid));
    }

    // Emit ways for each road
    for road in &project.roads {
        if let Some((_, start_nid, end_nid)) = road_node_ids.iter().find(|(id, ..)| id == &road.id)
        {
            let w_id = way_id;
            way_id -= 1;
            output.push_str(&format!("  <way id=\"{}\">\n", w_id));
            output.push_str(&format!("    <nd ref=\"{}\"/>\n", start_nid));
            output.push_str(&format!("    <nd ref=\"{}\"/>\n", end_nid));
            output.push_str(&format!(
                "    <tag k=\"highway\" v=\"{}\"/>\n",
                osm_highway_tag(road)
            ));
            if !road.id.is_empty() {
                output.push_str(&format!("    <tag k=\"ref\" v=\"{}\"/>\n", road.id));
            }
            output.push_str("  </way>\n");
        }
    }

    // Emit relations for junctions
    for junction in &project.junctions {
        let j_id = way_id;
        way_id -= 1;
        output.push_str(&format!("  <relation id=\"{}\">\n", j_id));
        output.push_str("    <tag k=\"type\" v=\"junction\"/>\n");
        output.push_str(&format!("    <tag k=\"ref\" v=\"{}\"/>\n", junction.id));
        output.push_str("  </relation>\n");
    }

    output.push_str("</osm>\n");
    output
}

fn road_start(road: &Road) -> (f64, f64) {
    road.plan_view
        .first()
        .map(|g| (g.x, g.y))
        .unwrap_or((0.0, 0.0))
}

fn road_end(road: &Road) -> (f64, f64) {
    if let Some(last) = road.plan_view.last() {
        let x = last.x + road.length * last.hdg.cos();
        let y = last.y + road.length * last.hdg.sin();
        (x, y)
    } else {
        (0.0, 0.0)
    }
}

fn osm_highway_tag(road: &Road) -> &'static str {
    if road.length > 200.0 {
        "motorway"
    } else if road.length > 50.0 {
        "primary"
    } else {
        "residential"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Geometry, GeometryType, Junction, Road};

    fn straight_road(id: &str, length: f64) -> Road {
        let geom = Geometry { s: 0.0, x: 0.0, y: 0.0, hdg: 0.0, length, geo_type: GeometryType::Line };
        Road::from_centerline(id, vec![geom])
    }

    #[test]
    fn test_export_empty_project() {
        let project = Project::default();
        let osm = export_to_osm(&project);
        assert!(osm.contains("<?xml"));
        assert!(osm.contains("<osm"));
        assert!(osm.contains("</osm>"));
        assert!(!osm.contains("<node"));
        assert!(!osm.contains("<way"));
    }

    #[test]
    fn test_export_single_road_has_two_nodes() {
        let project = Project { roads: vec![straight_road("r0", 50.0)], ..Default::default() };
        let osm = export_to_osm(&project);
        assert_eq!(osm.matches("<node").count(), 2);
    }

    #[test]
    fn test_export_single_road_has_way() {
        let project = Project { roads: vec![straight_road("r0", 100.0)], ..Default::default() };
        let osm = export_to_osm(&project);
        assert!(osm.contains("<way"));
        assert!(osm.contains("</way>"));
    }

    #[test]
    fn test_export_road_highway_tag() {
        let project = Project { roads: vec![straight_road("r0", 100.0)], ..Default::default() };
        let osm = export_to_osm(&project);
        assert!(osm.contains("highway"));
    }

    #[test]
    fn test_export_junction_becomes_relation() {
        let project = Project {
            roads: vec![],
            junctions: vec![Junction { id: "j0".to_string(), name: String::new(), connections: vec![] }],
            ..Default::default()
        };
        let osm = export_to_osm(&project);
        assert!(osm.contains("<relation"));
        assert!(osm.contains("junction"));
    }

    #[test]
    fn test_export_multiple_roads() {
        let project = Project {
            roads: vec![straight_road("r0", 100.0), straight_road("r1", 100.0)],
            ..Default::default()
        };
        let osm = export_to_osm(&project);
        assert_eq!(osm.matches("<way").count(), 2);
    }

    #[test]
    fn test_export_is_valid_xml_structure() {
        let project = Project { roads: vec![straight_road("r0", 50.0)], ..Default::default() };
        let osm = export_to_osm(&project);
        assert!(osm.starts_with("<?xml"));
        assert!(osm.ends_with("</osm>\n"));
    }
}
