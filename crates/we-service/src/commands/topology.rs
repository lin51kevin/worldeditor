//! Topology validation and repair commands.

use we_core::model::*;
use we_core::topology;

use crate::{Command, EditorError};

// ── RepairTopology ──────────────────────────────────

/// Automatically repair topology issues in the project.
///
/// Removes dangling links, orphan junction references, invalid connections,
/// and degenerate junctions. Safe to undo — stores the original project.
#[derive(Debug, Clone)]
pub struct RepairTopology {
    snapshot: Project,
}

impl RepairTopology {
    pub fn new(current_project: &Project) -> Self {
        Self {
            snapshot: current_project.clone(),
        }
    }
}

impl Command for RepairTopology {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let (repaired, actions) = topology::repair_topology(project);
        if actions.is_empty() {
            return Err(EditorError::OperationFailed(
                "No topology issues to repair".into(),
            ));
        }
        Ok(repaired)
    }

    fn undo(&self, _project: &Project) -> Result<Project, EditorError> {
        Ok(self.snapshot.clone())
    }

    fn description(&self) -> &str {
        "Repair Topology"
    }
}

// ── OptimizeJunction ─────────────────────────────────

/// Rebuild a junction's connections from the actual road topology.
///
/// This replaces the junction's connection list with a freshly computed
/// set of connections based on road links and lane matching.
#[derive(Debug, Clone)]
pub struct OptimizeJunction {
    pub junction_id: String,
    old_connections: Vec<JunctionConnection>,
}

impl OptimizeJunction {
    pub fn new(junction_id: impl Into<String>, old_connections: Vec<JunctionConnection>) -> Self {
        Self {
            junction_id: junction_id.into(),
            old_connections,
        }
    }
}

impl Command for OptimizeJunction {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let new_connections =
            topology::optimize_junction(project, &self.junction_id).ok_or_else(|| {
                EditorError::OperationFailed(format!(
                    "Junction '{}' not found or has no linked roads",
                    self.junction_id
                ))
            })?;

        let mut p = project.clone();
        let junction = p
            .junctions
            .iter_mut()
            .find(|j| j.id == self.junction_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Junction '{}' not found", self.junction_id))
            })?;
        junction.connections = new_connections;
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let junction = p
            .junctions
            .iter_mut()
            .find(|j| j.id == self.junction_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Junction '{}' not found", self.junction_id))
            })?;
        junction.connections = self.old_connections.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Optimize Junction"
    }
}

// ── OptimizeAllJunctions ─────────────────────────────

/// Optimize all junctions in the project at once.
#[derive(Debug, Clone)]
pub struct OptimizeAllJunctions {
    snapshot: Project,
}

impl OptimizeAllJunctions {
    pub fn new(current_project: &Project) -> Self {
        Self {
            snapshot: current_project.clone(),
        }
    }
}

impl Command for OptimizeAllJunctions {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let junction_ids: Vec<String> = p.junctions.iter().map(|j| j.id.clone()).collect();

        let mut changed = false;
        for jid in &junction_ids {
            if let Some(new_conns) = topology::optimize_junction(&p, jid)
                && let Some(junction) = p.junctions.iter_mut().find(|j| j.id == *jid)
                && junction.connections != new_conns
            {
                junction.connections = new_conns;
                changed = true;
            }
        }

        if !changed {
            return Err(EditorError::OperationFailed(
                "All junctions are already optimized".into(),
            ));
        }

        Ok(p)
    }

    fn undo(&self, _project: &Project) -> Result<Project, EditorError> {
        Ok(self.snapshot.clone())
    }

    fn description(&self) -> &str {
        "Optimize All Junctions"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use we_core::model::{LinkElement, LinkElementType, Project, Road, RoadLink};

    fn make_linked_project() -> Project {
        let mut road1 = Road::new("r1", 100.0);
        road1.link = Some(RoadLink {
            predecessor: None,
            successor: Some(LinkElement {
                element_type: LinkElementType::Road,
                element_id: "nonexistent".to_string(),
                contact_point: Some(ContactPoint::End),
            }),
        });
        Project {
            roads: vec![road1, Road::new("r2", 100.0)],
            ..Project::default()
        }
    }

    #[test]
    fn test_repair_topology_command() {
        let project = make_linked_project();
        let cmd = RepairTopology::new(&project);

        let repaired = cmd.execute(&project).unwrap();
        assert!(repaired.roads[0].link.is_none());

        // Undo restores original
        let restored = cmd.undo(&repaired).unwrap();
        assert!(restored.roads[0].link.is_some());
    }

    #[test]
    fn test_repair_topology_no_issues() {
        let project = Project {
            roads: vec![Road::new("r1", 100.0)],
            ..Project::default()
        };
        let cmd = RepairTopology::new(&project);
        // Should fail because there's nothing to repair
        assert!(cmd.execute(&project).is_err());
    }

    #[test]
    fn test_optimize_junction_command() {
        let mut project = Project::default();

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

        let cmd = OptimizeJunction::new("j1", vec![]);
        let result = cmd.execute(&project).unwrap();

        let junction = result.junctions.iter().find(|j| j.id == "j1").unwrap();
        assert!(!junction.connections.is_empty());

        // Undo restores empty connections
        let restored = cmd.undo(&result).unwrap();
        let junction = restored.junctions.iter().find(|j| j.id == "j1").unwrap();
        assert!(junction.connections.is_empty());
    }
}
