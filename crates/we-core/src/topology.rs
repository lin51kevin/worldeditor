//! Road network topology validation and repair.
//!
//! Analyses the connectivity graph of a road network to find dangling links,
//! orphan roads, inconsistent junction references, and other structural issues.
//! Also provides repair operations that produce a corrected [`Project`].

use crate::model::{
    ContactPoint, Junction, JunctionConnection, LinkElement, LinkElementType, Project, Road,
};
use serde::{Deserialize, Serialize};

// ── Validation types ──────────────────────────────────────────────────────────

/// Severity of a topology issue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IssueSeverity {
    /// Data is wrong and will cause runtime errors or incorrect rendering.
    Error,
    /// Data is structurally valid but likely unintended.
    Warning,
}

/// Category of a topology issue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IssueKind {
    /// A road's predecessor/successor references a non-existent road or junction.
    DanglingLink,
    /// A road claims to belong to a junction that does not exist.
    OrphanJunctionRef,
    /// A junction references a road that does not exist.
    JunctionDanglingRoad,
    /// Two roads link to each other but their contact points are inconsistent.
    InconsistentContactPoints,
    /// A road has no predecessor and no successor (isolated).
    IsolatedRoad,
    /// A junction has fewer than 2 connections (degenerate).
    DegenerateJunction,
    /// Duplicate road ID.
    DuplicateRoadId,
    /// Duplicate junction ID.
    DuplicateJunctionId,
    /// Road length is zero or negative.
    InvalidRoadLength,
    /// Junction lane link references a lane that doesn't exist.
    InvalidLaneLink,
}

/// A single topology issue found during validation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologyIssue {
    pub severity: IssueSeverity,
    pub kind: IssueKind,
    /// Human-readable description.
    pub message: String,
    /// The road or junction ID this issue relates to.
    pub element_id: String,
}

/// Result of a full topology validation pass.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TopologyReport {
    pub issues: Vec<TopologyIssue>,
}

impl TopologyReport {
    pub fn errors(&self) -> impl Iterator<Item = &TopologyIssue> {
        self.issues
            .iter()
            .filter(|i| i.severity == IssueSeverity::Error)
    }

    pub fn warnings(&self) -> impl Iterator<Item = &TopologyIssue> {
        self.issues
            .iter()
            .filter(|i| i.severity == IssueSeverity::Warning)
    }

    pub fn error_count(&self) -> usize {
        self.errors().count()
    }

    pub fn warning_count(&self) -> usize {
        self.warnings().count()
    }

    pub fn is_clean(&self) -> bool {
        self.issues.is_empty()
    }
}

// ── Validation ────────────────────────────────────────────────────────────────

/// Run a full topology validation on the project.
///
/// Checks for dangling links, orphan junctions, isolated roads, degenerate
/// junctions, duplicate IDs, and invalid lengths.
pub fn validate_topology(project: &Project) -> TopologyReport {
    let mut report = TopologyReport::default();

    check_duplicate_ids(project, &mut report);
    check_road_links(project, &mut report);
    check_junction_refs(project, &mut report);
    check_isolated_roads(project, &mut report);
    check_degenerate_junctions(project, &mut report);
    check_road_lengths(project, &mut report);
    check_junction_lane_links(project, &mut report);

    report
}

fn check_duplicate_ids(project: &Project, report: &mut TopologyReport) {
    let mut seen_roads = std::collections::HashSet::new();
    for road in &project.roads {
        if !seen_roads.insert(&road.id) {
            report.issues.push(TopologyIssue {
                severity: IssueSeverity::Error,
                kind: IssueKind::DuplicateRoadId,
                message: format!("Duplicate road ID '{}'", road.id),
                element_id: road.id.clone(),
            });
        }
    }

    let mut seen_junctions = std::collections::HashSet::new();
    for junction in &project.junctions {
        if !seen_junctions.insert(&junction.id) {
            report.issues.push(TopologyIssue {
                severity: IssueSeverity::Error,
                kind: IssueKind::DuplicateJunctionId,
                message: format!("Duplicate junction ID '{}'", junction.id),
                element_id: junction.id.clone(),
            });
        }
    }
}

