//! Baseline data models for WorldEditorOnline JSON comparison.
//!
//! These types deserialize the JSON exported from WorldEditorOnline's
//! `RoadNetwork.toJson()`. They are test-only and intentionally use
//! `serde_json::Value` for loosely-typed fields we don't yet compare.

#![allow(dead_code)]

use serde::Deserialize;

// ── Top-level ────────────────────────────────────────

/// Root structure of a WorldEditorOnline baseline JSON export.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineNetwork {
    pub roads: Vec<BaselineRoad>,
    #[serde(default)]
    pub junctions: Vec<BaselineJunction>,
}

// ── Road ─────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineRoad {
    pub id: serde_json::Value,
    #[serde(default)]
    pub name: String,
    /// Junction ID this road belongs to (-1 or absent = not in junction).
    #[serde(default = "default_junction_id")]
    pub junction_id: serde_json::Value,
    #[serde(default)]
    pub knots: Vec<BaselineKnot>,
    #[serde(default)]
    pub predecessor: Option<BaselineLinkElement>,
    #[serde(default)]
    pub successor: Option<BaselineLinkElement>,
    #[serde(default)]
    pub left_lane_sections: Vec<BaselineLaneSection>,
    #[serde(default)]
    pub right_lane_sections: Vec<BaselineLaneSection>,
    #[serde(default)]
    pub road_signals: Vec<BaselineSignal>,
    #[serde(default)]
    pub road_objects: Vec<BaselineObject>,
}

fn default_junction_id() -> serde_json::Value {
    serde_json::Value::Number(serde_json::Number::from(-1))
}

impl BaselineRoad {
    /// Get the road ID as a string for comparison with our `Road.id`.
    pub fn id_str(&self) -> String {
        match &self.id {
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        }
    }

    /// Get the junction ID as Option<String> for comparison.
    /// Returns None if junction_id is -1 (not in a junction).
    pub fn junction_id_str(&self) -> Option<String> {
        match &self.junction_id {
            serde_json::Value::Number(n) => {
                if n.as_i64() == Some(-1) {
                    None
                } else {
                    Some(n.to_string())
                }
            }
            serde_json::Value::Null => None,
            other => Some(other.to_string()),
        }
    }

    /// Compute road length from knots (last knot's s value).
    pub fn length(&self) -> f64 {
        self.knots.last().map_or(0.0, |k| k.s)
    }
}

// ── Knot (geometry control point) ────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineKnot {
    pub s: f64,
    #[serde(default)]
    pub position: Vec<f64>,
    #[serde(default)]
    pub is_key_knot: bool,
    #[serde(default)]
    pub super_elevation: f64,
    #[serde(default)]
    pub crossfall_left: f64,
    #[serde(default)]
    pub crossfall_right: f64,
    #[serde(default)]
    pub lane_offset: f64,
}

// ── Link elements ────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineLinkElement {
    pub element_id: serde_json::Value,
    /// 0 = Start, 1 = End
    pub contact_point: i32,
    /// 0 = Road, 1 = Junction
    #[serde(default)]
    pub element_type: i32,
}

// ── Lane sections ────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineLaneSection {
    #[serde(default)]
    pub name: String,
    pub start_s: f64,
    /// 0 = left, 1 = right
    #[serde(default)]
    pub side: i32,
    #[serde(default)]
    pub length: f64,
    #[serde(default)]
    pub lane_lines: Vec<serde_json::Value>,
}

// ── Signal ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineSignal {
    pub id: serde_json::Value,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub s: f64,
    #[serde(default)]
    pub t: f64,
    #[serde(default, rename = "zOffset")]
    pub z_offset: f64,
    #[serde(default, rename = "hOffset")]
    pub h_offset: f64,
    #[serde(default)]
    pub width: f64,
    #[serde(default)]
    pub height: f64,
    #[serde(default, rename = "type")]
    pub signal_type: String,
    #[serde(default)]
    pub subtype: serde_json::Value,
    #[serde(default)]
    pub value: serde_json::Value,
    /// 0 = both/none, 1 = forward (+), -1 = backward (-)
    #[serde(default)]
    pub orientation: serde_json::Value,
    /// 0 = static, 1 = dynamic
    #[serde(default)]
    pub dynamic: i32,
    #[serde(default)]
    pub country: serde_json::Value,
    #[serde(default)]
    pub unit: String,
}

impl BaselineSignal {
    pub fn id_str(&self) -> String {
        match &self.id {
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        }
    }

    /// Convert numeric orientation to OpenDRIVE string convention.
    pub fn orientation_str(&self) -> String {
        match &self.orientation {
            serde_json::Value::Number(n) => match n.as_i64() {
                Some(1) => "+".to_string(),
                Some(-1) => "-".to_string(),
                _ => "none".to_string(),
            },
            serde_json::Value::String(s) => s.clone(),
            _ => "none".to_string(),
        }
    }

    /// Convert numeric dynamic (0/1) to boolean.
    pub fn is_dynamic(&self) -> bool {
        self.dynamic != 0
    }

    /// Get subtype as string.
    pub fn subtype_str(&self) -> String {
        match &self.subtype {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Number(n) => {
                if n.as_i64() == Some(0) {
                    String::new()
                } else {
                    n.to_string()
                }
            }
            _ => String::new(),
        }
    }
}

// ── Object ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineObject {
    pub id: serde_json::Value,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub s: f64,
    #[serde(default)]
    pub t: f64,
    #[serde(default, rename = "zOffset")]
    pub z_offset: f64,
    #[serde(default)]
    pub hdg: f64,
    #[serde(default)]
    pub width: f64,
    #[serde(default)]
    pub height: f64,
    #[serde(default)]
    pub length: f64,
    #[serde(default)]
    pub pitch: f64,
    #[serde(default)]
    pub roll: f64,
    #[serde(default, rename = "type")]
    pub object_type: String,
    #[serde(default)]
    pub subtype: String,
    /// 0 = none/+, -1 = backward (-)
    #[serde(default)]
    pub orientation: serde_json::Value,
    #[serde(default)]
    pub corner_knots: Vec<BaselineCorner>,
    #[serde(default)]
    pub corner_count: i32,
    #[serde(default)]
    pub is_crosswalk: bool,
    #[serde(default)]
    pub is_stop_line: bool,
    #[serde(default)]
    pub is_outline_object: bool,
}

impl BaselineObject {
    pub fn id_str(&self) -> String {
        match &self.id {
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        }
    }
}

// ── Corner ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineCorner {
    #[serde(default)]
    pub position: Vec<f64>,
    #[serde(default)]
    pub id: serde_json::Value,
}

// ── Junction ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineJunction {
    pub id: serde_json::Value,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub connections: Vec<BaselineJunctionConnection>,
}

impl BaselineJunction {
    pub fn id_str(&self) -> String {
        match &self.id {
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineJunctionConnection {
    pub connecting_road_id: serde_json::Value,
    pub incoming_road_id: serde_json::Value,
    /// 0 = Start, 1 = End
    pub contact_point: i32,
    #[serde(default)]
    pub lane_links: Vec<BaselineJunctionLaneLink>,
}

impl BaselineJunctionConnection {
    pub fn connecting_road_id_str(&self) -> String {
        match &self.connecting_road_id {
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        }
    }

    pub fn incoming_road_id_str(&self) -> String {
        match &self.incoming_road_id {
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineJunctionLaneLink {
    pub from_lane_id: i32,
    pub to_lane_id: i32,
}
