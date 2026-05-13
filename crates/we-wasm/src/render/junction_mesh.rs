use super::{eval_lane_offset, road_point_at_s};

pub(super) fn append_junction_triangles(
    out: &mut Vec<f32>,
    project: &we_core::model::Project,
    junction: &we_core::model::Junction,
    color: [f32; 4],
) {
    let points = build_junction_polygon_points(project, junction);
    if points.len() < 3 {
        return;
    }
    let n = points.len() as f32;
    let cx: f32 = points.iter().map(|p| p[0]).sum::<f32>() / n;
    let cy: f32 = points.iter().map(|p| p[1]).sum::<f32>() / n;
    let cz: f32 = points.iter().map(|p| p[2]).sum::<f32>() / n;
    let [r, g, b, a] = color;
    for i in 0..points.len() {
        let j = (i + 1) % points.len();
        out.extend_from_slice(&[cx, cy, cz, r, g, b, a]);
        out.extend_from_slice(&[points[i][0], points[i][1], points[i][2], r, g, b, a]);
        out.extend_from_slice(&[points[j][0], points[j][1], points[j][2], r, g, b, a]);
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
        if connecting.render_hidden {
            continue;
        }
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
        if incoming.render_hidden {
            continue;
        }
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
    evaluate_elevation: &dyn Fn(&[we_core::model::Elevation], f64) -> f64,
    evaluate_lane_width: &dyn Fn(&[we_core::model::LaneWidth], f64) -> f64,
    offset_point: &dyn Fn(&we_core::geometry::eval::RefLinePoint, f64, f64) -> (f64, f64, f64),
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
    let z = evaluate_elevation(&road.elevation_profile, s) as f32 - 0.1;
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
