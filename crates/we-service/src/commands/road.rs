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

// ── AddRoads ─────────────────────────────────────────

/// Add multiple roads as a single undo unit (e.g. from point-cloud vectorization).
#[derive(Debug, Clone)]
pub struct AddRoads {
    pub roads: Vec<Road>,
    label: String,
}

impl AddRoads {
    /// Create a command adding `roads` with a default description.
    pub fn new(roads: Vec<Road>) -> Self {
        Self {
            roads,
            label: "Add Roads".to_string(),
        }
    }

    /// Create with a custom description (shown in the undo history).
    pub fn with_label(roads: Vec<Road>, label: impl Into<String>) -> Self {
        Self {
            roads,
            label: label.into(),
        }
    }
}

impl Command for AddRoads {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        for road in &self.roads {
            if project.roads.iter().any(|r| r.id == road.id) {
                return Err(EditorError::OperationFailed(format!(
                    "Road '{}' already exists",
                    road.id
                )));
            }
        }
        let mut p = project.clone();
        p.roads.extend(self.roads.iter().cloned());
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        p.roads
            .retain(|r| !self.roads.iter().any(|added| added.id == r.id));
        Ok(p)
    }

    fn description(&self) -> &str {
        &self.label
    }
}

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
    pub output_mode: we_core::spline::SplineOutputMode,
}

impl CreateRoadFromSpline {
    pub fn new(
        road_id: impl Into<String>,
        spline: we_core::spline::EditableSpline,
        template: RoadTemplate,
        output_mode: we_core::spline::SplineOutputMode,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            spline,
            template,
            output_mode,
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
        let geometries =
            we_core::spline::spline_to_geometries_with_mode(&self.spline, self.output_mode);

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

// ── UpdateBridge ─────────────────────────────────────

/// Update the position, length, and type of a bridge on a road.
#[derive(Debug, Clone)]
pub struct UpdateBridge {
    pub road_id: String,
    pub bridge_id: String,
    pub new_s: f64,
    pub new_length: f64,
    pub new_type: String,
    // Snapshots for undo
    old_s: f64,
    old_length: f64,
    old_type: String,
}

impl UpdateBridge {
    /// Create from old and new values.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        road_id: impl Into<String>,
        bridge_id: impl Into<String>,
        old_s: f64,
        old_length: f64,
        old_type: impl Into<String>,
        new_s: f64,
        new_length: f64,
        new_type: impl Into<String>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            bridge_id: bridge_id.into(),
            new_s,
            new_length,
            new_type: new_type.into(),
            old_s,
            old_length,
            old_type: old_type.into(),
        }
    }
}

impl Command for UpdateBridge {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let bridge = road
            .bridges
            .iter_mut()
            .find(|b| b.id == self.bridge_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Bridge '{}' not found", self.bridge_id))
            })?;
        bridge.s = self.new_s;
        bridge.length = self.new_length;
        bridge.bridge_type = self.new_type.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let bridge = road
            .bridges
            .iter_mut()
            .find(|b| b.id == self.bridge_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Bridge '{}' not found", self.bridge_id))
            })?;
        bridge.s = self.old_s;
        bridge.length = self.old_length;
        bridge.bridge_type = self.old_type.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Update Bridge"
    }
}

// ── DeleteBridge ─────────────────────────────────────

/// Remove a bridge from a road. Stores a snapshot for undo.
#[derive(Debug, Clone)]
pub struct DeleteBridge {
    pub road_id: String,
    pub bridge_id: String,
    snapshot: Option<Bridge>,
}

impl DeleteBridge {
    pub fn new(road_id: impl Into<String>, bridge_id: impl Into<String>) -> Self {
        Self {
            road_id: road_id.into(),
            bridge_id: bridge_id.into(),
            snapshot: None,
        }
    }

    pub fn with_snapshot(
        road_id: impl Into<String>,
        bridge_id: impl Into<String>,
        bridge: Bridge,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            bridge_id: bridge_id.into(),
            snapshot: Some(bridge),
        }
    }
}