fn check_road_links(project: &Project, report: &mut TopologyReport) {
    for road in &project.roads {
        if let Some(ref link) = road.link {
            if let Some(ref pred) = link.predecessor {
                check_link_target(project, &road.id, pred, "predecessor", report);
            }
            if let Some(ref succ) = link.successor {
                check_link_target(project, &road.id, succ, "successor", report);
            }
        }
    }
}

fn check_link_target(
    project: &Project,
    road_id: &str,
    link: &LinkElement,
    direction: &str,
    report: &mut TopologyReport,
) {
    match link.element_type {
        LinkElementType::Road => {
            if !project.roads.iter().any(|r| r.id == link.element_id) {
                report.issues.push(TopologyIssue {
                    severity: IssueSeverity::Error,
                    kind: IssueKind::DanglingLink,
                    message: format!(
                        "Road '{}' {} references non-existent road '{}'",
                        road_id, direction, link.element_id
                    ),
                    element_id: road_id.to_string(),
                });
            }
        }
        LinkElementType::Junction => {
            if !project.junctions.iter().any(|j| j.id == link.element_id) {
                report.issues.push(TopologyIssue {
                    severity: IssueSeverity::Error,
                    kind: IssueKind::DanglingLink,
                    message: format!(
                        "Road '{}' {} references non-existent junction '{}'",
                        road_id, direction, link.element_id
                    ),
                    element_id: road_id.to_string(),
                });
            }
        }
    }
}

fn check_junction_refs(project: &Project, report: &mut TopologyReport) {
    // Check road.junction_id references
    for road in &project.roads {
        if let Some(ref jid) = road.junction_id {
            if jid != "-1" && !project.junctions.iter().any(|j| j.id == *jid) {
                report.issues.push(TopologyIssue {
                    severity: IssueSeverity::Error,
                    kind: IssueKind::OrphanJunctionRef,
                    message: format!(
                        "Road '{}' references non-existent junction '{}'",
                        road.id, jid
                    ),
                    element_id: road.id.clone(),
                });
            }
        }
    }

    // Check junction connection road references
    for junction in &project.junctions {
        for conn in &junction.connections {
            if !project.roads.iter().any(|r| r.id == conn.connecting_road) {
                report.issues.push(TopologyIssue {
                    severity: IssueSeverity::Error,
                    kind: IssueKind::JunctionDanglingRoad,
                    message: format!(
                        "Junction '{}' connection '{}' references non-existent connecting road '{}'",
                        junction.id, conn.id, conn.connecting_road
                    ),
                    element_id: junction.id.clone(),
                });
            }
            if !project.roads.iter().any(|r| r.id == conn.incoming_road) {
                report.issues.push(TopologyIssue {
                    severity: IssueSeverity::Error,
                    kind: IssueKind::JunctionDanglingRoad,
                    message: format!(
                        "Junction '{}' connection '{}' references non-existent incoming road '{}'",
                        junction.id, conn.id, conn.incoming_road
                    ),
                    element_id: junction.id.clone(),
                });
            }
        }
    }
}

fn check_isolated_roads(project: &Project, report: &mut TopologyReport) {
    for road in &project.roads {
        // Skip junction connector roads
        if road.junction_id.as_deref().is_some_and(|j| j != "-1") {
            continue;
        }

        let has_link = road.link.as_ref().is_some_and(|l| {
            l.predecessor.is_some() || l.successor.is_some()
        });

        let referenced_by_junction = project.junctions.iter().any(|j| {
            j.connections
                .iter()
                .any(|c| c.incoming_road == road.id || c.connecting_road == road.id)
        });

        if !has_link && !referenced_by_junction && project.roads.len() > 1 {
            report.issues.push(TopologyIssue {
                severity: IssueSeverity::Warning,
                kind: IssueKind::IsolatedRoad,
                message: format!("Road '{}' has no connections to other roads", road.id),
                element_id: road.id.clone(),
            });
        }
    }
}

fn check_degenerate_junctions(project: &Project, report: &mut TopologyReport) {
    for junction in &project.junctions {
        if junction.connections.len() < 2 {
            report.issues.push(TopologyIssue {
                severity: IssueSeverity::Warning,
                kind: IssueKind::DegenerateJunction,
                message: format!(
                    "Junction '{}' has only {} connection(s) (expected ≥2)",
                    junction.id,
                    junction.connections.len()
                ),
                element_id: junction.id.clone(),
            });
        }
    }
}

