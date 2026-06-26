//! Road marking rendering — lines, crosswalks, arrows, etc.
//!
//! Renders road markings as triangles on the ground surface.
//! Supports solid lines, zebra crossings, stop lines, and arrows.

use crate::vertex::ColorVertex;
use we_core::geometry::eval::RefLinePoint;
use we_core::model::{Point3D, RoadMark, RoadMarkColor, RoadMarkType};

/// Get the color array for a road marking.
fn marking_color(color: &RoadMarkColor) -> [f32; 4] {
    match color {
        RoadMarkColor::Standard => [1.0, 1.0, 1.0, 1.0], // White
        RoadMarkColor::Yellow => [1.0, 0.9, 0.0, 1.0],   // Yellow
        RoadMarkColor::Red => [0.9, 0.1, 0.1, 1.0],      // Red
        RoadMarkColor::Blue => [0.0, 0.4, 0.9, 1.0],     // Blue
        RoadMarkColor::Green => [0.1, 0.8, 0.2, 1.0],    // Green
        RoadMarkColor::White => [1.0, 1.0, 1.0, 1.0],    // White
        RoadMarkColor::Orange => [1.0, 0.5, 0.0, 1.0],   // Orange
        RoadMarkColor::Violet => [0.5, 0.0, 1.0, 1.0],   // Violet
    }
}

/// Generate a solid line strip from a series of points.
///
/// Takes reference line points and generates triangle strips.
/// offset: perpendicular offset from centerline in meters
/// width: line width in meters
pub fn generate_solid_line(
    ref_points: &[RefLinePoint],
    offset: f64,
    width: f64,
    height: f64,
    color: [f32; 4],
) -> Vec<ColorVertex> {
    if ref_points.len() < 2 {
        return Vec::new();
    }

    let half_width = width / 2.0;
    let mut vertices = Vec::new();

    for i in 0..ref_points.len() - 1 {
        let p0 = &ref_points[i];
        let p1 = &ref_points[i + 1];

        // Calculate perpendicular direction for the offset
        let cos_h = p0.hdg.cos();
        let sin_h = p0.hdg.sin();
        let perp_x = -sin_h;
        let perp_y = cos_h;

        let cos_h1 = p1.hdg.cos();
        let sin_h1 = p1.hdg.sin();
        let perp_x1 = -sin_h1;
        let perp_y1 = cos_h1;

        // Inner and outer edges of the line
        let x0_inner = (p0.x + perp_x * (offset - half_width)) as f32;
        let y0_inner = (p0.y + perp_y * (offset - half_width)) as f32;
        let x0_outer = (p0.x + perp_x * (offset + half_width)) as f32;
        let y0_outer = (p0.y + perp_y * (offset + half_width)) as f32;
        let z0 = (height) as f32;

        let x1_inner = (p1.x + perp_x1 * (offset - half_width)) as f32;
        let y1_inner = (p1.y + perp_y1 * (offset - half_width)) as f32;
        let x1_outer = (p1.x + perp_x1 * (offset + half_width)) as f32;
        let y1_outer = (p1.y + perp_y1 * (offset + half_width)) as f32;
        let z1 = (height) as f32;

        // Two triangles for the quad
        vertices.push(ColorVertex::new([x0_inner, y0_inner, z0], color));
        vertices.push(ColorVertex::new([x0_outer, y0_outer, z0], color));
        vertices.push(ColorVertex::new([x1_inner, y1_inner, z1], color));

        vertices.push(ColorVertex::new([x0_outer, y0_outer, z0], color));
        vertices.push(ColorVertex::new([x1_outer, y1_outer, z1], color));
        vertices.push(ColorVertex::new([x1_inner, y1_inner, z1], color));
    }

    vertices
}

