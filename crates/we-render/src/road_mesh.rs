//! Road mesh generation — converts OpenDRIVE road data into renderable triangle meshes.
//!
//! Uses the geometry evaluator from we-core to sample reference lines,
//! then generates triangle strips for the road surface per lane.

use crate::render_config::RoadRenderConfig;
use crate::vertex::ColorVertex;
use we_core::geometry::eval::{
    evaluate_elevation, evaluate_lane_width, offset_point, sample_road_reference_line,
};
use we_core::model::{LaneType, Road, RoadMarkColor};

/// Color palette for lane types (RGBA), read from RoadRenderConfig.
fn lane_color(lane_type: LaneType, config: &RoadRenderConfig) -> [f32; 4] {
    let c = match lane_type {
        LaneType::Driving => config.color_surface_drivable,
        LaneType::Shoulder => config.color_surface_shoulder,
        LaneType::Sidewalk => config.color_surface_sidewalk,
        LaneType::Median => config.color_surface_median,
        LaneType::Border => config.color_surface_border,
        LaneType::None => config.color_surface_other,
        _ => config.color_surface_other,
    };
    [c.x, c.y, c.z, c.w]
}

/// Generate colored triangle vertices for all lanes of a road.
///
/// Returns a flat `Vec<ColorVertex>` ready for GPU upload.
pub fn generate_road_mesh(
    road: &Road,
    sample_step: f64,
    config: &RoadRenderConfig,
) -> Vec<ColorVertex> {
    let ref_pts = sample_road_reference_line(road, sample_step);
    if ref_pts.len() < 2 {
        return Vec::new();
    }

    let alpha = config.surface_alpha;
    let z_offset = config.surface_z_offset;
    let mut all_verts = Vec::new();

    for section in &road.lane_sections {
        let section_end_s = road
            .lane_sections
            .iter()
            .find(|ls| ls.s > section.s + 1e-9)
            .map(|ls| ls.s)
            .unwrap_or(road.length);

        // Filter reference points for this lane section
        let section_pts: Vec<_> = ref_pts
            .iter()
            .filter(|p| p.s >= section.s - 1e-9 && p.s <= section_end_s + 1e-9)
            .collect();

        if section_pts.len() < 2 {
            continue;
        }

        // Generate lanes: right side (negative IDs, inner to outer)
        let mut right_sorted: Vec<_> = section.right.iter().collect();
        right_sorted.sort_by_key(|l| l.id.abs());

        let mut right_offset = 0.0;
        for lane in &right_sorted {
            let color = lane_color(lane.lane_type, config);
            let verts = generate_lane_strip(
                &section_pts,
                &lane.width,
                section.s,
                &road.elevation_profile,
                right_offset,
                false, // right side
                color,
            );
            right_offset += average_width(&lane.width);
            all_verts.extend(verts);
        }

        // Generate lanes: left side (positive IDs, inner to outer)
        let mut left_sorted: Vec<_> = section.left.iter().collect();
        left_sorted.sort_by_key(|l| l.id);

        let mut left_offset = 0.0;
        for lane in &left_sorted {
            let color = lane_color(lane.lane_type, config);
            let verts = generate_lane_strip(
                &section_pts,
                &lane.width,
                section.s,
                &road.elevation_profile,
                left_offset,
                true, // left side
                color,
            );
            left_offset += average_width(&lane.width);
            all_verts.extend(verts);
        }
    }

    // If no lanes, generate a default road surface ribbon (3.5m each side)
    if all_verts.is_empty() && ref_pts.len() >= 2 {
        all_verts = generate_default_ribbon(&ref_pts, &road.elevation_profile, 3.5, alpha, z_offset);
    }

    all_verts
}

