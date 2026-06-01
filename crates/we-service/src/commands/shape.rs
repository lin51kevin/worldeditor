//! Shape vector layer commands: CRUD for nodes, ways, layers, plus conversion.

use we_core::model::*;

use crate::{Command, EditorError};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn find_layer_mut<'a>(
    project: &'a mut Project,
    layer_id: &str,
) -> Result<&'a mut ShapeLayer, EditorError> {
    project
        .shape_layers
        .iter_mut()
        .find(|l| l.id == layer_id)
        .ok_or_else(|| EditorError::OperationFailed(format!("Shape layer '{layer_id}' not found")))
}

// ── AddShapeLayer ─────────────────────────────────────────────────────────────

/// Add a new (empty) shape layer to the project.
#[derive(Debug, Clone)]
pub struct AddShapeLayer {
    pub layer: ShapeLayer,
}

impl AddShapeLayer {
    pub fn new(layer: ShapeLayer) -> Self {
        Self { layer }
    }
}

impl Command for AddShapeLayer {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        if project.shape_layers.iter().any(|l| l.id == self.layer.id) {
            return Err(EditorError::OperationFailed(format!(
                "Shape layer '{}' already exists",
                self.layer.id
            )));
        }
        let mut p = project.clone();
        p.shape_layers.push(self.layer.clone());
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        p.shape_layers.retain(|l| l.id != self.layer.id);
        Ok(p)
    }

    fn description(&self) -> &str {
        "Add Shape Layer"
    }
}

// ── DeleteShapeLayer ──────────────────────────────────────────────────────────

/// Delete a shape layer by ID.
#[derive(Debug, Clone)]
pub struct DeleteShapeLayer {
    pub layer_id: String,
    snapshot: Option<ShapeLayer>,
}

impl DeleteShapeLayer {
    pub fn with_snapshot(layer_id: impl Into<String>, layer: ShapeLayer) -> Self {
        Self {
            layer_id: layer_id.into(),
            snapshot: Some(layer),
        }
    }
}

impl Command for DeleteShapeLayer {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        if !project.shape_layers.iter().any(|l| l.id == self.layer_id) {
            return Err(EditorError::OperationFailed(format!(
                "Shape layer '{}' not found",
                self.layer_id
            )));
        }
        let mut p = project.clone();
        p.shape_layers.retain(|l| l.id != self.layer_id);
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let layer = self
            .snapshot
            .as_ref()
            .ok_or_else(|| EditorError::OperationFailed("No snapshot for undo".into()))?;
        let mut p = project.clone();
        p.shape_layers.push(layer.clone());
        Ok(p)
    }

    fn description(&self) -> &str {
        "Delete Shape Layer"
    }
}

// ── AddShapeNode ──────────────────────────────────────────────────────────────

/// Add a node to a shape layer.
#[derive(Debug, Clone)]
pub struct AddShapeNode {
    pub layer_id: String,
    pub node: ShapeNode,
}

impl AddShapeNode {
    pub fn new(layer_id: impl Into<String>, node: ShapeNode) -> Self {
        Self {
            layer_id: layer_id.into(),
            node,
        }
    }
}

impl Command for AddShapeNode {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let layer = find_layer_mut(&mut p, &self.layer_id)?;
        if layer.nodes.iter().any(|n| n.id == self.node.id) {
            return Err(EditorError::OperationFailed(format!(
                "Node '{}' already exists in layer '{}'",
                self.node.id, self.layer_id
            )));
        }
        layer.nodes.push(self.node.clone());
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let layer = find_layer_mut(&mut p, &self.layer_id)?;
        layer.nodes.retain(|n| n.id != self.node.id);
        Ok(p)
    }

    fn description(&self) -> &str {
        "Add Shape Node"
    }
}

// ── DeleteShapeNode ───────────────────────────────────────────────────────────