impl Command for DeleteBridge {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let before = road.bridges.len();
        road.bridges.retain(|b| b.id != self.bridge_id);
        if road.bridges.len() == before {
            return Err(EditorError::OperationFailed(format!(
                "Bridge '{}' not found on road '{}'",
                self.bridge_id, self.road_id
            )));
        }
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let bridge = self.snapshot.as_ref().ok_or_else(|| {
            EditorError::OperationFailed("Cannot undo DeleteBridge: no snapshot".into())
        })?;
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.bridges.push(bridge.clone());
        Ok(p)
    }

    fn description(&self) -> &str {
        "Delete Bridge"
    }
}

// ── UpdateTunnel ─────────────────────────────────────

/// Update the position, length, and type of a tunnel on a road.
#[derive(Debug, Clone)]
pub struct UpdateTunnel {
    pub road_id: String,
    pub tunnel_id: String,
    pub new_s: f64,
    pub new_length: f64,
    pub new_type: String,
    old_s: f64,
    old_length: f64,
    old_type: String,
}

impl UpdateTunnel {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        road_id: impl Into<String>,
        tunnel_id: impl Into<String>,
        old_s: f64,
        old_length: f64,
        old_type: impl Into<String>,
        new_s: f64,
        new_length: f64,
        new_type: impl Into<String>,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            tunnel_id: tunnel_id.into(),
            new_s,
            new_length,
            new_type: new_type.into(),
            old_s,
            old_length,
            old_type: old_type.into(),
        }
    }
}

impl Command for UpdateTunnel {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let tunnel = road
            .tunnels
            .iter_mut()
            .find(|t| t.id == self.tunnel_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Tunnel '{}' not found", self.tunnel_id))
            })?;
        tunnel.s = self.new_s;
        tunnel.length = self.new_length;
        tunnel.tunnel_type = self.new_type.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let tunnel = road
            .tunnels
            .iter_mut()
            .find(|t| t.id == self.tunnel_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Tunnel '{}' not found", self.tunnel_id))
            })?;
        tunnel.s = self.old_s;
        tunnel.length = self.old_length;
        tunnel.tunnel_type = self.old_type.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Update Tunnel"
    }
}

// ── DeleteTunnel ─────────────────────────────────────

/// Remove a tunnel from a road. Stores a snapshot for undo.
#[derive(Debug, Clone)]
pub struct DeleteTunnel {
    pub road_id: String,
    pub tunnel_id: String,
    snapshot: Option<Tunnel>,
}

impl DeleteTunnel {
    pub fn new(road_id: impl Into<String>, tunnel_id: impl Into<String>) -> Self {
        Self {
            road_id: road_id.into(),
            tunnel_id: tunnel_id.into(),
            snapshot: None,
        }
    }

    pub fn with_snapshot(
        road_id: impl Into<String>,
        tunnel_id: impl Into<String>,
        tunnel: Tunnel,
    ) -> Self {
        Self {
            road_id: road_id.into(),
            tunnel_id: tunnel_id.into(),
            snapshot: Some(tunnel),
        }
    }
}

impl Command for DeleteTunnel {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        let before = road.tunnels.len();
        road.tunnels.retain(|t| t.id != self.tunnel_id);
        if road.tunnels.len() == before {
            return Err(EditorError::OperationFailed(format!(
                "Tunnel '{}' not found on road '{}'",
                self.tunnel_id, self.road_id
            )));
        }
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let tunnel = self.snapshot.as_ref().ok_or_else(|| {
            EditorError::OperationFailed("Cannot undo DeleteTunnel: no snapshot".into())
        })?;
        let mut p = project.clone();
        let road = find_road_mut(&mut p, &self.road_id)?;
        road.tunnels.push(tunnel.clone());
        Ok(p)
    }

    fn description(&self) -> &str {
        "Delete Tunnel"
    }
}

