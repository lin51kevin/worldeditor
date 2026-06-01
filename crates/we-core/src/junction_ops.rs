//! Auto-build junction connector roads.
//!
//! Scans a project for roads that declare a junction as their predecessor or
//! successor link, computes hermite-spline connector roads between every pair
//! of entrance/exit arms, and returns an updated [`Project`] with the new
//! connector roads and [`JunctionConnection`] entries injected.

use serde::{Deserialize, Serialize};

use crate::geometry::eval::evaluate_road_at_s;
use crate::model::{
    ContactPoint, Geometry, GeometryType, JunctionConnection, JunctionLaneLink, Lane, LaneType,
    LinkElement, LinkElementType, ParamPoly3Range, Project, Road, RoadLink,
};

// ── Public types ──────────────────────────────────────────────────────────────

/// One arm of a junction: a road endpoint that touches the junction boundary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JunctionArm {
    /// ID of the road this arm belongs to.
    pub road_id: String,
    /// Which end of the road touches the junction.
    pub contact_point: ContactPoint,
    /// World-space X of the arm endpoint.
    pub x: f64,
    /// World-space Y of the arm endpoint.
    pub y: f64,
    /// Heading of the road at the arm endpoint.
    /// For `End` arms this points **away** from the junction (road-forward direction).
    /// For `Start` arms this also points **away** (road-forward direction at s=0).
    pub hdg: f64,
    /// Number of right-side (negative-id) driving lanes on this arm.
    pub right_lane_count: usize,
}

// ── Internal error ────────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum JunctionOpsError {
    JunctionNotFound(String),
}

impl std::fmt::Display for JunctionOpsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::JunctionNotFound(id) => write!(f, "Junction '{id}' not found"),
        }
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Return the list of road arms attached to `junction_id`.
///
/// An arm is any road whose `link.predecessor` or `link.successor` references
/// `junction_id` with element type `Junction`.
pub fn detect_junction_arms(project: &Project, junction_id: &str) -> Vec<JunctionArm> {
    let mut arms = Vec::new();

    for road in &project.roads {
        let Some(link) = &road.link else { continue };

        if is_junction_link(&link.successor, junction_id) {
            // Road's END touches the junction.
            if let Some(pt) = evaluate_road_at_s(road, road.length) {
                arms.push(JunctionArm {
                    road_id: road.id.clone(),
                    contact_point: ContactPoint::End,
                    x: pt.x,
                    y: pt.y,
                    hdg: pt.hdg,
                    right_lane_count: right_lane_count(road),
                });
            }
        }

        if is_junction_link(&link.predecessor, junction_id) {
            // Road's START touches the junction.
            if let Some(pt) = evaluate_road_at_s(road, 0.0) {
                arms.push(JunctionArm {
                    road_id: road.id.clone(),
                    contact_point: ContactPoint::Start,
                    x: pt.x,
                    y: pt.y,
                    hdg: pt.hdg,
                    right_lane_count: right_lane_count(road),
                });
            }
        }
    }

    arms
}

