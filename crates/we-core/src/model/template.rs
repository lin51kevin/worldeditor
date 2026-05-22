//! Road templates for quick lane layout creation.

use serde::{Deserialize, Serialize};

use super::lane::{Lane, LaneSection, LaneType, LaneWidth};

/// A template describing a road's lane configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoadTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub left_lanes: Vec<TemplateLane>,
    pub right_lanes: Vec<TemplateLane>,
}

/// A single lane specification within a template.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateLane {
    pub lane_type: LaneType,
    pub width: f64,
}

impl RoadTemplate {
    /// Single-lane road (one left, one right driving lane).
    pub fn single_lane() -> Self {
        Self {
            id: "single".into(),
            name: "Single Lane".into(),
            description: "One driving lane per direction".into(),
            left_lanes: vec![TemplateLane {
                lane_type: LaneType::Driving,
                width: 3.5,
            }],
            right_lanes: vec![TemplateLane {
                lane_type: LaneType::Driving,
                width: 3.5,
            }],
        }
    }

    /// Dual two-lane road (two lanes per direction).
    pub fn dual_two_lane() -> Self {
        Self {
            id: "dual2".into(),
            name: "Dual Two Lane".into(),
            description: "Two driving lanes per direction".into(),
            left_lanes: vec![
                TemplateLane {
                    lane_type: LaneType::Driving,
                    width: 3.5,
                },
                TemplateLane {
                    lane_type: LaneType::Driving,
                    width: 3.5,
                },
            ],
            right_lanes: vec![
                TemplateLane {
                    lane_type: LaneType::Driving,
                    width: 3.5,
                },
                TemplateLane {
                    lane_type: LaneType::Driving,
                    width: 3.5,
                },
            ],
        }
    }

    /// Dual four-lane road (four lanes per direction).
    pub fn dual_four_lane() -> Self {
        Self {
            id: "dual4".into(),
            name: "Dual Four Lane".into(),
            description: "Four driving lanes per direction".into(),
            left_lanes: (0..4)
                .map(|_| TemplateLane {
                    lane_type: LaneType::Driving,
                    width: 3.5,
                })
                .collect(),
            right_lanes: (0..4)
                .map(|_| TemplateLane {
                    lane_type: LaneType::Driving,
                    width: 3.5,
                })
                .collect(),
        }
    }

    /// Dual six-lane road (six lanes per direction).
    pub fn dual_six_lane() -> Self {
        Self {
            id: "dual6".into(),
            name: "Dual Six Lane".into(),
            description: "Six driving lanes per direction".into(),
            left_lanes: (0..6)
                .map(|_| TemplateLane {
                    lane_type: LaneType::Driving,
                    width: 3.5,
                })
                .collect(),
            right_lanes: (0..6)
                .map(|_| TemplateLane {
                    lane_type: LaneType::Driving,
                    width: 3.5,
                })
                .collect(),
        }
    }

