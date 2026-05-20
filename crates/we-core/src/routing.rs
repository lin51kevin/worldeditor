//! Route and path planning on the road network.
//!
//! Implements Dijkstra's shortest-path algorithm for finding routes between
//! road nodes. Nodes are road endpoints (start/end); edges are road segments
//! weighted by length.

use crate::model::{ContactPoint, Project};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};

/// A node in the routing graph — one end of a road.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct RouteNode {
    /// Road ID.
    pub road_id: String,
    /// Which end of the road (Start = s=0, End = s=length).
    pub contact: ContactPoint,
}

impl RouteNode {
    pub fn new(road_id: impl Into<String>, contact: ContactPoint) -> Self {
        Self {
            road_id: road_id.into(),
            contact,
        }
    }
}

/// An edge in the routing graph.
#[derive(Debug, Clone)]
pub struct RouteEdge {
    pub from: RouteNode,
    pub to: RouteNode,
    /// Edge weight (typically road length in metres).
    pub weight: f64,
}

/// A computed route from source to destination.
#[derive(Debug, Clone)]
pub struct Route {
    /// Sequence of road IDs on the path (in travel order).
    pub road_ids: Vec<String>,
    /// Total path length (m).
    pub total_length: f64,
}

impl Route {
    /// Returns `true` if the route is empty.
    pub fn is_empty(&self) -> bool {
        self.road_ids.is_empty()
    }

    /// Number of road segments on the route.
    pub fn len(&self) -> usize {
        self.road_ids.len()
    }
}

/// Build a routing graph from a project.
///
/// Edges are created from road predecessor/successor links
/// (roads connected via their `link` field).
pub fn build_routing_graph(project: &Project) -> Vec<RouteEdge> {
    let mut edges = Vec::new();

    // Map road ID → road for quick lookup
    let road_map: HashMap<&str, &crate::model::Road> =
        project.roads.iter().map(|r| (r.id.as_str(), r)).collect();

    for road in &project.roads {
        let from_end = RouteNode::new(&road.id, ContactPoint::End);
        let from_start = RouteNode::new(&road.id, ContactPoint::Start);

        // Successor link
        if let Some(link) = &road.link {
            if let Some(succ) = &link.successor
                && road_map.contains_key(succ.element_id.as_str())
            {
                let contact = succ.contact_point.unwrap_or(ContactPoint::Start);
                edges.push(RouteEdge {
                    from: from_end.clone(),
                    to: RouteNode::new(&succ.element_id, contact),
                    weight: road.length,
                });
            }
            // Predecessor link
            if let Some(pred) = &link.predecessor
                && road_map.contains_key(pred.element_id.as_str())
            {
                let contact = pred.contact_point.unwrap_or(ContactPoint::End);
                edges.push(RouteEdge {
                    from: from_start.clone(),
                    to: RouteNode::new(&pred.element_id, contact),
                    weight: road.length,
                });
            }
        }
    }

    edges
}

/// Run Dijkstra's algorithm on a routing graph.
///
/// Returns the shortest [`Route`] from `source` to `target`, or `None`
/// if no path exists.
pub fn find_shortest_route(
    edges: &[RouteEdge],
    source: &RouteNode,
    target: &RouteNode,
) -> Option<Route> {
    // Build adjacency list
    let mut adj: HashMap<&RouteNode, Vec<(&RouteNode, f64)>> = HashMap::new();
    for edge in edges {
        adj.entry(&edge.from)
            .or_default()
            .push((&edge.to, edge.weight));
    }

    // Dijkstra
    let mut dist: HashMap<&RouteNode, f64> = HashMap::new();
    let mut prev: HashMap<&RouteNode, &RouteNode> = HashMap::new();
    let mut heap: BinaryHeap<(Reverse<i64>, &RouteNode)> = BinaryHeap::new();

    dist.insert(source, 0.0);
    heap.push((Reverse(0), source));

    while let Some((Reverse(cost_i64), node)) = heap.pop() {
        let cost = cost_i64 as f64 / 1000.0; // Convert back from integer key

        if dist.get(node).is_some_and(|&best| cost > best + 1e-9) {
            continue;
        }

        if node == target {
            break;
        }

        if let Some(neighbors) = adj.get(node) {
            for (next, weight) in neighbors {
                let new_cost = cost + weight;
                let is_better = dist.get(next).is_none_or(|&d| new_cost < d - 1e-9);
                if is_better {
                    dist.insert(next, new_cost);
                    prev.insert(next, node);
                    heap.push((Reverse((new_cost * 1000.0) as i64), next));
                }
            }
        }
    }

    // Reconstruct path
    let total_length = *dist.get(target)?;
    let mut path = Vec::new();
    let mut current = target;
    while current != source {
        path.push(current.road_id.clone());
        current = prev.get(current)?;
    }
    path.push(source.road_id.clone());
    path.reverse();

    // Deduplicate consecutive identical road IDs
    let road_ids: Vec<String> = path
        .iter()
        .enumerate()
        .filter(|(i, id)| *i == 0 || *id != &path[i - 1])
        .map(|(_, id)| id.clone())
        .collect();

    Some(Route {
        road_ids,
        total_length,
    })
}

