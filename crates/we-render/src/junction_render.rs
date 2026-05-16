//! Junction surface mesh generation.
//!
//! Generates triangle meshes covering junction areas based on the junction's
//! connections. Uses a fan-triangulation approach from the junction center
//! through the arm road boundary points, angularly sorted for a correct polygon.

use crate::render_config::RoadRenderConfig;
use crate::vertex::ColorVertex;
use we_core::model::Project;

/// Z-offset for junction surfaces (road surface sinks slightly below).
const HEIGHT_OFFSET: f32 = -0.24;

/// Generate junction surface triangles.
///
/// For each junction, collects the unique *arm road* start positions (the points
/// that face the junction interior), sorts them angularly around their centroid,
/// then fans out triangles from the centroid to successive boundary points.
///
/// Arm roads are identified by being the `incoming_road` in each connection.
/// Connector roads (those with `junction_id` set) are excluded from boundary
/// collection to avoid mixing internal geometry with the outer polygon.
pub fn generate_junction_meshes(project: &Project, config: &RoadRenderConfig) -> Vec<ColorVertex> {
    let mut all_verts = Vec::new();

    // Build a fast road-id → road map once
    let road_map: std::collections::HashMap<&str, &we_core::model::Road> =
        project.roads.iter().map(|r| (r.id.as_str(), r)).collect();

    for junction in &project.junctions {
        if junction.connections.is_empty() {
            continue;
        }

        let color = config.color_junction_surface;
        let rgba = [color.x, color.y, color.z, color.w];

        // Collect unique arm-road (incoming_road) start positions.
        // Using a HashSet on &str avoids duplicates when multiple connections share the same arm.
        let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
        let mut points: Vec<[f32; 3]> = Vec::new();

        for conn in &junction.connections {
            if seen.insert(conn.incoming_road.as_str()) {
                if let Some(road) = road_map.get(conn.incoming_road.as_str()) {
                    let (x, y, z) = road_contact_position(road);
                    points.push([x, y, z + HEIGHT_OFFSET]);
                }
            }
        }

        if points.len() < 3 {
            continue;
        }

        // Compute centroid
        let n = points.len() as f32;
        let cx = points.iter().map(|p| p[0]).sum::<f32>() / n;
        let cy = points.iter().map(|p| p[1]).sum::<f32>() / n;
        let cz = points.iter().map(|p| p[2]).sum::<f32>() / n;
        let center = [cx, cy, cz];

        // Angular sort so fan triangulation produces a non-self-intersecting polygon
        points.sort_by(|a, b| {
            let angle_a = f32::atan2(a[1] - cy, a[0] - cx);
            let angle_b = f32::atan2(b[1] - cy, b[0] - cx);
            angle_a.partial_cmp(&angle_b).unwrap_or(std::cmp::Ordering::Equal)
        });

        // Fan triangulation from center to each edge
        for i in 0..points.len() {
            let j = (i + 1) % points.len();
            all_verts.push(ColorVertex::new(center, rgba));
            all_verts.push(ColorVertex::new(points[i], rgba));
            all_verts.push(ColorVertex::new(points[j], rgba));
        }
    }

    all_verts
}

/// Get the start position of a road (plan_view[0], the junction-facing edge).
fn road_contact_position(road: &we_core::model::Road) -> (f32, f32, f32) {
    if let Some(geo) = road.plan_view.first() {
        let z = we_core::geometry::eval::evaluate_elevation(&road.elevation_profile, 0.0) as f32;
        (geo.x as f32, geo.y as f32, z)
    } else {
        (0.0, 0.0, HEIGHT_OFFSET)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use we_core::model::*;

    fn make_road(id: &str, x: f64, y: f64, hdg: f64) -> Road {
        Road {
            id: id.to_string(),
            plan_view: vec![Geometry {
                s: 0.0, x, y, hdg,
                length: 50.0,
                geo_type: GeometryType::Line,
            }],
            length: 50.0,
            junction_id: None,
            ..Road::default()
        }
    }

    fn make_connector(id: &str, jid: &str, from_road: &Road, to_road: &Road) -> Road {
        let gf = &from_road.plan_view[0];
        let gt = &to_road.plan_view[0];
        let dx = gt.x - gf.x;
        let dy = gt.y - gf.y;
        let length = (dx * dx + dy * dy).sqrt().max(0.5);
        Road {
            id: id.to_string(),
            plan_view: vec![Geometry {
                s: 0.0, x: gf.x, y: gf.y,
                hdg: dy.atan2(dx),
                length,
                geo_type: GeometryType::Line,
            }],
            length,
            junction_id: Some(jid.to_string()),
            ..Road::default()
        }
    }

    #[test]
    fn test_generate_junction_meshes_empty_network() {
        let network = Project::default();
        let config = RoadRenderConfig::default();
        let verts = generate_junction_meshes(&network, &config);
        assert!(verts.is_empty());
    }

    #[test]
    fn test_generate_junction_meshes_no_connections() {
        let mut network = Project::default();
        network.junctions.push(Junction {
            id: "j1".to_string(),
            name: "J1".to_string(),
            connections: vec![],
        });
        let config = RoadRenderConfig::default();
        let verts = generate_junction_meshes(&network, &config);
        assert!(verts.is_empty());
    }

    /// 4-way cross junction: 4 arms at N/S/E/W, 12 connectors.
    /// Junction polygon should use only the 4 arm start positions.
    /// 4 boundary points → 4 triangles × 3 verts = 12 vertices.
    #[test]
    fn test_generate_junction_meshes_4way_cross() {
        let gap = 8.0_f64;
        let arm_e = make_road("arm_e", gap, 0.0, 0.0);
        let arm_w = make_road("arm_w", -gap, 0.0, std::f64::consts::PI);
        let arm_n = make_road("arm_n", 0.0, gap, std::f64::consts::FRAC_PI_2);
        let arm_s = make_road("arm_s", 0.0, -gap, -std::f64::consts::FRAC_PI_2);

        let arms = [&arm_e, &arm_w, &arm_n, &arm_s];
        let jid = "j1";

        let mut connectors = vec![];
        let mut connections = vec![];
        let mut conn_id = 0;
        for i in 0..4 {
            for j in 0..4 {
                if i == j { continue; }
                let c = make_connector(&format!("c{conn_id}"), jid, arms[i], arms[j]);
                connections.push(JunctionConnection {
                    id: format!("conn{conn_id}"),
                    incoming_road: arms[i].id.clone(),
                    connecting_road: c.id.clone(),
                    contact_point: ContactPoint::Start,
                    lane_links: vec![JunctionLaneLink { from: -1, to: -1 }],
                });
                connectors.push(c);
                conn_id += 1;
            }
        }

        let mut project = Project::default();
        project.roads.push(arm_e);
        project.roads.push(arm_w);
        project.roads.push(arm_n);
        project.roads.push(arm_s);
        for c in connectors { project.roads.push(c); }
        project.junctions.push(Junction {
            id: jid.to_string(),
            name: "4way".to_string(),
            connections,
        });

        let config = RoadRenderConfig::default();
        let verts = generate_junction_meshes(&project, &config);
        // 4 unique arm roads → 4 boundary points → 4 triangles → 12 vertices
        assert_eq!(verts.len(), 12);

        // All vertices within reasonable distance of center (0,0)
        let max_dist: f32 = gap as f32 * 1.5;
        for v in &verts {
            let (vx, vy) = (v.position[0], v.position[1]);
            let d = (vx * vx + vy * vy).sqrt();
            assert!(d < max_dist, "vertex ({vx}, {vy}) too far from center");
        }
    }
}