/// Generate a triangle strip for a single lane.
fn generate_lane_strip(
    ref_pts: &[&we_core::geometry::eval::RefLinePoint],
    widths: &[we_core::model::LaneWidth],
    section_s: f64,
    elevations: &[we_core::model::Elevation],
    inner_offset: f64,
    is_left: bool,
    color: [f32; 4],
) -> Vec<ColorVertex> {
    let mut verts = Vec::new();

    for i in 0..ref_pts.len() - 1 {
        let pt0 = ref_pts[i];
        let pt1 = ref_pts[i + 1];

        let ds0 = pt0.s - section_s;
        let ds1 = pt1.s - section_s;

        let w0 = evaluate_lane_width(widths, ds0);
        let w1 = evaluate_lane_width(widths, ds1);

        let z0 = evaluate_elevation(elevations, pt0.s) as f32;
        let z1 = evaluate_elevation(elevations, pt1.s) as f32;

        // Inner and outer edges
        let (inner0, outer0) = if is_left {
            (inner_offset, inner_offset + w0)
        } else {
            (-inner_offset, -(inner_offset + w0))
        };

        let (inner1, outer1) = if is_left {
            (inner_offset, inner_offset + w1)
        } else {
            (-inner_offset, -(inner_offset + w1))
        };

        let (ix0, iy0, _) = offset_point(pt0, inner0, 0.0);
        let (ox0, oy0, _) = offset_point(pt0, outer0, 0.0);
        let (ix1, iy1, _) = offset_point(pt1, inner1, 0.0);
        let (ox1, oy1, _) = offset_point(pt1, outer1, 0.0);

        // Two triangles: inner0-outer0-inner1, outer0-outer1-inner1
        verts.push(ColorVertex::new([ix0 as f32, iy0 as f32, z0], color));
        verts.push(ColorVertex::new([ox0 as f32, oy0 as f32, z0], color));
        verts.push(ColorVertex::new([ix1 as f32, iy1 as f32, z1], color));

        verts.push(ColorVertex::new([ox0 as f32, oy0 as f32, z0], color));
        verts.push(ColorVertex::new([ox1 as f32, oy1 as f32, z1], color));
        verts.push(ColorVertex::new([ix1 as f32, iy1 as f32, z1], color));
    }

    verts
}

/// Generate a default ribbon when no lane sections are defined.
fn generate_default_ribbon(
    ref_pts: &[we_core::geometry::eval::RefLinePoint],
    elevations: &[we_core::model::Elevation],
    half_width: f64,
    alpha: f32,
    _z_offset: f32,
) -> Vec<ColorVertex> {
    let color = [0.35, 0.35, 0.38, alpha]; // asphalt
    let mut verts = Vec::new();

    for i in 0..ref_pts.len() - 1 {
        let pt0 = &ref_pts[i];
        let pt1 = &ref_pts[i + 1];

        let z0 = evaluate_elevation(elevations, pt0.s) as f32;
        let z1 = evaluate_elevation(elevations, pt1.s) as f32;

        let (lx0, ly0, _) = offset_point(pt0, half_width, 0.0);
        let (rx0, ry0, _) = offset_point(pt0, -half_width, 0.0);
        let (lx1, ly1, _) = offset_point(pt1, half_width, 0.0);
        let (rx1, ry1, _) = offset_point(pt1, -half_width, 0.0);

        verts.push(ColorVertex::new([lx0 as f32, ly0 as f32, z0], color));
        verts.push(ColorVertex::new([rx0 as f32, ry0 as f32, z0], color));
        verts.push(ColorVertex::new([lx1 as f32, ly1 as f32, z1], color));

        verts.push(ColorVertex::new([rx0 as f32, ry0 as f32, z0], color));
        verts.push(ColorVertex::new([rx1 as f32, ry1 as f32, z1], color));
        verts.push(ColorVertex::new([lx1 as f32, ly1 as f32, z1], color));
    }

    verts
}

/// Average width using numerical integration (sample 10 points along s direction).
fn average_width(widths: &[we_core::model::LaneWidth]) -> f64 {
    if widths.is_empty() {
        return 0.0;
    }
    // Determine the range of s_offsets covered
    let s_max = widths.iter().map(|w| w.s_offset + w.d * 100.0 + w.c * 100.0).fold(0.0_f64, f64::max);
    let s_max = s_max.max(100.0); // at least 100m to sample
    const N: usize = 10;
    let mut sum = 0.0_f64;
    for i in 0..N {
        let s = s_max * (i as f64) / (N as f64 - 1.0);
        sum += evaluate_lane_width(widths, s);
    }
    sum / N as f64
}

