//! Topology validation — checks for structural issues in the road network.

use crate::model::{LinkElement, LinkElementType, Project, Road};

use super::{IssueKind, IssueSeverity, TopologyIssue, TopologyReport};

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
        if let Some(ref jid) = road.junction_id
            && jid != "-1" && !project.junctions.iter().any(|j| j.id == *jid) {
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

        let has_link = road
            .link
            .as_ref()
            .is_some_and(|l| l.predecessor.is_some() || l.successor.is_some());

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
                message: format!("Road '{}' has invalid length {}", road.id, road.length),
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
                if let Some(road) = incoming_road
                    && !road_has_lane(road, ll.from) {
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

                // Check connecting lane exists
                if let Some(road) = connecting_road
                    && !road_has_lane(road, ll.to) {
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

pub(super) fn road_has_lane(road: &Road, lane_id: i32) -> bool {
    road.lane_sections.iter().any(|section| {
        section.left.iter().any(|l| l.id == lane_id)
            || section.right.iter().any(|l| l.id == lane_id)
            || section.center.iter().any(|l| l.id == lane_id)
    })
}
