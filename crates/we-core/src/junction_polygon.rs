//! Junction polygon builder and triangulator.
//!
//! Constructs a polygon boundary for a junction from its connected road endpoints,
//! then triangulates it using the Delaunay algorithm for rendering and area computation.

use crate::geometry::{convex_hull, triangulate, Triangle};
use crate::model::{Junction, Project};
use nalgebra::Vector2;
use serde::{Deserialize, Serialize};

/// A 2D polygon vertex.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PolyVertex {
    pub x: f64,
    pub y: f64,
}

impl PolyVertex {
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

/// A triangulated junction polygon.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JunctionPolygon {
    /// Junction ID.
    pub junction_id: String,
    /// Convex hull boundary vertices.
    pub boundary: Vec<PolyVertex>,
    /// Triangle indices into `boundary` (if triangulated).
    pub triangles: Vec<[usize; 3]>,
    /// Approximate area in m².
    pub area: f64,
    /// Centroid of the polygon.
    pub centroid: PolyVertex,
}

impl JunctionPolygon {
    /// Returns `true` if the polygon has valid triangulation data.
    pub fn is_triangulated(&self) -> bool {
        !self.triangles.is_empty()
    }
}

/// Error types for junction polygon building.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JunctionPolygonError {
    /// Junction not found in project.
    JunctionNotFound,
    /// Insufficient road endpoint data to build a polygon (< 3 unique points).
    InsufficientPoints,
    /// The computed polygon is degenerate (zero area).
    DegeneratePolygon,
}

impl std::fmt::Display for JunctionPolygonError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::JunctionNotFound => write!(f, "Junction not found in project"),
            Self::InsufficientPoints => {
                write!(f, "Insufficient road endpoint data (need ≥3 points)")
            }
            Self::DegeneratePolygon => write!(f, "Degenerate polygon (zero area)"),
        }
    }
}

/// Sample road endpoint positions for a junction.
///
/// Returns the start and end world positions of all connected roads.
fn collect_junction_points(project: &Project, junction: &Junction) -> Vec<Vector2<f64>> {
    let mut pts = Vec::new();

    for conn in &junction.connections {
        for road_id in [&conn.connecting_road, &conn.incoming_road] {
            if let Some(road) = project.roads.iter().find(|r| &r.id == road_id) {
                // Use the plan_view endpoints as approximate positions
                if let Some(first_geo) = road.plan_view.first() {
                    pts.push(Vector2::new(first_geo.x, first_geo.y));
                }
                if let Some(last_geo) = road.plan_view.last() {
                    // Approximate end point from last geometry
                    let end_x = last_geo.x + last_geo.length * last_geo.hdg.cos();
                    let end_y = last_geo.y + last_geo.length * last_geo.hdg.sin();
                    pts.push(Vector2::new(end_x, end_y));
                }
            }
        }
    }

    // Deduplicate very close points
    let mut deduped: Vec<Vector2<f64>> = Vec::new();
    for pt in pts {
        if deduped
            .iter()
            .all(|q: &Vector2<f64>| (pt - q).norm() > 0.01)
        {
            deduped.push(pt);
        }
    }
    deduped
}