fn check_road_lengths(project: &Project, report: &mut TopologyReport) {
    for road in &project.roads {
        if road.length <= 0.0 {
            report.issues.push(TopologyIssue {
                severity: IssueSeverity::Error,
                kind: IssueKind::InvalidRoadLength,
                message: format!(
                    "Road '{}' has invalid length {}",
                    road.id, road.length
                ),
                element_id: road.id.clone(),
            });
        }
    }
}

fn check_junction_lane_links(project: &Project, report: &mut TopologyReport) {
    for junction in &project.junctions {
        for conn in &junction.connections {
            let connecting_road = project.roads.iter().find(|r| r.id == conn.connecting_road);
            let incoming_road = project.roads.iter().find(|r| r.id == conn.incoming_road);

            for ll in &conn.lane_links {
                // Check incoming lane exists
                if let Some(road) = incoming_road {
                    if !road_has_lane(road, ll.from) {
                        report.issues.push(TopologyIssue {
                            severity: IssueSeverity::Warning,
                            kind: IssueKind::InvalidLaneLink,
                            message: format!(
                                "Junction '{}' connection '{}': incoming lane {} not found on road '{}'",
                                junction.id, conn.id, ll.from, conn.incoming_road
                            ),
                            element_id: junction.id.clone(),
                        });
                    }
                }

                // Check connecting lane exists
                if let Some(road) = connecting_road {
                    if !road_has_lane(road, ll.to) {
                        report.issues.push(TopologyIssue {
                            severity: IssueSeverity::Warning,
                            kind: IssueKind::InvalidLaneLink,
                            message: format!(
                                "Junction '{}' connection '{}': connecting lane {} not found on road '{}'",
                                junction.id, conn.id, ll.to, conn.connecting_road
                            ),
                            element_id: junction.id.clone(),
                        });
                    }
                }
            }
        }
    }
}

fn road_has_lane(road: &Road, lane_id: i32) -> bool {
    road.lane_sections.iter().any(|section| {
        section.left.iter().any(|l| l.id == lane_id)
            || section.right.iter().any(|l| l.id == lane_id)
            || section.center.iter().any(|l| l.id == lane_id)
    })
}

