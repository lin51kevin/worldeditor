//! Topology repair and junction optimization.

use crate::model::{
    ContactPoint, JunctionConnection, LinkElementType, Project, Road,
};

use super::validate::road_has_lane;

/// Automatically repair topology issues in a project.
///
/// The repair strategy is conservative:
/// - Dangling road links are removed (set to None).
/// - Roads referencing non-existent junctions have their junction_id cleared.
/// - Junction connections referencing non-existent roads are removed.
/// - Degenerate junctions (< 2 connections after pruning) are removed entirely.
/// - Invalid lane links within junction connections are removed.
/// - Duplicate IDs and zero-length roads are NOT auto-repaired (require user decision).
///
/// Returns the repaired project and a list of actions taken.
pub fn repair_topology(project: &Project) -> (Project, Vec<String>) {
    let mut p = project.clone();
    let mut actions: Vec<String> = Vec::new();

    // Pre-collect all IDs so we can borrow mutably later
    let road_ids: std::collections::HashSet<String> =
        p.roads.iter().map(|r| r.id.clone()).collect();
    let junction_ids: std::collections::HashSet<String> =
        p.junctions.iter().map(|j| j.id.clone()).collect();

    // 1. Remove dangling road links
    for road in &mut p.roads {
        if let Some(ref mut link) = road.link {
            if let Some(ref pred) = link.predecessor {
                let exists = match pred.element_type {
                    LinkElementType::Road => road_ids.contains(&pred.element_id),
                    LinkElementType::Junction => junction_ids.contains(&pred.element_id),
                };
                if !exists {
                    actions.push(format!(
                        "Removed dangling predecessor '{}' from road '{}'",
                        pred.element_id, road.id
                    ));
                    link.predecessor = None;
                }
            }
            if let Some(ref succ) = link.successor {
                let exists = match succ.element_type {
                    LinkElementType::Road => road_ids.contains(&succ.element_id),
                    LinkElementType::Junction => junction_ids.contains(&succ.element_id),
                };
                if !exists {
                    actions.push(format!(
                        "Removed dangling successor '{}' from road '{}'",
                        succ.element_id, road.id
                    ));
                    link.successor = None;
                }
            }
            // If both are now None, drop the link entirely
            if link.predecessor.is_none() && link.successor.is_none() {
                road.link = None;
            }
        }
    }

    // 2. Clear orphan junction_id references on roads
    for road in &mut p.roads {
        if let Some(ref jid) = road.junction_id {
            if jid != "-1" && !junction_ids.contains(jid) {
                actions.push(format!(
                    "Cleared orphan junction_id '{}' on road '{}'",
                    jid, road.id
                ));
                road.junction_id = None;
            }
        }
    }

    // 3. Remove junction connections referencing non-existent roads
    for junction in &mut p.junctions {
        let before = junction.connections.len();
        junction.connections.retain(|conn| {
            road_ids.contains(&conn.connecting_road)
                && road_ids.contains(&conn.incoming_road)
        });
        let removed = before - junction.connections.len();
        if removed > 0 {
            actions.push(format!(
                "Removed {} dangling connection(s) from junction '{}'",
                removed, junction.id
            ));
        }
    }

    // 4. Remove invalid lane links within remaining connections
    for junction in &mut p.junctions {
        for conn in &mut junction.connections {
            let incoming_road = p.roads.iter().find(|r| r.id == conn.incoming_road);
            let connecting_road = p.roads.iter().find(|r| r.id == conn.connecting_road);

            let before = conn.lane_links.len();
            conn.lane_links.retain(|ll| {
                let from_ok = incoming_road
                    .map(|r| road_has_lane(r, ll.from))
                    .unwrap_or(false);
                let to_ok = connecting_road
                    .map(|r| road_has_lane(r, ll.to))
                    .unwrap_or(false);
                from_ok && to_ok
            });
            let removed = before - conn.lane_links.len();
            if removed > 0 {
                actions.push(format!(
                    "Removed {} invalid lane link(s) from junction '{}' connection '{}'",
                    removed, junction.id, conn.id
                ));
            }
        }
    }

    // 5. Remove degenerate junctions (< 2 connections after cleanup)
    let before_junctions = p.junctions.len();
    p.junctions.retain(|j| j.connections.len() >= 2);
    let removed_junctions = before_junctions - p.junctions.len();
    if removed_junctions > 0 {
        actions.push(format!(
            "Removed {} degenerate junction(s) with fewer than 2 connections",
            removed_junctions
        ));
    }

    (p, actions)
}

// ── Junction optimization ─────────────────────────────────────────────────────

