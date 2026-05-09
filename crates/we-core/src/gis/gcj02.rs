//! GCJ-02 (China Mars coordinate) transformations.
//!
//! Converts between WGS84 and GCJ-02 (used by Gaode/AutoNavi, Tencent Maps).
//! Pure Rust, WASM compatible. No external dependency.

use super::GeoCoord;

const PI: f64 = std::f64::consts::PI;
const A: f64 = 6_378_245.0; // Krasovsky 1940 semi-major axis
const EE: f64 = 0.006_693_421_622_965_943; // Krasovsky eccentricity squared

/// Check if a coordinate is inside China (rough bounds).
pub fn is_in_china(lat: f64, lon: f64) -> bool {
    (72.004..=137.8347).contains(&lon) && (0.8293..=55.8271).contains(&lat)
}

/// Convert WGS84 to GCJ-02.
pub fn wgs84_to_gcj02(coord: &GeoCoord) -> GeoCoord {
    if !is_in_china(coord.lat, coord.lon) {
        return *coord;
    }

    let (d_lat, d_lon) = delta(coord.lat, coord.lon);
    GeoCoord::new(coord.lat + d_lat, coord.lon + d_lon, coord.alt)
}

/// Convert GCJ-02 to WGS84 (iterative method, high precision).
pub fn gcj02_to_wgs84(coord: &GeoCoord) -> GeoCoord {
    if !is_in_china(coord.lat, coord.lon) {
        return *coord;
    }

    // Iterative approach for better precision (~0.5m)
    let mut wgs_lat = coord.lat;
    let mut wgs_lon = coord.lon;

    for _ in 0..5 {
        let gcj = wgs84_to_gcj02(&GeoCoord::new(wgs_lat, wgs_lon, coord.alt));
        wgs_lat += coord.lat - gcj.lat;
        wgs_lon += coord.lon - gcj.lon;
    }

    GeoCoord::new(wgs_lat, wgs_lon, coord.alt)
}

/// Calculate the offset from WGS84 to GCJ-02.
fn delta(lat: f64, lon: f64) -> (f64, f64) {
    let mut d_lat = transform_lat(lon - 105.0, lat - 35.0);
    let mut d_lon = transform_lon(lon - 105.0, lat - 35.0);

    let rad_lat = lat / 180.0 * PI;
    let magic = rad_lat.sin();
    let magic = 1.0 - EE * magic * magic;
    let sqrt_magic = magic.sqrt();

    d_lat = (d_lat * 180.0) / ((A * (1.0 - EE)) / (magic * sqrt_magic) * PI);
    d_lon = (d_lon * 180.0) / (A / sqrt_magic * rad_lat.cos() * PI);

    (d_lat, d_lon)
}

fn transform_lat(x: f64, y: f64) -> f64 {
    let mut ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * x.abs().sqrt();
    ret += (20.0 * (6.0 * x * PI).sin() + 20.0 * (2.0 * x * PI).sin()) * 2.0 / 3.0;
    ret += (20.0 * (y * PI).sin() + 40.0 * (y / 3.0 * PI).sin()) * 2.0 / 3.0;
    ret += (160.0 * (y / 12.0 * PI).sin() + 320.0 * (y * PI / 30.0).sin()) * 2.0 / 3.0;
    ret
}

fn transform_lon(x: f64, y: f64) -> f64 {
    let mut ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * x.abs().sqrt();
    ret += (20.0 * (6.0 * x * PI).sin() + 20.0 * (2.0 * x * PI).sin()) * 2.0 / 3.0;
    ret += (20.0 * (x * PI).sin() + 40.0 * (x / 3.0 * PI).sin()) * 2.0 / 3.0;
    ret += (150.0 * (x / 12.0 * PI).sin() + 300.0 * (x / 30.0 * PI).sin()) * 2.0 / 3.0;
    ret
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_in_china() {
        assert!(is_in_china(39.9042, 116.4074)); // Beijing
        assert!(is_in_china(31.2304, 121.4737)); // Shanghai
        assert!(!is_in_china(51.5074, -0.1278)); // London
        assert!(!is_in_china(40.7128, -74.0060)); // New York
    }

    #[test]
    fn test_wgs84_to_gcj02_outside_china() {
        let wgs = GeoCoord::new(51.5074, -0.1278, 0.0); // London
        let gcj = wgs84_to_gcj02(&wgs);
        // Outside China, should return unchanged
        assert!((gcj.lat - wgs.lat).abs() < f64::EPSILON);
        assert!((gcj.lon - wgs.lon).abs() < f64::EPSILON);
    }

    #[test]
    fn test_wgs84_to_gcj02_beijing() {
        let wgs = GeoCoord::new(39.9042, 116.4074, 0.0);
        let gcj = wgs84_to_gcj02(&wgs);
        // GCJ-02 should differ from WGS84 by roughly 0.003-0.006 degrees
        let d_lat = (gcj.lat - wgs.lat).abs();
        let d_lon = (gcj.lon - wgs.lon).abs();
        assert!(
            d_lat > 0.001 && d_lat < 0.01,
            "Unexpected lat delta: {d_lat}"
        );
        assert!(
            d_lon > 0.001 && d_lon < 0.01,
            "Unexpected lon delta: {d_lon}"
        );
    }

    #[test]
    fn test_gcj02_roundtrip_beijing() {
        let wgs = GeoCoord::new(39.9042, 116.4074, 50.0);
        let gcj = wgs84_to_gcj02(&wgs);
        let recovered = gcj02_to_wgs84(&gcj);
        assert!(
            (wgs.lat - recovered.lat).abs() < 1e-6,
            "Lat: {} vs {}",
            wgs.lat,
            recovered.lat
        );
        assert!(
            (wgs.lon - recovered.lon).abs() < 1e-6,
            "Lon: {} vs {}",
            wgs.lon,
            recovered.lon
        );
        assert!((wgs.alt - recovered.alt).abs() < f64::EPSILON);
    }

    #[test]
    fn test_gcj02_roundtrip_shanghai() {
        let wgs = GeoCoord::new(31.2304, 121.4737, 0.0);
        let gcj = wgs84_to_gcj02(&wgs);
        let recovered = gcj02_to_wgs84(&gcj);
        assert!((wgs.lat - recovered.lat).abs() < 1e-6);
        assert!((wgs.lon - recovered.lon).abs() < 1e-6);
    }

    #[test]
    fn test_gcj02_roundtrip_shenzhen() {
        let wgs = GeoCoord::new(22.5431, 114.0579, 0.0);
        let gcj = wgs84_to_gcj02(&wgs);
        let recovered = gcj02_to_wgs84(&gcj);
        assert!((wgs.lat - recovered.lat).abs() < 1e-6);
        assert!((wgs.lon - recovered.lon).abs() < 1e-6);
    }

    /// Known point pair for validation (Tian'anmen Square).
    /// WGS84: 39.908722, 116.397499
    /// GCJ02: ~39.91034, 116.40328 (approx)
    #[test]
    fn test_known_point_tiananmen() {
        let wgs = GeoCoord::new(39.908722, 116.397499, 0.0);
        let gcj = wgs84_to_gcj02(&wgs);
        // Offset should be non-trivial
        assert!((gcj.lat - wgs.lat).abs() > 0.001);
        assert!((gcj.lon - wgs.lon).abs() > 0.001);
    }
}
