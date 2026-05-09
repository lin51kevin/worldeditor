use serde::{Deserialize, Serialize};

/// A road in the road network.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Road {
    pub id: String,
    pub name: String,
    pub length: f64,
    pub junction_id: Option<String>,
    #[serde(default)]
    pub render_hidden: bool,
    pub link: Option<RoadLink>,
    pub plan_view: Vec<Geometry>,
    pub elevation_profile: Vec<Elevation>,
    pub lane_sections: Vec<LaneSection>,
    pub lane_offsets: Vec<LaneOffset>,
    pub lateral_profile: LateralProfile,
    pub bridges: Vec<Bridge>,
    pub tunnels: Vec<Tunnel>,
    /// Traffic signals on this road.
    pub signals: Vec<Signal>,
    /// Road objects (signs, barriers, etc.) on this road.
    pub objects: Vec<RoadObject>,
}

impl Road {
    pub fn new(id: impl Into<String>, length: f64) -> Self {
        Self {
            id: id.into(),
            name: String::new(),
            length,
            junction_id: None,
            render_hidden: false,
            link: None,
            plan_view: Vec::new(),
            elevation_profile: Vec::new(),
            lane_sections: Vec::new(),
            lane_offsets: Vec::new(),
            lateral_profile: LateralProfile::default(),
            bridges: Vec::new(),
            tunnels: Vec::new(),
            signals: Vec::new(),
            objects: Vec::new(),
        }
    }

    /// Create a road from a centerline geometry with default lanes.
    ///
    /// Generates a single lane section with:
    /// - center lane (id=0, type=None)
    /// - left driving lane (id=1, width=3.5m)
    /// - right driving lane (id=-1, width=3.5m)
    pub fn from_centerline(id: impl Into<String>, plan_view: Vec<Geometry>) -> Self {
        let total_length: f64 = plan_view.iter().map(|geo| geo.length).sum();
        let mut road = Self::new(id, total_length);
        road.plan_view = plan_view;
        // Create default lane section at s=0
        let section = LaneSection {
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
        };
        road.lane_sections.push(section);
        road
    }
}

/// Link to predecessor/successor roads.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoadLink {
    pub predecessor: Option<LinkElement>,
    pub successor: Option<LinkElement>,
}

/// A single link element (road or junction reference).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkElement {
    pub element_type: LinkElementType,
    pub element_id: String,
    pub contact_point: Option<super::ContactPoint>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LinkElementType {
    Road,
    Junction,
}

/// Road geometry element (line, arc, spiral, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Geometry {
    pub s: f64,
    pub x: f64,
    pub y: f64,
    pub hdg: f64,
    pub length: f64,
    pub geo_type: GeometryType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum GeometryType {
    Line,
    Arc {
        curvature: f64,
    },
    Spiral {
        curv_start: f64,
        curv_end: f64,
    },
    Poly3 {
        a: f64,
        b: f64,
        c: f64,
        d: f64,
    },
    ParamPoly3 {
        a_u: f64,
        b_u: f64,
        c_u: f64,
        d_u: f64,
        a_v: f64,
        b_v: f64,
        c_v: f64,
        d_v: f64,
        p_range: ParamPoly3Range,
    },
}

/// Parameter range for paramPoly3 geometry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ParamPoly3Range {
    ArcLength,
    Normalized,
}

/// Elevation profile entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Elevation {
    pub s: f64,
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
}

impl Elevation {
    /// Evaluate elevation at a given ds offset from this entry's s position.
    pub fn evaluate(&self, ds: f64) -> f64 {
        self.a + self.b * ds + self.c * ds * ds + self.d * ds * ds * ds
    }
}

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
    pub height: f64,
}

/// Road mark type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
    None,
}

impl Default for RoadMarkType {
    fn default() -> Self {
        Self::None
    }
}

/// Road mark color.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RoadMarkColor {
    Standard,
    White,
    Yellow,
    Red,
    Blue,
    Green,
    Orange,
    Violet,
}

impl Default for RoadMarkColor {
    fn default() -> Self {
        Self::Standard
    }
}

