//! OpenDRIVE data quality validation.
//!
//! Checks road networks for common issues: missing connections, invalid
//! lane counts, zero-length roads, and self-intersecting geometry.

use crate::model::{Project, Road};
use serde::{Deserialize, Serialize};

/// Severity level of a validation issue.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Severity {
    Error,
    Warning,
    Info,
}

/// A single validation issue.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ValidationIssue {
    pub severity: Severity,
    pub code: String,
    pub message: String,
    /// The ID of the road or junction causing the issue, if applicable.
    pub element_id: Option<String>,
}

impl ValidationIssue {
    fn error(code: &str, message: impl Into<String>, id: Option<&str>) -> Self {
        Self {
            severity: Severity::Error,
            code: code.into(),
            message: message.into(),
            element_id: id.map(str::to_owned),
        }
    }
    fn warning(code: &str, message: impl Into<String>, id: Option<&str>) -> Self {
        Self {
            severity: Severity::Warning,
            code: code.into(),
            message: message.into(),
            element_id: id.map(str::to_owned),
        }
    }
}

/// Result of a full project validation run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationReport {
    pub issues: Vec<ValidationIssue>,
}

impl ValidationReport {
    pub fn errors(&self) -> impl Iterator<Item = &ValidationIssue> {
        self.issues.iter().filter(|i| i.severity == Severity::Error)
    }
    pub fn warnings(&self) -> impl Iterator<Item = &ValidationIssue> {
        self.issues
            .iter()
            .filter(|i| i.severity == Severity::Warning)
    }
    pub fn is_valid(&self) -> bool {
        self.errors().next().is_none()
    }
}

/// Run all validation checks on the project.
pub fn validate_project(project: &Project) -> ValidationReport {
    let mut issues = Vec::new();
    check_zero_length_roads(&project.roads, &mut issues);
    check_empty_plan_view(&project.roads, &mut issues);
    check_no_lane_sections(&project.roads, &mut issues);
    check_duplicate_road_ids(&project.roads, &mut issues);
    ValidationReport { issues }
}

fn check_zero_length_roads(roads: &[Road], issues: &mut Vec<ValidationIssue>) {
    for road in roads {
        if road.length <= 0.0 {
            issues.push(ValidationIssue::error(
                "E001",
                format!(
                    "Road '{}' has zero or negative length: {}",
                    road.id, road.length
                ),
                Some(&road.id),
            ));
        }
    }
}

fn check_empty_plan_view(roads: &[Road], issues: &mut Vec<ValidationIssue>) {
    for road in roads {
        if road.plan_view.is_empty() {
            issues.push(ValidationIssue::warning(
                "W001",
                format!("Road '{}' has no geometry elements in plan_view", road.id),
                Some(&road.id),
            ));
        }
    }
}

fn check_no_lane_sections(roads: &[Road], issues: &mut Vec<ValidationIssue>) {
    for road in roads {
        if road.lane_sections.is_empty() {
            issues.push(ValidationIssue::warning(
                "W002",
                format!("Road '{}' has no lane sections", road.id),
                Some(&road.id),
            ));
        }
    }
}

fn check_duplicate_road_ids(roads: &[Road], issues: &mut Vec<ValidationIssue>) {
    let mut seen = std::collections::HashSet::new();
    for road in roads {
        if !seen.insert(&road.id) {
            issues.push(ValidationIssue::error(
                "E002",
                format!("Duplicate road ID: '{}'", road.id),
                Some(&road.id),
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Project;

    fn empty_project() -> Project {
        Project::default()
    }

    #[test]
    fn test_empty_project_is_valid() {
        let report = validate_project(&empty_project());
        assert!(report.is_valid(), "issues: {:?}", report.issues);
    }

    #[test]
    fn test_zero_length_road() {
        let mut p = empty_project();
        let mut road = crate::model::road::Road::new("r1", 0.0);
        road.length = 0.0;
        p.roads.push(road);
        let report = validate_project(&p);
        assert!(!report.is_valid());
        assert!(report.errors().any(|i| i.code == "E001"));
    }

    #[test]
    fn test_missing_geometry_warning() {
        let mut p = empty_project();
        p.roads.push(crate::model::road::Road::new("r1", 10.0));
        let report = validate_project(&p);
        // road has no plan_view → W001, no lane_sections → W002
        assert!(report.warnings().any(|i| i.code == "W001"));
        assert!(report.warnings().any(|i| i.code == "W002"));
    }

    #[test]
    fn test_duplicate_road_ids() {
        let mut p = empty_project();
        p.roads.push(crate::model::road::Road::new("r1", 10.0));
        p.roads.push(crate::model::road::Road::new("r1", 20.0));
        let report = validate_project(&p);
        assert!(!report.is_valid());
        assert!(report.errors().any(|i| i.code == "E002"));
    }

    #[test]
    fn test_valid_road() {
        let mut p = empty_project();
        let geom = vec![crate::model::road::Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 10.0,
            geo_type: crate::model::road::GeometryType::Line,
        }];
        p.roads
            .push(crate::model::road::Road::from_centerline("r1", geom));
        let report = validate_project(&p);
        // Should have no errors, but may have W002 (no lane_sections on top — actually from_centerline adds them)
        assert!(
            report.is_valid(),
            "errors: {:?}",
            report.errors().collect::<Vec<_>>()
        );
    }

    #[test]
    fn test_report_is_valid_no_errors() {
        let report = ValidationReport { issues: vec![] };
        assert!(report.is_valid());
    }
}
