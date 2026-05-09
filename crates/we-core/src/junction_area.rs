//! Junction area computation and boundary generation.
//!
//! Computes the actual boundary polygon of a junction from its
//! connecting roads' endpoints and lane widths. Produces convex hull
//! or ordered boundary for rendering and picking.

use crate::geometry::eval::{
    evaluate_lane_width, offset_point, sample_road_reference_line,
};
use crate::model::{Junction, Project, Road};
use serde::{Deserialize, Serialize};

/// A 2D boundary point of a junction area.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoundaryPoint {
    pub x: f64,
    pub y: f64,
}

/// The computed area/boundary of a junction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JunctionArea {
    /// Junction ID.
    pub id: String,
    /// Center of the junction (average of boundary points).
    pub center: [f64; 2],
    /// Ordered boundary polygon (convex hull).
    pub boundary: Vec<BoundaryPoint>,
    /// Approximate area in square meters.
    pub area: f64,
}

/// Compute the junction area from its connecting roads.
///
/// Collects the road endpoints (with lane widths) at the junction
/// and computes a convex hull boundary polygon.
pub fn compute_junction_area(project: &Project, junction: &Junction) -> Option<JunctionArea> {
    let mut boundary_pts: Vec<[f64; 2]> = Vec::new();

    for conn in &junction.connections {
        // Collect endpoints from connecting road
        if let Some(road) = project.roads.iter().find(|r| r.id == conn.connecting_road) {
            collect_road_endpoints(road, &mut boundary_pts);
        }
        // Also from incoming road
        if let Some(road) = project.roads.iter().find(|r| r.id == conn.incoming_road) {
            collect_road_endpoints(road, &mut boundary_pts);
        }
    }

    if boundary_pts.len() < 3 {
        return None;
    }

    // Compute convex hull
    let hull = convex_hull(&boundary_pts);
    if hull.len() < 3 {
        return None;
    }

    // Compute center
    let cx = hull.iter().map(|p| p[0]).sum::<f64>() / hull.len() as f64;
    let cy = hull.iter().map(|p| p[1]).sum::<f64>() / hull.len() as f64;

    // Compute area using shoelace formula
    let area = polygon_area(&hull);

    let boundary = hull
        .into_iter()
        .map(|p| BoundaryPoint { x: p[0], y: p[1] })
        .collect();

    Some(JunctionArea {
        id: junction.id.clone(),
        center: [cx, cy],
        boundary,
        area,
    })
}

/// Collect the start and end points of a road with lane widths offset.
fn collect_road_endpoints(road: &Road, pts: &mut Vec<[f64; 2]>) {
    let ref_pts = sample_road_reference_line(road, road.length.max(1.0));
    if ref_pts.is_empty() {
        return;
    }

    // Start point
    if let Some(first) = ref_pts.first() {
        let half_w = half_width_at_s(road, first.s);
        let (lx, ly, _) = offset_point(first, half_w, 0.0);
        let (rx, ry, _) = offset_point(first, -half_w, 0.0);
        pts.push([lx, ly]);
        pts.push([rx, ry]);
        pts.push([first.x, first.y]);
    }

    // End point
    if let Some(last) = ref_pts.last() {
        let half_w = half_width_at_s(road, last.s);
        let (lx, ly, _) = offset_point(last, half_w, 0.0);
        let (rx, ry, _) = offset_point(last, -half_w, 0.0);
        pts.push([lx, ly]);
        pts.push([rx, ry]);
        pts.push([last.x, last.y]);
    }
}

/// Get half-width of a road at a given s position.
fn half_width_at_s(road: &Road, s: f64) -> f64 {
    let section = road
        .lane_sections
        .iter()
        .rev()
        .find(|ls| ls.s <= s + 1e-9);
    match section {
        Some(sec) => {
            let ds = s - sec.s;
            let rw: f64 = sec
                .right
                .iter()
                .map(|l| evaluate_lane_width(&l.width, ds))
                .sum();
            let lw: f64 = sec
                .left
                .iter()
                .map(|l| evaluate_lane_width(&l.width, ds))
                .sum();
            rw.max(lw)
        }
        None => 3.5,
    }
}

/// Test if a point is inside the junction area (for picking).
pub fn point_in_junction_area(area: &JunctionArea, x: f64, y: f64) -> bool {
    let pts: Vec<[f64; 2]> = area.boundary.iter().map(|p| [p.x, p.y]).collect();
    point_in_polygon(x, y, &pts)
}

