//! OpenDRIVE parser/writer tests, split by domain.
#![allow(unused_imports)]

use super::*;
use crate::model::*;


// ══════════════════════════════════════════════════
// Writer unit tests — cover every branch in writer.rs
// ══════════════════════════════════════════════════

// Helper: build a minimal Road to reduce boilerplate
pub(super) fn base_road() -> Road {
    Road {
        id: "r1".into(),
        name: "TestRoad".into(),
        length: 100.0,
        junction_id: None,
        render_hidden: false,
        link: None,
        plan_view: vec![Geometry {
            s: 0.0,
            x: 1.5,
            y: -2.3,
            hdg: 0.785,
            length: 100.0,
            geo_type: GeometryType::Line,
        }],
        elevation_profile: vec![],
        lane_sections: vec![],
        lane_offsets: vec![],
        lateral_profile: LateralProfile::default(),
        bridges: vec![],
        tunnels: vec![],
        signals: vec![],
        objects: vec![],
        speed: None,
        spline_edit_data: None,
    }
}


pub(super) fn project_with(roads: Vec<Road>, junctions: Vec<Junction>) -> Project {
    Project {
        name: String::new(),
        header: Header::default(),
        roads,
        junctions,
        ..Default::default()
    }
}

mod parking;
mod parse;
mod roundtrip;
mod write_geometry;
mod write_lane;
mod write_object;
mod write_road;