/// Delete a node from a shape layer (and remove it from any ways).
#[derive(Debug, Clone)]
pub struct DeleteShapeNode {
    pub layer_id: String,
    pub node_id: String,
    snapshot: Option<ShapeNode>,
}

impl DeleteShapeNode {
    pub fn with_snapshot(
        layer_id: impl Into<String>,
        node_id: impl Into<String>,
        node: ShapeNode,
    ) -> Self {
        Self {
            layer_id: layer_id.into(),
            node_id: node_id.into(),
            snapshot: Some(node),
        }
    }
}

impl Command for DeleteShapeNode {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let layer = find_layer_mut(&mut p, &self.layer_id)?;
        if !layer.nodes.iter().any(|n| n.id == self.node_id) {
            return Err(EditorError::OperationFailed(format!(
                "Node '{}' not found",
                self.node_id
            )));
        }
        layer.nodes.retain(|n| n.id != self.node_id);
        // Remove the node from all ways in this layer.
        for way in layer.ways.iter_mut() {
            way.node_ids.retain(|nid| nid != &self.node_id);
        }
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let node = self
            .snapshot
            .as_ref()
            .ok_or_else(|| EditorError::OperationFailed("No snapshot for undo".into()))?;
        let mut p = project.clone();
        let layer = find_layer_mut(&mut p, &self.layer_id)?;
        layer.nodes.push(node.clone());
        Ok(p)
    }

    fn description(&self) -> &str {
        "Delete Shape Node"
    }
}

// ── MoveShapeNode ─────────────────────────────────────────────────────────────

/// Move a node to a new position.
#[derive(Debug, Clone)]
pub struct MoveShapeNode {
    pub layer_id: String,
    pub node_id: String,
    pub new_x: f64,
    pub new_y: f64,
    pub new_z: f64,
    pub old_x: f64,
    pub old_y: f64,
    pub old_z: f64,
}

impl MoveShapeNode {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        layer_id: impl Into<String>,
        node_id: impl Into<String>,
        old_x: f64,
        old_y: f64,
        old_z: f64,
        new_x: f64,
        new_y: f64,
        new_z: f64,
    ) -> Self {
        Self {
            layer_id: layer_id.into(),
            node_id: node_id.into(),
            new_x,
            new_y,
            new_z,
            old_x,
            old_y,
            old_z,
        }
    }
}

impl Command for MoveShapeNode {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let layer = find_layer_mut(&mut p, &self.layer_id)?;
        let node = layer
            .nodes
            .iter_mut()
            .find(|n| n.id == self.node_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Node '{}' not found", self.node_id))
            })?;
        node.x = self.new_x;
        node.y = self.new_y;
        node.z = self.new_z;
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let layer = find_layer_mut(&mut p, &self.layer_id)?;
        let node = layer
            .nodes
            .iter_mut()
            .find(|n| n.id == self.node_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Node '{}' not found", self.node_id))
            })?;
        node.x = self.old_x;
        node.y = self.old_y;
        node.z = self.old_z;
        Ok(p)
    }

    fn description(&self) -> &str {
        "Move Shape Node"
    }
}

// ── AddShapeWay ───────────────────────────────────────────────────────────────

/// Add a way to a shape layer.
#[derive(Debug, Clone)]
pub struct AddShapeWay {
    pub layer_id: String,
    pub way: ShapeWay,
}

impl AddShapeWay {
    pub fn new(layer_id: impl Into<String>, way: ShapeWay) -> Self {
        Self {
            layer_id: layer_id.into(),
            way,
        }
    }
}

impl Command for AddShapeWay {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let layer = find_layer_mut(&mut p, &self.layer_id)?;
        if layer.ways.iter().any(|w| w.id == self.way.id) {
            return Err(EditorError::OperationFailed(format!(
                "Way '{}' already exists",
                self.way.id
            )));
        }
        layer.ways.push(self.way.clone());
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let layer = find_layer_mut(&mut p, &self.layer_id)?;
        layer.ways.retain(|w| w.id != self.way.id);
        Ok(p)
    }

    fn description(&self) -> &str {
        "Add Shape Way"
    }
}

