use super::helpers::{eval_lane_offset, road_point_at_s};

pub(super) fn append_junction_triangles(
    out: &mut Vec<f32>,
    project: &we_core::model::Project,
    junction: &we_core::model::Junction,
    color: [f32; 4],
) {
    use we_core::geometry::convex_hull;
    use we_core::math::Vector2;

    let points = build_junction_polygon_points(project, junction);
    if points.len() < 3 {
        return;
    }

    // Planarize the junction surface: assign one shared elevation to every
    // emitted vertex. Boundary points inherit each road's own elevation, so the
    // raw polygon is non-planar; fanning a non-planar ring from an averaged
    // centroid yields twisted/overlapping faces (the "shattered" look) in 3D.
    // A single flat elevation keeps the whole surface coplanar.
    let junction_z: f32 = points.iter().map(|p| p[2]).sum::<f32>() / points.len() as f32;

    // Build a simple convex ring before fanning so there are no self-intersecting
    // or sliver triangles: boundary points from both incoming and connecting
    // roads can otherwise be non-star-shaped around the centroid.
    let hull = convex_hull(
        &points
            .iter()
            .map(|p| Vector2::new(p[0] as f64, p[1] as f64))
            .collect::<Vec<_>>(),
    );
    let ring: Vec<[f32; 2]> = if hull.len() >= 3 {
        hull.iter().map(|p| [p.x as f32, p.y as f32]).collect()
    } else {
        // Degenerate/collinear fallback: keep the ordered boundary ring.
        points.iter().map(|p| [p[0], p[1]]).collect()
    };

    let n = ring.len() as f32;
    let cx: f32 = ring.iter().map(|p| p[0]).sum::<f32>() / n;
    let cy: f32 = ring.iter().map(|p| p[1]).sum::<f32>() / n;
    let [r, g, b, a] = color;
    for i in 0..ring.len() {
        let j = (i + 1) % ring.len();
        out.extend_from_slice(&[cx, cy, junction_z, r, g, b, a]);
        out.extend_from_slice(&[ring[i][0], ring[i][1], junction_z, r, g, b, a]);
        out.extend_from_slice(&[ring[j][0], ring[j][1], junction_z, r, g, b, a]);
    }
}

pub(crate) fn build_junction_polygon_points(
    project: &we_core::model::Project,
    junction: &we_core::model::Junction,
) -> Vec<[f32; 3]> {
    use we_core::geometry::eval::{evaluate_elevation, evaluate_lane_width, offset_point};

    let mut points: Vec<[f32; 3]> = Vec::new();
    for conn in &junction.connections {
        let Some(connecting) = project.roads.iter().find(|r| r.id == conn.connecting_road) else {
            continue;
        };
        let connecting_s = if conn.contact_point == we_core::model::ContactPoint::Start {
            0.0
        } else {
            connecting.length
        };
        let Some(connecting_pt) = road_point_at_s(&connecting.plan_view, connecting_s) else {
            continue;
        };
        append_road_boundary_points(
            connecting,
            connecting_s,
            &mut points,
            &evaluate_elevation,
            &evaluate_lane_width,
            &offset_point,
        );

        // Incoming road endpoint is not described by connection.contactPoint.
        // Choose start/end by nearest distance to connecting-road contact point.
        let Some(incoming) = project.roads.iter().find(|r| r.id == conn.incoming_road) else {
            continue;
        };
        let Some(in_start) = road_point_at_s(&incoming.plan_view, 0.0) else {
            continue;
        };
        let Some(in_end) = road_point_at_s(&incoming.plan_view, incoming.length) else {
            continue;
        };
        let ds_start =
            (in_start.x - connecting_pt.x).powi(2) + (in_start.y - connecting_pt.y).powi(2);
        let ds_end = (in_end.x - connecting_pt.x).powi(2) + (in_end.y - connecting_pt.y).powi(2);
        let incoming_s = if ds_start <= ds_end {
            0.0
        } else {
            incoming.length
        };
        append_road_boundary_points(
            incoming,
            incoming_s,
            &mut points,
            &evaluate_elevation,
            &evaluate_lane_width,
            &offset_point,
        );
    }

    if points.len() < 3 {
        return points;
    }

    // Deduplicate near-identical points.
    let mut dedup: Vec<[f32; 3]> = Vec::new();
    for p in points {
        if !dedup.iter().any(|q| {
            let dx = p[0] - q[0];
            let dy = p[1] - q[1];
            (dx * dx + dy * dy) < 0.01 // 10cm
        }) {
            dedup.push(p);
        }
    }
    if dedup.len() < 3 {
        return dedup;
    }

    // Sort by polar angle around centroid to build a stable polygon ring.
    let cx: f32 = dedup.iter().map(|p| p[0]).sum::<f32>() / dedup.len() as f32;
    let cy: f32 = dedup.iter().map(|p| p[1]).sum::<f32>() / dedup.len() as f32;
    dedup.sort_by(|a, b| {
        let aa = (a[1] - cy).atan2(a[0] - cx);
        let bb = (b[1] - cy).atan2(b[0] - cx);
        aa.total_cmp(&bb)
    });
    dedup
}

