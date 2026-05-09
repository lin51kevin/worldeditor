//! GIS coordinate system transformations.
//!
//! Supports WGS84, GCJ02, ECEF, ENU, UTM.
//! All implementations are pure Rust — WASM compatible.

pub mod gcj02;
pub mod utm;
mod wgs84;

pub use gcj02::{gcj02_to_wgs84, is_in_china, wgs84_to_gcj02};
pub use utm::{UtmCoord, geo_to_utm, utm_to_geo};
pub use wgs84::Wgs84Coord;

use serde::{Deserialize, Serialize};

/// A geographic coordinate in decimal degrees.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct GeoCoord {
    /// Latitude in degrees (-90 to 90)
    pub lat: f64,
    /// Longitude in degrees (-180 to 180)
    pub lon: f64,
    /// Altitude in meters above WGS84 ellipsoid
    pub alt: f64,
}

impl GeoCoord {
    pub fn new(lat: f64, lon: f64, alt: f64) -> Self {
        Self { lat, lon, alt }
    }
}

/// A 3D point in a local East-North-Up coordinate system.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct EnuCoord {
    pub east: f64,
    pub north: f64,
    pub up: f64,
}

impl EnuCoord {
    pub fn new(east: f64, north: f64, up: f64) -> Self {
        Self { east, north, up }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_geo_coord_creation() {
        let coord = GeoCoord::new(39.9042, 116.4074, 50.0);
        assert!((coord.lat - 39.9042).abs() < f64::EPSILON);
        assert!((coord.lon - 116.4074).abs() < f64::EPSILON);
        assert!((coord.alt - 50.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_geo_coord_serialization() {
        let coord = GeoCoord::new(39.9042, 116.4074, 50.0);
        let json = serde_json::to_string(&coord).unwrap();
        let deserialized: GeoCoord = serde_json::from_str(&json).unwrap();
        assert_eq!(coord, deserialized);
    }
}
