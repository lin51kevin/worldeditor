//! Junction surface mesh generation.
//!
//! Generates triangle meshes covering junction areas based on the junction's
//! connections. Uses a fan-triangulation approach from the junction center
//! through connection endpoints.

use crate::render_config::RoadRenderConfig;
use crate::vertex::ColorVertex;
use we_core::model::Project;

/// Z-offset for junction surfaces (road surface sinks slightly below).
const HEIGHT_OFFSET: f32 = -0.24;

/// Generate junction surface triangles.
///
/// For each junction, computes the average center of connection road endpoints
/// and fans out triangles to each endpoint, creating a polygonal coverage.
pub fn generate_junction_meshes(
    project: &Project,
    config: &RoadRenderConfig,
) -> Vec<ColorVertex> {
    let mut all_verts = Vec::new();

    for junction in &project.junctions {
        if junction.connections.is_empty() {
            continue;
        }

        let color = config.color_junction_surface;
        let rgba = [color.x, color.y, color.z, color.w];

        // Collect connection points (road start/end positions)
        let mut points: Vec<[f32; 3]> = Vec::new();
        for conn in &junction.connections {
            // Find the incoming road and get its contact point position
            if let Some(road) = project
                .roads
                .iter()
                .find(|r| r.id == conn.incoming_road)
            {
                let (x, y, z) = road_contact_position(road);
                points.push([x, y, z + HEIGHT_OFFSET]);
            }
            // Also get the connecting road endpoint
            if let Some(road) = project
                .roads
                .iter()
                .find(|r| r.id == conn.connecting_road)
            {
                let (x, y, z) = road_end_position(road);
                points.push([x, y, z + HEIGHT_OFFSET]);
            }
        }

        if points.len() < 3 {
            continue;
        }

        // Compute center as average of all points
        let center: [f32; 3] = {
            let n = points.len() as f32;
            let x = points.iter().map(|p| p[0]).sum::<f32>() / n;
            let y = points.iter().map(|p| p[1]).sum::<f32>() / n;
            let z = points.iter().map(|p| p[2]).sum::<f32>() / n;
            [x, y, z]
        };

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

/// Get the start position of a road (contact point at start).
fn road_contact_position(road: &we_core::model::Road) -> (f32, f32, f32) {
    if let Some(geo) = road.plan_view.first() {
        let z = we_core::geometry::eval::evaluate_elevation(&road.elevation_profile, 0.0) as f32;
        (geo.x as f32, geo.y as f32, z)
    } else {
        (0.0, 0.0, HEIGHT_OFFSET)
    }
}

/// Get the end position of a road.
fn road_end_position(road: &we_core::model::Road) -> (f32, f32, f32) {
    // Use the last geometry's endpoint approximation
    let _total_length = road.length;
    if let Some(geo) = road.plan_view.last() {
        let end_s = geo.s + geo.length;
        let z =
            we_core::geometry::eval::evaluate_elevation(&road.elevation_profile, end_s) as f32;
        // Approximate end position by linear extrapolation from geometry
        let dx = (geo.length as f32) * geo.hdg.cos() as f32;
        let dy = (geo.length as f32) * geo.hdg.sin() as f32;
        (geo.x as f32 + dx, geo.y as f32 + dy, z)
    } else {
        (0.0, 0.0, HEIGHT_OFFSET)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use we_core::model::*;

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
}