/// Generate lane boundary lines (solid/dashed) based on roadMark attributes.
/// Returns vertices for both left and right boundaries of a lane.
pub fn generate_lane_lines(
    lane: &we_core::model::Lane,
    ref_pts: &[&we_core::geometry::eval::RefLinePoint],
    section_s: f64,
    elevations: &[we_core::model::Elevation],
    inner_offset: f64,
    is_left: bool,
) -> Vec<ColorVertex> {
    let mut verts = Vec::new();
    if ref_pts.len() < 2 {
        return verts;
    }

    // Determine road marking properties (use first roadMark entry if any)
    let road_mark = lane.road_marks.first();
    let (line_width, line_color) = if let Some(rm) = road_mark {
        // Parse width, default 0.15m
        let width = if rm.width > 0.0 {
            rm.width as f32
        } else {
            0.15
        };
        // Parse color string
        let color = match rm.color {
            RoadMarkColor::Yellow => [1.0, 1.0, 0.0, 1.0],
            RoadMarkColor::Red => [1.0, 0.0, 0.0, 1.0],
            RoadMarkColor::Blue => [0.0, 0.0, 1.0, 1.0],
            RoadMarkColor::Green => [0.0, 1.0, 0.0, 1.0],
            _ => [1.0, 1.0, 1.0, 1.0], // default white
        };
        (width, color)
    } else {
        // No road marking, use default white solid line
        (0.15, [1.0, 1.0, 1.0, 1.0])
    };
    // Height offset above road surface (slightly elevated)
    let height_offset = 0.01;

    for i in 0..ref_pts.len() - 1 {
        let pt0 = ref_pts[i];
        let pt1 = ref_pts[i + 1];

        let ds0 = pt0.s - section_s;
        let ds1 = pt1.s - section_s;

        let w0 = evaluate_lane_width(&lane.width, ds0);
        let w1 = evaluate_lane_width(&lane.width, ds1);

        let z0 = evaluate_elevation(elevations, pt0.s) as f32 + height_offset;
        let z1 = evaluate_elevation(elevations, pt1.s) as f32 + height_offset;

        // Inner and outer edges of the lane
        let (inner0, outer0) = if is_left {
            (inner_offset, inner_offset + w0)
        } else {
            (-inner_offset, -(inner_offset + w0))
        };
        let (inner1, outer1) = if is_left {
            (inner_offset, inner_offset + w1)
        } else {
            (-inner_offset, -(inner_offset + w1))
        };

        // Generate left boundary line (inner edge of lane)
        // We'll generate a thin quadrilateral along the inner edge
        // Line width extends half to each side of the edge
        let half_width = line_width * 0.5;
        // For simplicity, we generate a line strip with width perpendicular to the edge direction.
        // Compute offset direction: perpendicular to the segment direction.
        let dx = pt1.x - pt0.x;
        let dy = pt1.y - pt0.y;
        let len = (dx * dx + dy * dy).sqrt();
        if len < 1e-9 {
            continue;
        }
        let nx = -dy / len; // unit normal (perpendicular to segment direction)
        let ny = dx / len;
        // Adjust for left/right side: normal should point outward from lane?
        // For inner edge, we want line centered on edge, so we can shift half width inward/outward.
        // We'll just generate a line strip with width perpendicular to the edge.
        // Compute two points offset by half width in normal direction.
        let (nx0, ny0) = (nx as f32, ny as f32);
        let (nx1, ny1) = (nx as f32, ny as f32);
        // Edge points at inner edge
        let (ix0, iy0, _) = offset_point(pt0, inner0, 0.0);
        let (ix1, iy1, _) = offset_point(pt1, inner1, 0.0);
        // Generate two triangles for the line segment
        // p0_left = (ix0 - half_width * nx, iy0 - half_width * ny)
        // p0_right = (ix0 + half_width * nx, iy0 + half_width * ny)
        // similarly for p1
        let p0_lx = ix0 as f32 - half_width * nx0;
        let p0_ly = iy0 as f32 - half_width * ny0;
        let p0_rx = ix0 as f32 + half_width * nx0;
        let p0_ry = iy0 as f32 + half_width * ny0;
        let p1_lx = ix1 as f32 - half_width * nx1;
        let p1_ly = iy1 as f32 - half_width * ny1;
        let p1_rx = ix1 as f32 + half_width * nx1;
        let p1_ry = iy1 as f32 + half_width * ny1;

        verts.push(ColorVertex::new([p0_lx, p0_ly, z0], line_color));
        verts.push(ColorVertex::new([p0_rx, p0_ry, z0], line_color));
        verts.push(ColorVertex::new([p1_lx, p1_ly, z1], line_color));

        verts.push(ColorVertex::new([p0_rx, p0_ry, z0], line_color));
        verts.push(ColorVertex::new([p1_rx, p1_ry, z1], line_color));
        verts.push(ColorVertex::new([p1_lx, p1_ly, z1], line_color));

        // Also generate right boundary line (outer edge of lane) if lane is outermost?
        // For simplicity, we generate both inner and outer edges for each lane.
        // But outer edge may be shared with adjacent lane; we'll duplicate for now.
        let (ox0, oy0, _) = offset_point(pt0, outer0, 0.0);
        let (ox1, oy1, _) = offset_point(pt1, outer1, 0.0);
        let po0_lx = ox0 as f32 - half_width * nx0;
        let po0_ly = oy0 as f32 - half_width * ny0;
        let po0_rx = ox0 as f32 + half_width * nx0;
        let po0_ry = oy0 as f32 + half_width * ny0;
        let po1_lx = ox1 as f32 - half_width * nx1;
        let po1_ly = oy1 as f32 - half_width * ny1;
        let po1_rx = ox1 as f32 + half_width * nx1;
        let po1_ry = oy1 as f32 + half_width * ny1;

        verts.push(ColorVertex::new([po0_lx, po0_ly, z0], line_color));
        verts.push(ColorVertex::new([po0_rx, po0_ry, z0], line_color));
        verts.push(ColorVertex::new([po1_lx, po1_ly, z1], line_color));

        verts.push(ColorVertex::new([po0_rx, po0_ry, z0], line_color));
        verts.push(ColorVertex::new([po1_rx, po1_ry, z1], line_color));
        verts.push(ColorVertex::new([po1_lx, po1_ly, z1], line_color));
    }

    verts
}