/// Compute the signed polygon area using the shoelace formula.
fn polygon_area(pts: &[Vector2<f64>]) -> f64 {
    let n = pts.len();
    if n < 3 {
        return 0.0;
    }
    let mut area = 0.0;
    for i in 0..n {
        let j = (i + 1) % n;
        area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    area.abs() / 2.0
}

/// Build a triangulated junction polygon for a specific junction.
///
/// # Errors
///
/// Returns an error if the junction is not found, has insufficient data,
/// or produces a degenerate polygon.
pub fn build_junction_polygon(
    project: &Project,
    junction_id: &str,
) -> Result<JunctionPolygon, JunctionPolygonError> {
    let junction = project
        .junctions
        .iter()
        .find(|j| j.id == junction_id)
        .ok_or(JunctionPolygonError::JunctionNotFound)?;

    let pts = collect_junction_points(project, junction);

    if pts.len() < 3 {
        return Err(JunctionPolygonError::InsufficientPoints);
    }

    // Compute convex hull
    let hull = convex_hull(&pts);
    if hull.len() < 3 {
        return Err(JunctionPolygonError::InsufficientPoints);
    }

    let area = polygon_area(&hull);
    if area < 1e-9 {
        return Err(JunctionPolygonError::DegeneratePolygon);
    }

    let centroid = PolyVertex::new(
        hull.iter().map(|p| p.x).sum::<f64>() / hull.len() as f64,
        hull.iter().map(|p| p.y).sum::<f64>() / hull.len() as f64,
    );

    // Delaunay triangulate the hull vertices
    let tri_result = triangulate(&hull);
    let triangles: Vec<[usize; 3]> = tri_result
        .iter()
        .map(|Triangle { a, b, c }| [*a, *b, *c])
        .collect();

    let boundary: Vec<PolyVertex> = hull
        .iter()
        .map(|p| PolyVertex::new(p.x, p.y))
        .collect();

    Ok(JunctionPolygon {
        junction_id: junction_id.to_string(),
        boundary,
        triangles,
        area,
        centroid,
    })
}

/// Build junction polygons for all junctions in the project.
///
/// Skips junctions with insufficient data (returning them in the error list).
pub fn build_all_junction_polygons(
    project: &Project,
) -> (Vec<JunctionPolygon>, Vec<(String, JunctionPolygonError)>) {
    let mut polygons = Vec::new();
    let mut errors = Vec::new();

    for junction in &project.junctions {
        match build_junction_polygon(project, &junction.id) {
            Ok(poly) => polygons.push(poly),
            Err(e) => errors.push((junction.id.clone(), e)),
        }
    }

    (polygons, errors)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ContactPoint, Geometry, GeometryType, Junction, JunctionConnection, Road};

    fn make_project_with_junction() -> Project {
        // Create 4 roads radiating from origin
        let roads = vec![
            make_road("r1", 0.0, 0.0, 0.0),         // East
            make_road("r2", 0.0, 0.0, std::f64::consts::FRAC_PI_2), // North
            make_road("r3", 0.0, 0.0, std::f64::consts::PI),        // West
            make_road("r4", 0.0, 0.0, -std::f64::consts::FRAC_PI_2), // South
        ];

        let junction = Junction {
            id: "jct-1".to_string(),
            name: "Test Junction".to_string(),
            connections: vec![
                make_conn("c1", "r1", "r2"),
                make_conn("c2", "r3", "r4"),
            ],
        };

        Project {
            name: "test".to_string(),
            header: Default::default(),
            roads,
            junctions: vec![junction],
        }
    }

    fn make_road(id: &str, x: f64, y: f64, hdg: f64) -> Road {
        Road::from_centerline(
            id,
            vec![Geometry {
                s: 0.0,
                x,
                y,
                hdg,
                length: 10.0,
                geo_type: GeometryType::Line,
            }],
        )
    }

    fn make_conn(id: &str, incoming: &str, connecting: &str) -> JunctionConnection {
        JunctionConnection {
            id: id.to_string(),
            incoming_road: incoming.to_string(),
            connecting_road: connecting.to_string(),
            contact_point: ContactPoint::Start,
            lane_links: vec![],
        }
    }

    #[test]
    fn test_build_junction_polygon_ok() {
        let project = make_project_with_junction();
        let result = build_junction_polygon(&project, "jct-1");
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        let poly = result.unwrap();
        assert_eq!(poly.junction_id, "jct-1");
        assert!(poly.boundary.len() >= 3);
        assert!(poly.area > 0.0);
    }

    #[test]
    fn test_build_junction_polygon_not_found() {
        let project = Project::default();
        let result = build_junction_polygon(&project, "nonexistent");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), JunctionPolygonError::JunctionNotFound));
    }

    #[test]
    fn test_build_junction_polygon_no_roads() {
        // Junction with connections to roads that don't exist
        let project = Project {
            junctions: vec![Junction {
                id: "j1".to_string(),
                name: "empty".to_string(),
                connections: vec![],
            }],
            ..Default::default()
        };
        let result = build_junction_polygon(&project, "j1");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), JunctionPolygonError::InsufficientPoints));
    }

    #[test]
    fn test_build_all_junction_polygons_empty_project() {
        let project = Project::default();
        let (polys, errors) = build_all_junction_polygons(&project);
        assert!(polys.is_empty());
        assert!(errors.is_empty());
    }

    #[test]
    fn test_build_all_junction_polygons_with_valid_junction() {
        let project = make_project_with_junction();
        let (polys, errors) = build_all_junction_polygons(&project);
        assert!(!polys.is_empty(), "Should produce at least one polygon");
        assert!(errors.is_empty() || !polys.is_empty());
    }

    #[test]
    fn test_junction_polygon_is_triangulated() {
        let project = make_project_with_junction();
        let poly = build_junction_polygon(&project, "jct-1").unwrap();
        assert!(poly.is_triangulated(), "Polygon should be triangulated");
    }

    #[test]
    fn test_junction_polygon_centroid_in_bounds() {
        let project = make_project_with_junction();
        let poly = build_junction_polygon(&project, "jct-1").unwrap();
        // Centroid should be within the bounding box of boundary vertices
        let min_x = poly.boundary.iter().map(|v| v.x).fold(f64::INFINITY, f64::min);
        let max_x = poly.boundary.iter().map(|v| v.x).fold(f64::NEG_INFINITY, f64::max);
        let min_y = poly.boundary.iter().map(|v| v.y).fold(f64::INFINITY, f64::min);
        let max_y = poly.boundary.iter().map(|v| v.y).fold(f64::NEG_INFINITY, f64::max);
        assert!(poly.centroid.x >= min_x - 0.01 && poly.centroid.x <= max_x + 0.01);
        assert!(poly.centroid.y >= min_y - 0.01 && poly.centroid.y <= max_y + 0.01);
    }
}
