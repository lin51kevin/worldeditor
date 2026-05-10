//! Road-level commands: CRUD, geometry, transform.

use we_core::model::*;

use crate::{Command, EditorError};

use super::find_road_mut;

// ── AddRoad ──────────────────────────────────────────

/// Add a new road to the project.
#[derive(Debug, Clone)]
pub struct AddRoad {
    pub road: Road,
}

impl AddRoad {
    pub fn new(road: Road) -> Self {
        Self { road }
    }
}

impl Command for AddRoad {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        if project.roads.iter().any(|r| r.id == self.road.id) {
            return Err(EditorError::OperationFailed(format!(
                "Road '{}' already exists",
                self.road.id
            )));
        }
        let mut p = project.clone();
        p.roads.push(self.road.clone());
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        p.roads.retain(|r| r.id != self.road.id);
        Ok(p)
    }

    fn description(&self) -> &str {
        "Add Road"
    }
}

// ── DeleteRoad ───────────────────────────────────────

/// Remove a road from the project by ID.
#[derive(Debug, Clone)]
pub struct DeleteRoad {
    pub road_id: String,
    /// Snapshot of the deleted road for undo.
    snapshot: Option<Road>,
}

impl DeleteRoad {
    pub fn new(road_id: impl Into<String>) -> Self {
        Self {
            road_id: road_id.into(),
            snapshot: None,
        }
    }

    /// Create with a pre-captured snapshot (for use when the road is known).
    pub fn with_snapshot(road_id: impl Into<String>, road: Road) -> Self {
        Self {
            road_id: road_id.into(),
            snapshot: Some(road),
        }
    }
}

impl Command for DeleteRoad {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let found = project.roads.iter().any(|r| r.id == self.road_id);
        if !found {
            return Err(EditorError::OperationFailed(format!(
                "Road '{}' not found",
                self.road_id
            )));
        }
        let mut p = project.clone();
        p.roads.retain(|r| r.id != self.road_id);
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let road = self
            .snapshot
            .as_ref()
            .ok_or_else(|| EditorError::OperationFailed("Cannot undo: no road snapshot".into()))?;
        let mut p = project.clone();
        p.roads.push(road.clone());
        Ok(p)
    }

    fn description(&self) -> &str {
        "Delete Road"
    }
}

// ── UpdateRoadName ───────────────────────────────────

/// Rename a road.
#[derive(Debug, Clone)]
pub struct UpdateRoadName {
    pub road_id: String,
    pub new_name: String,
    pub old_name: String,
}

impl UpdateRoadName {
    pub fn new(
        road_id: impl Into<String>,
        old_name: impl Into<String>,
        new_name: impl Into<String>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            old_name: old_name.into(),
            new_name: new_name.into(),
        }
    }
}

impl Command for UpdateRoadName {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.name = self.new_name.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.name = self.old_name.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Rename Road"
    }
}

// ── SetRoadGeometry ──────────────────────────────────

/// Replace the plan view (geometries) of a road.
#[derive(Debug, Clone)]
pub struct SetRoadGeometry {
    pub road_id: String,
    pub new_geometries: Vec<Geometry>,
    pub old_geometries: Vec<Geometry>,
}

impl SetRoadGeometry {
    pub fn new(
        road_id: impl Into<String>,
        old_geometries: Vec<Geometry>,
        new_geometries: Vec<Geometry>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            new_geometries,
            old_geometries,
        }
    }
}

impl Command for SetRoadGeometry {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.plan_view = self.new_geometries.clone();
        road.length = road.plan_view.iter().map(|g| g.length).sum();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.plan_view = self.old_geometries.clone();
        road.length = road.plan_view.iter().map(|g| g.length).sum();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Set Road Geometry"
    }
}

// ── CreateRoadFromCenterline ───────────────────────────

/// Create a new road from a centerline geometry with default lanes.
#[derive(Debug, Clone)]
pub struct CreateRoadFromCenterline {
    pub road_id: String,
    pub geometries: Vec<Geometry>,
}

impl CreateRoadFromCenterline {
    pub fn new(road_id: impl Into<String>, geometries: Vec<Geometry>) -> Self {
        Self {
            road_id: road_id.into(),
            geometries,
        }
    }
}

impl Command for CreateRoadFromCenterline {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        if project.roads.iter().any(|r| r.id == self.road_id) {
            return Err(EditorError::OperationFailed(format!(
                "Road '{}' already exists",
                self.road_id
            )));
        }
        let road = Road::from_centerline(&self.road_id, self.geometries.clone());
        let mut p = project.clone();
        p.roads.push(road);
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        p.roads.retain(|r| r.id != self.road_id);
        Ok(p)
    }

    fn description(&self) -> &str {
        "Create Road from Centerline"
    }
}

// ── CreateRoadFromSpline ─────────────────────────────

/// Create a new road from an editable spline with a lane template.
#[derive(Debug, Clone)]
pub struct CreateRoadFromSpline {
    pub road_id: String,
    pub spline: we_core::spline::EditableSpline,
    pub template: RoadTemplate,
}

impl CreateRoadFromSpline {
    pub fn new(
        road_id: impl Into<String>,
        spline: we_core::spline::EditableSpline,
        template: RoadTemplate,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            spline,
            template,
        }
    }
}

impl Command for CreateRoadFromSpline {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        if project.roads.iter().any(|r| r.id == self.road_id) {
            return Err(EditorError::OperationFailed(format!(
                "Road '{}' already exists",
                self.road_id
            )));
        }