/// Generate lane boundary lines for all lanes of a road.
/// Returns a flat `Vec<ColorVertex>` ready for GPU upload.
pub fn generate_road_lane_lines(road: &Road, sample_step: f64) -> Vec<ColorVertex> {
    let ref_pts = sample_road_reference_line(road, sample_step);
    if ref_pts.len() < 2 {
        return Vec::new();
    }

    let mut all_verts = Vec::new();

    for section in &road.lane_sections {
        let section_end_s = road
            .lane_sections
            .iter()
            .find(|ls| ls.s > section.s + 1e-9)
            .map(|ls| ls.s)
            .unwrap_or(road.length);

        // Filter reference points for this lane section
        let section_pts: Vec<_> = ref_pts
            .iter()
            .filter(|p| p.s >= section.s - 1e-9 && p.s <= section_end_s + 1e-9)
            .collect();

        if section_pts.len() < 2 {
            continue;
        }

        // Generate lanes: right side (negative IDs, inner to outer)
        let mut right_sorted: Vec<_> = section.right.iter().collect();
        right_sorted.sort_by_key(|l| l.id.abs());

        let mut right_offset = 0.0;
        for lane in &right_sorted {
            let verts = generate_lane_lines(
                lane,
                &section_pts,
                section.s,
                &road.elevation_profile,
                right_offset,
                false, // right side
            );
            right_offset += average_width(&lane.width);
            all_verts.extend(verts);
        }

        // Generate lanes: left side (positive IDs, inner to outer)
        let mut left_sorted: Vec<_> = section.left.iter().collect();
        left_sorted.sort_by_key(|l| l.id);

        let mut left_offset = 0.0;
        for lane in &left_sorted {
            let verts = generate_lane_lines(
                lane,
                &section_pts,
                section.s,
                &road.elevation_profile,
                left_offset,
                true, // left side
            );
            left_offset += average_width(&lane.width);
            all_verts.extend(verts);
        }
    }

    all_verts
}

#[cfg(test)]
mod tests {
    use super::*;
    use we_core::model::*;