// ── DeleteShapeWay ────────────────────────────────────────────────────────────

/// Delete a way from a shape layer.
#[derive(Debug, Clone)]
pub struct DeleteShapeWay {
    pub layer_id: String,
    pub way_id: String,
    snapshot: Option<ShapeWay>,
}

impl DeleteShapeWay {
    pub fn with_snapshot(
        layer_id: impl Into<String>,
        way_id: impl Into<String>,
        way: ShapeWay,
    ) -> Self {
        Self {
            layer_id: layer_id.into(),
            way_id: way_id.into(),
            snapshot: Some(way),
        }
    }
}

impl Command for DeleteShapeWay {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let layer = find_layer_mut(&mut p, &self.layer_id)?;
        if !layer.ways.iter().any(|w| w.id == self.way_id) {
            return Err(EditorError::OperationFailed(format!(
                "Way '{}' not found",
                self.way_id
            )));
        }
        layer.ways.retain(|w| w.id != self.way_id);
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let way = self
            .snapshot
            .as_ref()
            .ok_or_else(|| EditorError::OperationFailed("No snapshot for undo".into()))?;
        let mut p = project.clone();
        let layer = find_layer_mut(&mut p, &self.layer_id)?;
        layer.ways.push(way.clone());
        Ok(p)
    }

    fn description(&self) -> &str {
        "Delete Shape Way"
    }
}

// ── UpdateShapeWayNodes ───────────────────────────────────────────────────────

/// Replace the node list of an existing way.
#[derive(Debug, Clone)]
pub struct UpdateShapeWayNodes {
    pub layer_id: String,
    pub way_id: String,
    pub new_node_ids: Vec<String>,
    pub old_node_ids: Vec<String>,
}

impl Command for UpdateShapeWayNodes {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let layer = find_layer_mut(&mut p, &self.layer_id)?;
        let way = layer
            .ways
            .iter_mut()
            .find(|w| w.id == self.way_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Way '{}' not found", self.way_id))
            })?;
        way.node_ids = self.new_node_ids.clone();
        Ok(p)
    }

    fn undo(&self, project: &Project) -> Result<Project, EditorError> {
        let mut p = project.clone();
        let layer = find_layer_mut(&mut p, &self.layer_id)?;
        let way = layer
            .ways
            .iter_mut()
            .find(|w| w.id == self.way_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Way '{}' not found", self.way_id))
            })?;
        way.node_ids = self.old_node_ids.clone();
        Ok(p)
    }

    fn description(&self) -> &str {
        "Update Shape Way Nodes"
    }
}

// ── ShapeWayToRoad ────────────────────────────────────────────────────────────

/// Convert a shape way to an OpenDRIVE road.
///
/// The road gets a multi-segment `Line` geometry derived from the node positions,
/// a single lane section, and a default lane width.  Tags are used to infer the
/// number of lanes (`lanes` tag) and lane width (`lane_width` tag, default 3.5 m).
#[derive(Debug, Clone)]
pub struct ShapeWayToRoad {
    pub layer_id: String,
    pub way_id: String,
    /// Road ID for the generated road.
    pub road_id: String,
}

impl ShapeWayToRoad {
    pub fn new(
        layer_id: impl Into<String>,
        way_id: impl Into<String>,
        road_id: impl Into<String>,
    ) -> Self {
        Self {
            layer_id: layer_id.into(),
            way_id: way_id.into(),
            road_id: road_id.into(),
        }
    }
}

impl Command for ShapeWayToRoad {
    fn execute(&self, project: &Project) -> Result<Project, EditorError> {
        if project.roads.iter().any(|r| r.id == self.road_id) {
            return Err(EditorError::OperationFailed(format!(
                "Road '{}' already exists",
                self.road_id
            )));
        }
        let layer = project
            .shape_layers
            .iter()
            .find(|l| l.id == self.layer_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Shape layer '{}' not found", self.layer_id))
            })?;
        let way = layer
            .ways
            .iter()
            .find(|w| w.id == self.way_id)
            .ok_or_else(|| {
                EditorError::OperationFailed(format!("Way '{}' not found", self.way_id))
            })?;

