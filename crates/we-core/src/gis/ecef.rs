//! ECEF (Earth-Centered, Earth-Fixed) coordinate conversions.
//!
//! Converts between WGS84 geodetic (lat, lon, alt) and ECEF (X, Y, Z).

use serde::{Deserialize, Serialize};

/// WGS84 semi-major axis in metres.
const A: f64 = 6_378_137.0;
/// WGS84 flattening.
const F: f64 = 1.0 / 298.257_223_563;
/// WGS84 first eccentricity squared.
const E2: f64 = 2.0 * F - F * F;

/// A 3-D point in ECEF coordinates (metres).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct EcefCoord {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl EcefCoord {
    pub fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }
}

/// Convert geodetic (lat°, lon°, alt m) → ECEF (X, Y, Z) metres.
pub fn geodetic_to_ecef(lat_deg: f64, lon_deg: f64, alt_m: f64) -> EcefCoord {
    let lat = lat_deg.to_radians();
    let lon = lon_deg.to_radians();
    let sin_lat = lat.sin();
    let cos_lat = lat.cos();
    let n = A / (1.0 - E2 * sin_lat * sin_lat).sqrt();
    EcefCoord {
        x: (n + alt_m) * cos_lat * lon.cos(),
        y: (n + alt_m) * cos_lat * lon.sin(),
        z: (n * (1.0 - E2) + alt_m) * sin_lat,
    }
}

/// Convert ECEF (X, Y, Z) metres → geodetic (lat°, lon°, alt m).
///
/// Uses Bowring's iterative formula — converges in 3–5 iterations.
pub fn ecef_to_geodetic(ecef: EcefCoord) -> (f64, f64, f64) {
    let p = (ecef.x * ecef.x + ecef.y * ecef.y).sqrt();
    let mut lat = (ecef.z / p / (1.0 - E2)).atan();
    for _ in 0..10 {
        let sin_lat = lat.sin();
        let n = A / (1.0 - E2 * sin_lat * sin_lat).sqrt();
        lat = ((ecef.z + E2 * n * sin_lat) / p).atan();
    }
    let sin_lat = lat.sin();
    let n = A / (1.0 - E2 * sin_lat * sin_lat).sqrt();
    let alt = p / lat.cos() - n;
    let lon = ecef.y.atan2(ecef.x);
    (lat.to_degrees(), lon.to_degrees(), alt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_geodetic_to_ecef_equator() {
        // Point on equator at prime meridian
        let e = geodetic_to_ecef(0.0, 0.0, 0.0);
        assert!((e.x - A).abs() < 1e-3, "x={}", e.x);
        assert!(e.y.abs() < 1e-6);
        assert!(e.z.abs() < 1e-6);
    }

    #[test]
    fn test_ecef_round_trip() {
        let (lat0, lon0, alt0) = (39.9042, 116.4074, 50.0);
        let ecef = geodetic_to_ecef(lat0, lon0, alt0);
        let (lat1, lon1, alt1) = ecef_to_geodetic(ecef);
        assert!((lat1 - lat0).abs() < 1e-8, "lat error={}", (lat1 - lat0).abs());
        assert!((lon1 - lon0).abs() < 1e-8, "lon error={}", (lon1 - lon0).abs());
        assert!((alt1 - alt0).abs() < 1e-3, "alt error={}", (alt1 - alt0).abs());
    }

    #[test]
    fn test_north_pole() {
        let e = geodetic_to_ecef(90.0, 0.0, 0.0);
        // At north pole, x≈0, y≈0, z≈b
        let b = A * (1.0 - F);
        assert!(e.x.abs() < 1.0);
        assert!(e.y.abs() < 1.0);
        assert!((e.z - b).abs() < 1.0, "z={}", e.z);
    }

    #[test]
    fn test_ecef_coord_new() {
        let c = EcefCoord::new(1.0, 2.0, 3.0);
        assert_eq!(c.x, 1.0);
        assert_eq!(c.z, 3.0);
    }
}