#[allow(clippy::type_complexity)]
fn append_road_boundary_points(
    road: &we_core::model::Road,
    s: f64,
    points: &mut Vec<[f32; 3]>,
    evaluate_elevation: &impl Fn(&[we_core::model::Elevation], f64) -> f64,
    evaluate_lane_width: &impl Fn(&[we_core::model::LaneWidth], f64) -> f64,
    offset_point: &impl Fn(&we_core::geometry::eval::RefLinePoint, f64, f64) -> (f64, f64, f64),
) {
    let Some(ref_pt) = road_point_at_s(&road.plan_view, s) else {
        return;
    };
    let lane_offset = eval_lane_offset(&road.lane_offsets, s);
    let Some(section) = road
        .lane_sections
        .iter()
        .rev()
        .find(|ls| !ls.render_hidden && ls.s <= s + 1e-9)
        .or_else(|| road.lane_sections.iter().find(|ls| !ls.render_hidden))
    else {
        return;
    };
    let ds = (s - section.s).max(0.0);
    let left_width: f64 = section
        .left
        .iter()
        .map(|l| evaluate_lane_width(&l.width, ds))
        .sum();
    let right_width: f64 = section
        .right
        .iter()
        .map(|l| evaluate_lane_width(&l.width, ds))
        .sum();
    // Lift the junction fill just above the road surface (E + 1cm) so overlapping
    // road meshes do not occlude it, while staying below lane marks (+2cm),
    // crosswalks (+5cm), road objects and signals.
    let z = evaluate_elevation(&road.elevation_profile, s) as f32 + 0.01;
    let (lx, ly, _) = offset_point(&ref_pt, lane_offset + left_width, 0.0);
    let (rx, ry, _) = offset_point(&ref_pt, lane_offset - right_width, 0.0);
    points.push([lx as f32, ly as f32, z]);
    points.push([rx as f32, ry as f32, z]);
}

pub(crate) fn point_in_polygon(x: f64, y: f64, poly: &[[f32; 3]]) -> bool {
    let mut inside = false;
    let mut j = poly.len() - 1;
    for i in 0..poly.len() {
        let xi = poly[i][0] as f64;
        let yi = poly[i][1] as f64;
        let xj = poly[j][0] as f64;
        let yj = poly[j][1] as f64;
        let intersect = ((yi > y) != (yj > y))
            && (x < (xj - xi) * (y - yi) / ((yj - yi).abs().max(1e-12)) + xi);
        if intersect {
            inside = !inside;
        }
        j = i;
    }
    inside
}

#[cfg(test)]
mod tests {
    use super::{append_junction_triangles, build_junction_polygon_points, point_in_polygon};
    use std::f64::consts::FRAC_PI_2;
    use we_core::model::{ContactPoint, Junction, JunctionConnection, Project, Road};

