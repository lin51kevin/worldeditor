//! Shape vector layer model (Node / Way / Relation).
//!
//! Provides an OSM-inspired editing layer where users can place point nodes,
//! connect them into ways (polylines), and group ways into relations before
//! converting shapes to OpenDRIVE road geometry.

use serde::{Deserialize, Serialize};

// ── ShapeTag ─────────────────────────────────────────────────────────────────

/// A key–value tag attached to a shape element.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ShapeTag {
    pub key: String,
    pub value: String,
}

impl ShapeTag {
    pub fn new(key: impl Into<String>, value: impl Into<String>) -> Self {
        Self { key: key.into(), value: value.into() }
    }
}

// ── ShapeNode ─────────────────────────────────────────────────────────────────

/// A 2D/3D point node in a shape layer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShapeNode {
    pub id: String,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub z: f64,
    #[serde(default)]
    pub tags: Vec<ShapeTag>,
}

impl ShapeNode {
    pub fn new(id: impl Into<String>, x: f64, y: f64) -> Self {
        Self { id: id.into(), x, y, z: 0.0, tags: vec![] }
    }

    pub fn with_z(mut self, z: f64) -> Self {
        self.z = z;
        self
    }
}

// ── ShapeWay ──────────────────────────────────────────────────────────────────

/// An ordered sequence of [`ShapeNode`] IDs forming a polyline or polygon.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShapeWay {
    pub id: String,
    /// Ordered list of node IDs this way passes through.
    pub node_ids: Vec<String>,
    #[serde(default)]
    pub tags: Vec<ShapeTag>,
}

impl ShapeWay {
    pub fn new(id: impl Into<String>, node_ids: Vec<String>) -> Self {
        Self { id: id.into(), node_ids, tags: vec![] }
    }

    /// Return `true` if the way forms a closed loop (first == last node ID).
    pub fn is_closed(&self) -> bool {
        self.node_ids.len() >= 3
            && self.node_ids.first() == self.node_ids.last()
    }
}

// ── ShapeRelation ─────────────────────────────────────────────────────────────

/// A typed group of nodes and ways (e.g. turn restrictions, junctions).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShapeRelationMember {
    pub member_id: String,
    /// `"node"` or `"way"`.
    pub member_type: String,
    /// Semantic role (e.g. `"outer"`, `"inner"`, `"via"`, `"from"`, `"to"`).
    #[serde(default)]
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShapeRelation {
    pub id: String,
    #[serde(default)]
    pub members: Vec<ShapeRelationMember>,
    #[serde(default)]
    pub tags: Vec<ShapeTag>,
}

// ── ShapeLayer ────────────────────────────────────────────────────────────────

/// A named layer containing nodes, ways, and relations.
///
/// Projects may have multiple layers (e.g. one for roads, one for sidewalks,
/// one imported from an OSM/shapefile source).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShapeLayer {
    pub id: String,
    pub name: String,
    #[serde(default = "bool_true")]
    pub visible: bool,
    #[serde(default)]
    pub nodes: Vec<ShapeNode>,
    #[serde(default)]
    pub ways: Vec<ShapeWay>,
    #[serde(default)]
    pub relations: Vec<ShapeRelation>,
}

fn bool_true() -> bool {
    true
}

impl ShapeLayer {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            visible: true,
            nodes: vec![],
            ways: vec![],
            relations: vec![],
        }
    }

    /// Look up a node by ID.
    pub fn node(&self, id: &str) -> Option<&ShapeNode> {
        self.nodes.iter().find(|n| n.id == id)
    }

    /// Resolve ordered node positions for a way (skips missing nodes).
    pub fn way_points(&self, way: &ShapeWay) -> Vec<(f64, f64, f64)> {
        way.node_ids
            .iter()
            .filter_map(|nid| self.node(nid))
            .map(|n| (n.x, n.y, n.z))
            .collect()
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shape_way_is_closed() {
        let way = ShapeWay::new("w1", vec!["n1".into(), "n2".into(), "n3".into(), "n1".into()]);
        assert!(way.is_closed());
    }

    #[test]
    fn test_shape_way_not_closed() {
        let way = ShapeWay::new("w1", vec!["n1".into(), "n2".into(), "n3".into()]);
        assert!(!way.is_closed());
    }

    #[test]
    fn test_layer_way_points_resolves_nodes() {
        let mut layer = ShapeLayer::new("l1", "Test");
        layer.nodes.push(ShapeNode::new("n1", 0.0, 0.0));
        layer.nodes.push(ShapeNode::new("n2", 10.0, 0.0));
        let way = ShapeWay::new("w1", vec!["n1".into(), "n2".into()]);
        let pts = layer.way_points(&way);
        assert_eq!(pts.len(), 2);
        assert!((pts[0].0 - 0.0).abs() < 1e-9);
        assert!((pts[1].0 - 10.0).abs() < 1e-9);
    }

    #[test]
    fn test_shape_layer_serde_round_trip() {
        let mut layer = ShapeLayer::new("l1", "Test");
        layer.nodes.push(ShapeNode::new("n1", 1.0, 2.0));
        let json = serde_json::to_string(&layer).unwrap();
        let decoded: ShapeLayer = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.nodes.len(), 1);
        assert_eq!(decoded.nodes[0].id, "n1");
    }
}