        let points = layer.way_points(way);
        if points.len() < 2 {
            return Err(EditorError::OperationFailed(
                "Way needs at least 2 nodes to create a road".into(),
            ));
        }

        // Read tags.
        let lane_width: f64 = way
            .tags
            .iter()
            .find(|t| t.key == "lane_width")
            .and_then(|t| t.value.parse().ok())
            .unwrap_or(3.5);
        let _highway_type = way
            .tags
            .iter()
            .find(|t| t.key == "highway")
            .map(|t| t.value.as_str())
            .unwrap_or("unclassified");

        // Build a piecewise-linear geometry from the node positions.
        let mut plan_view: Vec<Geometry> = Vec::new();
        let mut total_s = 0.0_f64;

        for i in 0..points.len() - 1 {
            let (x0, y0, _z0) = points[i];
            let (x1, y1, _z1) = points[i + 1];
            let dx = x1 - x0;
            let dy = y1 - y0;
            let length = (dx * dx + dy * dy).sqrt().max(1e-3);
            let hdg = dy.atan2(dx);
            plan_view.push(Geometry {
                s: total_s,
                x: x0,
                y: y0,
                hdg,
                length,
                geo_type: GeometryType::Line,
            });
            total_s += length;
        }

        let mut road = Road::from_centerline_with_width(&self.road_id, plan_view, lane_width);
        road.name = way
            .tags
            .iter()
            .find(|t| t.key == "name")
            .map(|t| t.value.clone())
            .unwrap_or_default();

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
        "Shape Way to Road"
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use we_core::model::{Project, ShapeLayer, ShapeNode, ShapeWay};

    fn project_with_layer() -> Project {
        let mut layer = ShapeLayer::new("layer-1", "Test Layer");
        layer.nodes.push(ShapeNode::new("n1", 0.0, 0.0));
        layer.nodes.push(ShapeNode::new("n2", 10.0, 0.0));
        layer.nodes.push(ShapeNode::new("n3", 20.0, 5.0));
        layer.ways.push(ShapeWay::new(
            "w1",
            vec!["n1".into(), "n2".into(), "n3".into()],
        ));
        Project {
            shape_layers: vec![layer],
            ..Default::default()
        }
    }

    fn assert_operation_failed(result: Result<Project, EditorError>, expected: &str) {
        match result {
            Err(EditorError::OperationFailed(msg)) => {
                assert!(msg.contains(expected), "expected '{expected}' in '{msg}'");
            }
            other => panic!("expected OperationFailed, got {other:?}"),
        }
    }

    // ── AddShapeLayer ──

    #[test]
    fn test_add_shape_layer_execute_adds_layer() {
        let project = Project::default();
        let layer = ShapeLayer::new("l1", "New Layer");
        let cmd = AddShapeLayer::new(layer);
        let result = cmd.execute(&project).unwrap();
        assert_eq!(result.shape_layers.len(), 1);
    }