    fn default_config() -> RoadRenderConfig {
        RoadRenderConfig::default()
    }

    fn simple_road() -> Road {
        let mut road = Road::new("1", 100.0);
        road.plan_view.push(Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 100.0,
            geo_type: GeometryType::Line,
        });
        road
    }

    fn road_with_lanes() -> Road {
        let mut road = simple_road();
        road.lane_sections.push(LaneSection {
            s: 0.0,
            single_side: false,
            render_hidden: false,
            left: vec![Lane {
                id: 1,
                lane_type: LaneType::Driving,
                level: 0,
                render_hidden: false,
                link: None,
                width: vec![LaneWidth {
                    s_offset: 0.0,
                    a: 3.5,
                    b: 0.0,
                    c: 0.0,
                    d: 0.0,
                }],
                borders: vec![],
                road_marks: vec![],
            }],
            center: vec![Lane {
                id: 0,
                lane_type: LaneType::None,
                level: 0,
                render_hidden: false,
                link: None,
                width: vec![],
                borders: vec![],
                road_marks: vec![],
            }],
            right: vec![Lane {
                id: -1,
                lane_type: LaneType::Driving,
                level: 0,
                render_hidden: false,
                link: None,
                width: vec![LaneWidth {
                    s_offset: 0.0,
                    a: 3.5,
                    b: 0.0,
                    c: 0.0,
                    d: 0.0,
                }],
                borders: vec![],
                road_marks: vec![],
            }],
        });
        road
    }

    #[test]
    fn test_generate_road_mesh_no_lanes_uses_default_ribbon() {
        let road = simple_road();
        let verts = generate_road_mesh(&road, 10.0, &default_config());
        // 11 sample points → 10 segments → 10 * 6 = 60 vertices
        assert_eq!(verts.len(), 60);
    }

    #[test]
    fn test_generate_road_mesh_with_lanes() {
        let road = road_with_lanes();
        let verts = generate_road_mesh(&road, 10.0, &default_config());
        // 2 lanes * 10 segments * 6 verts = 120
        assert_eq!(verts.len(), 120);
    }

    #[test]
    fn test_mesh_vertices_are_finite() {
        let road = road_with_lanes();
        let verts = generate_road_mesh(&road, 5.0, &default_config());
        for v in &verts {
            assert!(v.position[0].is_finite());
            assert!(v.position[1].is_finite());
            assert!(v.position[2].is_finite());
        }
    }

    #[test]
    fn test_mesh_with_elevation() {
        let mut road = road_with_lanes();
        road.elevation_profile.push(Elevation {
            s: 0.0,
            a: 0.0,
            b: 0.1,
            c: 0.0,
            d: 0.0,
        });
        let verts = generate_road_mesh(&road, 50.0, &default_config());
        // Check that z values increase along the road
        let first_z = verts[0].position[2];
        let last_z = verts.last().unwrap().position[2];
        assert!(last_z > first_z);
    }

    #[test]
    fn test_mesh_empty_road() {
        let road = Road::new("empty", 0.0);
        let verts = generate_road_mesh(&road, 10.0, &default_config());
        assert!(verts.is_empty());
    }

    #[test]
    fn test_average_width_constant() {
        let widths = vec![LaneWidth { s_offset: 0.0, a: 3.5, b: 0.0, c: 0.0, d: 0.0 }];
        let avg = average_width(&widths);
        assert!((avg - 3.5).abs() < 0.01);
    }

    #[test]
    fn test_average_width_linear() {
        // Linearly increasing width: w(s) = 3.0 + 0.01*s, average over 100m = 3.5
        let widths = vec![LaneWidth { s_offset: 0.0, a: 3.0, b: 0.01, c: 0.0, d: 0.0 }];
        let avg = average_width(&widths);
        assert!((avg - 3.5).abs() < 0.1);
    }

    #[test]
    fn test_average_width_empty() {
        let avg = average_width(&[]);
        assert!(avg.abs() < 1e-9);
    }

    #[test]
    fn test_lane_colors_differ() {
        let config = default_config();
        let driving = lane_color(LaneType::Driving, &config);
        let sidewalk = lane_color(LaneType::Sidewalk, &config);
        assert_ne!(driving, sidewalk);
    }
}