// ── Repair ────────────────────────────────────────────────────────────────────

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;

    fn make_simple_project() -> Project {
        Project {
            roads: vec![
                Road::new("1", 100.0),
                Road::new("2", 200.0),
            ],
            junctions: vec![],
            ..Project::default()
        }
    }

    #[test]
    fn test_validate_clean_project() {
        let project = make_simple_project();
        let report = validate_topology(&project);
        // Two isolated roads — warnings only
        assert_eq!(report.error_count(), 0);
    }

    #[test]
    fn test_validate_dangling_link() {
        let mut project = make_simple_project();
        project.roads[0].link = Some(RoadLink {
            predecessor: Some(LinkElement {
                element_type: LinkElementType::Road,
                element_id: "nonexistent".to_string(),
                contact_point: Some(ContactPoint::End),
            }),
            successor: None,
        });

        let report = validate_topology(&project);
        assert!(report.error_count() >= 1);
        assert!(report.issues.iter().any(|i| i.kind == IssueKind::DanglingLink));
    }

    #[test]
    fn test_validate_orphan_junction_ref() {
        let mut project = make_simple_project();
        project.roads[0].junction_id = Some("missing-junction".to_string());

        let report = validate_topology(&project);
        assert!(report.issues.iter().any(|i| i.kind == IssueKind::OrphanJunctionRef));
    }

    #[test]
    fn test_validate_junction_dangling_road() {
        let mut project = make_simple_project();
        project.junctions.push(Junction {
            id: "j1".to_string(),
            name: "Test Junction".to_string(),
            connections: vec![JunctionConnection {
                id: "c1".to_string(),
                incoming_road: "1".to_string(),
                connecting_road: "ghost".to_string(),
                contact_point: ContactPoint::Start,
                lane_links: vec![],
            }],
        });

        let report = validate_topology(&project);
        assert!(report.issues.iter().any(|i| i.kind == IssueKind::JunctionDanglingRoad));
    }

    #[test]
    fn test_validate_degenerate_junction() {
        let mut project = make_simple_project();
        project.junctions.push(Junction {
            id: "j1".to_string(),
            name: "Degenerate".to_string(),
            connections: vec![JunctionConnection {
                id: "c1".to_string(),
                incoming_road: "1".to_string(),
                connecting_road: "2".to_string(),
                contact_point: ContactPoint::Start,
                lane_links: vec![],
            }],
        });

        let report = validate_topology(&project);
        assert!(report.issues.iter().any(|i| i.kind == IssueKind::DegenerateJunction));
    }

    #[test]
    fn test_validate_duplicate_road_ids() {
        let mut project = make_simple_project();
        project.roads.push(Road::new("1", 50.0)); // duplicate

        let report = validate_topology(&project);
        assert!(report.issues.iter().any(|i| i.kind == IssueKind::DuplicateRoadId));
    }

    #[test]
    fn test_validate_invalid_road_length() {
        let mut project = make_simple_project();
        project.roads[0].length = 0.0;

        let report = validate_topology(&project);
        assert!(report.issues.iter().any(|i| i.kind == IssueKind::InvalidRoadLength));
    }

    #[test]
    fn test_repair_dangling_link() {
        let mut project = make_simple_project();
        project.roads[0].link = Some(RoadLink {
            predecessor: Some(LinkElement {
                element_type: LinkElementType::Road,
                element_id: "nonexistent".to_string(),
                contact_point: Some(ContactPoint::End),
            }),
            successor: None,
        });

        let (repaired, actions) = repair_topology(&project);
        assert!(repaired.roads[0].link.is_none());
        assert!(!actions.is_empty());
    }

    #[test]
    fn test_repair_orphan_junction_ref() {
        let mut project = make_simple_project();
        project.roads[0].junction_id = Some("missing".to_string());

        let (repaired, actions) = repair_topology(&project);
        assert!(repaired.roads[0].junction_id.is_none());
        assert!(!actions.is_empty());
    }

    #[test]
    fn test_repair_junction_dangling_connections() {
        let mut project = make_simple_project();
        project.junctions.push(Junction {
            id: "j1".to_string(),
            name: "Test".to_string(),
            connections: vec![
                JunctionConnection {
                    id: "c1".to_string(),
                    incoming_road: "1".to_string(),
                    connecting_road: "2".to_string(),
                    contact_point: ContactPoint::Start,
                    lane_links: vec![],
                },
                JunctionConnection {
                    id: "c2".to_string(),
                    incoming_road: "ghost".to_string(),
                    connecting_road: "2".to_string(),
                    contact_point: ContactPoint::Start,
                    lane_links: vec![],
                },
            ],
        });

        let (repaired, actions) = repair_topology(&project);
        // The dangling connection was removed, leaving only 1 → degenerate → junction removed
        assert!(repaired.junctions.is_empty());
        assert!(!actions.is_empty());
    }

    #[test]
    fn test_repair_preserves_valid_project() {
        let project = make_simple_project();
        let (repaired, actions) = repair_topology(&project);
        assert_eq!(repaired.roads.len(), project.roads.len());
        assert!(actions.is_empty());
    }

    #[test]
    fn test_optimize_junction_basic() {
        let mut project = Project::default();

        // Create two incoming roads that link to junction "j1"
        let mut road1 = Road::new("r1", 100.0);
        road1.link = Some(RoadLink {
            predecessor: None,
            successor: Some(LinkElement {
                element_type: LinkElementType::Junction,
                element_id: "j1".to_string(),
                contact_point: Some(ContactPoint::End),
            }),
        });

        let mut road2 = Road::new("r2", 100.0);
        road2.link = Some(RoadLink {
            predecessor: Some(LinkElement {
                element_type: LinkElementType::Junction,
                element_id: "j1".to_string(),
                contact_point: Some(ContactPoint::Start),
            }),
            successor: None,
        });

        project.roads = vec![road1, road2];
        project.junctions = vec![Junction {
            id: "j1".to_string(),
            name: "Test".to_string(),
            connections: vec![],
        }];

        let optimized = optimize_junction(&project, "j1");
        assert!(optimized.is_some());
        let conns = optimized.unwrap();
        // Should create connections between the two approach roads
        assert!(conns.len() >= 2);
    }

    #[test]
    fn test_optimize_junction_not_found() {
        let project = make_simple_project();
        assert!(optimize_junction(&project, "nonexistent").is_none());
    }
}
