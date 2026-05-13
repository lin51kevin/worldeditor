//! Lane-related road model types.
//!
//! This module contains lane sections, lanes, lane geometry polynomials, and
//! road marking metadata used by road definitions.

use serde::{Deserialize, Serialize};

/// A lane section along a road.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaneSection {
    pub s: f64,
    pub single_side: bool,
    #[serde(default)]
    pub render_hidden: bool,
    pub left: Vec<Lane>,
    pub center: Vec<Lane>,
    pub right: Vec<Lane>,
}

/// A single lane within a lane section.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lane {
    pub id: i32,
    pub lane_type: LaneType,
    pub level: i32,
    #[serde(default)]
    pub render_hidden: bool,
    pub link: Option<LaneLink>,
    pub width: Vec<LaneWidth>,
    pub borders: Vec<LaneBorder>,
    pub road_marks: Vec<RoadMark>,
}

/// Lane border polynomial entry (same format as LaneWidth).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaneBorder {
    pub s_offset: f64,
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
}

/// Lane link to predecessor/successor lanes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaneLink {
    pub predecessor: Option<i32>,
    pub successor: Option<i32>,
}

/// Road marking on a lane boundary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoadMark {
    pub s_offset: f64,
    pub mark_type: RoadMarkType,
    pub weight: RoadMarkWeight,
    pub color: RoadMarkColor,
    pub material: String,
    pub width: f64,
    pub lane_change: String,
    /// Vertical height of the road mark above the road surface.
    /// Defaults to 0 when omitted (standard flush marking).
    #[serde(default)]
    pub height: f64,
}

/// Road mark type.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RoadMarkType {
    Solid,
    Broken,
    SolidSolid,
    SolidBroken,
    BrokenSolid,
    BottsDots,
    Curb,
    StopLine,
    Grass,
    Custom,
    #[default]
    None,
}

/// Road mark color.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RoadMarkColor {
    #[default]
    Standard,
    White,
    Yellow,
    Red,
    Blue,
    Green,
    Orange,
    Violet,
}

/// Road mark weight.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RoadMarkWeight {
    #[default]
    Standard,
    Bold,
}

/// Width polynomial entry for a lane.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaneWidth {
    pub s_offset: f64,
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
}

/// Lane type as defined in OpenDRIVE.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LaneType {
    Driving,
    Shoulder,
    Sidewalk,
    Border,
    Parking,
    Median,
    Curb,
    Stop,
    Biking,
    Restricted,
    Bidirectional,
    Rail,
    Tram,
    Bus,
    Taxi,
    HOV,
    Entry,
    Exit,
    OffRamp,
    OnRamp,
    ConnectingRamp,
    Special1,
    Special2,
    Special3,
    RoadWorks,
    #[default]
    None,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lane_type_serialization() {
        let lane_type = LaneType::Driving;
        let json = serde_json::to_string(&lane_type).unwrap();
        assert_eq!(json, "\"Driving\"");
    }

    #[test]
    fn test_lane_type_default() {
        assert_eq!(LaneType::default(), LaneType::None);
    }

    #[test]
    fn test_road_mark_serialization() {
        let road_mark = RoadMark {
            s_offset: 0.5,
            mark_type: RoadMarkType::Solid,
            weight: RoadMarkWeight::Standard,
            color: RoadMarkColor::White,
            material: "paint".to_string(),
            width: 0.15,
            lane_change: "both".to_string(),
            height: 0.02,
        };

        let json = serde_json::to_string(&road_mark).unwrap();
        let deserialized: RoadMark = serde_json::from_str(&json).unwrap();
        assert!((deserialized.s_offset - 0.5).abs() < f64::EPSILON);
        assert_eq!(deserialized.mark_type, RoadMarkType::Solid);
        assert_eq!(deserialized.weight, RoadMarkWeight::Standard);
        assert_eq!(deserialized.color, RoadMarkColor::White);
        assert_eq!(deserialized.material, "paint");
        assert!((deserialized.width - 0.15).abs() < f64::EPSILON);
        assert_eq!(deserialized.lane_change, "both");
        assert!((deserialized.height - 0.02).abs() < f64::EPSILON);
    }

    #[test]
    fn test_lane_section_with_lanes() {
        let section = LaneSection {
            s: 5.0,
            single_side: false,
            render_hidden: false,
            left: vec![Lane {
                id: 1,
                lane_type: LaneType::Driving,
                level: 0,
                render_hidden: false,
                link: Some(LaneLink {
                    predecessor: Some(1),
                    successor: Some(1),
                }),
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
                lane_type: LaneType::Shoulder,
                level: 1,
                render_hidden: false,
                link: Some(LaneLink {
                    predecessor: Some(-1),
                    successor: Some(-1),
                }),
                width: vec![LaneWidth {
                    s_offset: 0.0,
                    a: 2.0,
                    b: 0.0,
                    c: 0.0,
                    d: 0.0,
                }],
                borders: vec![],
                road_marks: vec![RoadMark {
                    s_offset: 0.0,
                    mark_type: RoadMarkType::Broken,
                    weight: RoadMarkWeight::Standard,
                    color: RoadMarkColor::Yellow,
                    material: "paint".to_string(),
                    width: 0.2,
                    lane_change: "decrease".to_string(),
                    height: 0.02,
                }],
            }],
        };

        assert!((section.s - 5.0).abs() < f64::EPSILON);
        assert!(!section.single_side);
        assert_eq!(section.left.len(), 1);
        assert_eq!(section.center.len(), 1);
        assert_eq!(section.right.len(), 1);
        assert_eq!(section.left[0].id, 1);
        assert_eq!(section.center[0].lane_type, LaneType::None);
        assert_eq!(section.right[0].lane_type, LaneType::Shoulder);
        assert_eq!(section.right[0].road_marks.len(), 1);
    }
}