/// Road mark weight.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RoadMarkWeight {
    Standard,
    Bold,
}

impl Default for RoadMarkWeight {
    fn default() -> Self {
        Self::Standard
    }
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
    None,
}

impl Default for LaneType {
    fn default() -> Self {
        Self::None
    }
}

// ============================================================================
// Lane Offset
// ============================================================================

/// Lane offset polynomial entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaneOffset {
    pub s: f64,
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
}

impl LaneOffset {
    /// Evaluate lane offset at a given ds offset from this entry's s position.
    pub fn evaluate(&self, ds: f64) -> f64 {
        self.a + self.b * ds + self.c * ds * ds + self.d * ds * ds * ds
    }
}

// ============================================================================
// Lateral Profile
// ============================================================================

/// Lateral profile containing superelevation and crossfall data.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LateralProfile {
    pub superelevations: Vec<Superelevation>,
    pub crossfalls: Vec<Crossfall>,
}

/// Superelevation polynomial entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Superelevation {
    pub s: f64,
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
}

impl Superelevation {
    pub fn evaluate(&self, ds: f64) -> f64 {
        self.a + self.b * ds + self.c * ds * ds + self.d * ds * ds * ds
    }
}

/// Crossfall side specification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CrossfallSide {
    Both,
    Left,
    Right,
}

/// Crossfall polynomial entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Crossfall {
    pub s: f64,
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub side: CrossfallSide,
}

impl Crossfall {
    pub fn evaluate(&self, ds: f64) -> f64 {
        self.a + self.b * ds + self.c * ds * ds + self.d * ds * ds * ds
    }
}

// ============================================================================
// Bridge / Tunnel
// ============================================================================

/// A bridge on a road.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bridge {
    pub id: String,
    pub s: f64,
    pub length: f64,
    pub bridge_type: String,
}

/// A tunnel on a road.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tunnel {
    pub id: String,
    pub s: f64,
    pub length: f64,
    pub tunnel_type: String,
}

// ============================================================================
// Traffic Signals
// ============================================================================

/// A traffic signal element as parsed from OpenDRIVE `<signal>`.
///
/// Positions are stored in road-local coordinates (s along reference line,
/// t lateral offset) rather than pre-computed world-space XYZ, so the WASM
/// vertex generators can evaluate the road geometry on demand.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signal {
    /// OpenDRIVE signal id.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// s-coordinate along the road reference line (m).
    pub s: f64,
    /// Lateral offset from the reference line, positive = left (m).
    pub t: f64,
    /// Height above the road surface (m).
    pub z_offset: f64,
    /// Additional heading offset relative to the road direction (rad).
    pub h_offset: f64,
    /// Width of the signal (m); also used as scale for paint marks.
    pub width: f64,
    /// Height/length of the signal (m).
    pub height: f64,
    /// Raw `type` attribute string (e.g., `"Graphics"`, `"1010203800001413"`).
    pub signal_type: String,
    /// Raw `subtype` attribute string (e.g., `"StraightAheadArrow"`, `"none"`).
    pub signal_subtype: String,
    /// Optional value field (e.g., `"30"` for a speed-limit sign).
    pub value: Option<String>,
    /// Orientation along road: `"+"` forward, `"-"` backward, `"none"` both.
    pub orientation: String,
    /// Whether this signal is dynamic (e.g., a traffic light).
    pub is_dynamic: bool,
}

/// 3D point with optional id reference.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Point3D {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub id: Option<String>,
}

impl Point3D {
    pub fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z, id: None }
    }

    pub fn new_with_id(x: f64, y: f64, z: f64, id: Option<String>) -> Self {
        Self { x, y, z, id }
    }
}

// ============================================================================
// Road Objects (Signage, Barriers, Guardrails, etc.)
// ============================================================================

/// Road object types.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ObjectType {
    /// Traffic sign/notice board
    Sign,
    /// Guardrail
    Guardrail,
    /// Barrier
    Barrier,
    /// Curb
    Curb,
    /// Wall
    Wall,
    /// Pillar
    Pillar,
    /// Traffic cone
    TrafficCone,
    /// Custom object
    Custom(String),
}