/// Point-in-polygon test using ray casting.
fn point_in_polygon(x: f64, y: f64, polygon: &[[f64; 2]]) -> bool {
    let n = polygon.len();
    if n < 3 {
        return false;
    }
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = (polygon[i][0], polygon[i][1]);
        let (xj, yj) = (polygon[j][0], polygon[j][1]);
        if ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Compute the area of a polygon using the shoelace formula.
fn polygon_area(pts: &[[f64; 2]]) -> f64 {
    let n = pts.len();
    if n < 3 {
        return 0.0;
    }
    let mut area = 0.0;
    for i in 0..n {
        let j = (i + 1) % n;
        area += pts[i][0] * pts[j][1];
        area -= pts[j][0] * pts[i][1];
    }
    area.abs() / 2.0
}

/// Compute the convex hull of a set of 2D points (Andrew's monotone chain).
fn convex_hull(points: &[[f64; 2]]) -> Vec<[f64; 2]> {
    let mut pts: Vec<[f64; 2]> = points.to_vec();
    pts.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap().then(a[1].partial_cmp(&b[1]).unwrap()));
    pts.dedup_by(|a, b| (a[0] - b[0]).abs() < 1e-9 && (a[1] - b[1]).abs() < 1e-9);

    let n = pts.len();
    if n < 3 {
        return pts;
    }

    let mut hull: Vec<[f64; 2]> = Vec::with_capacity(2 * n);

    // Lower hull
    for p in &pts {
        while hull.len() >= 2 && cross(&hull[hull.len() - 2], &hull[hull.len() - 1], p) <= 0.0 {
            hull.pop();
        }
        hull.push(*p);
    }

    // Upper hull
    let lower_len = hull.len();
    for p in pts.iter().rev().skip(1) {
        while hull.len() > lower_len
            && cross(&hull[hull.len() - 2], &hull[hull.len() - 1], p) <= 0.0
        {
            hull.pop();
        }
        hull.push(*p);
    }

    hull.pop(); // Remove the last point (same as first)
    hull
}

/// Cross product of vectors OA and OB where O is the origin point.
fn cross(o: &[f64; 2], a: &[f64; 2], b: &[f64; 2]) -> f64 {
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;

    fn make_junction_project() -> (Project, Junction) {
        // Create two roads meeting at a point
        let road1 = Road::from_centerline(
            "r1",
            vec![Geometry {
                s: 0.0,
                x: -50.0,
                y: 0.0,
                hdg: 0.0,
                length: 50.0,
                geo_type: GeometryType::Line,
            }],
        );
        let road2 = Road::from_centerline(
            "r2",
            vec![Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: std::f64::consts::FRAC_PI_2,
                length: 50.0,
                geo_type: GeometryType::Line,
            }],
        );
        let junction = Junction {
            id: "j1".into(),
            name: "Test".into(),
            connections: vec![
                JunctionConnection {
                    id: "c1".into(),
                    incoming_road: "r1".into(),
                    connecting_road: "r2".into(),
                    contact_point: ContactPoint::Start,
                    lane_links: vec![],
                },
            ],
        };
        let project = Project {
            name: "test".into(),
            header: Header::default(),
            roads: vec![road1, road2],
            junctions: vec![junction.clone()],
        };
        (project, junction)
    }

    #[test]
    fn test_convex_hull_triangle() {
        let pts = vec![[0.0, 0.0], [10.0, 0.0], [5.0, 10.0]];
        let hull = convex_hull(&pts);
        assert_eq!(hull.len(), 3);
    }

    #[test]
    fn test_convex_hull_square() {
        let pts = vec![
            [0.0, 0.0],
            [10.0, 0.0],
            [10.0, 10.0],
            [0.0, 10.0],
            [5.0, 5.0], // interior point, should not be in hull
        ];
        let hull = convex_hull(&pts);
        assert_eq!(hull.len(), 4);
    }

    #[test]
    fn test_polygon_area_square() {
        let pts = vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]];
        let area = polygon_area(&pts);
        assert!((area - 100.0).abs() < 1e-6);
    }

    #[test]
    fn test_point_in_polygon_inside() {
        let poly = vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]];
        assert!(point_in_polygon(5.0, 5.0, &poly));
    }

    #[test]
    fn test_point_in_polygon_outside() {
        let poly = vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]];
        assert!(!point_in_polygon(15.0, 5.0, &poly));
    }

    #[test]
    fn test_compute_junction_area() {
        let (project, junction) = make_junction_project();
        let area = compute_junction_area(&project, &junction);
        assert!(area.is_some());
        let area = area.unwrap();
        assert_eq!(area.id, "j1");
        assert!(area.boundary.len() >= 3);
        assert!(area.area > 0.0);
    }

    #[test]
    fn test_point_in_junction_area() {
        let (project, junction) = make_junction_project();
        let area = compute_junction_area(&project, &junction).unwrap();
        // Center should be inside
        assert!(point_in_junction_area(&area, area.center[0], area.center[1]));
        // Far away should be outside
        assert!(!point_in_junction_area(&area, 1000.0, 1000.0));
    }

    #[test]
    fn test_junction_area_no_connections() {
        let project = Project::default();
        let junction = Junction {
            id: "j_empty".into(),
            name: "Empty".into(),
            connections: vec![],
        };
        let area = compute_junction_area(&project, &junction);
        assert!(area.is_none());
    }
}
