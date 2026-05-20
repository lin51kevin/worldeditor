//! Road network topology validation and repair.
//!
//! Analyses the connectivity graph of a road network to find dangling links,
//! orphan roads, inconsistent junction references, and other structural issues.
//! Also provides repair operations that produce a corrected [`Project`].

mod repair;
pub mod validate;

pub use repair::{optimize_junction, repair_topology};
pub use validate::validate_topology;

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

// ── Tests ────────────────────────────────────────────────────────────────────

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
