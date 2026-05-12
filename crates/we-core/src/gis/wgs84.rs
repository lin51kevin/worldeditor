use serde::{Deserialize, Serialize};

use super::GeoCoord;

/// WGS84 ellipsoid parameters.
pub const WGS84_A: f64 = 6_378_137.0; // Semi-major axis (meters)
pub const WGS84_F: f64 = 1.0 / 298.257_223_563; // Flattening
/// Semi-minor axis (meters)
pub const WGS84_E2: f64 = 2.0 * WGS84_F - WGS84_F * WGS84_F; // Eccentricity squared

/// A WGS84 coordinate with conversion utilities.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Wgs84Coord(pub GeoCoord);

impl Wgs84Coord {
    pub fn new(lat: f64, lon: f64, alt: f64) -> Self {
        Self(GeoCoord::new(lat, lon, alt))
    }

    /// Convert WGS84 geodetic to ECEF (Earth-Centered, Earth-Fixed).
    pub fn to_ecef(&self) -> (f64, f64, f64) {
        let lat_rad = self.0.lat.to_radians();
        let lon_rad = self.0.lon.to_radians();

        let sin_lat = lat_rad.sin();
        let cos_lat = lat_rad.cos();
        let sin_lon = lon_rad.sin();
        let cos_lon = lon_rad.cos();

        let n = WGS84_A / (1.0 - WGS84_E2 * sin_lat * sin_lat).sqrt();

        let x = (n + self.0.alt) * cos_lat * cos_lon;
        let y = (n + self.0.alt) * cos_lat * sin_lon;
        let z = (n * (1.0 - WGS84_E2) + self.0.alt) * sin_lat;

        (x, y, z)
    }

    /// Convert ECEF coordinates back to WGS84 geodetic.
    pub fn from_ecef(x: f64, y: f64, z: f64) -> Self {
        let lon = y.atan2(x);
        let p = (x * x + y * y).sqrt();

        // Iterative approach (Bowring's method)
        let mut lat = (z / p).atan();
        for _ in 0..10 {
            let sin_lat = lat.sin();
            let n = WGS84_A / (1.0 - WGS84_E2 * sin_lat * sin_lat).sqrt();
            lat = (z + WGS84_E2 * n * sin_lat).atan2(p);
        }

        let sin_lat = lat.sin();
        let n = WGS84_A / (1.0 - WGS84_E2 * sin_lat * sin_lat).sqrt();
        let alt = p / lat.cos() - n;

        Self::new(lat.to_degrees(), lon.to_degrees(), alt)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ecef_roundtrip() {
        let original = Wgs84Coord::new(39.9042, 116.4074, 50.0);
        let (x, y, z) = original.to_ecef();
        let recovered = Wgs84Coord::from_ecef(x, y, z);

        assert!(
            (original.0.lat - recovered.0.lat).abs() < 1e-8,
            "Latitude mismatch: {} vs {}",
            original.0.lat,
            recovered.0.lat
        );
        assert!(
            (original.0.lon - recovered.0.lon).abs() < 1e-8,
            "Longitude mismatch: {} vs {}",
            original.0.lon,
            recovered.0.lon
        );
        assert!(
            (original.0.alt - recovered.0.alt).abs() < 1e-3,
            "Altitude mismatch: {} vs {}",
            original.0.alt,
            recovered.0.alt
        );
    }

    #[test]
    fn test_ecef_known_point() {
        // Greenwich, London at sea level
        let coord = Wgs84Coord::new(51.4769, 0.0005, 0.0);
        let (x, y, z) = coord.to_ecef();

        // X should be roughly 3.98M meters, Z roughly 4.97M
        assert!(x > 3_900_000.0 && x < 4_000_000.0);
        assert!(y.abs() < 100.0); // near prime meridian
        assert!(z > 4_900_000.0 && z < 5_000_000.0);
    }
}
