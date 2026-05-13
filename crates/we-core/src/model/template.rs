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
}