    fn make_junction_project() -> (Project, Junction) {
        let incoming = Road::from_centerline(
            "incoming",
            vec![we_core::model::Geometry {
                s: 0.0,
                x: -10.0,
                y: 0.0,
                hdg: 0.0,
                length: 10.0,
                geo_type: we_core::model::GeometryType::Line,
            }],
        );
        let connecting = Road::from_centerline(
            "connecting",
            vec![we_core::model::Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: FRAC_PI_2,
                length: 10.0,
                geo_type: we_core::model::GeometryType::Line,
            }],
        );
        let junction = Junction {
            id: "j1".to_string(),
            name: "junction".to_string(),
            connections: vec![
                JunctionConnection {
                    id: "c1".to_string(),
                    incoming_road: "incoming".to_string(),
                    connecting_road: "connecting".to_string(),
                    contact_point: ContactPoint::Start,
                    lane_links: vec![],
                },
                JunctionConnection {
                    id: "c2".to_string(),
                    incoming_road: "incoming".to_string(),
                    connecting_road: "connecting".to_string(),
                    contact_point: ContactPoint::Start,
                    lane_links: vec![],
                },
            ],
        };
        (
            Project {
                roads: vec![incoming, connecting],
                junctions: vec![junction.clone()],
                ..Project::default()
            },
            junction,
        )
    }

    #[test]
    fn test_build_junction_polygon_points_deduplicates_connection_boundaries() {
        let (project, junction) = make_junction_project();
        let points = build_junction_polygon_points(&project, &junction);

        assert_eq!(points.len(), 4);
        assert!(
            points
                .iter()
                .any(|p| p[0].abs() < 0.01 && (p[1] - 3.5).abs() < 0.01)
        );
        assert!(
            points
                .iter()
                .any(|p| p[0].abs() < 0.01 && (p[1] + 3.5).abs() < 0.01)
        );
        assert!(
            points
                .iter()
                .any(|p| (p[0] - 3.5).abs() < 0.01 && p[1].abs() < 0.01)
        );
        assert!(
            points
                .iter()
                .any(|p| (p[0] + 3.5).abs() < 0.01 && p[1].abs() < 0.01)
        );
    }

    #[test]
    fn test_append_junction_triangles_emits_triangle_fan() {
        let (project, junction) = make_junction_project();
        let mut out = Vec::new();

        append_junction_triangles(&mut out, &project, &junction, [0.1, 0.2, 0.3, 0.4]);

        assert_eq!(out.len(), 4 * 3 * 7);
        assert_eq!(&out[3..7], &[0.1, 0.2, 0.3, 0.4]);
        assert_eq!(&out[10..14], &[0.1, 0.2, 0.3, 0.4]);
    }

    #[test]
    fn test_append_junction_triangles_emits_coplanar_surface() {
        let (project, junction) = make_junction_project();
        let mut out = Vec::new();

        append_junction_triangles(&mut out, &project, &junction, [0.1, 0.2, 0.3, 0.4]);

        assert!(!out.is_empty());
        // Every emitted vertex (stride 7) must share the same Z so the junction
        // surface is a single flat plane (no shattered/overlapping faces in 3D).
        let z0 = out[2];
        for vertex in out.chunks_exact(7) {
            assert!(
                (vertex[2] - z0).abs() < 1e-6,
                "junction vertex Z {} differs from {}",
                vertex[2],
                z0
            );
        }
    }

    #[test]
    fn test_crosswalk_signals_junction_fill_is_flat_and_convex() {
        // Regression guard for the 3D junction-fill rendering bug: with a real
        // multi-connection junction the emitted fill must be a single flat plane
        // (all vertex Z coplanar) and non-degenerate, so it never shatters into
        // twisted faces or z-fights the road surface in perspective view.
        let xodr = std::fs::read_to_string("../../tests/fixtures/xodr/crosswalk_signals.xodr")
            .or_else(|_| std::fs::read_to_string("tests/fixtures/xodr/crosswalk_signals.xodr"));
        let Ok(xodr) = xodr else {
            eprintln!("fixture not found, skipping");
            return;
        };
        let project = we_core::opendrive::parse_xodr(&xodr).expect("parse");
        assert!(
            !project.junctions.is_empty(),
            "fixture must contain at least one junction"
        );

        for junction in &project.junctions {
            let mut out = Vec::new();
            append_junction_triangles(&mut out, &project, junction, [0.88, 0.85, 0.98, 0.65]);
            assert!(
                !out.is_empty(),
                "junction {} produced no fill triangles",
                junction.id
            );

            // All emitted vertices must be coplanar (single flat Z plane).
            let z0 = out[2];
            for vertex in out.chunks_exact(7) {
                assert!(
                    (vertex[2] - z0).abs() < 1e-6,
                    "junction {} fill not coplanar: Z {} != {}",
                    junction.id,
                    vertex[2],
                    z0
                );
            }

            // Vertex count must be a whole number of triangles (stride 7, 3 verts).
            assert_eq!(
                out.len() % 21,
                0,
                "junction {} fill vertex buffer is not triangle-aligned",
                junction.id
            );
        }
    }

    #[test]
    fn test_point_in_polygon_returns_expected_membership() {
        let poly = vec![
            [-1.0, -1.0, 0.0],
            [1.0, -1.0, 0.0],
            [1.0, 1.0, 0.0],
            [-1.0, 1.0, 0.0],
        ];

        assert!(point_in_polygon(0.0, 0.0, &poly));
        assert!(!point_in_polygon(2.0, 0.0, &poly));
    }
}