/// Generate a broken line (dashed) from a series of points.
///
/// dash_length: length of each dash in meters
/// gap_length: length of the gap between dashes in meters
pub fn generate_broken_line(
    ref_points: &[RefLinePoint],
    offset: f64,
    width: f64,
    height: f64,
    dash_length: f64,
    gap_length: f64,
    color: [f32; 4],
) -> Vec<ColorVertex> {
    if ref_points.len() < 2 {
        return Vec::new();
    }

    let mut vertices = Vec::new();
    let half_width = width / 2.0;
    let dash_period = dash_length + gap_length;
    let mut current_dist = 0.0;
    let mut prev_point = &ref_points[0];

    for i in 0..ref_points.len() - 1 {
        let p0 = prev_point;
        let p1 = &ref_points[i + 1];

        let segment_length = ((p1.x - p0.x).powi(2) + (p1.y - p0.y).powi(2)).sqrt();

        // Calculate how many dashes fit in this segment
        let segment_start_dist = current_dist;
        let segment_end_dist = current_dist + segment_length;

        let cos_h = p0.hdg.cos();
        let sin_h = p0.hdg.sin();
        let perp_x = -sin_h;
        let perp_y = cos_h;

        // Iterate through the segment and generate dashes
        let mut d = segment_start_dist;
        while d < segment_end_dist {
            let dash_start = d;
            let dash_end = (d + dash_length).min(segment_end_dist);

            // Only draw if we're on a dash (within dash_length from period start)
            let period_pos = d % dash_period;
            if period_pos < dash_length + 1e-9 {
                let seg_len = segment_length.max(1e-9);
                let t0 = (dash_start - segment_start_dist) / seg_len;
                let t1 = (dash_end - segment_start_dist) / seg_len;

                let x0 = ((1.0 - t0) * p0.x + t0 * p1.x) as f32;
                let y0 = ((1.0 - t0) * p0.y + t0 * p1.y) as f32;
                let z0 = height as f32;

                let x1 = ((1.0 - t1) * p0.x + t1 * p1.x) as f32;
                let y1 = ((1.0 - t1) * p0.y + t1 * p1.y) as f32;
                let z1 = height as f32;

                let x0_inner = x0 + (perp_x * (offset - half_width)) as f32;
                let y0_inner = y0 + (perp_y * (offset - half_width)) as f32;
                let x0_outer = x0 + (perp_x * (offset + half_width)) as f32;
                let y0_outer = y0 + (perp_y * (offset + half_width)) as f32;

                let x1_inner = x1 + (perp_x * (offset - half_width)) as f32;
                let y1_inner = y1 + (perp_y * (offset - half_width)) as f32;
                let x1_outer = x1 + (perp_x * (offset + half_width)) as f32;
                let y1_outer = y1 + (perp_y * (offset + half_width)) as f32;

                vertices.push(ColorVertex::new([x0_inner, y0_inner, z0], color));
                vertices.push(ColorVertex::new([x0_outer, y0_outer, z0], color));
                vertices.push(ColorVertex::new([x1_inner, y1_inner, z1], color));

                vertices.push(ColorVertex::new([x0_outer, y0_outer, z0], color));
                vertices.push(ColorVertex::new([x1_outer, y1_outer, z1], color));
                vertices.push(ColorVertex::new([x1_inner, y1_inner, z1], color));
            }

            d += dash_period;
        }

        current_dist += segment_length;
        prev_point = p1;
    }

    vertices
}

/// Generate a zebra crossing (block pattern).
///
/// span_width: total width of the crosswalk
/// stripe_width: width of each stripe
/// stripe_count: number of stripes
pub fn generate_zebra_crossing(
    center: &Point3D,
    heading: f64,
    span_width: f64,
    road_width: f64,
    stripe_width: f64,
    color: [f32; 4],
) -> Vec<ColorVertex> {
    let mut vertices = Vec::new();

    let cos_h = heading.cos() as f32;
    let sin_h = heading.sin() as f32;
    let perp_x = -sin_h;
    let perp_y = cos_h;

    let cx = center.x as f32;
    let cy = center.y as f32;
    let cz = center.z as f32;

    let half_span = (span_width / 2.0) as f32;
    let half_road = (road_width / 2.0) as f32;
    let _half_stripe = (stripe_width / 2.0) as f32;

    // Number of stripes across the road
    let stripe_count = (road_width / stripe_width) as i32;

    for i in 0..stripe_count {
        let offset = -half_road + (i as f32 + 0.5) * stripe_width as f32;

        // Center of this stripe
        let ox = cx + perp_x * offset;
        let oy = cy + perp_y * offset;

        // Four corners of the stripe
        let corners = [
            [ox - cos_h * half_span, oy - sin_h * half_span, cz],
            [ox + cos_h * half_span, oy + sin_h * half_span, cz],
            [
                ox + cos_h * half_span - perp_x * stripe_width as f32,
                oy + sin_h * half_span - perp_y * stripe_width as f32,
                cz,
            ],
            [
                ox - cos_h * half_span - perp_x * stripe_width as f32,
                oy - sin_h * half_span - perp_y * stripe_width as f32,
                cz,
            ],
        ];

        // Two triangles for the stripe
        vertices.push(ColorVertex::new(corners[0], color));
        vertices.push(ColorVertex::new(corners[1], color));
        vertices.push(ColorVertex::new(corners[2], color));

        vertices.push(ColorVertex::new(corners[0], color));
        vertices.push(ColorVertex::new(corners[2], color));
        vertices.push(ColorVertex::new(corners[3], color));
    }

    vertices
}

