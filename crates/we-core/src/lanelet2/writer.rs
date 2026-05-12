//! Lanelet2 OSM-XML writer.
//!
//! Exports a WorldEditor project as a Lanelet2-compatible OSM-XML file.

use crate::model::Project;

/// Export a project as a Lanelet2 OSM-XML string.
pub fn export_to_lanelet2(project: &Project) -> String {
    let mut out = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<osm version=\"0.6\" generator=\"WorldEditor Next\">\n",
    );

    let mut node_id: i64 = 1;
    let mut way_id: i64 = 10000;
    let mut road_ways: Vec<(String, i64, i64)> = Vec::new();

    for road in &project.roads {
        let (sx, sy) = road.plan_view.first().map(|g| (g.x, g.y)).unwrap_or((0.0, 0.0));
        let (ex, ey) = if let Some(g) = road.plan_view.last() {
            (g.x + road.length * g.hdg.cos(), g.y + road.length * g.hdg.sin())
        } else {
            (0.0, 0.0)
        };

        let start_nid = node_id;
        out.push_str(&format!("  <node id=\"{}\" lat=\"{}\" lon=\"{}\"/>\n", start_nid, sy, sx));
        node_id += 1;

        let end_nid = node_id;
        out.push_str(&format!("  <node id=\"{}\" lat=\"{}\" lon=\"{}\"/>\n", end_nid, ey, ex));
        node_id += 1;

        road_ways.push((road.id.clone(), start_nid, end_nid));
    }

    for road in &project.roads {
        if let Some((_, start_nid, end_nid)) = road_ways.iter().find(|(id, ..)| id == &road.id) {
            out.push_str(&format!("  <way id=\"{}\">\n", way_id));
            out.push_str(&format!("    <nd ref=\"{start_nid}\"/>\n"));
            out.push_str(&format!("    <nd ref=\"{end_nid}\"/>\n"));
            out.push_str("    <tag k=\"type\" v=\"lanelet\"/>\n");
            out.push_str("    <tag k=\"subtype\" v=\"road\"/>\n");
            if !road.name.is_empty() {
                out.push_str(&format!("    <tag k=\"name\" v=\"{}\"/>\n", road.name));
            }
            out.push_str("  </way>\n");
            way_id += 1;
        }
    }

    out.push_str("</osm>\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Geometry, GeometryType, Road};

    fn straight_road(id: &str, length: f64) -> Road {
        let geom = Geometry { s: 0.0, x: 0.0, y: 0.0, hdg: 0.0, length, geo_type: GeometryType::Line };
        Road::from_centerline(id, vec![geom])
    }

    #[test]
    fn test_export_empty_project() {
        let project = Project::default();
        let xml = export_to_lanelet2(&project);
        assert!(xml.contains("<osm"));
        assert!(xml.contains("</osm>"));
        assert!(!xml.contains("<node"));
    }

    #[test]
    fn test_export_road_produces_two_nodes() {
        let project = Project { roads: vec![straight_road("r0", 50.0)], ..Default::default() };
        let xml = export_to_lanelet2(&project);
        assert_eq!(xml.matches("<node").count(), 2);
    }

    #[test]
    fn test_export_road_produces_way_with_lanelet_type() {
        let project = Project { roads: vec![straight_road("r0", 50.0)], ..Default::default() };
        let xml = export_to_lanelet2(&project);
        assert!(xml.contains("<way"));
        assert!(xml.contains("type\" v=\"lanelet\""));
    }

    #[test]
    fn test_export_multiple_roads() {
        let project = Project {
            roads: vec![straight_road("r0", 50.0), straight_road("r1", 100.0)],
            ..Default::default()
        };
        let xml = export_to_lanelet2(&project);
        assert_eq!(xml.matches("<way").count(), 2);
    }

    #[test]
    fn test_export_xml_header() {
        let project = Project::default();
        let xml = export_to_lanelet2(&project);
        assert!(xml.starts_with("<?xml version=\"1.0\""));
    }
}