/// Auto-build connector roads for every unconnected (from_arm, to_arm) pair in
/// `junction_id` and return an updated project.
///
/// * "from arm" = arm with `contact_point == End`  (road ends at junction)
/// * "to arm"   = arm with `contact_point == Start` (road begins at junction)
///
/// Pairs that already have a connecting road registered in the junction's
/// `connections` list are skipped.  Connector roads get sequential numeric IDs.
pub fn build_junction_connectors(
    project: &Project,
    junction_id: &str,
) -> Result<Project, JunctionOpsError> {
    let junction_idx = project
        .junctions
        .iter()
        .position(|j| j.id == junction_id)
        .ok_or_else(|| JunctionOpsError::JunctionNotFound(junction_id.to_owned()))?;

    let arms = detect_junction_arms(project, junction_id);

    // Sort arms by angle around the junction center to determine adjacency.
    let arm_order = sorted_arm_indices_by_angle(&arms);

    // Collect already-covered (incoming, connecting) pairs to skip duplicates.
    let junction = &project.junctions[junction_idx];
    let covered: std::collections::HashSet<(String, String)> = junction
        .connections
        .iter()
        .map(|c| (c.incoming_road.clone(), c.connecting_road.clone()))
        .collect();

    // Find the max numeric ID already used by roads to generate sequential IDs.
    let mut next_id = next_numeric_id(project);

    let mut new_project = project.clone();
    let mut new_roads: Vec<Road> = Vec::new();
    let mut new_connections: Vec<JunctionConnection> = Vec::new();

    // Track which (from, to) road pairs have been connected to skip duplicates.
    let mut connected_pairs: std::collections::HashSet<(String, String)> = covered
        .iter()
        .map(|(incoming, _)| (incoming.clone(), String::new()))
        .collect();

    // Generate connectors for ALL arm pairs (bidirectional).
    // Each arm can be both a source and a destination.
    for from_arm in &arms {
        for to_arm in &arms {
            // Don't connect a road to itself.
            if from_arm.road_id == to_arm.road_id {
                continue;
            }

            let pair_key = (from_arm.road_id.clone(), to_arm.road_id.clone());

            // Skip if a connector between this pair already exists in covered set.
            let already_covered = covered.iter().any(|(incoming, connecting)| {
                incoming == &from_arm.road_id
                    && new_project
                        .roads
                        .iter()
                        .chain(new_roads.iter())
                        .any(|r| {
                            r.id == *connecting
                                && r.link
                                    .as_ref()
                                    .and_then(|l| l.successor.as_ref())
                                    .map(|s| s.element_id == to_arm.road_id)
                                    .unwrap_or(false)
                        })
            });
            if already_covered || connected_pairs.contains(&pair_key) {
                continue;
            }

            let connector_id = next_id.to_string();
            next_id += 1;
            connected_pairs.insert(pair_key);

            // Build effective from/to arms with junction-facing headings.
            // - "End" arm: road heading points away from junction → flip for entry into junction
            // - "Start" arm: road heading points away from junction → flip for entry into junction
            // The connector road goes FROM the from_arm INTO the junction, and OUT to the to_arm.
            let effective_from = JunctionArm {
                road_id: from_arm.road_id.clone(),
                contact_point: from_arm.contact_point,
                x: from_arm.x,
                y: from_arm.y,
                hdg: if from_arm.contact_point == ContactPoint::End {
                    from_arm.hdg // End arm: heading already in drive-forward direction
                } else {
                    from_arm.hdg + std::f64::consts::PI // Start arm: reverse heading
                },
                right_lane_count: from_arm.right_lane_count,
            };

            let effective_to = JunctionArm {
                road_id: to_arm.road_id.clone(),
                contact_point: to_arm.contact_point,
                x: to_arm.x,
                y: to_arm.y,
                hdg: if to_arm.contact_point == ContactPoint::Start {
                    to_arm.hdg // Start arm: heading already in drive-forward direction
                } else {
                    to_arm.hdg + std::f64::consts::PI // End arm: reverse heading for arrival
                },
                right_lane_count: to_arm.right_lane_count,
            };

            // Generate the connector road.
            let lane_count = effective_from
                .right_lane_count
                .min(effective_to.right_lane_count)
                .max(1);

            // Determine if this pair is angularly adjacent (cwDist == 1).
            // Adjacent CW pairs include the outermost shoulder; others get driving-only.
            let is_adjacent = is_cw_adjacent(&arms, &arm_order, &from_arm.road_id, &to_arm.road_id);

            // Get template lanes from the source (from) road.
            let from_road = new_project.roads.iter().find(|r| r.id == from_arm.road_id);
            let template_lanes: Vec<Lane> = from_road
                .and_then(|r| r.lane_sections.first())
                .map(|ls| {
                    let mut lanes: Vec<Lane> = ls
                        .right
                        .iter()
                        .filter(|l| matches!(l.lane_type, LaneType::Driving))
                        .take(lane_count)
                        .cloned()
                        .collect();
                    // Append outermost shoulder only for adjacent CW pairs.
                    if is_adjacent
                        && let Some(outermost) = ls.right.last()
                            && matches!(outermost.lane_type, LaneType::Shoulder) {
                                lanes.push(outermost.clone());
                            }
                    lanes
                })
                .unwrap_or_default();

            // Build a concise name like "1 → 2" using road names or IDs.
            let from_name = from_road
                .map(|r| if r.name.is_empty() { r.id.clone() } else { r.name.clone() })
                .unwrap_or_else(|| from_arm.road_id.clone());
            let to_name = new_project
                .roads
                .iter()
                .find(|r| r.id == to_arm.road_id)
                .map(|r| if r.name.is_empty() { r.id.clone() } else { r.name.clone() })
                .unwrap_or_else(|| to_arm.road_id.clone());

            let connector =
                make_connector_road(&effective_from, &effective_to, &connector_id, junction_id, &template_lanes, &from_name, &to_name);

            // Build JunctionConnection.
            let lane_links: Vec<JunctionLaneLink> = (1..=lane_count as i32)
                .map(|i| JunctionLaneLink { from: -i, to: -i })
                .collect();

            let contact_point = if from_arm.contact_point == ContactPoint::End {
                ContactPoint::Start
            } else {
                ContactPoint::End
            };

            let connection = JunctionConnection {
                id: format!(
                    "conn_{}",
                    new_connections.len() + junction.connections.len()
                ),
                incoming_road: from_arm.road_id.clone(),
                connecting_road: connector_id.clone(),
                contact_point,
                lane_links,
            };

            new_roads.push(connector);
            new_connections.push(connection);
        }
    }

    // Mutate the project immutably.
    new_project.roads.extend(new_roads);
    new_project.junctions[junction_idx]
        .connections
        .extend(new_connections);

    Ok(new_project)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Compute the next sequential numeric ID by finding the max numeric road/junction ID in the project.
fn next_numeric_id(project: &Project) -> u64 {
    let max_road = project
        .roads
        .iter()
        .filter_map(|r| r.id.parse::<u64>().ok())
        .max()
        .unwrap_or(0);
    let max_junction = project
        .junctions
        .iter()
        .filter_map(|j| j.id.parse::<u64>().ok())
        .max()
        .unwrap_or(0);
    max_road.max(max_junction) + 1
}

/// Check whether a link element references the given junction.
fn is_junction_link(link: &Option<LinkElement>, junction_id: &str) -> bool {
    link.as_ref()
        .map(|l| l.element_type == LinkElementType::Junction && l.element_id == junction_id)
        .unwrap_or(false)
}

/// Sort arm indices by angle around the junction center (centroid of arm positions).
fn sorted_arm_indices_by_angle(arms: &[JunctionArm]) -> Vec<usize> {
    if arms.is_empty() {
        return Vec::new();
    }
    let cx = arms.iter().map(|a| a.x).sum::<f64>() / arms.len() as f64;
    let cy = arms.iter().map(|a| a.y).sum::<f64>() / arms.len() as f64;
    let mut indices: Vec<usize> = (0..arms.len()).collect();
    indices.sort_by(|&a, &b| {
        let angle_a = (arms[a].y - cy).atan2(arms[a].x - cx);
        let angle_b = (arms[b].y - cy).atan2(arms[b].x - cx);
        angle_a.partial_cmp(&angle_b).unwrap_or(std::cmp::Ordering::Equal)
    });
    indices
}

/// Check if (from_road, to_road) are angularly adjacent in clockwise direction (cwDist == 1).
fn is_cw_adjacent(
    arms: &[JunctionArm],
    arm_order: &[usize],
    from_road_id: &str,
    to_road_id: &str,
) -> bool {
    let n = arm_order.len();
    if n < 2 {
        return false;
    }
    let from_pos = arm_order.iter().position(|&idx| arms[idx].road_id == from_road_id);
    let to_pos = arm_order.iter().position(|&idx| arms[idx].road_id == to_road_id);
    match (from_pos, to_pos) {
        (Some(f), Some(t)) => (t + n - f) % n == 1,
        _ => false,
    }
}

/// Count driving lanes on the right side (negative IDs) of the first lane section.
fn right_lane_count(road: &Road) -> usize {
    road.lane_sections
        .first()
        .map(|ls| {
            ls.right
                .iter()
                .filter(|l| matches!(l.lane_type, LaneType::Driving))
                .count()
        })
        .unwrap_or(1)
        .max(1)
}

/// Generate a cubic-bezier connector road between two junction arms.
///
/// Uses hermite interpolation (same algorithm as `spline_to_geometries`) so the
/// connector is tangentially continuous with both endpoint roads.
/// `template_lanes` provides the lane types/widths to use (from the source road).
fn make_connector_road(
    from: &JunctionArm,
    to: &JunctionArm,
    road_id: &str,
    junction_id: &str,
    template_lanes: &[Lane],
    from_name: &str,
    to_name: &str,
) -> Road {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    let chord = (dx * dx + dy * dy).sqrt().max(1e-3);

    // Tangent scale — one third of chord length is the standard Bezier heuristic.
    let scale = chord / 3.0;

    let (a_u, b_u, c_u, d_u, a_v, b_v, c_v, d_v) =
        hermite_param_poly3(from.x, from.y, from.hdg, to.x, to.y, to.hdg, scale, chord);

    // Estimate arc length by sampling the curve at 32 points.
    let arc_length = sample_arc_length(a_u, b_u, c_u, d_u, a_v, b_v, c_v, d_v, 32);

    let geo = Geometry {
        s: 0.0,
        x: from.x,
        y: from.y,
        hdg: from.hdg,
        length: arc_length.max(0.1),
        geo_type: GeometryType::ParamPoly3 {
            a_u,
            b_u,
            c_u,
            d_u,
            a_v,
            b_v,
            c_v,
            d_v,
            p_range: ParamPoly3Range::Normalized,
        },
    };

    let lane_width = 3.5_f64;
    let mut road = Road::from_centerline_with_width(road_id, vec![geo], lane_width);

    // Replace the default single driving lane with template lanes (preserving types).
    if !template_lanes.is_empty()
        && let Some(ls) = road.lane_sections.first_mut() {
            ls.right = template_lanes
                .iter()
                .enumerate()
                .map(|(i, tpl)| {
                    let mut lane = tpl.clone();
                    lane.id = -(i as i32 + 1);
                    lane.link = None;
                    lane
                })
                .collect();
        }

    // Mark as belonging to the junction and set concise name.
    road.junction_id = Some(junction_id.to_owned());
    road.name = format!("Road({from_name}\u{2192}{to_name})");

    // Wire up links so the OpenDRIVE is valid.
    road.link = Some(RoadLink {
        predecessor: Some(LinkElement {
            element_type: LinkElementType::Road,
            element_id: from.road_id.clone(),
            contact_point: Some(from.contact_point),
        }),
        successor: Some(LinkElement {
            element_type: LinkElementType::Road,
            element_id: to.road_id.clone(),
            contact_point: Some(to.contact_point),
        }),
    });

    road
}

/// Compute hermite cubic ParamPoly3 coefficients in the local frame of `from`.
///
/// Returns `(a_u, b_u, c_u, d_u, a_v, b_v, c_v, d_v)` for normalised p ∈ [0,1].
#[allow(clippy::too_many_arguments)]
fn hermite_param_poly3(
    x0: f64,
    y0: f64,
    hdg0: f64,
    x1: f64,
    y1: f64,
    hdg1: f64,
    scale: f64,
    chord: f64,
) -> (f64, f64, f64, f64, f64, f64, f64, f64) {
    let cos_h = hdg0.cos();
    let sin_h = hdg0.sin();

    // Transform endpoint to local frame (origin = from, X-axis = hdg0).
    let dx = x1 - x0;
    let dy = y1 - y0;
    let end_u = dx * cos_h + dy * sin_h;
    let end_v = -dx * sin_h + dy * cos_h;

    // Scale tangents by chord so the Hermite basis operates at chord-length scale.
    let t0_u = cos_h * cos_h * scale + sin_h * sin_h * scale; // = scale (in local frame: t0 is along X)
    let t0_v = 0.0_f64; // start tangent has no lateral component in local frame

    // Incoming tangent at endpoint (transformed to local frame, scaled).
    let t1_u = (hdg1.cos() * cos_h + hdg1.sin() * sin_h) * chord;
    let t1_v = (-hdg1.cos() * sin_h + hdg1.sin() * cos_h) * chord;

    // Hermite basis coefficients (normalised, p ∈ [0,1]):
    let a_u = 0.0;
    let b_u = t0_u;
    let c_u = 3.0 * end_u - 2.0 * t0_u - t1_u;
    let d_u = -2.0 * end_u + t0_u + t1_u;

    let a_v = 0.0;
    let b_v = t0_v;
    let c_v = 3.0 * end_v - 2.0 * t0_v - t1_v;
    let d_v = -2.0 * end_v + t0_v + t1_v;

    (a_u, b_u, c_u, d_u, a_v, b_v, c_v, d_v)
}

/// Approximate the arc length of a normalised ParamPoly3 curve by sampling.
#[allow(clippy::too_many_arguments)]
fn sample_arc_length(
    a_u: f64,
    b_u: f64,
    c_u: f64,
    d_u: f64,
    a_v: f64,
    b_v: f64,
    c_v: f64,
    d_v: f64,
    n: usize,
) -> f64 {
    let mut length = 0.0;
    let mut prev_u = a_u;
    let mut prev_v = a_v;
    for i in 1..=n {
        let t = i as f64 / n as f64;
        let t2 = t * t;
        let t3 = t2 * t;
        let u = a_u + b_u * t + c_u * t2 + d_u * t3;
        let v = a_v + b_v * t + c_v * t2 + d_v * t3;
        let du = u - prev_u;
        let dv = v - prev_v;
        length += (du * du + dv * dv).sqrt();
        prev_u = u;
        prev_v = v;
    }
    length
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        ContactPoint, Geometry, GeometryType, Junction, LinkElement, LinkElementType, Project,
        Road, RoadLink,
    };

    fn make_straight_road(id: &str, x: f64, y: f64, length: f64, hdg: f64) -> Road {
        let road = Road::from_centerline(
            id,
            vec![Geometry {
                s: 0.0,
                x,
                y,
                hdg,
                length,
                geo_type: GeometryType::Line,
            }],
        );
        road
    }

    fn project_two_arm_junction() -> Project {
        let junction_id = "j1";

        let mut road_a = make_straight_road("road-a", 0.0, 0.0, 20.0, 0.0);
        road_a.link = Some(RoadLink {
            predecessor: None,
            successor: Some(LinkElement {
                element_type: LinkElementType::Junction,
                element_id: junction_id.into(),
                contact_point: None,
            }),
        });

        let mut road_b = make_straight_road("road-b", 20.0, 3.0, 20.0, 0.0);
        road_b.link = Some(RoadLink {
            predecessor: Some(LinkElement {
                element_type: LinkElementType::Junction,
                element_id: junction_id.into(),
                contact_point: None,
            }),
            successor: None,
        });

        let junction = Junction {
            id: junction_id.into(),
            name: "J1".into(),
            connections: vec![],
        };

        Project {
            roads: vec![road_a, road_b],
            junctions: vec![junction],
            ..Default::default()
        }
    }

    #[test]
    fn test_detect_junction_arms_finds_both_sides() {
        let project = project_two_arm_junction();
        let arms = detect_junction_arms(&project, "j1");
        assert_eq!(arms.len(), 2);
        let end_arms: Vec<_> = arms
            .iter()
            .filter(|a| a.contact_point == ContactPoint::End)
            .collect();
        let start_arms: Vec<_> = arms
            .iter()
            .filter(|a| a.contact_point == ContactPoint::Start)
            .collect();
        assert_eq!(end_arms.len(), 1, "one End arm");
        assert_eq!(start_arms.len(), 1, "one Start arm");
    }

    #[test]
    fn test_build_junction_connectors_adds_road_and_connection() {
        let project = project_two_arm_junction();
        let result = build_junction_connectors(&project, "j1").unwrap();
        // Bidirectional: generates connectors for both directions (a→b and b→a)
        assert_eq!(result.roads.len(), 4, "two connector roads added");
        let junction = result.junctions.iter().find(|j| j.id == "j1").unwrap();
        assert_eq!(junction.connections.len(), 2, "two connections registered");
        let conn_ab = junction.connections.iter().find(|c| c.incoming_road == "road-a");
        let conn_ba = junction.connections.iter().find(|c| c.incoming_road == "road-b");
        assert!(conn_ab.is_some(), "connection from road-a exists");
        assert!(conn_ba.is_some(), "connection from road-b exists");
    }

    #[test]
    fn test_build_junction_connectors_idempotent() {
        let project = project_two_arm_junction();
        let once = build_junction_connectors(&project, "j1").unwrap();
        let twice = build_junction_connectors(&once, "j1").unwrap();
        assert_eq!(
            once.roads.len(),
            twice.roads.len(),
            "calling twice should not duplicate connectors"
        );
    }

    #[test]
    fn test_build_junction_connectors_junction_not_found() {
        let project = project_two_arm_junction();
        let err = build_junction_connectors(&project, "no-such-junction").unwrap_err();
        assert!(err.to_string().contains("not found"));
    }
}
