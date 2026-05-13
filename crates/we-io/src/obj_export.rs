//! Wavefront OBJ 3D mesh export for road network geometry.
//!
//! Generates triangulated road surfaces from road geometry
//! (centre-line + lane widths) and writes standard `.obj` text.

use we_core::model::{GeometryType, Project, Road};

/// Export a project's road surfaces as a Wavefront OBJ string.
///
/// Each road is tessellated into a flat quad-strip along its centre-line.
pub fn export_project_to_obj(project: &Project) -> String {
    let mut vertices: Vec<[f64; 3]> = Vec::new();
    let mut faces: Vec<[usize; 3]> = Vec::new();
    let mut obj = String::from("# WorldEditor Next — OBJ Export\n");
    obj.push_str(&format!("# Roads: {}\n", project.roads.len()));

    for road in &project.roads {
        generate_road_mesh(road, &mut vertices, &mut faces);
    }

    for v in &vertices {
        obj.push_str(&format!("v {} {} {}\n", v[0], v[1], v[2]));
    }
    obj.push_str("# Faces\n");
    for f in &faces {
        obj.push_str(&format!("f {} {} {}\n", f[0] + 1, f[1] + 1, f[2] + 1));
    }
    obj
}

fn generate_road_mesh(road: &Road, vertices: &mut Vec<[f64; 3]>, faces: &mut Vec<[usize; 3]>) {
    let half_width = road_half_width(road);
    let steps = 4usize.max((road.length / 5.0).ceil() as usize);
    let base = vertices.len();

    for i in 0..=steps {
        let s = road.length * (i as f64 / steps as f64);
        let (x, y, hdg) = sample_road(road, s);
        let perp = hdg + std::f64::consts::FRAC_PI_2;
        vertices.push([
            x + half_width * perp.cos(),
            y + half_width * perp.sin(),
            0.0,
        ]);
        vertices.push([
            x - half_width * perp.cos(),
            y - half_width * perp.sin(),
            0.0,
        ]);
    }

    for i in 0..steps {
        let a = base + i * 2;
        let b = a + 1;
        let c = a + 2;
        let d = a + 3;
        faces.push([a, b, c]);
        faces.push([b, d, c]);
    }
}

fn road_half_width(road: &Road) -> f64 {
    if let Some(section) = road.lane_sections.first() {
        let right_width: f64 = section
            .right
            .iter()
            .filter_map(|l| l.width.first().map(|w| w.a))
            .sum();
        let left_width: f64 = section
            .left
            .iter()
            .filter_map(|l| l.width.first().map(|w| w.a))
            .sum();
        let total = right_width + left_width;
        if total > 0.0 {
            return total / 2.0;
        }
    }
    3.5
}

fn sample_road(road: &Road, s: f64) -> (f64, f64, f64) {
    if road.plan_view.is_empty() {
        return (0.0, 0.0, 0.0);
    }
    let mut geom = &road.plan_view[0];
    for g in &road.plan_view {
        if g.s <= s {
            geom = g;
        } else {
            break;
        }
    }
    let ds = s - geom.s;
    match &geom.geo_type {
        GeometryType::Line => (
            geom.x + ds * geom.hdg.cos(),
            geom.y + ds * geom.hdg.sin(),
            geom.hdg,
        ),
        GeometryType::Arc { curvature } => {
            if curvature.abs() < 1e-10 {
                (
                    geom.x + ds * geom.hdg.cos(),
                    geom.y + ds * geom.hdg.sin(),
                    geom.hdg,
                )
            } else {
                let r = 1.0 / curvature;
                let dtheta = ds * curvature;
                let cx = geom.x - r * geom.hdg.sin();
                let cy = geom.y + r * geom.hdg.cos();
                let theta = geom.hdg - std::f64::consts::FRAC_PI_2 + dtheta;
                (
                    cx + r * theta.cos(),
                    cy + r * theta.sin(),
                    geom.hdg + dtheta,
                )
            }
        }
        _ => (
            geom.x + ds * geom.hdg.cos(),
            geom.y + ds * geom.hdg.sin(),
            geom.hdg,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use we_core::model::{Geometry, GeometryType, Project, Road};

    fn straight_road(id: &str, length: f64) -> Road {
        let geom = Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length,
            geo_type: GeometryType::Line,
        };
        Road::from_centerline(id, vec![geom])
    }

    #[test]
    fn test_export_empty_project() {
        let project = Project::default();
        let obj = export_project_to_obj(&project);
        assert!(obj.contains("# WorldEditor Next"));
        assert!(obj.contains("Roads: 0"));
        assert!(!obj.contains("v "));
    }

    #[test]
    fn test_export_single_road_has_vertices() {
        let project = Project {
            roads: vec![straight_road("r0", 20.0)],
            ..Default::default()
        };
        let obj = export_project_to_obj(&project);
        let vertex_count = obj.lines().filter(|l| l.starts_with("v ")).count();
        assert!(vertex_count > 0);
    }

    #[test]
    fn test_export_single_road_has_faces() {
        let project = Project {
            roads: vec![straight_road("r0", 20.0)],
            ..Default::default()
        };
        let obj = export_project_to_obj(&project);
        let face_count = obj.lines().filter(|l| l.starts_with("f ")).count();
        assert!(face_count > 0);
    }

    #[test]
    fn test_export_vertex_z_is_zero() {
        let project = Project {
            roads: vec![straight_road("r0", 10.0)],
            ..Default::default()
        };
        let obj = export_project_to_obj(&project);
        for line in obj.lines().filter(|l| l.starts_with("v ")) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            assert_eq!(parts.len(), 4);
            assert_eq!(parts[3], "0");
        }
    }

    #[test]
    fn test_export_face_indices_are_1_based() {
        let project = Project {
            roads: vec![straight_road("r0", 10.0)],
            ..Default::default()
        };
        let obj = export_project_to_obj(&project);
        for line in obj.lines().filter(|l| l.starts_with("f ")) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            assert_eq!(parts.len(), 4);
            for idx in &parts[1..] {
                let n: usize = idx.parse().expect("face index must be a positive integer");
                assert!(n >= 1);
            }
        }
    }

    #[test]
    fn test_export_multiple_roads_more_vertices() {
        let p1 = Project {
            roads: vec![straight_road("r0", 20.0)],
            ..Default::default()
        };
        let p2 = Project {
            roads: vec![straight_road("r0", 20.0), straight_road("r1", 30.0)],
            ..Default::default()
        };
        let count1 = export_project_to_obj(&p1)
            .lines()
            .filter(|l| l.starts_with("v "))
            .count();
        let count2 = export_project_to_obj(&p2)
            .lines()
            .filter(|l| l.starts_with("v "))
            .count();
        assert!(count2 > count1);
    }

    #[test]
    fn test_sample_road_straight_at_origin() {
        let road = straight_road("r0", 100.0);
        let (x, y, hdg) = sample_road(&road, 50.0);
        assert!((x - 50.0).abs() < 1e-9);
        assert!(y.abs() < 1e-9);
        assert!(hdg.abs() < 1e-9);
    }

    #[test]
    fn test_sample_road_empty_plan_view() {
        let road = Road::new("r0", 100.0);
        let (x, y, hdg) = sample_road(&road, 10.0);
        assert_eq!((x, y, hdg), (0.0, 0.0, 0.0));
    }
}
