//! UTM (Universal Transverse Mercator) coordinate transformations.
//!
//! Pure Rust, WASM compatible. No GDAL/PROJ dependency.

use super::GeoCoord;
use serde::{Deserialize, Serialize};

/// Semi-major axis (WGS84)
const A: f64 = 6_378_137.0;
/// Flattening
const F: f64 = 1.0 / 298.257_223_563;
/// Eccentricity squared
const E2: f64 = 2.0 * F - F * F;
/// Second eccentricity squared
const EP2: f64 = E2 / (1.0 - E2);
/// UTM scale factor
const K0: f64 = 0.9996;

/// A UTM coordinate.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct UtmCoord {
    pub easting: f64,
    pub northing: f64,
    pub zone: u8,
    pub is_northern: bool,
    pub alt: f64,
}

impl UtmCoord {
    pub fn new(easting: f64, northing: f64, zone: u8, is_northern: bool, alt: f64) -> Self {
        Self {
            easting,
            northing,
            zone,
            is_northern,
            alt,
        }
    }
}

/// Convert WGS84 geodetic (lat/lon degrees) to UTM.
pub fn geo_to_utm(coord: &GeoCoord) -> UtmCoord {
    let lat_rad = coord.lat.to_radians();
    let lon_rad = coord.lon.to_radians();

    let zone = lat_lon_to_zone(coord.lat, coord.lon);
    let lon0 = zone_to_central_meridian(zone).to_radians();

    let n = A / (1.0 - E2 * lat_rad.sin().powi(2)).sqrt();
    let t = lat_rad.tan();
    let c = EP2 * lat_rad.cos().powi(2);
    let a_coeff = (lon_rad - lon0) * lat_rad.cos();

    let m = meridian_arc(lat_rad);

    let easting = K0
        * n
        * (a_coeff
            + (1.0 - t * t + c) * a_coeff.powi(3) / 6.0
            + (5.0 - 18.0 * t * t + t.powi(4) + 72.0 * c - 58.0 * EP2) * a_coeff.powi(5) / 120.0)
        + 500_000.0;

    let mut northing = K0
        * (m + n
            * t
            * (a_coeff.powi(2) / 2.0
                + (5.0 - t * t + 9.0 * c + 4.0 * c * c) * a_coeff.powi(4) / 24.0
                + (61.0 - 58.0 * t * t + t.powi(4) + 600.0 * c - 330.0 * EP2) * a_coeff.powi(6)
                    / 720.0));

    let is_northern = coord.lat >= 0.0;
    if !is_northern {
        northing += 10_000_000.0;
    }

    UtmCoord {
        easting,
        northing,
        zone,
        is_northern,
        alt: coord.alt,
    }
}

/// Convert UTM to WGS84 geodetic (lat/lon degrees).
pub fn utm_to_geo(utm: &UtmCoord) -> GeoCoord {
    let x = utm.easting - 500_000.0;
    let mut y = utm.northing;
    if !utm.is_northern {
        y -= 10_000_000.0;
    }

    let lon0 = zone_to_central_meridian(utm.zone).to_radians();

    // Footpoint latitude
    let m = y / K0;
    let mu = m / (A * (1.0 - E2 / 4.0 - 3.0 * E2 * E2 / 64.0 - 5.0 * E2.powi(3) / 256.0));

    let e1 = (1.0 - (1.0 - E2).sqrt()) / (1.0 + (1.0 - E2).sqrt());
    let phi1 = mu
        + (3.0 * e1 / 2.0 - 27.0 * e1.powi(3) / 32.0) * (2.0 * mu).sin()
        + (21.0 * e1 * e1 / 16.0 - 55.0 * e1.powi(4) / 32.0) * (4.0 * mu).sin()
        + (151.0 * e1.powi(3) / 96.0) * (6.0 * mu).sin();

    let n1 = A / (1.0 - E2 * phi1.sin().powi(2)).sqrt();
    let t1 = phi1.tan();
    let c1 = EP2 * phi1.cos().powi(2);
    let r1 = A * (1.0 - E2) / (1.0 - E2 * phi1.sin().powi(2)).powf(1.5);
    let d = x / (n1 * K0);

    let lat = phi1
        - (n1 * t1 / r1)
            * (d * d / 2.0
                - (5.0 + 3.0 * t1 * t1 + 10.0 * c1 - 4.0 * c1 * c1 - 9.0 * EP2) * d.powi(4) / 24.0
                + (61.0 + 90.0 * t1 * t1 + 298.0 * c1 + 45.0 * t1.powi(4)
                    - 252.0 * EP2
                    - 3.0 * c1 * c1)
                    * d.powi(6)
                    / 720.0);

    let lon = lon0
        + (d - (1.0 + 2.0 * t1 * t1 + c1) * d.powi(3) / 6.0
            + (5.0 - 2.0 * c1 + 28.0 * t1 * t1 - 3.0 * c1 * c1 + 8.0 * EP2 + 24.0 * t1.powi(4))
                * d.powi(5)
                / 120.0)
            / phi1.cos();

    GeoCoord::new(lat.to_degrees(), lon.to_degrees(), utm.alt)
}