/// Find all routes from a source node up to a maximum depth (hop count).
///
/// Returns a list of `(destination, route)` pairs.
pub fn find_reachable_roads(
    edges: &[RouteEdge],
    source: &RouteNode,
    max_hops: usize,
) -> Vec<(RouteNode, Route)> {
    let mut adj: HashMap<&RouteNode, Vec<(&RouteNode, f64)>> = HashMap::new();
    for edge in edges {
        adj.entry(&edge.from)
            .or_default()
            .push((&edge.to, edge.weight));
    }

    // Use predecessor-based path reconstruction to avoid cloning paths per expansion.
    let mut visited: HashMap<&RouteNode, (f64, Option<&RouteNode>, usize)> = HashMap::new();
    let mut queue: Vec<(&RouteNode, f64, Option<&RouteNode>, usize)> =
        vec![(source, 0.0, None, 0)];

    while let Some((node, cost, prev, depth)) = queue.pop() {
        if depth > max_hops {
            continue;
        }
        if visited.contains_key(node) {
            continue;
        }
        visited.insert(node, (cost, prev, depth));

        if let Some(neighbors) = adj.get(node) {
            for (next, weight) in neighbors {
                if !visited.contains_key(next) {
                    queue.push((next, cost + weight, Some(node), depth + 1));
                }
            }
        }
    }

    // Reconstruct paths from predecessors
    visited
        .iter()
        .filter(|(node, _)| **node != source)
        .map(|(node, (total_length, _, _))| {
            let mut road_ids = Vec::new();
            let mut current: &RouteNode = node;
            road_ids.push(current.road_id.clone());
            while let Some((_, Some(prev), _)) = visited.get(current) {
                current = prev;
                road_ids.push(current.road_id.clone());
            }
            road_ids.reverse();
            // Deduplicate consecutive identical road IDs
            road_ids.dedup();
            (
                (*node).clone(),
                Route {
                    road_ids,
                    total_length: *total_length,
                },
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Geometry, GeometryType, LinkElement, LinkElementType, Road, RoadLink};

    fn make_road_with_link(id: &str, length: f64, succ_id: Option<&str>) -> crate::model::Road {
        let succ = succ_id.map(|s| LinkElement {
            element_id: s.to_string(),
            element_type: LinkElementType::Road,
            contact_point: Some(ContactPoint::Start),
        });

        let mut road = Road::from_centerline(
            id,
            vec![Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length,
                geo_type: GeometryType::Line,
            }],
        );
        road.link = Some(RoadLink {
            predecessor: None,
            successor: succ,
        });
        road
    }

    fn make_chain_project() -> Project {
        // r1 → r2 → r3
        Project {
            name: "chain".to_string(),
            header: Default::default(),
            roads: vec![
                make_road_with_link("r1", 10.0, Some("r2")),
                make_road_with_link("r2", 20.0, Some("r3")),
                make_road_with_link("r3", 15.0, None),
            ],
            junctions: vec![],
            ..Default::default()
        }
    }

    #[test]
    fn test_build_routing_graph_chain() {
        let project = make_chain_project();
        let edges = build_routing_graph(&project);
        assert!(!edges.is_empty(), "Should have edges for connected roads");
    }

    #[test]
    fn test_find_shortest_route_direct() {
        let project = make_chain_project();
        let edges = build_routing_graph(&project);
        let src = RouteNode::new("r1", ContactPoint::End);
        let dst = RouteNode::new("r2", ContactPoint::Start);
        let route = find_shortest_route(&edges, &src, &dst);
        assert!(route.is_some(), "Direct route r1→r2 should exist");
        let r = route.unwrap();
        assert!(r.total_length > 0.0);
    }

    #[test]
    fn test_find_shortest_route_no_path() {
        // Disconnected graph
        let project = Project {
            roads: vec![
                make_road_with_link("r1", 10.0, None),
                make_road_with_link("r2", 10.0, None),
            ],
            ..Default::default()
        };
        let edges = build_routing_graph(&project);
        let src = RouteNode::new("r1", ContactPoint::End);
        let dst = RouteNode::new("r2", ContactPoint::Start);
        let route = find_shortest_route(&edges, &src, &dst);
        assert!(route.is_none(), "No path between disconnected roads");
    }

    #[test]
    fn test_route_len() {
        let r = Route {
            road_ids: vec!["r1".into(), "r2".into()],
            total_length: 30.0,
        };
        assert_eq!(r.len(), 2);
        assert!(!r.is_empty());
    }

    #[test]
    fn test_route_empty() {
        let r = Route {
            road_ids: vec![],
            total_length: 0.0,
        };
        assert!(r.is_empty());
        assert_eq!(r.len(), 0);
    }

    #[test]
    fn test_find_reachable_roads() {
        let project = make_chain_project();
        let edges = build_routing_graph(&project);
        let src = RouteNode::new("r1", ContactPoint::End);
        let reachable = find_reachable_roads(&edges, &src, 3);
        assert!(!reachable.is_empty(), "r1 should reach at least r2");
    }

    #[test]
    fn test_route_node_equality() {
        let n1 = RouteNode::new("r1", ContactPoint::Start);
        let n2 = RouteNode::new("r1", ContactPoint::Start);
        let n3 = RouteNode::new("r1", ContactPoint::End);
        assert_eq!(n1, n2);
        assert_ne!(n1, n3);
    }
}
