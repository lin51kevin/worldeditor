//! JSON signal import and HD Map XML export.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use we_core::model::Project;

#[derive(Error, Debug)]
pub enum SignalIoError {
    #[error("JSON parse error: {0}")]
    Json(String),
}

/// A JSON signal configuration entry.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SignalEntry {
    pub id: String,
    pub road_id: String,
    pub s: f64,
    pub t: f64,
    pub signal_type: String,
}

/// Import signal entries from a JSON string.
pub fn import_signals_from_json(json: &str) -> Result<Vec<SignalEntry>, SignalIoError> {
    serde_json::from_str::<Vec<SignalEntry>>(json).map_err(|e| SignalIoError::Json(e.to_string()))
}

/// Export a project's signals as JSON (stub — returns empty array).
pub fn export_signals_to_json(_project: &Project) -> String {
    "[]".to_string()
}

/// Export a project as HD Map XML (simplified structure).
pub fn export_to_hdmap_xml(project: &Project) -> String {
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<hdmap>\n");
    for road in &project.roads {
        out.push_str(&format!(
            "  <road id=\"{}\" length=\"{}\"/>\n",
            road.id, road.length
        ));
    }
    out.push_str("</hdmap>\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use we_core::model::{Geometry, GeometryType, Road};

    #[test]
    fn test_import_valid_signals() {
        let json = r#"[{"id":"s1","road_id":"r0","s":10.0,"t":0.0,"signal_type":"traffic_light"}]"#;
        let signals = import_signals_from_json(json).unwrap();
        assert_eq!(signals.len(), 1);
        assert_eq!(signals[0].id, "s1");
    }

    #[test]
    fn test_import_empty_array() {
        let signals = import_signals_from_json("[]").unwrap();
        assert!(signals.is_empty());
    }

    #[test]
    fn test_import_invalid_json_returns_error() {
        assert!(matches!(
            import_signals_from_json("{invalid}"),
            Err(SignalIoError::Json(_))
        ));
    }

    #[test]
    fn test_export_signals_empty() {
        assert_eq!(export_signals_to_json(&Project::default()), "[]");
    }

    #[test]
    fn test_export_hdmap_xml_structure() {
        let geom = Geometry {
            s: 0.0,
            x: 0.0,
            y: 0.0,
            hdg: 0.0,
            length: 100.0,
            geo_type: GeometryType::Line,
        };
        let project = Project {
            roads: vec![Road::from_centerline("r0", vec![geom])],
            ..Default::default()
        };
        let xml = export_to_hdmap_xml(&project);
        assert!(xml.contains("<hdmap>"));
        assert!(xml.contains("<road id=\"r0\""));
        assert!(xml.contains("</hdmap>"));
    }

    #[test]
    fn test_signal_entry_fields() {
        let json = r#"[{"id":"s2","road_id":"r1","s":5.0,"t":1.5,"signal_type":"stop_sign"}]"#;
        let signals = import_signals_from_json(json).unwrap();
        assert_eq!(signals[0].s, 5.0);
        assert_eq!(signals[0].t, 1.5);
    }
}