        // Convert spline to geometries
        let geometries = we_core::spline::spline_to_geometries(&self.spline);

        if geometries.is_empty() {
            return Err(EditorError::OperationFailed(
                "Spline must have at least one geometry segment".into(),
            ));
        }

        // Calculate total length
        let total_length: f64 = geometries.iter().map(|geo| geo.length).sum();

        // Build road with template lanes
        let mut road = Road::new(&self.road_id, total_length);
        road.plan_view = geometries;
        let lane_section = self.template.to_lane_section();
        road.lane_sections.push(lane_section);

        let mut p = project.clone();
        p.roads.push(road);
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        p.roads.retain(|r| r.id != self.road_id);
        Ok(p)
    }

    fn description(&self) -> &str {
        "Create Road from Spline"
    }
}

// ── SetRoadElevation ─────────────────────────────────

/// Replace the elevation profile of a road.
#[derive(Debug, Clone)]
pub struct SetRoadElevation {
    pub road_id: String,
    pub new_elevations: Vec<Elevation>,
    pub old_elevations: Vec<Elevation>,
}

impl SetRoadElevation {
    pub fn new(
        road_id: impl Into<String>,
        old_elevations: Vec<Elevation>,
        new_elevations: Vec<Elevation>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            new_elevations,
            old_elevations,
        }
    }
}

impl Command for SetRoadElevation {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.elevation_profile = self.new_elevations.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.elevation_profile = self.old_elevations.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Set Road Elevation"
    }
}

// ── SetRoadLink ──────────────────────────────────────

/// Set or update the link (predecessor/successor) of a road.
#[derive(Debug, Clone)]
pub struct SetRoadLink {
    pub road_id: String,
    pub new_link: Option<RoadLink>,
    pub old_link: Option<RoadLink>,
}

impl SetRoadLink {
    pub fn new(
        road_id: impl Into<String>,
        old_link: Option<RoadLink>,
        new_link: Option<RoadLink>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            new_link,
            old_link,
        }
    }
}

impl Command for SetRoadLink {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.link = self.new_link.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.link = self.old_link.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Set Road Link"
    }
}

// ── TranslateRoad ────────────────────────────────────

/// Translate (move) a road's geometry by a displacement vector.
///
/// Shifts all geometry segment origins and updates elevation accordingly.
#[derive(Debug, Clone)]
pub struct TranslateRoad {
    pub road_id: String,
    pub dx: f64,
    pub dy: f64,
    pub dz: f64,
}

impl TranslateRoad {
    pub fn new(road_id: impl Into<String>, dx: f64, dy: f64, dz: f64) -> Self {
        Self {
            road_id: road_id.into(),
            dx,
            dy,
            dz,
        }
    }
}

impl Command for TranslateRoad {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        for geo in &mut road.plan_view {
            geo.x += self.dx;
            geo.y += self.dy;
        }
        if self.dz.abs() > 1e-12 {
            if road.elevation_profile.is_empty() {
                road.elevation_profile.push(Elevation {
                    s: 0.0,
                    a: self.dz,
                    b: 0.0,
                    c: 0.0,
                    d: 0.0,
                });
            } else {
                for ep in &mut road.elevation_profile {
                    ep.a += self.dz;
                }
            }
        }
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        for geo in &mut road.plan_view {
            geo.x -= self.dx;
            geo.y -= self.dy;
        }
        if self.dz.abs() > 1e-12 {
            for ep in &mut road.elevation_profile {
                ep.a -= self.dz;
            }
            road.elevation_profile.retain(|ep| {
                ep.a.abs() > 1e-12 || ep.b.abs() > 1e-12 || ep.c.abs() > 1e-12 || ep.d.abs() > 1e-12
            });
        }
        Ok(p)
    }

    fn description(&self) -> &str {
        "Translate Road"
    }
}

// ── RotateRoad ───────────────────────────────────────

/// Rotate a road's geometry around a pivot point.
///
/// `angle_rad` is the rotation angle in radians (counter-clockwise positive).
/// `pivot` is the (x, y) rotation center.
#[derive(Debug, Clone)]
pub struct RotateRoad {
    pub road_id: String,
    pub pivot: [f64; 2],
    pub angle_rad: f64,
}

impl RotateRoad {
    pub fn new(road_id: impl Into<String>, pivot: [f64; 2], angle_rad: f64) -> Self {
        Self {
            road_id: road_id.into(),
            pivot,
            angle_rad,
        }
    }
}

fn rotate_point_2d(x: f64, y: f64, cx: f64, cy: f64, angle: f64) -> (f64, f64) {
    let cos_a = angle.cos();
    let sin_a = angle.sin();
    let dx = x - cx;
    let dy = y - cy;
    (cx + dx * cos_a - dy * sin_a, cy + dx * sin_a + dy * cos_a)
}

impl Command for RotateRoad {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let [cx, cy] = self.pivot;
        for geo in &mut road.plan_view {
            let (nx, ny) = rotate_point_2d(geo.x, geo.y, cx, cy, self.angle_rad);
            geo.x = nx;
            geo.y = ny;
            geo.hdg += self.angle_rad;
        }
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let [cx, cy] = self.pivot;
        for geo in &mut road.plan_view {
            let (nx, ny) = rotate_point_2d(geo.x, geo.y, cx, cy, -self.angle_rad);
            geo.x = nx;
            geo.y = ny;
            geo.hdg -= self.angle_rad;
        }
        Ok(p)
    }

    fn description(&self) -> &str {
        "Rotate Road"
    }
}