    /// Convert this template into an OpenDRIVE `LaneSection` at s=0.
    pub fn to_lane_section(&self) -> LaneSection {
        let center_lane = Lane {
            id: 0,
            lane_type: LaneType::None,
            level: 0,
            render_hidden: false,
            link: None,
            width: vec![],
            borders: vec![],
            road_marks: vec![],
        };

        let left: Vec<Lane> = self
            .left_lanes
            .iter()
            .enumerate()
            .map(|(i, tl)| Lane {
                id: (i as i32) + 1,
                lane_type: tl.lane_type,
                level: 0,
                render_hidden: false,
                link: None,
                width: vec![LaneWidth {
                    s_offset: 0.0,
                    a: tl.width,
                    b: 0.0,
                    c: 0.0,
                    d: 0.0,
                }],
                borders: vec![],
                road_marks: vec![],
            })
            .collect();

        let right: Vec<Lane> = self
            .right_lanes
            .iter()
            .enumerate()
            .map(|(i, tl)| Lane {
                id: -((i as i32) + 1),
                lane_type: tl.lane_type,
                level: 0,
                render_hidden: false,
                link: None,
                width: vec![LaneWidth {
                    s_offset: 0.0,
                    a: tl.width,
                    b: 0.0,
                    c: 0.0,
                    d: 0.0,
                }],
                borders: vec![],
                road_marks: vec![],
            })
            .collect();

        LaneSection {
            s: 0.0,
            single_side: false,
            render_hidden: false,
            left,
            center: vec![center_lane],
            right,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_single_lane_template() {
        let t = RoadTemplate::single_lane();
        assert_eq!(t.id, "single");
        let ls = t.to_lane_section();
        assert_eq!(ls.left.len(), 1);
        assert_eq!(ls.right.len(), 1);
        assert_eq!(ls.center.len(), 1);
        assert_eq!(ls.center[0].id, 0);
        assert_eq!(ls.left[0].id, 1);
        assert_eq!(ls.right[0].id, -1);
    }

    #[test]
    fn test_dual_two_lane_template() {
        let t = RoadTemplate::dual_two_lane();
        assert_eq!(t.id, "dual2");
        let ls = t.to_lane_section();
        assert_eq!(ls.left.len(), 2);
        assert_eq!(ls.right.len(), 2);
    }

    #[test]
    fn test_dual_four_lane_template() {
        let t = RoadTemplate::dual_four_lane();
        assert_eq!(t.id, "dual4");
        let ls = t.to_lane_section();
        assert_eq!(ls.left.len(), 4);
        assert_eq!(ls.right.len(), 4);
    }

    #[test]
    fn test_dual_six_lane_template() {
        let t = RoadTemplate::dual_six_lane();
        assert_eq!(t.id, "dual6");
        let ls = t.to_lane_section();
        assert_eq!(ls.left.len(), 6);
        assert_eq!(ls.right.len(), 6);
    }

    #[test]
    fn test_lane_width_set_correctly() {
        let t = RoadTemplate::single_lane();
        let ls = t.to_lane_section();
        assert_eq!(ls.left[0].width[0].a, 3.5);
        assert_eq!(ls.right[0].width[0].a, 3.5);
    }

    // ── Golden output tests ────────────────────────────────────────────────

    /// Left lane IDs are positive (1, 2, …N), right lane IDs are negative (-1, -2, …-N).
    #[test]
    fn test_golden_lane_id_signs() {
        for preset in [
            RoadTemplate::single_lane(),
            RoadTemplate::dual_two_lane(),
            RoadTemplate::dual_four_lane(),
            RoadTemplate::dual_six_lane(),
        ] {
            let ls = preset.to_lane_section();
            for lane in &ls.left {
                assert!(
                    lane.id > 0,
                    "left lane id must be positive, got {}",
                    lane.id
                );
            }
            for lane in &ls.right {
                assert!(
                    lane.id < 0,
                    "right lane id must be negative, got {}",
                    lane.id
                );
            }
            assert_eq!(ls.center[0].id, 0, "center lane id must be 0");
        }
    }

    /// Left lane IDs are sequential 1..N; right lane IDs are -1..-N.
    #[test]
    fn test_golden_lane_ids_are_sequential() {
        let t = RoadTemplate::dual_four_lane();
        let ls = t.to_lane_section();
        let left_ids: Vec<i32> = ls.left.iter().map(|l| l.id).collect();
        let right_ids: Vec<i32> = ls.right.iter().map(|l| l.id).collect();
        assert_eq!(left_ids, vec![1, 2, 3, 4]);
        assert_eq!(right_ids, vec![-1, -2, -3, -4]);
    }

    /// All template lanes have `Driving` type.
    #[test]
    fn test_golden_all_lanes_are_driving() {
        for preset in [
            RoadTemplate::single_lane(),
            RoadTemplate::dual_two_lane(),
            RoadTemplate::dual_four_lane(),
            RoadTemplate::dual_six_lane(),
        ] {
            let ls = preset.to_lane_section();
            for lane in ls.left.iter().chain(ls.right.iter()) {
                assert_eq!(
                    lane.lane_type,
                    LaneType::Driving,
                    "template lane {} should be Driving",
                    lane.id
                );
            }
            assert_eq!(
                ls.center[0].lane_type,
                LaneType::None,
                "center lane should be None"
            );
        }
    }

    /// Total road width = sum of all lane widths on left + right.
    #[test]
    fn test_golden_total_road_width() {
        let cases = [
            (RoadTemplate::single_lane(), 7.0_f64),     // 1+1 lanes × 3.5m
            (RoadTemplate::dual_two_lane(), 14.0_f64),  // 2+2 lanes × 3.5m
            (RoadTemplate::dual_four_lane(), 28.0_f64), // 4+4 lanes × 3.5m
            (RoadTemplate::dual_six_lane(), 42.0_f64),  // 6+6 lanes × 3.5m
        ];
        for (preset, expected_width) in cases {
            let ls = preset.to_lane_section();
            let total: f64 = ls
                .left
                .iter()
                .chain(ls.right.iter())
                .map(|l| l.width.first().map(|w| w.a).unwrap_or(0.0))
                .sum();
            assert!(
                (total - expected_width).abs() < 1e-9,
                "total width {total} != expected {expected_width}"
            );
        }
    }

    /// `to_lane_section` result is at s=0.
    #[test]
    fn test_golden_lane_section_s_is_zero() {
        let ls = RoadTemplate::dual_four_lane().to_lane_section();
        assert_eq!(ls.s, 0.0);
    }

    /// Width polynomials b/c/d coefficients are all zero (constant width).
    #[test]
    fn test_golden_constant_width_polynomial() {
        let ls = RoadTemplate::dual_six_lane().to_lane_section();
        for lane in ls.left.iter().chain(ls.right.iter()) {
            for w in &lane.width {
                assert_eq!(w.b, 0.0, "b coefficient must be 0 for constant width");
                assert_eq!(w.c, 0.0, "c coefficient must be 0 for constant width");
                assert_eq!(w.d, 0.0, "d coefficient must be 0 for constant width");
            }
        }
    }
}
