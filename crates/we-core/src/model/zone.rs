//! Zone data model — rectangular or polygonal zones on the road network.
//!
//! Zones represent special areas like construction sites, restricted areas,
//! loading zones, speed zones, and custom work areas.

use serde::{Deserialize, Serialize};

/// The type of a zone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ZoneType {
    /// Construction zone (reduced speed, lane closures).
    Construction,
    /// No-entry restricted area.
    Restricted,
    /// Loading/unloading zone.
    Loading,
    /// Temporary speed zone.
    Speed,
    /// Parking zone.
    Parking,
    /// Custom zone type with a string label.
    Custom(String),
}

/// Zone status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum ZoneStatus {
    /// Zone is active and affecting traffic.
    Active,
    /// Zone is defined but not yet active.
    #[default]
    Inactive,
}

/// A 2D vertex of a zone polygon.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ZoneVertex {
    pub x: f64,
    pub y: f64,
}

impl ZoneVertex {
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

/// A zone on the road network.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Zone {
    /// Unique zone identifier.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Zone type.
    pub zone_type: ZoneType,
    /// Zone status.
    pub status: ZoneStatus,
    /// Polygon boundary vertices (at least 3 for a valid zone).
    pub vertices: Vec<ZoneVertex>,
    /// Optional speed limit within this zone (km/h). `None` = inherits.
    pub speed_limit: Option<f64>,
    /// Roads affected by this zone.
    pub affected_road_ids: Vec<String>,
}

impl Zone {
    /// Create a new zone with no vertices.
    pub fn new(id: impl Into<String>, name: impl Into<String>, zone_type: ZoneType) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            zone_type,
            status: ZoneStatus::default(),
            vertices: Vec::new(),
            speed_limit: None,
            affected_road_ids: Vec::new(),
        }
    }

    /// Returns `true` if this zone has at least 3 vertices (valid polygon).
    pub fn is_valid_polygon(&self) -> bool {
        self.vertices.len() >= 3
    }

    /// Compute the approximate area of the zone polygon using the shoelace formula.
    /// Returns 0.0 if the zone is not a valid polygon.
    pub fn area(&self) -> f64 {
        if !self.is_valid_polygon() {
            return 0.0;
        }
        let n = self.vertices.len();
        let mut area = 0.0;
        for i in 0..n {
            let j = (i + 1) % n;
            area += self.vertices[i].x * self.vertices[j].y;
            area -= self.vertices[j].x * self.vertices[i].y;
        }
        area.abs() / 2.0
    }

    /// Compute the centroid of the zone polygon.
    /// Returns `None` if the zone is not a valid polygon.
    pub fn centroid(&self) -> Option<ZoneVertex> {
        if !self.is_valid_polygon() {
            return None;
        }
        let n = self.vertices.len() as f64;
        let x = self.vertices.iter().map(|v| v.x).sum::<f64>() / n;
        let y = self.vertices.iter().map(|v| v.y).sum::<f64>() / n;
        Some(ZoneVertex::new(x, y))
    }

    /// Test if a point (x, y) is inside the zone polygon (ray casting).
    pub fn contains_point(&self, x: f64, y: f64) -> bool {
        if !self.is_valid_polygon() {
            return false;
        }
        let n = self.vertices.len();
        let mut inside = false;
        let mut j = n - 1;
        for i in 0..n {
            let vi = &self.vertices[i];
            let vj = &self.vertices[j];
            if ((vi.y > y) != (vj.y > y))
                && (x < (vj.x - vi.x) * (y - vi.y) / (vj.y - vi.y) + vi.x)
            {
                inside = !inside;
            }
            j = i;
        }
        inside
    }

    /// Activate the zone.
    pub fn activate(&mut self) {
        self.status = ZoneStatus::Active;
    }

    /// Deactivate the zone.
    pub fn deactivate(&mut self) {
        self.status = ZoneStatus::Inactive;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square_zone() -> Zone {
        let mut z = Zone::new("z1", "Test Zone", ZoneType::Construction);
        z.vertices = vec![
            ZoneVertex::new(0.0, 0.0),
            ZoneVertex::new(10.0, 0.0),
            ZoneVertex::new(10.0, 10.0),
            ZoneVertex::new(0.0, 10.0),
        ];
        z
    }

    #[test]
    fn test_zone_new() {
        let z = Zone::new("z1", "My Zone", ZoneType::Restricted);
        assert_eq!(z.id, "z1");
        assert_eq!(z.name, "My Zone");
        assert_eq!(z.zone_type, ZoneType::Restricted);
        assert_eq!(z.status, ZoneStatus::Inactive);
        assert!(z.vertices.is_empty());
    }

    #[test]
    fn test_zone_is_valid_polygon_false_when_fewer_than_3() {
        let mut z = Zone::new("z", "z", ZoneType::Loading);
        z.vertices = vec![ZoneVertex::new(0.0, 0.0), ZoneVertex::new(1.0, 0.0)];
        assert!(!z.is_valid_polygon());
    }

    #[test]
    fn test_zone_is_valid_polygon_true() {
        let z = square_zone();
        assert!(z.is_valid_polygon());
    }

    #[test]
    fn test_zone_area_square() {
        let z = square_zone();
        let area = z.area();
        assert!((area - 100.0).abs() < 1e-9, "Area should be 100m², got {area}");
    }

    #[test]
    fn test_zone_area_invalid() {
        let z = Zone::new("z", "z", ZoneType::Custom("x".into()));
        assert!((z.area() - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_zone_centroid_square() {
        let z = square_zone();
        let c = z.centroid().unwrap();
        assert!((c.x - 5.0).abs() < 1e-9);
        assert!((c.y - 5.0).abs() < 1e-9);
    }

    #[test]
    fn test_zone_centroid_none_for_invalid() {
        let z = Zone::new("z", "z", ZoneType::Speed);
        assert!(z.centroid().is_none());
    }

    #[test]
    fn test_zone_contains_point_inside() {
        let z = square_zone();
        assert!(z.contains_point(5.0, 5.0));
    }

    #[test]
    fn test_zone_contains_point_outside() {
        let z = square_zone();
        assert!(!z.contains_point(15.0, 5.0));
    }

    #[test]
    fn test_zone_activate_deactivate() {
        let mut z = square_zone();
        assert_eq!(z.status, ZoneStatus::Inactive);
        z.activate();
        assert_eq!(z.status, ZoneStatus::Active);
        z.deactivate();
        assert_eq!(z.status, ZoneStatus::Inactive);
    }

    #[test]
    fn test_zone_type_serialization() {
        let json = serde_json::to_string(&ZoneType::Custom("my-zone".into())).unwrap();
        let back: ZoneType = serde_json::from_str(&json).unwrap();
        assert_eq!(back, ZoneType::Custom("my-zone".into()));
    }

    #[test]
    fn test_zone_serialization() {
        let z = square_zone();
        let json = serde_json::to_string(&z).unwrap();
        let back: Zone = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "z1");
        assert_eq!(back.vertices.len(), 4);
    }
}