/// Generate a stop line.
///
/// A thick white line spanning the road width.
pub fn generate_stop_line(
    center: &Point3D,
    heading: f64,
    road_width: f64,
    line_width: f64,
    color: [f32; 4],
) -> Vec<ColorVertex> {
    let cos_h = heading.cos() as f32;
    let sin_h = heading.sin() as f32;
    let perp_x = -sin_h;
    let perp_y = cos_h;

    let cx = center.x as f32;
    let cy = center.y as f32;
    let cz = center.z as f32;

    let half_road = (road_width / 2.0) as f32;
    let half_line = (line_width / 2.0) as f32;

    // Corners of the stop line
    let corners = [
        [
            cx - perp_x * half_road - cos_h * half_line,
            cy - perp_y * half_road - sin_h * half_line,
            cz,
        ],
        [
            cx + perp_x * half_road - cos_h * half_line,
            cy + perp_y * half_road - sin_h * half_line,
            cz,
        ],
        [
            cx + perp_x * half_road + cos_h * half_line,
            cy + perp_y * half_road + sin_h * half_line,
            cz,
        ],
        [
            cx - perp_x * half_road + cos_h * half_line,
            cy - perp_y * half_road + sin_h * half_line,
            cz,
        ],
    ];

    vec![
        // First triangle
        ColorVertex::new(corners[0], color),
        ColorVertex::new(corners[1], color),
        ColorVertex::new(corners[2], color),
        // Second triangle
        ColorVertex::new(corners[0], color),
        ColorVertex::new(corners[2], color),
        ColorVertex::new(corners[3], color),
    ]
}

/// Generate an arrow marking indicating direction.
///
/// arrow_type: 0 = forward, 1 = left, 2 = right, 3 = forward-left, 4 = forward-right, 5 = u-turn
pub fn generate_arrow(
    center: &Point3D,
    heading: f64,
    arrow_type: i32,
    scale: f32,
    color: [f32; 4],
) -> Vec<ColorVertex> {
    let mut vertices = Vec::new();

    let cos_h = heading.cos() as f32;
    let sin_h = heading.sin() as f32;

    let cx = center.x as f32;
    let cy = center.y as f32;
    let cz = center.z as f32;

    match arrow_type {
        0 => {
            // Forward arrow
            let points = [
                [0.0, -0.5, 0.0],   // bottom center
                [-0.25, -0.2, 0.0], // bottom left
                [0.25, -0.2, 0.0],  // bottom right
                [-0.15, 0.0, 0.0],  // mid left
                [0.15, 0.0, 0.0],   // mid right
                [0.0, 0.6, 0.0],    // tip
            ];

            let triangles = [
                (0, 1, 3), // shaft left
                (0, 3, 4), // shaft center
                (0, 4, 2), // shaft right
                (3, 5, 4), // arrow head
            ];

            for (a, b, c) in triangles {
                for idx in [a, b, c] {
                    let p = &points[idx];
                    // Rotate by (heading - π/2) so that the +Y template axis
                    // aligns with the road forward direction.
                    let rx = sin_h * p[0] + cos_h * p[1];
                    let ry = -cos_h * p[0] + sin_h * p[1];
                    vertices.push(ColorVertex::new(
                        [cx + rx * scale, cy + ry * scale, cz],
                        color,
                    ));
                }
            }
        }
        _ => {
            // Default: simple triangle for other types
            let triangle = [[0.0, 0.4, 0.0], [-0.3, -0.3, 0.0], [0.3, -0.3, 0.0]];

            for p in triangle {
                // Same heading-π/2 rotation as the forward arrow case.
                let rx = sin_h * p[0] + cos_h * p[1];
                let ry = -cos_h * p[0] + sin_h * p[1];
                vertices.push(ColorVertex::new(
                    [cx + rx * scale, cy + ry * scale, cz],
                    color,
                ));
            }
        }
    }

    vertices
}