/// OpenDRIVE object validity (which lanes the object applies to).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Validity {
    pub from_lane: i32,
    pub to_lane: i32,
}

/// A road object (signs, barriers, guardrails, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoadObject {
    pub id: String,
    pub object_type: ObjectType,
    pub name: String,
    pub position: Point3D,
    pub orientation: f64,
    pub width: f64,
    pub height: f64,
    pub validity: Option<Validity>,
}

// ============================================================================
// Road Markings (see RoadMarkType, RoadMarkColor, RoadMarkWeight above)
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_road_creation() {
        let road = Road::new("1", 100.0);
        assert_eq!(road.id, "1");
        assert!((road.length - 100.0).abs() < f64::EPSILON);
        assert!(road.lane_sections.is_empty());
    }

    #[test]
    fn test_road_serialization_roundtrip() {
        let road = Road::new("42", 250.5);
        let json = serde_json::to_string(&road).unwrap();
        let deserialized: Road = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.id, "42");
        assert!((deserialized.length - 250.5).abs() < f64::EPSILON);
    }

    #[test]
    fn test_elevation_evaluate() {
        let elev = Elevation {
            s: 0.0,
            a: 10.0,
            b: 0.5,
            c: 0.01,
            d: 0.001,
        };
        // At ds=0, elevation = a = 10.0
        assert!((elev.evaluate(0.0) - 10.0).abs() < f64::EPSILON);
        // At ds=1, elevation = 10 + 0.5 + 0.01 + 0.001 = 10.511
        assert!((elev.evaluate(1.0) - 10.511).abs() < 1e-10);
    }

    #[test]
    fn test_lane_type_serialization() {
        let lane_type = LaneType::Driving;
        let json = serde_json::to_string(&lane_type).unwrap();
        assert_eq!(json, "\"Driving\"");
    }

    #[test]
    fn test_road_new() {
        let road = Road::new("road-1", 123.0);
        assert_eq!(road.id, "road-1");
        assert!(road.name.is_empty());
        assert!((road.length - 123.0).abs() < f64::EPSILON);
        assert!(road.junction_id.is_none());
        assert!(road.link.is_none());
        assert!(road.plan_view.is_empty());
        assert!(road.elevation_profile.is_empty());
        assert!(road.lane_sections.is_empty());
        assert!(road.signals.is_empty());
        assert!(road.objects.is_empty());
    }

    #[test]
    fn test_road_from_centerline() {
        let plan_view = vec![
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
                length: 15.0,
                geo_type: GeometryType::Arc { curvature: 0.01 },
            },
        ];

        let road = Road::from_centerline("road-2", plan_view);
        assert_eq!(road.id, "road-2");
        assert!((road.length - 25.0).abs() < f64::EPSILON);
        assert_eq!(road.plan_view.len(), 2);
        assert_eq!(road.lane_sections.len(), 1);
        let section = &road.lane_sections[0];
        assert_eq!(section.left.len(), 1);
        assert_eq!(section.center.len(), 1);
        assert_eq!(section.right.len(), 1);
        assert_eq!(section.left[0].lane_type, LaneType::Driving);
        assert_eq!(section.center[0].lane_type, LaneType::None);
        assert_eq!(section.right[0].lane_type, LaneType::Driving);
        assert!((section.left[0].width[0].a - 3.5).abs() < f64::EPSILON);
        assert!((section.right[0].width[0].a - 3.5).abs() < f64::EPSILON);
    }

    #[test]
    fn test_geometry_type_serialization() {
        let geometries = vec![
            GeometryType::Line,
            GeometryType::Arc { curvature: 0.01 },
            GeometryType::Spiral {
                curv_start: 0.0,
                curv_end: 0.02,
            },
            GeometryType::Poly3 {
                a: 1.0,
                b: 2.0,
                c: 3.0,
                d: 4.0,
            },
            GeometryType::ParamPoly3 {
                a_u: 1.0,
                b_u: 2.0,
                c_u: 3.0,
                d_u: 4.0,
                a_v: 5.0,
                b_v: 6.0,
                c_v: 7.0,
                d_v: 8.0,
                p_range: ParamPoly3Range::Normalized,
            },
        ];

        for geometry in geometries {
            let json = serde_json::to_string(&geometry).unwrap();
            let deserialized: GeometryType = serde_json::from_str(&json).unwrap();
            assert_eq!(serde_json::to_string(&deserialized).unwrap(), json);
        }
    }

    #[test]
    fn test_lane_type_default() {
        assert_eq!(LaneType::default(), LaneType::None);
    }

    #[test]
    fn test_road_link_serialization() {
        let link = RoadLink {
            predecessor: Some(LinkElement {
                element_type: LinkElementType::Road,
                element_id: "road-prev".to_string(),
                contact_point: Some(super::super::ContactPoint::Start),
            }),
            successor: Some(LinkElement {
                element_type: LinkElementType::Junction,
                element_id: "junction-1".to_string(),
                contact_point: Some(super::super::ContactPoint::End),
            }),
        };

        let json = serde_json::to_string(&link).unwrap();
        let deserialized: RoadLink = serde_json::from_str(&json).unwrap();
        let predecessor = deserialized.predecessor.unwrap();
        let successor = deserialized.successor.unwrap();
        assert_eq!(predecessor.element_type, LinkElementType::Road);
        assert_eq!(predecessor.element_id, "road-prev");
        assert_eq!(
            predecessor.contact_point,
            Some(super::super::ContactPoint::Start)
        );
        assert_eq!(successor.element_type, LinkElementType::Junction);
        assert_eq!(successor.element_id, "junction-1");
        assert_eq!(
            successor.contact_point,
            Some(super::super::ContactPoint::End)
        );
    }

    #[test]
    fn test_signal_serialization() {
        let signal = Signal {
            id: "signal-1".to_string(),
            name: "Turn Signal".to_string(),
            s: 20.0,
            t: -1.5,
            z_offset: 0.0,
            h_offset: 1.5708,
            width: 3.0,
            height: 0.0,
            signal_type: "Graphics".to_string(),
            signal_subtype: "LeftTurnArrow".to_string(),
            value: Some("30".to_string()),
            orientation: "+".to_string(),
            is_dynamic: false,
        };

        let json = serde_json::to_string(&signal).unwrap();
        let deserialized: Signal = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.id, "signal-1");
        assert_eq!(deserialized.signal_type, "Graphics");
        assert_eq!(deserialized.signal_subtype, "LeftTurnArrow");
        assert_eq!(deserialized.name, "Turn Signal");
        assert!((deserialized.s - 20.0).abs() < f64::EPSILON);
        assert!((deserialized.t - -1.5).abs() < f64::EPSILON);
        assert_eq!(deserialized.value.as_deref(), Some("30"));
        assert!(!deserialized.is_dynamic);
    }

    #[test]
    fn test_road_object_serialization() {
        let object = RoadObject {
            id: "object-1".to_string(),
            object_type: ObjectType::Guardrail,
            name: "Guardrail".to_string(),
            position: Point3D::new(4.0, 5.0, 0.5),
            orientation: 180.0,
            width: 2.5,
            height: 1.2,
            validity: Some(Validity {
                from_lane: -2,
                to_lane: 2,
            }),
        };

        let json = serde_json::to_string(&object).unwrap();
        let deserialized: RoadObject = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.id, "object-1");
        assert_eq!(deserialized.object_type, ObjectType::Guardrail);
        assert_eq!(deserialized.name, "Guardrail");
        assert!((deserialized.position.x - 4.0).abs() < f64::EPSILON);
        assert!((deserialized.position.y - 5.0).abs() < f64::EPSILON);
        assert!((deserialized.position.z - 0.5).abs() < f64::EPSILON);
        assert!((deserialized.orientation - 180.0).abs() < f64::EPSILON);
        assert!((deserialized.width - 2.5).abs() < f64::EPSILON);
        assert!((deserialized.height - 1.2).abs() < f64::EPSILON);
        let validity = deserialized.validity.unwrap();
        assert_eq!(validity.from_lane, -2);
        assert_eq!(validity.to_lane, 2);
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