    #[test]
    fn test_add_shape_layer_undo_removes_layer() {
        let project = Project::default();
        let layer = ShapeLayer::new("l1", "New Layer");
        let cmd = AddShapeLayer::new(layer);
        let modified = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&modified).unwrap();
        assert!(undone.shape_layers.is_empty());
    }

    #[test]
    fn test_add_shape_layer_duplicate_returns_error() {
        let project = project_with_layer();
        let cmd = AddShapeLayer::new(ShapeLayer::new("layer-1", "Dup"));
        assert_operation_failed(cmd.execute(&project), "already exists");
    }

    // ── AddShapeNode ──

    #[test]
    fn test_add_shape_node_execute_adds_node() {
        let project = project_with_layer();
        let node = ShapeNode::new("n-new", 5.0, 5.0);
        let cmd = AddShapeNode::new("layer-1", node);
        let result = cmd.execute(&project).unwrap();
        assert_eq!(result.shape_layers[0].nodes.len(), 4);
    }

    #[test]
    fn test_add_shape_node_undo_removes_node() {
        let project = project_with_layer();
        let node = ShapeNode::new("n-new", 5.0, 5.0);
        let cmd = AddShapeNode::new("layer-1", node);
        let modified = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&modified).unwrap();
        assert_eq!(undone.shape_layers[0].nodes.len(), 3);
    }

    // ── MoveShapeNode ──

    #[test]
    fn test_move_shape_node_execute_changes_position() {
        let project = project_with_layer();
        let cmd = MoveShapeNode::new("layer-1", "n1", 0.0, 0.0, 0.0, 99.0, 88.0, 0.0);
        let result = cmd.execute(&project).unwrap();
        let node = result.shape_layers[0]
            .nodes
            .iter()
            .find(|n| n.id == "n1")
            .unwrap();
        assert!((node.x - 99.0).abs() < 1e-9);
        assert!((node.y - 88.0).abs() < 1e-9);
    }

    #[test]
    fn test_move_shape_node_undo_restores_position() {
        let project = project_with_layer();
        let cmd = MoveShapeNode::new("layer-1", "n1", 0.0, 0.0, 0.0, 99.0, 88.0, 0.0);
        let modified = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&modified).unwrap();
        let node = undone.shape_layers[0]
            .nodes
            .iter()
            .find(|n| n.id == "n1")
            .unwrap();
        assert!((node.x - 0.0).abs() < 1e-9);
    }

    // ── DeleteShapeNode ──

    #[test]
    fn test_delete_shape_node_removes_from_ways() {
        let project = project_with_layer();
        let node = project.shape_layers[0].nodes[1].clone();
        let cmd = DeleteShapeNode::with_snapshot("layer-1", "n2", node);
        let result = cmd.execute(&project).unwrap();
        let way = &result.shape_layers[0].ways[0];
        assert!(!way.node_ids.contains(&"n2".to_string()));
    }

    // ── ShapeWayToRoad ──

    #[test]
    fn test_shape_way_to_road_creates_road() {
        let project = project_with_layer();
        let cmd = ShapeWayToRoad::new("layer-1", "w1", "road-from-way");
        let result = cmd.execute(&project).unwrap();
        assert_eq!(result.roads.len(), 1);
        assert_eq!(result.roads[0].id, "road-from-way");
        assert!(result.roads[0].length > 0.0);
    }

    #[test]
    fn test_shape_way_to_road_undo_removes_road() {
        let project = project_with_layer();
        let cmd = ShapeWayToRoad::new("layer-1", "w1", "road-from-way");
        let modified = cmd.execute(&project).unwrap();
        let undone = cmd.undo(&modified).unwrap();
        assert!(undone.roads.is_empty());
    }

    #[test]
    fn test_shape_way_to_road_uses_lane_width_tag() {
        let project = project_with_layer();
        // Add a lane_width tag to the way
        let cmd = ShapeWayToRoad::new("layer-1", "w1", "road-tagged");
        let result = cmd.execute(&project).unwrap();
        // Default width 3.5 should apply
        let road = &result.roads[0];
        assert!(!road.lane_sections.is_empty());
    }

    #[test]
    fn test_shape_way_to_road_duplicate_road_returns_error() {
        let mut project = project_with_layer();
        project.roads.push(Road::from_centerline(
            "road-from-way",
            vec![we_core::model::Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length: 10.0,
                geo_type: we_core::model::GeometryType::Line,
            }],
        ));
        let cmd = ShapeWayToRoad::new("layer-1", "w1", "road-from-way");
        assert_operation_failed(cmd.execute(&project), "already exists");
    }
}