/// Generate all road markings from reference line.
pub fn generate_road_markings(
    ref_points: &[RefLinePoint],
    markings: &[RoadMark],
    offset: f64,
) -> Vec<ColorVertex> {
    let mut vertices = Vec::new();

    for marking in markings {
        let color = marking_color(&marking.color);
        let _height = marking.height as f32;

        match marking.mark_type {
            RoadMarkType::Solid => {
                vertices.extend(generate_solid_line(
                    ref_points,
                    offset,
                    marking.width,
                    marking.height,
                    color,
                ));
            }
            RoadMarkType::Broken => {
                vertices.extend(generate_broken_line(
                    ref_points,
                    offset,
                    marking.width,
                    marking.height,
                    3.0, // dash_length
                    3.0, // gap_length
                    color,
                ));
            }
            RoadMarkType::SolidSolid => {
                // Double solid line
                vertices.extend(generate_solid_line(
                    ref_points,
                    offset - marking.width / 2.0,
                    marking.width / 2.0,
                    marking.height,
                    color,
                ));
                vertices.extend(generate_solid_line(
                    ref_points,
                    offset + marking.width / 2.0,
                    marking.width / 2.0,
                    marking.height,
                    color,
                ));
            }
            RoadMarkType::StopLine => {
                // Stop line is handled separately at intersection
                if let Some(last_point) = ref_points.last() {
                    vertices.extend(generate_stop_line(
                        &Point3D::new(last_point.x, last_point.y, 0.0),
                        last_point.hdg,
                        7.0, // default road width
                        marking.width,
                        color,
                    ));
                }
            }
            _ => {
                // Default to solid line
                vertices.extend(generate_solid_line(
                    ref_points,
                    offset,
                    marking.width,
                    marking.height,
                    color,
                ));
            }
        }
    }

    vertices
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_solid_line_generation() {
        let ref_points = vec![
            RefLinePoint {
                s: 0.0,
                x: 0.0,
                y: 0.0,

                hdg: 0.0,
            },
            RefLinePoint {
                s: 10.0,
                x: 10.0,
                y: 0.0,

                hdg: 0.0,
            },
        ];
        let vertices = generate_solid_line(&ref_points, 3.5, 0.15, 0.01, [1.0, 1.0, 1.0, 1.0]);
        assert!(!vertices.is_empty());
    }

    #[test]
    fn test_stop_line_generation() {
        let center = Point3D::new(0.0, 0.0, 0.0);
        let vertices = generate_stop_line(&center, 0.0, 7.0, 0.5, [1.0, 1.0, 1.0, 1.0]);
        assert_eq!(vertices.len(), 6); // 2 triangles * 3 vertices
    }

    #[test]
    fn test_arrow_generation() {
        let center = Point3D::new(0.0, 0.0, 0.0);
        let vertices = generate_arrow(&center, 0.0, 0, 1.0, [1.0, 1.0, 1.0, 1.0]);
        assert!(!vertices.is_empty());
    }

    #[test]
    fn test_arrow_tip_points_forward() {
        // For heading=0 (east-bound road), the arrow tip should point
        // in the +X direction, NOT +Y.
        let center = Point3D::new(0.0, 0.0, 0.0);
        let verts = generate_arrow(&center, 0.0, 0, 1.0, [1.0, 1.0, 1.0, 1.0]);

        // The tip vertex (point [0.0, 0.6, 0.0]) appears in triangles
        // involving index 5.  After rotation it should land near (0.6, 0).
        let tip_x = verts
            .iter()
            .map(|v| v.position[0])
            .fold(f32::NEG_INFINITY, f32::max);
        let tip_y_at_max_x = verts
            .iter()
            .filter(|v| (v.position[0] - tip_x).abs() < 1e-4)
            .map(|v| v.position[1])
            .next()
            .unwrap();
        assert!(
            tip_x > 0.5,
            "tip should be in +X for heading=0, got {}",
            tip_x
        );
        assert!(
            tip_y_at_max_x.abs() < 0.1,
            "tip Y should be near 0 for heading=0, got {}",
            tip_y_at_max_x
        );
    }

    #[test]
    fn test_arrow_tip_north_for_heading_pi_half() {
        // For heading=π/2 (north-bound road), the tip should point in +Y.
        let center = Point3D::new(0.0, 0.0, 0.0);
        let verts = generate_arrow(&center, std::f64::consts::FRAC_PI_2, 0, 1.0, [1.0; 4]);

        let tip_y = verts
            .iter()
            .map(|v| v.position[1])
            .fold(f32::NEG_INFINITY, f32::max);
        let tip_x_at_max_y = verts
            .iter()
            .filter(|v| (v.position[1] - tip_y).abs() < 1e-4)
            .map(|v| v.position[0])
            .next()
            .unwrap();
        assert!(
            tip_y > 0.5,
            "tip should be in +Y for heading=π/2, got {}",
            tip_y
        );
        assert!(
            tip_x_at_max_y.abs() < 0.1,
            "tip X should be near 0 for heading=π/2, got {}",
            tip_x_at_max_y
        );
    }

    fn two_points(len: f64) -> Vec<RefLinePoint> {
        vec![
            RefLinePoint {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
            },
            RefLinePoint {
                s: len,
                x: len,
                y: 0.0,
                hdg: 0.0,
            },
        ]
    }

    fn mark(mark_type: RoadMarkType, color: RoadMarkColor, width: f64) -> RoadMark {
        RoadMark {
            s_offset: 0.0,
            mark_type,
            weight: we_core::model::RoadMarkWeight::default(),
            color,
            material: String::new(),
            width,
            lane_change: String::new(),
            height: 0.01,
        }
    }

    #[test]
    fn test_marking_color_variants_distinct() {
        // White and Standard both map to white; others must differ from it.
        assert_eq!(marking_color(&RoadMarkColor::Standard), [1.0, 1.0, 1.0, 1.0]);
        assert_eq!(marking_color(&RoadMarkColor::White), [1.0, 1.0, 1.0, 1.0]);
        for c in [
            RoadMarkColor::Yellow,
            RoadMarkColor::Red,
            RoadMarkColor::Blue,
            RoadMarkColor::Green,
            RoadMarkColor::Orange,
            RoadMarkColor::Violet,
        ] {
            assert_ne!(marking_color(&c), [1.0, 1.0, 1.0, 1.0]);
        }
    }

    #[test]
    fn test_solid_line_too_few_points_is_empty() {
        let single = vec![RefLinePoint {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
        }];
        assert!(generate_solid_line(&single, 0.0, 0.15, 0.0, [1.0; 4]).is_empty());
    }

    #[test]
    fn test_broken_line_generation() {
        let pts = two_points(30.0);
        let v = generate_broken_line(&pts, 0.0, 0.15, 0.01, 3.0, 3.0, [1.0; 4]);
        // 30m with 6m period (3 dash + 3 gap) → multiple dashes, each 6 verts.
        assert!(!v.is_empty());
        assert_eq!(v.len() % 6, 0);
    }

    #[test]
    fn test_broken_line_too_few_points_is_empty() {
        let single = vec![RefLinePoint {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
        }];
        assert!(generate_broken_line(&single, 0.0, 0.15, 0.0, 3.0, 3.0, [1.0; 4]).is_empty());
    }

    #[test]
    fn test_zebra_crossing_generation() {
        let center = Point3D::new(0.0, 0.0, 0.0);
        let v = generate_zebra_crossing(&center, 0.0, 4.0, 7.0, 0.5, [1.0; 4]);
        // road_width / stripe_width = 14 stripes, each 6 verts.
        assert!(!v.is_empty());
        assert_eq!(v.len(), 14 * 6);
    }

    #[test]
    fn test_arrow_default_type_is_triangle() {
        let center = Point3D::new(0.0, 0.0, 0.0);
        let v = generate_arrow(&center, 0.0, 2, 1.0, [1.0; 4]);
        assert_eq!(v.len(), 3);
    }

    #[test]
    fn test_generate_road_markings_solid() {
        let pts = two_points(10.0);
        let v = generate_road_markings(&pts, &[mark(RoadMarkType::Solid, RoadMarkColor::White, 0.15)], 3.5);
        assert!(!v.is_empty());
    }

    #[test]
    fn test_generate_road_markings_broken() {
        let pts = two_points(30.0);
        let v = generate_road_markings(&pts, &[mark(RoadMarkType::Broken, RoadMarkColor::Yellow, 0.15)], 0.0);
        assert!(!v.is_empty());
    }

    #[test]
    fn test_generate_road_markings_solid_solid() {
        let pts = two_points(10.0);
        let v = generate_road_markings(
            &pts,
            &[mark(RoadMarkType::SolidSolid, RoadMarkColor::White, 0.3)],
            0.0,
        );
        assert!(!v.is_empty());
    }

    #[test]
    fn test_generate_road_markings_stop_line() {
        let pts = two_points(10.0);
        let v = generate_road_markings(
            &pts,
            &[mark(RoadMarkType::StopLine, RoadMarkColor::White, 0.5)],
            0.0,
        );
        assert_eq!(v.len(), 6);
    }

    #[test]
    fn test_generate_road_markings_default_arm() {
        // Curb falls through to the default solid-line arm.
        let pts = two_points(10.0);
        let v = generate_road_markings(&pts, &[mark(RoadMarkType::Curb, RoadMarkColor::Red, 0.2)], 0.0);
        assert!(!v.is_empty());
    }
}
