//! Road-level transformation operations.
//!
//! Pure algorithms for cloning, reversing, mirroring, and optimizing roads.
//! All operations are WASM-compatible and side-effect free (return new Roads).

pub mod optimize;
pub mod split;
pub mod swap_centerline;
pub mod transform;
pub mod weld;

#[allow(unused_imports)]
pub use split::*;
#[allow(unused_imports)]
pub use weld::*;
pub use optimize::{OptimizeConfig, optimize_road_knots};
pub use swap_centerline::swap_centerline_with_edge;
pub use transform::{clone_road, mirror_road, reverse_road};

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;
    use crate::model::{
        Geometry, GeometryType, Lane, LaneSection, LaneType, LaneWidth, LinkElement,
        LinkElementType, Road, RoadLink, Signal,
    };

    fn make_link(pred: Option<&str>, succ: Option<&str>) -> Option<RoadLink> {
        let make_el = |id: &str| LinkElement {
            element_type: LinkElementType::Road,
            element_id: id.to_string(),
            contact_point: None,
        };
        Some(RoadLink {
            predecessor: pred.map(make_el),
            successor: succ.map(make_el),
        })
    }

    fn make_road_with_line(id: &str) -> Road {
        let mut road = Road::new(id, 100.0);
        road.plan_view = vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 100.0,
            geo_type: GeometryType::Line,
        }];
        road
    }

    fn make_road_with_lane_sections(id: &str) -> Road {
        let make_lane = |lane_id: i32| Lane {
            id: lane_id,
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
        };
        let section = LaneSection {
            s: 0.0,
            single_side: false,
            render_hidden: false,
            left: vec![make_lane(1), make_lane(2)],
            center: vec![make_lane(0)],
            right: vec![make_lane(-1), make_lane(-2)],
        };
        let mut road = make_road_with_line(id);
        road.lane_sections = vec![section];
        road
    }

    // ── clone_road ────────────────────────────────────────────────────────────

    #[test]
    fn test_clone_road_assigns_new_id() {
        let road = make_road_with_line("original");
        let cloned = clone_road(&road, "copy", [0.0, 0.0]);
        assert_eq!(cloned.id, "copy");
        assert_eq!(road.id, "original"); // original unchanged
    }

    #[test]
    fn test_clone_road_applies_xy_offset() {
        let road = make_road_with_line("r1");
        let cloned = clone_road(&road, "r2", [10.0, 20.0]);
        assert!((cloned.plan_view[0].x - 10.0).abs() < 1e-9);
        assert!((cloned.plan_view[0].y - 20.0).abs() < 1e-9);
        // Original should be untouched
        assert!((road.plan_view[0].x - 0.0).abs() < 1e-9);
    }

    #[test]
    fn test_clone_road_zero_offset_keeps_same_geometry() {
        let road = make_road_with_line("r1");
        let cloned = clone_road(&road, "r2", [0.0, 0.0]);
        assert_eq!(cloned.plan_view.len(), road.plan_view.len());
        assert!((cloned.plan_view[0].x - road.plan_view[0].x).abs() < 1e-9);
    }

    #[test]
    fn test_clone_road_clears_links() {
        let mut road = make_road_with_line("r1");
        road.link = make_link(Some("prev"), Some("next"));
        let cloned = clone_road(&road, "r2", [0.0, 0.0]);
        assert!(cloned.link.is_none());
    }

    #[test]
    fn test_clone_road_preserves_length() {
        let road = make_road_with_line("r1");
        let cloned = clone_road(&road, "r2", [5.0, 5.0]);
        assert!((cloned.length - road.length).abs() < 1e-9);
    }

    #[test]
    fn test_clone_road_is_independent() {
        let mut road = make_road_with_lane_sections("r1");
        let cloned = clone_road(&road, "r2", [0.0, 0.0]);
        // Mutating original should not affect clone
        road.lane_sections[0].left[0].id = 99;
        assert_eq!(cloned.lane_sections[0].left[0].id, 1);
    }

    // ── reverse_road ─────────────────────────────────────────────────────────

    #[test]
    fn test_reverse_road_same_length() {
        let road = make_road_with_line("r1");
        let rev = reverse_road(&road);
        assert!((rev.length - road.length).abs() < 1e-9);
    }

    #[test]
    fn test_reverse_road_line_start_is_old_end() {
        let road = make_road_with_line("r1");
        // Line goes from (0,0) heading 0, length 100  → end at (100, 0)
        let rev = reverse_road(&road);
        assert_eq!(rev.plan_view.len(), 1);
        assert!(
            (rev.plan_view[0].x - 100.0).abs() < 1e-6,
            "start x should be 100, got {}",
            rev.plan_view[0].x
        );
        assert!((rev.plan_view[0].y - 0.0).abs() < 1e-6);
    }

    #[test]
    fn test_reverse_road_line_heading_flipped() {
        let road = make_road_with_line("r1");
        let rev = reverse_road(&road);
        // Reversed heading should be ~π (pointing in -X direction)
        let hdg = rev.plan_view[0].hdg;
        assert!(
            (hdg.abs() - PI).abs() < 1e-6,
            "heading should be ±π, got {}",
            hdg
        );
    }

    #[test]
    fn test_reverse_road_multiple_segments_reorder() {
        let mut road = Road::new("r1", 30.0);
        road.plan_view = vec![
            Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length: 10.0,
                geo_type: GeometryType::Line,
            },
            Geometry {
                s: 10.0,
                x: 10.0,
                y: 0.0,
                hdg: 0.0,
                length: 10.0,
                geo_type: GeometryType::Line,
            },
            Geometry {
                s: 20.0,
                x: 20.0,
                y: 0.0,
                hdg: 0.0,
                length: 10.0,
                geo_type: GeometryType::Line,
            },
        ];
        let rev = reverse_road(&road);
        assert_eq!(rev.plan_view.len(), 3);
        // The first segment in reversed road starts near x=30 (end of original)
        assert!(
            (rev.plan_view[0].x - 30.0).abs() < 1e-6,
            "expected x≈30, got {}",
            rev.plan_view[0].x
        );
        // s values must be monotone from 0
        assert!((rev.plan_view[0].s - 0.0).abs() < 1e-9);
        assert!((rev.plan_view[1].s - 10.0).abs() < 1e-9);
        assert!((rev.plan_view[2].s - 20.0).abs() < 1e-9);
    }

    #[test]
    fn test_reverse_road_arc_negates_curvature() {
        let mut road = Road::new("r1", 50.0);
        road.plan_view = vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 50.0,
            geo_type: GeometryType::Arc { curvature: 0.02 },
        }];
        let rev = reverse_road(&road);
        if let GeometryType::Arc { curvature } = rev.plan_view[0].geo_type {
            assert!((curvature - (-0.02)).abs() < 1e-9);
        } else {
            panic!("Expected Arc");
        }
    }

    #[test]
    fn test_reverse_road_spiral_swaps_curv() {
        let mut road = Road::new("r1", 60.0);
        road.plan_view = vec![Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 60.0,
            geo_type: GeometryType::Spiral {
                curv_start: 0.0,
                curv_end: 0.02,
            },
        }];
        let rev = reverse_road(&road);
        if let GeometryType::Spiral {
            curv_start,
            curv_end,
        } = rev.plan_view[0].geo_type
        {
            assert!(
                (curv_start - (-0.02)).abs() < 1e-9,
                "curv_start should be -0.02, got {}",
                curv_start
            );
            assert!(
                (curv_end - 0.0).abs() < 1e-9,
                "curv_end should be 0.0, got {}",
                curv_end
            );
        } else {
            panic!("Expected Spiral");
        }
    }

    #[test]
    fn test_reverse_road_swaps_predecessor_successor() {
        let mut road = make_road_with_line("r1");
        road.link = make_link(Some("prev-road"), Some("succ-road"));
        let rev = reverse_road(&road);
        let link = rev.link.as_ref().unwrap();
        assert_eq!(link.predecessor.as_ref().unwrap().element_id, "succ-road");
        assert_eq!(link.successor.as_ref().unwrap().element_id, "prev-road");
    }

    #[test]
    fn test_reverse_road_swaps_left_right_lanes() {
        let road = make_road_with_lane_sections("r1");
        // Original: left=[1,2], right=[-1,-2]
        let rev = reverse_road(&road);
        let sec = &rev.lane_sections[0];
        // After reverse+negate: left was right ([-1,-2]) → negated → [1,2]
        let left_ids: Vec<i32> = sec.left.iter().map(|l| l.id).collect();
        let right_ids: Vec<i32> = sec.right.iter().map(|l| l.id).collect();
        // All left IDs should be positive (came from right, negated)
        assert!(
            left_ids.iter().all(|&id| id > 0),
            "left IDs should be positive: {:?}",
            left_ids
        );
        // All right IDs should be negative
        assert!(
            right_ids.iter().all(|&id| id < 0),
            "right IDs should be negative: {:?}",
            right_ids
        );
    }

    #[test]
    fn test_reverse_road_no_link() {
        let road = make_road_with_line("r1");
        let rev = reverse_road(&road);
        assert!(rev.link.is_none());
    }

    // ── mirror_road ───────────────────────────────────────────────────────────

    #[test]
    fn test_mirror_road_swaps_left_right_lanes() {
        let road = make_road_with_lane_sections("r1");
        let mirrored = mirror_road(&road);
        let sec = &mirrored.lane_sections[0];
        // After swap: left was [-1,-2] negated → [1,2]; right was [1,2] negated → [-1,-2]
        let left_ids: Vec<i32> = sec.left.iter().map(|l| l.id).collect();
        let right_ids: Vec<i32> = sec.right.iter().map(|l| l.id).collect();
        assert!(
            left_ids.iter().all(|&id| id > 0),
            "left IDs should be positive: {:?}",
            left_ids
        );
        assert!(
            right_ids.iter().all(|&id| id < 0),
            "right IDs should be negative: {:?}",
            right_ids
        );
    }

    #[test]
    fn test_mirror_road_preserves_lane_count() {
        let road = make_road_with_lane_sections("r1");
        let mirrored = mirror_road(&road);
        assert_eq!(
            mirrored.lane_sections[0].left.len(),
            road.lane_sections[0].right.len()
        );
        assert_eq!(
            mirrored.lane_sections[0].right.len(),
            road.lane_sections[0].left.len()
        );
    }

    #[test]
    fn test_mirror_road_preserves_geometry() {
        let road = make_road_with_line("r1");
        let mirrored = mirror_road(&road);
        assert_eq!(mirrored.plan_view.len(), road.plan_view.len());
        assert!((mirrored.plan_view[0].x - road.plan_view[0].x).abs() < 1e-9);
        assert!((mirrored.plan_view[0].y - road.plan_view[0].y).abs() < 1e-9);
    }

    #[test]
    fn test_mirror_road_is_independent() {
        let mut road = make_road_with_lane_sections("r1");
        let mirrored = mirror_road(&road);
        road.lane_sections[0].left[0].id = 99;
        // mirrored.left came from road.right (id -1), negated to +1
        assert_eq!(mirrored.lane_sections[0].left[0].id, 1);
    }

    #[test]
    fn test_mirror_road_center_lane_unchanged() {
        let road = make_road_with_lane_sections("r1");
        let mirrored = mirror_road(&road);
        assert_eq!(mirrored.lane_sections[0].center[0].id, 0);
    }

    // ── reverse/mirror edge cases ─────────────────────────────────────────────

    #[test]
    fn test_reverse_road_empty_geometry_returns_empty() {
        let road = Road::new("empty", 0.0);
        let rev = reverse_road(&road);
        assert!(rev.plan_view.is_empty());
    }

    #[test]
    fn test_mirror_road_empty_geometry_returns_empty() {
        let road = Road::new("empty", 0.0);
        let mirrored = mirror_road(&road);
        assert!(mirrored.plan_view.is_empty());
    }

    #[test]
    fn test_reverse_road_preserves_signals() {
        let mut road = make_road_with_line("r1");
        road.signals = vec![Signal {
            id: "sig1".to_string(),
            name: "Stop".to_string(),
            s: 50.0,
            t: 2.0,
            z_offset: 3.0,
            h_offset: 0.0,
            width: 0.6,
            height: 0.6,
            value: None,
            signal_type: "sign".to_string(),
            signal_subtype: "stop".to_string(),
            orientation: "+".to_string(),
            is_dynamic: false,
            country: String::new(),
            unit: String::new(),
            validities: Vec::new(),
        }];
        let rev = reverse_road(&road);
        assert_eq!(rev.signals.len(), 1);
        assert_eq!(rev.signals[0].id, "sig1");
    }

    #[test]
    fn test_mirror_road_preserves_signals() {
        let mut road = make_road_with_lane_sections("r1");
        road.signals = vec![Signal {
            id: "sig1".to_string(),
            name: "Speed".to_string(),
            s: 25.0,
            t: -1.5,
            z_offset: 2.5,
            h_offset: 0.0,
            width: 0.5,
            height: 0.8,
            value: Some("30".to_string()),
            signal_type: "sign".to_string(),
            signal_subtype: "speed".to_string(),
            orientation: "+".to_string(),
            is_dynamic: false,
            country: String::new(),
            unit: String::new(),
            validities: Vec::new(),
        }];
        let mirrored = mirror_road(&road);
        assert_eq!(mirrored.signals.len(), 1);
        assert_eq!(mirrored.signals[0].id, "sig1");
    }

    #[test]
    fn test_reverse_road_elevation_profile_reversed() {
        use crate::model::Elevation;
        let mut road = make_road_with_line("r1");
        road.elevation_profile = vec![
            Elevation { s: 0.0, a: 0.0, b: 0.1, c: 0.0, d: 0.0 },
            Elevation { s: 50.0, a: 5.0, b: -0.05, c: 0.0, d: 0.0 },
        ];
        let rev = reverse_road(&road);
        // After reversing: s values should be 100-original_s, sorted
        assert_eq!(rev.elevation_profile.len(), 2);
        assert!((rev.elevation_profile[0].s - 50.0).abs() < 1e-9);
        assert!((rev.elevation_profile[1].s - 100.0).abs() < 1e-9);
    }

    #[test]
    fn test_reverse_road_no_lane_sections() {
        let road = make_road_with_line("r1");
        // No lane sections
        let rev = reverse_road(&road);
        assert!(rev.lane_sections.is_empty());
    }

    #[test]
    fn test_mirror_road_no_lane_sections() {
        let road = make_road_with_line("r1");
        let mirrored = mirror_road(&road);
        assert!(mirrored.lane_sections.is_empty());
    }

    #[test]
    fn test_mirror_road_multiple_lane_sections() {
        let make_lane = |lane_id: i32| Lane {
            id: lane_id,
            lane_type: LaneType::Driving,
            level: 0,
            render_hidden: false,
            link: None,
            width: vec![LaneWidth { s_offset: 0.0, a: 3.5, b: 0.0, c: 0.0, d: 0.0 }],
            borders: vec![],
            road_marks: vec![],
        };
        let mut road = make_road_with_line("r1");
        road.lane_sections = vec![
            LaneSection {
                s: 0.0,
                single_side: false,
                render_hidden: false,
                left: vec![make_lane(1)],
                center: vec![make_lane(0)],
                right: vec![make_lane(-1), make_lane(-2)],
            },
            LaneSection {
                s: 50.0,
                single_side: false,
                render_hidden: false,
                left: vec![make_lane(1), make_lane(2), make_lane(3)],
                center: vec![make_lane(0)],
                right: vec![make_lane(-1)],
            },
        ];
        let mirrored = mirror_road(&road);
        assert_eq!(mirrored.lane_sections.len(), 2);
        // Section 0: left was [1], right was [-1,-2] → after swap: left=2 lanes, right=1 lane
        assert_eq!(mirrored.lane_sections[0].left.len(), 2);
        assert_eq!(mirrored.lane_sections[0].right.len(), 1);
        // Section 1: left was [1,2,3], right was [-1] → after swap: left=1 lane, right=3 lanes
        assert_eq!(mirrored.lane_sections[1].left.len(), 1);
        assert_eq!(mirrored.lane_sections[1].right.len(), 3);
    }

    // ── optimize_road_knots ───────────────────────────────────────────────────

    #[test]
    fn test_optimize_no_change_for_simple_road() {
        // A single straight-line geometry segment is already optimal.
        let road = make_road_with_line("r1");
        let config = OptimizeConfig::default();
        let (optimized, _removed) = optimize_road_knots(&road, &config);
        // Result must still be a valid non-empty road
        assert!(
            !optimized.plan_view.is_empty(),
            "optimized road should still have geometry"
        );
        assert!(
            optimized.length > 0.0,
            "optimized road should have positive length"
        );
    }

    #[test]
    fn test_optimize_empty_road_returns_unchanged() {
        let road = Road::new("empty", 0.0);
        let config = OptimizeConfig::default();
        let (optimized, removed) = optimize_road_knots(&road, &config);
        assert_eq!(removed, 0);
        assert!(optimized.plan_view.is_empty());
    }

    #[test]
    fn test_optimize_collinear_points_removed() {
        // Road with three collinear geometry segments — middle one is redundant
        let mut road = Road::new("r1", 30.0);
        road.plan_view = vec![
            Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length: 10.0,
                geo_type: GeometryType::Line,
            },
            Geometry {
                s: 10.0,
                x: 10.0,
                y: 0.0,
                hdg: 0.0,
                length: 10.0,
                geo_type: GeometryType::Line,
            },
            Geometry {
                s: 20.0,
                x: 20.0,
                y: 0.0,
                hdg: 0.0,
                length: 10.0,
                geo_type: GeometryType::Line,
            },
        ];
        let config = OptimizeConfig {
            xy_threshold: 0.1,
            z_threshold: 0.005,
        };
        let (optimized, removed) = optimize_road_knots(&road, &config);
        // The resulting road should have fewer or equal geometry segments
        assert!(optimized.plan_view.len() <= road.plan_view.len());
        let _ = removed;
    }

    // ── swap_centerline_with_edge ─────────────────────────────────────────────

    #[test]
    fn test_swap_centerline_with_left_lane_offsets_refline() {
        // Road with left lane 1 (width 3.5m), right lane -1 (width 3.5m)
        // Swapping with left lane 1 outer edge should shift refline 3.5m to the left
        let road = make_road_with_lane_sections("r1");
        let swapped = swap_centerline_with_edge(&road, 1);
        // New plan_view start should be offset 3.5m perpendicular (heading=0, so +Y direction)
        assert!(
            !swapped.plan_view.is_empty(),
            "swapped road should have geometry"
        );
        let start_y = swapped.plan_view[0].y;
        assert!(
            (start_y - 3.5).abs() < 0.5,
            "start y should be ~3.5, got {}",
            start_y
        );
    }

    #[test]
    fn test_swap_centerline_with_right_lane_offsets_refline() {
        let road = make_road_with_lane_sections("r1");
        let swapped = swap_centerline_with_edge(&road, -1);
        assert!(!swapped.plan_view.is_empty());
        let start_y = swapped.plan_view[0].y;
        // New refline shifted 3.5m to the right → start_y should be ~-3.5
        assert!(
            (start_y - (-3.5)).abs() < 0.5,
            "start y should be ~-3.5, got {}",
            start_y
        );
    }

    #[test]
    fn test_swap_centerline_id_zero_returns_clone() {
        let road = make_road_with_lane_sections("r1");
        let swapped = swap_centerline_with_edge(&road, 0);
        assert_eq!(swapped.plan_view.len(), road.plan_view.len());
    }

    #[test]
    fn test_swap_centerline_lane_count_preserved() {
        let road = make_road_with_lane_sections("r1");
        let swapped = swap_centerline_with_edge(&road, 1);
        // Total non-center lane count should be preserved
        let orig_total = road.lane_sections[0].left.len() + road.lane_sections[0].right.len();
        let new_total = swapped.lane_sections[0].left.len() + swapped.lane_sections[0].right.len();
        assert_eq!(new_total, orig_total);
    }

    #[test]
    fn test_swap_centerline_left_side_moves_inside_lanes_to_right() {
        // Left lane 2 is outside lane 1; swapping with lane 1 outer edge:
        // - Lane 2 (outside) should remain on left
        // - Lane 1 and old right lanes should be on right
        let road = make_road_with_lane_sections("r1");
        let swapped = swap_centerline_with_edge(&road, 1);
        let sec = &swapped.lane_sections[0];
        // All left IDs should be positive, right IDs negative (OpenDRIVE convention)
        for lane in &sec.left {
            assert!(
                lane.id > 0,
                "Left lane id should be positive, got {}",
                lane.id
            );
        }
        for lane in &sec.right {
            assert!(
                lane.id < 0,
                "Right lane id should be negative, got {}",
                lane.id
            );
        }
    }

    #[test]
    fn test_swap_centerline_preserves_length_approximately() {
        let road = make_road_with_lane_sections("r1");
        let swapped = swap_centerline_with_edge(&road, 1);
        // Length should be approximately the same (offset line is same arc length for straight road)
        assert!((swapped.length - road.length).abs() < road.length * 0.05 + 1.0);
    }
}