/// Optimize a junction by rebuilding its connections from the actual road
/// topology.
///
/// This scans all roads whose predecessor or successor links reference this
/// junction and rebuilds the connection list with correct lane links.
pub fn optimize_junction(project: &Project, junction_id: &str) -> Option<Vec<JunctionConnection>> {
    let _junction = project.junctions.iter().find(|j| j.id == junction_id)?;

    // Find all roads that link to this junction
    let incoming_roads: Vec<&Road> = project
        .roads
        .iter()
        .filter(|r| {
            // Not a connector road for this junction
            r.junction_id.as_deref() != Some(junction_id)
                && r.link.as_ref().is_some_and(|l| {
                    l.predecessor
                        .as_ref()
                        .is_some_and(|p| p.element_id == junction_id)
                        || l.successor
                            .as_ref()
                            .is_some_and(|s| s.element_id == junction_id)
                })
        })
        .collect();

    // Find connector roads (roads that belong to this junction)
    let connector_roads: Vec<&Road> = project
        .roads
        .iter()
        .filter(|r| r.junction_id.as_deref() == Some(junction_id))
        .collect();

    let mut connections = Vec::new();
    let mut conn_id = 0u32;

    for connector in &connector_roads {
        // Determine the incoming road for this connector
        let incoming = connector
            .link
            .as_ref()
            .and_then(|l| l.predecessor.as_ref())
            .and_then(|pred| {
                if pred.element_type == LinkElementType::Road {
                    incoming_roads.iter().find(|r| r.id == pred.element_id)
                } else {
                    None
                }
            });

        let incoming_road = match incoming {
            Some(road) => road,
            None => continue,
        };

        // Determine contact point
        let contact_point = connector
            .link
            .as_ref()
            .and_then(|l| l.predecessor.as_ref())
            .and_then(|pred| pred.contact_point)
            .unwrap_or(ContactPoint::Start);

        // Build lane links from matching lane IDs
        let lane_links = build_lane_links(incoming_road, connector, contact_point);

        connections.push(JunctionConnection {
            id: conn_id.to_string(),
            incoming_road: incoming_road.id.clone(),
            connecting_road: connector.id.clone(),
            contact_point,
            lane_links,
        });
        conn_id += 1;
    }

    // If no connectors found, try to build connections from approach roads directly
    if connections.is_empty() && incoming_roads.len() >= 2 {
        for (i, road_a) in incoming_roads.iter().enumerate() {
            for road_b in incoming_roads.iter().skip(i + 1) {
                let contact_a = road_junction_contact(road_a, junction_id);
                let contact_b = road_junction_contact(road_b, junction_id);

                connections.push(JunctionConnection {
                    id: conn_id.to_string(),
                    incoming_road: road_a.id.clone(),
                    connecting_road: road_b.id.clone(),
                    contact_point: contact_a.unwrap_or(ContactPoint::End),
                    lane_links: Vec::new(),
                });
                conn_id += 1;

                connections.push(JunctionConnection {
                    id: conn_id.to_string(),
                    incoming_road: road_b.id.clone(),
                    connecting_road: road_a.id.clone(),
                    contact_point: contact_b.unwrap_or(ContactPoint::End),
                    lane_links: Vec::new(),
                });
                conn_id += 1;
            }
        }
    }

    Some(connections)
}

/// Build lane links between an incoming road and a connector road.
fn build_lane_links(
    incoming: &Road,
    connector: &Road,
    contact_point: ContactPoint,
) -> Vec<crate::model::JunctionLaneLink> {
    let incoming_section = match contact_point {
        ContactPoint::Start => incoming.lane_sections.first(),
        ContactPoint::End => incoming.lane_sections.last(),
    };
    let connector_section = connector.lane_sections.first();

    let (Some(inc_sec), Some(conn_sec)) = (incoming_section, connector_section) else {
        return Vec::new();
    };

    let mut links = Vec::new();

    // Match driving lanes by position
    let inc_right: Vec<i32> = inc_sec
        .right
        .iter()
        .filter(|l| l.lane_type.is_driving())
        .map(|l| l.id)
        .collect();
    let conn_right: Vec<i32> = conn_sec
        .right
        .iter()
        .filter(|l| l.lane_type.is_driving())
        .map(|l| l.id)
        .collect();

    for (from, to) in inc_right.iter().zip(conn_right.iter()) {
        links.push(crate::model::JunctionLaneLink {
            from: *from,
            to: *to,
        });
    }

    let inc_left: Vec<i32> = inc_sec
        .left
        .iter()
        .filter(|l| l.lane_type.is_driving())
        .map(|l| l.id)
        .collect();
    let conn_left: Vec<i32> = conn_sec
        .left
        .iter()
        .filter(|l| l.lane_type.is_driving())
        .map(|l| l.id)
        .collect();

    for (from, to) in inc_left.iter().zip(conn_left.iter()) {
        links.push(crate::model::JunctionLaneLink {
            from: *from,
            to: *to,
        });
    }

    links
}

fn road_junction_contact(road: &Road, junction_id: &str) -> Option<ContactPoint> {
    road.link.as_ref().and_then(|l| {
        if l.predecessor
            .as_ref()
            .is_some_and(|p| p.element_id == junction_id)
        {
            Some(ContactPoint::Start)
        } else if l.successor
            .as_ref()
            .is_some_and(|s| s.element_id == junction_id)
        {
            Some(ContactPoint::End)
        } else {
            None
        }
    })
}