#[cfg(test)]
mod tests {
    use std::f64::consts::FRAC_PI_2;

    use serde_json::to_value;
    use we_core::spline::{EditableSpline, SplineKnot, SplineOutputMode};

    use super::*;

    fn assert_projects_equal(actual: &Project, expected: &Project) {
        assert_eq!(to_value(actual).unwrap(), to_value(expected).unwrap());
    }

    fn assert_operation_failed(result: Result<Project, EditorError>, expected: &str) {
        match result {
            Err(EditorError::OperationFailed(message)) => {
                assert!(
                    message.contains(expected),
                    "expected error containing '{expected}', got '{message}'"
                );
            }
            other => panic!("expected operation failed error, got {other:?}"),
        }
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-9,
            "expected {expected}, got {actual}"
        );
    }

    fn line_geometry(x: f64, y: f64, hdg: f64, length: f64) -> Geometry {
        Geometry {
            s: 0.0,
            x,
            y,
            hdg,
            length,
            geo_type: GeometryType::Line,
        }
    }

    fn elevation(s: f64, a: f64) -> Elevation {
        Elevation {
            s,
            a,
            b: 0.0,
            c: 0.0,
            d: 0.0,
        }
    }

    fn road_link(target: &str) -> RoadLink {
        RoadLink {
            predecessor: Some(LinkElement {
                element_type: LinkElementType::Road,
                element_id: target.into(),
                contact_point: Some(ContactPoint::Start),
            }),
            successor: None,
        }
    }

    fn sample_road(road_id: &str) -> Road {
        let mut road = Road::from_centerline(road_id, vec![line_geometry(1.0, 2.0, 0.0, 10.0)]);
        road.name = "Old Road".into();
        road.elevation_profile = vec![elevation(0.0, 1.0)];
        road.link = Some(road_link("road-prev"));
        road
    }

    fn project_with_road() -> Project {
        Project {
            roads: vec![sample_road("road-1")],
            ..Default::default()
        }
    }

    fn straight_spline() -> EditableSpline {
        EditableSpline::from_knots(vec![
            SplineKnot::new(0.0, 0.0, 0.0),
            SplineKnot::new(10.0, 0.0, 0.0),
        ])
    }

    #[test]
    fn test_add_road_execute_adds_road() {
        let original = Project::default();
        let command = AddRoad::new(sample_road("road-1"));

        let result = command.execute(&original).unwrap();

        assert_eq!(result.roads.len(), 1);
        assert_eq!(result.roads[0].id, "road-1");
    }

    #[test]
    fn test_add_road_undo_restores_original_project() {
        let original = Project::default();
        let command = AddRoad::new(sample_road("road-1"));
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_add_road_execute_duplicate_id_returns_error() {
        let project = project_with_road();
        let command = AddRoad::new(sample_road("road-1"));

        assert_operation_failed(command.execute(&project), "already exists");
    }

    #[test]
    fn test_add_roads_execute_adds_all() {
        let original = Project::default();
        let command = AddRoads::new(vec![sample_road("r-1"), sample_road("r-2")]);

        let result = command.execute(&original).unwrap();

        assert_eq!(result.roads.len(), 2);
    }

    #[test]
    fn test_add_roads_undo_restores_original() {
        let original = project_with_road();
        let command = AddRoads::new(vec![sample_road("r-1"), sample_road("r-2")]);
        let modified = command.execute(&original).unwrap();
        assert_eq!(modified.roads.len(), 3);

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_add_roads_duplicate_id_returns_error() {
        let project = project_with_road();
        let command = AddRoads::new(vec![sample_road("road-1")]);

        assert_operation_failed(command.execute(&project), "already exists");
    }

    #[test]
    fn test_add_roads_custom_label() {
        let command = AddRoads::with_label(vec![], "Vectorize Point Cloud");
        assert_eq!(command.description(), "Vectorize Point Cloud");
    }

    #[test]
    fn test_delete_road_execute_removes_road() {
        let original = project_with_road();
        let command = DeleteRoad::with_snapshot("road-1", original.roads[0].clone());

        let result = command.execute(&original).unwrap();

        assert!(result.roads.is_empty());
    }

    #[test]
    fn test_delete_road_undo_restores_original_project() {
        let original = project_with_road();
        let command = DeleteRoad::with_snapshot("road-1", original.roads[0].clone());
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_delete_road_execute_missing_road_returns_error() {
        let project = project_with_road();
        let command = DeleteRoad::new("missing-road");

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_update_road_name_execute_renames_road() {
        let original = project_with_road();
        let command = UpdateRoadName::new("road-1", "Old Road", "Renamed Road");

        let result = command.execute(&original).unwrap();

        assert_eq!(result.roads[0].name, "Renamed Road");
    }

    #[test]
    fn test_update_road_name_undo_restores_original_project() {
        let original = project_with_road();
        let command = UpdateRoadName::new("road-1", "Old Road", "Renamed Road");
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_update_road_name_execute_missing_road_returns_error() {
        let project = project_with_road();
        let command = UpdateRoadName::new("missing-road", "Old Road", "Renamed Road");

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_set_road_geometry_execute_replaces_plan_view() {
        let original = project_with_road();
        let command = SetRoadGeometry::new(
            "road-1",
            original.roads[0].plan_view.clone(),
            vec![
                line_geometry(5.0, 6.0, 0.25, 7.5),
                Geometry {
                    s: 7.5,
                    x: 12.5,
                    y: 6.0,
                    hdg: 0.25,
                    length: 2.5,
                    geo_type: GeometryType::Line,
                },
            ],
        );

        let result = command.execute(&original).unwrap();

        assert_eq!(result.roads[0].plan_view.len(), 2);
        assert_close(result.roads[0].length, 10.0);
        assert_close(result.roads[0].plan_view[0].x, 5.0);
    }

    #[test]
    fn test_set_road_geometry_undo_restores_original_project() {
        let original = project_with_road();
        let command = SetRoadGeometry::new(
            "road-1",
            original.roads[0].plan_view.clone(),
            vec![line_geometry(5.0, 6.0, 0.25, 7.5)],
        );
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_set_road_geometry_execute_missing_road_returns_error() {
        let project = project_with_road();
        let command = SetRoadGeometry::new(
            "missing-road",
            vec![],
            vec![line_geometry(0.0, 0.0, 0.0, 5.0)],
        );

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_create_road_from_centerline_execute_creates_default_lanes() {
        let original = Project::default();
        let command =
            CreateRoadFromCenterline::new("road-1", vec![line_geometry(0.0, 0.0, 0.0, 15.0)]);

        let result = command.execute(&original).unwrap();
        let road = &result.roads[0];

        assert_eq!(result.roads.len(), 1);
        assert_close(road.length, 15.0);
        assert_eq!(road.lane_sections.len(), 1);
        assert_eq!(road.lane_sections[0].left.len(), 1);
        assert_eq!(road.lane_sections[0].right.len(), 1);
    }

    #[test]
    fn test_create_road_from_centerline_undo_restores_original_project() {
        let original = Project::default();
        let command =
            CreateRoadFromCenterline::new("road-1", vec![line_geometry(0.0, 0.0, 0.0, 15.0)]);
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_create_road_from_centerline_execute_duplicate_id_returns_error() {
        let project = project_with_road();
        let command =
            CreateRoadFromCenterline::new("road-1", vec![line_geometry(0.0, 0.0, 0.0, 15.0)]);

        assert_operation_failed(command.execute(&project), "already exists");
    }

    #[test]
    fn test_create_road_from_spline_execute_creates_template_lanes() {
        let original = Project::default();
        let command = CreateRoadFromSpline::new(
            "road-1",
            straight_spline(),
            RoadTemplate::dual_two_lane(),
            SplineOutputMode::Classify,
        );

        let result = command.execute(&original).unwrap();
        let road = &result.roads[0];

        assert_eq!(result.roads.len(), 1);
        assert!(!road.plan_view.is_empty());
        assert_eq!(road.lane_sections[0].left.len(), 2);
        assert_eq!(road.lane_sections[0].right.len(), 2);
    }

    #[test]
    fn test_create_road_from_spline_undo_restores_original_project() {
        let original = Project::default();
        let command = CreateRoadFromSpline::new(
            "road-1",
            straight_spline(),
            RoadTemplate::single_lane(),
            SplineOutputMode::Classify,
        );
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_create_road_from_spline_execute_duplicate_id_returns_error() {
        let project = project_with_road();
        let command = CreateRoadFromSpline::new(
            "road-1",
            straight_spline(),
            RoadTemplate::single_lane(),
            SplineOutputMode::Classify,
        );

        assert_operation_failed(command.execute(&project), "already exists");
    }

    #[test]
    fn test_set_road_elevation_execute_replaces_profile() {
        let original = project_with_road();
        let command = SetRoadElevation::new(
            "road-1",
            original.roads[0].elevation_profile.clone(),
            vec![elevation(0.0, 5.0), elevation(10.0, 7.0)],
        );

        let result = command.execute(&original).unwrap();

        assert_eq!(result.roads[0].elevation_profile.len(), 2);
        assert_close(result.roads[0].elevation_profile[0].a, 5.0);
        assert_close(result.roads[0].elevation_profile[1].a, 7.0);
    }

    #[test]
    fn test_set_road_elevation_undo_restores_original_project() {
        let original = project_with_road();
        let command = SetRoadElevation::new(
            "road-1",
            original.roads[0].elevation_profile.clone(),
            vec![elevation(0.0, 5.0)],
        );
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_set_road_elevation_execute_missing_road_returns_error() {
        let project = project_with_road();
        let command = SetRoadElevation::new("missing-road", vec![], vec![elevation(0.0, 5.0)]);

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_set_road_link_execute_updates_link() {
        let original = project_with_road();
        let command = SetRoadLink::new(
            "road-1",
            original.roads[0].link.clone(),
            Some(RoadLink {
                predecessor: Some(LinkElement {
                    element_type: LinkElementType::Road,
                    element_id: "road-prev-2".into(),
                    contact_point: Some(ContactPoint::End),
                }),
                successor: Some(LinkElement {
                    element_type: LinkElementType::Junction,
                    element_id: "junction-1".into(),
                    contact_point: Some(ContactPoint::Start),
                }),
            }),
        );

        let result = command.execute(&original).unwrap();
        let link = result.roads[0].link.as_ref().unwrap();

        assert_eq!(link.successor.as_ref().unwrap().element_id, "junction-1");
    }

    #[test]
    fn test_set_road_link_undo_restores_original_project() {
        let original = project_with_road();
        let command = SetRoadLink::new(
            "road-1",
            original.roads[0].link.clone(),
            Some(RoadLink {
                predecessor: None,
                successor: Some(LinkElement {
                    element_type: LinkElementType::Road,
                    element_id: "road-next".into(),
                    contact_point: Some(ContactPoint::Start),
                }),
            }),
        );
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_set_road_link_execute_missing_road_returns_error() {
        let project = project_with_road();
        let command = SetRoadLink::new("missing-road", None, Some(road_link("road-next")));

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_translate_road_execute_moves_geometry_and_elevation() {
        let original = project_with_road();
        let command = TranslateRoad::new("road-1", 3.0, -4.0, 2.0);

        let result = command.execute(&original).unwrap();

        assert_close(result.roads[0].plan_view[0].x, 4.0);
        assert_close(result.roads[0].plan_view[0].y, -2.0);
        assert_close(result.roads[0].elevation_profile[0].a, 3.0);
    }

    #[test]
    fn test_translate_road_undo_restores_original_project() {
        let original = project_with_road();
        let command = TranslateRoad::new("road-1", 3.0, -4.0, 2.0);
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();

        assert_projects_equal(&undone, &original);
    }

    #[test]
    fn test_translate_road_execute_missing_road_returns_error() {
        let project = project_with_road();
        let command = TranslateRoad::new("missing-road", 1.0, 2.0, 3.0);

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_rotate_road_execute_rotates_geometry() {
        let mut road = Road::from_centerline("road-1", vec![line_geometry(1.0, 0.0, 0.0, 10.0)]);
        road.name = "Rotate Me".into();
        let project = Project {
            roads: vec![road],
            ..Default::default()
        };
        let command = RotateRoad::new("road-1", [0.0, 0.0], FRAC_PI_2);

        let result = command.execute(&project).unwrap();
        let geometry = &result.roads[0].plan_view[0];

        assert!(geometry.x.abs() < 1e-9);
        assert_close(geometry.y, 1.0);
        assert_close(geometry.hdg, FRAC_PI_2);
    }

    #[test]
    fn test_rotate_road_undo_restores_original_state() {
        let original = Project {
            roads: vec![Road::from_centerline(
                "road-1",
                vec![line_geometry(1.0, 0.0, 0.0, 10.0)],
            )],
            ..Default::default()
        };
        let command = RotateRoad::new("road-1", [0.0, 0.0], FRAC_PI_2);
        let modified = command.execute(&original).unwrap();

        let undone = command.undo(&modified).unwrap();
        let geometry = &undone.roads[0].plan_view[0];

        assert_close(geometry.x, 1.0);
        assert!(geometry.y.abs() < 1e-9);
        assert_close(geometry.hdg, 0.0);
    }

    #[test]
    fn test_rotate_road_execute_missing_road_returns_error() {
        let project = project_with_road();
        let command = RotateRoad::new("missing-road", [0.0, 0.0], FRAC_PI_2);

        assert_operation_failed(command.execute(&project), "not found");
    }

    // ── Bridge / Tunnel command tests ──────────────────────────────────────

    fn project_with_bridge() -> Project {
        let mut road = sample_road("road-1");
        road.bridges.push(we_core::model::Bridge {
            id: "bridge-1".into(),
            s: 1.0,
            length: 5.0,
            bridge_type: "concrete".into(),
        });
        Project {
            roads: vec![road],
            ..Default::default()
        }
    }

    fn project_with_tunnel() -> Project {
        let mut road = sample_road("road-1");
        road.tunnels.push(we_core::model::Tunnel {
            id: "tunnel-1".into(),
            s: 2.0,
            length: 8.0,
            tunnel_type: "standard".into(),
        });
        Project {
            roads: vec![road],
            ..Default::default()
        }
    }

    #[test]
    fn test_update_bridge_execute_changes_fields() {
        let project = project_with_bridge();
        let command = UpdateBridge::new(
            "road-1", "bridge-1", 1.0, 5.0, "concrete", 3.0, 10.0, "steel",
        );

        let result = command.execute(&project).unwrap();

        let bridge = &result.roads[0].bridges[0];
        assert_close(bridge.s, 3.0);
        assert_close(bridge.length, 10.0);
        assert_eq!(bridge.bridge_type, "steel");
    }

    #[test]
    fn test_update_bridge_undo_restores_original_fields() {
        let project = project_with_bridge();
        let command = UpdateBridge::new(
            "road-1", "bridge-1", 1.0, 5.0, "concrete", 3.0, 10.0, "steel",
        );
        let modified = command.execute(&project).unwrap();

        let undone = command.undo(&modified).unwrap();

        let bridge = &undone.roads[0].bridges[0];
        assert_close(bridge.s, 1.0);
        assert_close(bridge.length, 5.0);
        assert_eq!(bridge.bridge_type, "concrete");
    }

    #[test]
    fn test_update_bridge_execute_missing_road_returns_error() {
        let project = project_with_bridge();
        let command = UpdateBridge::new(
            "missing", "bridge-1", 1.0, 5.0, "concrete", 3.0, 10.0, "steel",
        );

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_update_bridge_execute_missing_bridge_returns_error() {
        let project = project_with_bridge();
        let command = UpdateBridge::new(
            "road-1",
            "no-such-bridge",
            1.0,
            5.0,
            "concrete",
            3.0,
            10.0,
            "steel",
        );

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_delete_bridge_execute_removes_bridge() {
        let project = project_with_bridge();
        assert_eq!(project.roads[0].bridges.len(), 1);

        let command =
            DeleteBridge::with_snapshot("road-1", "bridge-1", project.roads[0].bridges[0].clone());
        let result = command.execute(&project).unwrap();

        assert_eq!(result.roads[0].bridges.len(), 0);
    }

    #[test]
    fn test_delete_bridge_undo_restores_bridge() {
        let project = project_with_bridge();
        let command =
            DeleteBridge::with_snapshot("road-1", "bridge-1", project.roads[0].bridges[0].clone());
        let modified = command.execute(&project).unwrap();
        assert_eq!(modified.roads[0].bridges.len(), 0);

        let undone = command.undo(&modified).unwrap();

        assert_eq!(undone.roads[0].bridges.len(), 1);
        assert_eq!(undone.roads[0].bridges[0].id, "bridge-1");
    }

    #[test]
    fn test_update_tunnel_execute_changes_fields() {
        let project = project_with_tunnel();
        let command = UpdateTunnel::new(
            "road-1",
            "tunnel-1",
            2.0,
            8.0,
            "standard",
            4.0,
            12.0,
            "underpass",
        );

        let result = command.execute(&project).unwrap();

        let tunnel = &result.roads[0].tunnels[0];
        assert_close(tunnel.s, 4.0);
        assert_close(tunnel.length, 12.0);
        assert_eq!(tunnel.tunnel_type, "underpass");
    }

    #[test]
    fn test_update_tunnel_undo_restores_original_fields() {
        let project = project_with_tunnel();
        let command = UpdateTunnel::new(
            "road-1",
            "tunnel-1",
            2.0,
            8.0,
            "standard",
            4.0,
            12.0,
            "underpass",
        );
        let modified = command.execute(&project).unwrap();

        let undone = command.undo(&modified).unwrap();

        let tunnel = &undone.roads[0].tunnels[0];
        assert_close(tunnel.s, 2.0);
        assert_close(tunnel.length, 8.0);
        assert_eq!(tunnel.tunnel_type, "standard");
    }

    #[test]
    fn test_update_tunnel_execute_missing_road_returns_error() {
        let project = project_with_tunnel();
        let command = UpdateTunnel::new(
            "missing",
            "tunnel-1",
            2.0,
            8.0,
            "standard",
            4.0,
            12.0,
            "underpass",
        );

        assert_operation_failed(command.execute(&project), "not found");
    }

    #[test]
    fn test_delete_tunnel_execute_removes_tunnel() {
        let project = project_with_tunnel();
        assert_eq!(project.roads[0].tunnels.len(), 1);

        let command =
            DeleteTunnel::with_snapshot("road-1", "tunnel-1", project.roads[0].tunnels[0].clone());
        let result = command.execute(&project).unwrap();

        assert_eq!(result.roads[0].tunnels.len(), 0);
    }

    #[test]
    fn test_delete_tunnel_undo_restores_tunnel() {
        let project = project_with_tunnel();
        let command =
            DeleteTunnel::with_snapshot("road-1", "tunnel-1", project.roads[0].tunnels[0].clone());
        let modified = command.execute(&project).unwrap();
        assert_eq!(modified.roads[0].tunnels.len(), 0);

        let undone = command.undo(&modified).unwrap();

        assert_eq!(undone.roads[0].tunnels.len(), 1);
        assert_eq!(undone.roads[0].tunnels[0].id, "tunnel-1");
    }
}
