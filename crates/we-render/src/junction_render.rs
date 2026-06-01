//! Junction surface mesh generation.
//!
//! Generates triangle meshes covering junction areas. Uses a per-arm star
//! triangulation: each arm road contributes its left/right boundary edges,
//! and a triangle is formed from the junction centroid to those edges.
//! This produces a star/cross shape with hollow areas between arms,
//! matching the C# reference rendering.

use crate::render_config::RoadRenderConfig;
use crate::vertex::ColorVertex;
use we_core::geometry::eval::{evaluate_geometry, evaluate_lane_width, offset_point};
use we_core::model::Project;

/// Z-offset for junction surfaces (slightly below road surfaces).
const HEIGHT_OFFSET: f32 = -0.24;

/// Generate junction surface triangles (star-shaped, per-arm).
///
/// For each junction, collects the unique arm road boundary edges (left/right
/// at full road width), computes the centroid, then creates one triangle per arm
/// from centroid to the arm's left and right edge points.
///
/// This produces a star/cross shape with hollow cutouts between adjacent arms,
/// matching the C# reference rendering.
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

        // Collect per-arm boundary edges (left_edge, right_edge) for each unique arm road.
        let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
        let mut arm_edges: Vec<([f32; 3], [f32; 3])> = Vec::new();

        for conn in &junction.connections {
            if seen.insert(conn.incoming_road.as_str())
                && let Some(road) = road_map.get(conn.incoming_road.as_str())
                    && let Some((left, right)) = compute_arm_edges(road) {
                        arm_edges.push((left, right));
                    }
        }

        if arm_edges.is_empty() {
            continue;
        }

        // Compute centroid of all edge points
        let total_points = arm_edges.len() * 2;
        let mut cx = 0.0f32;
        let mut cy = 0.0f32;
        let mut cz = 0.0f32;
        for (left, right) in &arm_edges {
            cx += left[0] + right[0];
            cy += left[1] + right[1];
            cz += left[2] + right[2];
        }
        cx /= total_points as f32;
        cy /= total_points as f32;
        cz /= total_points as f32;
        let center = [cx, cy, cz + HEIGHT_OFFSET];

        // Per-arm triangulation: one triangle per arm (centroid → left → right)
        for (left, right) in &arm_edges {
            let l = [left[0], left[1], left[2] + HEIGHT_OFFSET];
            let r = [right[0], right[1], right[2] + HEIGHT_OFFSET];
            all_verts.push(ColorVertex::new(center, rgba));
            all_verts.push(ColorVertex::new(l, rgba));
            all_verts.push(ColorVertex::new(r, rgba));
        }
    }

    all_verts
}

/// Compute left and right boundary edge points of an arm road at the junction face.
///
/// Returns (left_edge, right_edge) at the road's start position (plan_view[0]),
/// using the full road width (sum of all left + right lane widths).
fn compute_arm_edges(road: &we_core::model::Road) -> Option<([f32; 3], [f32; 3])> {
    let geo = road.plan_view.first()?;
    let z = we_core::geometry::eval::evaluate_elevation(&road.elevation_profile, 0.0) as f32;

    if road.lane_sections.is_empty() {
        return None;
    }

    let first_ls = &road.lane_sections[0];

    // Compute full left-side width (sum of all left lane widths at s=0)
    let left_total: f64 = first_ls
        .left
        .iter()
        .map(|lane| evaluate_lane_width(&lane.width, 0.0))
        .sum();

    // Compute full right-side width (sum of all right lane widths at s=0)
    let right_total: f64 = first_ls
        .right
        .iter()
        .map(|lane| evaluate_lane_width(&lane.width, 0.0))
        .sum();

    if left_total + right_total < 0.01 {
        return None;
    }

    let ref_pt = evaluate_geometry(geo, 0.0);

    // Left edge: offset by full left-side width (positive t direction)
    let (lx, ly, _) = offset_point(&ref_pt, left_total, 0.0);
    // Right edge: offset by full right-side width (negative t direction)
    let (rx, ry, _) = offset_point(&ref_pt, -right_total, 0.0);

    Some(([lx as f32, ly as f32, z], [rx as f32, ry as f32, z]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use we_core::model::*;

    fn make_road(id: &str, x: f64, y: f64, hdg: f64) -> Road {
        let mut road = Road::new(id, 50.0);
        road.plan_view = vec![Geometry {
            s: 0.0,
            x,
            y,
            hdg,
            length: 50.0,
            geo_type: GeometryType::Line,
        }];
        // Add a lane section with left+right lanes for proper edge computation
        road.lane_sections = vec![LaneSection {
            s: 0.0,
            single_side: false,
            left: vec![Lane {
                id: 1,
                lane_type: LaneType::Driving,
                level: 0,
                render_hidden: false,
                link: None,
                width: vec![LaneWidth {
                    s_offset: 0.0,
                    a: 3.5,
                    b: 0.0,
                    c: 0.0,
                    d: 0.0,
                }],
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
                width: vec![LaneWidth {
                    s_offset: 0.0,
                    a: 3.5,
                    b: 0.0,
                    c: 0.0,
                    d: 0.0,
                }],
                borders: vec![],
                road_marks: vec![],
            }],
            render_hidden: false,
        }];
        road
    }

    fn make_connector(id: &str, jid: &str, from_road: &Road, to_road: &Road) -> Road {
        let gf = &from_road.plan_view[0];
        let gt = &to_road.plan_view[0];
        let dx = gt.x - gf.x;
        let dy = gt.y - gf.y;
        let length = (dx * dx + dy * dy).sqrt().max(0.5);
        let mut road = Road::new(id, length);
        road.junction_id = Some(jid.to_string());
        road.plan_view = vec![Geometry {
            s: 0.0,
            x: gf.x,
            y: gf.y,
            hdg: dy.atan2(dx),
            length,
            geo_type: GeometryType::Line,
        }];
        road
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
                if i == j {
                    continue;
                }
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
        for c in connectors {
            project.roads.push(c);
        }
        project.junctions.push(Junction {
            id: jid.to_string(),
            name: "4way".to_string(),
            connections,
        });

        let config = RoadRenderConfig::default();
        let verts = generate_junction_meshes(&project, &config);
        // 4 unique arm roads with lane sections → 4 arm edges → 4 triangles → 12 vertices
        assert_eq!(verts.len(), 12);

        // All vertices within reasonable distance of center (0,0)
        let max_dist: f32 = gap as f32 + 5.0; // arm position + lane width
        for v in &verts {
            let (vx, vy) = (v.position[0], v.position[1]);
            let d = (vx * vx + vy * vy).sqrt();
            assert!(d < max_dist, "vertex ({vx}, {vy}) too far from center");
        }
    }
}