/// Calculate the UTM zone number from latitude and longitude.
pub fn lat_lon_to_zone(lat: f64, lon: f64) -> u8 {
    // Special zones for Norway and Svalbard
    if (56.0..=64.0).contains(&lat) && (3.0..=12.0).contains(&lon) {
        return 32;
    }
    if (72.0..=84.0).contains(&lat) {
        if (0.0..=9.0).contains(&lon) {
            return 31;
        }
        if (9.0..=21.0).contains(&lon) {
            return 33;
        }
        if (21.0..=33.0).contains(&lon) {
            return 35;
        }
        if (33.0..=42.0).contains(&lon) {
            return 37;
        }
    }
    ((lon + 180.0) / 6.0).floor() as u8 + 1
}

/// Central meridian for a UTM zone.
fn zone_to_central_meridian(zone: u8) -> f64 {
    (zone as f64 - 1.0) * 6.0 - 180.0 + 3.0
}

/// Meridional arc length from equator to latitude phi.
fn meridian_arc(phi: f64) -> f64 {
    let e2 = E2;
    let e4 = e2 * e2;
    let e6 = e4 * e2;
    A * ((1.0 - e2 / 4.0 - 3.0 * e4 / 64.0 - 5.0 * e6 / 256.0) * phi
        - (3.0 * e2 / 8.0 + 3.0 * e4 / 32.0 + 45.0 * e6 / 1024.0) * (2.0 * phi).sin()
        + (15.0 * e4 / 256.0 + 45.0 * e6 / 1024.0) * (4.0 * phi).sin()
        - (35.0 * e6 / 3072.0) * (6.0 * phi).sin())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_utm_zone_calculation() {
        // Beijing: zone 50
        assert_eq!(lat_lon_to_zone(39.9, 116.4), 50);
        // London: zone 30
        assert_eq!(lat_lon_to_zone(51.5, -0.1), 30);
        // New York: zone 18
        assert_eq!(lat_lon_to_zone(40.7, -74.0), 18);
    }

    #[test]
    fn test_geo_to_utm_beijing() {
        let coord = GeoCoord::new(39.9042, 116.4074, 50.0);
        let utm = geo_to_utm(&coord);
        assert_eq!(utm.zone, 50);
        assert!(utm.is_northern);
        // Roundtrip is the true validation; absolute values have variance between implementations
        let recovered = utm_to_geo(&utm);
        assert!((coord.lat - recovered.lat).abs() < 1e-6);
        assert!((coord.lon - recovered.lon).abs() < 1e-6);
    }

    #[test]
    fn test_geo_to_utm_southern() {
        let coord = GeoCoord::new(-33.8688, 151.2093, 0.0); // Sydney
        let utm = geo_to_utm(&coord);
        assert!(!utm.is_northern);
        assert_eq!(utm.zone, 56);
    }

    #[test]
    fn test_utm_roundtrip() {
        let original = GeoCoord::new(39.9042, 116.4074, 50.0);
        let utm = geo_to_utm(&original);
        let recovered = utm_to_geo(&utm);
        assert!(
            (original.lat - recovered.lat).abs() < 1e-6,
            "Lat: {} vs {}",
            original.lat,
            recovered.lat
        );
        assert!(
            (original.lon - recovered.lon).abs() < 1e-6,
            "Lon: {} vs {}",
            original.lon,
            recovered.lon
        );
    }

    #[test]
    fn test_utm_roundtrip_equator() {
        let original = GeoCoord::new(0.0, 0.0, 0.0);
        let utm = geo_to_utm(&original);
        let recovered = utm_to_geo(&utm);
        assert!((original.lat - recovered.lat).abs() < 1e-6);
        assert!((original.lon - recovered.lon).abs() < 1e-6);
    }

    #[test]
    fn test_utm_roundtrip_high_lat() {
        let original = GeoCoord::new(78.0, 15.0, 0.0); // Svalbard
        let utm = geo_to_utm(&original);
        let recovered = utm_to_geo(&utm);
        assert!((original.lat - recovered.lat).abs() < 1e-6);
        assert!((original.lon - recovered.lon).abs() < 1e-6);
    }

    #[test]
    fn test_utm_roundtrip_southern_hemisphere() {
        let original = GeoCoord::new(-33.8688, 151.2093, 10.0);
        let utm = geo_to_utm(&original);
        let recovered = utm_to_geo(&utm);
        assert!((original.lat - recovered.lat).abs() < 1e-6);
        assert!((original.lon - recovered.lon).abs() < 1e-6);
    }
}
