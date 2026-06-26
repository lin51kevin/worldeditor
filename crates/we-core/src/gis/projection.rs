//! Pure-Rust map projection engine.
//!
//! Connects a parsed [`Proj4Crs`](super::proj4::Proj4Crs) to actual coordinate
//! transformation, covering the projections that matter for road networks
//! without any GDAL/PROJ native dependency:
//!
//! - `longlat` / `latlong` — geographic pass-through (lon = x, lat = y)
//! - `utm` — Universal Transverse Mercator (fixed `+zone`, optional `+south`)
//! - `tmerc` — generic Transverse Mercator (`+lat_0 +lon_0 +k +x_0 +y_0`)
//! - `merc` / `webmerc` — spherical (Web) Mercator, EPSG:3857
//!
//! All transforms operate on the WGS84 ellipsoid (Web Mercator uses the sphere
//! of radius `A`). GDAL-specific raster warping and exotic CRS remain a
//! documented native-only extension.

use super::GeoCoord;
use super::proj4::Proj4Crs;

/// Semi-major axis (WGS84), metres.
const A: f64 = 6_378_137.0;
/// Flattening (WGS84).
const F: f64 = 1.0 / 298.257_223_563;
/// First eccentricity squared.
const E2: f64 = 2.0 * F - F * F;
/// Second eccentricity squared.
const EP2: f64 = E2 / (1.0 - E2);

/// Error raised when a CRS cannot be used for transformation.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProjError {
    /// The projection type is not supported by this pure-Rust engine.
    #[error("unsupported projection: {0}")]
    Unsupported(String),
    /// A required parameter was missing or malformed.
    #[error("missing or invalid parameter: {0}")]
    BadParam(String),
}

/// Parameters of a Transverse Mercator projection.
#[derive(Debug, Clone, Copy)]
pub struct TmercParams {
    /// Latitude of origin (degrees).
    pub lat0: f64,
    /// Central meridian (degrees).
    pub lon0: f64,
    /// Scale factor at the central meridian.
    pub k0: f64,
    /// False easting (metres).
    pub x0: f64,
    /// False northing (metres).
    pub y0: f64,
}

/// Meridional arc length from the equator to latitude `phi` (radians).
fn meridian_arc(phi: f64) -> f64 {
    let e2 = E2;
    let e4 = e2 * e2;
    let e6 = e4 * e2;
    A * ((1.0 - e2 / 4.0 - 3.0 * e4 / 64.0 - 5.0 * e6 / 256.0) * phi
        - (3.0 * e2 / 8.0 + 3.0 * e4 / 32.0 + 45.0 * e6 / 1024.0) * (2.0 * phi).sin()
        + (15.0 * e4 / 256.0 + 45.0 * e6 / 1024.0) * (4.0 * phi).sin()
        - (35.0 * e6 / 3072.0) * (6.0 * phi).sin())
}

/// Forward Transverse Mercator: WGS84 lat/lon (degrees) → projected (x, y).
pub fn tmerc_forward(lat_deg: f64, lon_deg: f64, p: &TmercParams) -> (f64, f64) {
    let phi = lat_deg.to_radians();
    let lam = lon_deg.to_radians();
    let lon0 = p.lon0.to_radians();
    let lat0 = p.lat0.to_radians();

    let n = A / (1.0 - E2 * phi.sin().powi(2)).sqrt();
    let t = phi.tan();
    let c = EP2 * phi.cos().powi(2);
    let a_coeff = (lam - lon0) * phi.cos();

    let m = meridian_arc(phi);
    let m0 = meridian_arc(lat0);

    let x = p.k0
        * n
        * (a_coeff
            + (1.0 - t * t + c) * a_coeff.powi(3) / 6.0
            + (5.0 - 18.0 * t * t + t.powi(4) + 72.0 * c - 58.0 * EP2) * a_coeff.powi(5) / 120.0)
        + p.x0;

    let y = p.k0
        * (m - m0
            + n * t
                * (a_coeff.powi(2) / 2.0
                    + (5.0 - t * t + 9.0 * c + 4.0 * c * c) * a_coeff.powi(4) / 24.0
                    + (61.0 - 58.0 * t * t + t.powi(4) + 600.0 * c - 330.0 * EP2)
                        * a_coeff.powi(6)
                        / 720.0))
        + p.y0;

    (x, y)
}

/// Inverse Transverse Mercator: projected (x, y) → WGS84 lat/lon (degrees).
pub fn tmerc_inverse(x: f64, y: f64, p: &TmercParams) -> (f64, f64) {
    let lon0 = p.lon0.to_radians();
    let lat0 = p.lat0.to_radians();
    let m0 = meridian_arc(lat0);

    let m = (y - p.y0) / p.k0 + m0;
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
    let d = (x - p.x0) / (n1 * p.k0);

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

    (lat.to_degrees(), lon.to_degrees())
}

/// Forward spherical (Web) Mercator: WGS84 lat/lon (degrees) → (x, y) metres.
pub fn web_mercator_forward(lat_deg: f64, lon_deg: f64) -> (f64, f64) {
    let lat = lat_deg.to_radians().clamp(-1.484_422_229_745_332, 1.484_422_229_745_332);
    let x = A * lon_deg.to_radians();
    let y = A * (std::f64::consts::FRAC_PI_4 + lat / 2.0).tan().ln();
    (x, y)
}

/// Inverse spherical (Web) Mercator: (x, y) metres → WGS84 lat/lon (degrees).
pub fn web_mercator_inverse(x: f64, y: f64) -> (f64, f64) {
    let lon = (x / A).to_degrees();
    let lat = (2.0 * (y / A).exp().atan() - std::f64::consts::FRAC_PI_2).to_degrees();
    (lat, lon)
}

/// Central meridian (degrees) for a UTM zone.
fn utm_central_meridian(zone: u32) -> f64 {
    (zone as f64 - 1.0) * 6.0 - 180.0 + 3.0
}

impl Proj4Crs {
    /// Read a numeric parameter, falling back to `default` when absent.
    fn num_param(&self, key: &str, default: f64) -> f64 {
        self.params
            .get(key)
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(default)
    }

    /// Resolve this CRS to Transverse Mercator parameters, if applicable.
    fn tmerc_params(&self) -> Result<TmercParams, ProjError> {
        match self.proj_type() {
            "utm" => {
                let zone = self
                    .params
                    .get("zone")
                    .and_then(|v| v.parse::<u32>().ok())
                    .ok_or_else(|| ProjError::BadParam("zone".into()))?;
                let south = self.params.contains_key("south");
                Ok(TmercParams {
                    lat0: 0.0,
                    lon0: utm_central_meridian(zone),
                    k0: 0.9996,
                    x0: 500_000.0,
                    y0: if south { 10_000_000.0 } else { 0.0 },
                })
            }
            "tmerc" | "etmerc" => Ok(TmercParams {
                lat0: self.num_param("lat_0", 0.0),
                lon0: self.num_param("lon_0", 0.0),
                // PROJ accepts both `+k` and `+k_0`.
                k0: self
                    .params
                    .get("k_0")
                    .or_else(|| self.params.get("k"))
                    .and_then(|v| v.parse::<f64>().ok())
                    .unwrap_or(1.0),
                x0: self.num_param("x_0", 0.0),
                y0: self.num_param("y_0", 0.0),
            }),
            other => Err(ProjError::Unsupported(other.to_string())),
        }
    }

    /// Project WGS84 geographic coordinates into this CRS, returning `(x, y)`
    /// in the CRS's units (metres for projected systems, degrees for geographic).
    pub fn forward(&self, geo: &GeoCoord) -> Result<(f64, f64), ProjError> {
        match self.proj_type() {
            "longlat" | "latlong" => Ok((geo.lon, geo.lat)),
            "merc" | "webmerc" => Ok(web_mercator_forward(geo.lat, geo.lon)),
            "utm" | "tmerc" | "etmerc" => {
                let p = self.tmerc_params()?;
                Ok(tmerc_forward(geo.lat, geo.lon, &p))
            }
            other => Err(ProjError::Unsupported(other.to_string())),
        }
    }

    /// Inverse-project `(x, y)` in this CRS back to WGS84 geographic coordinates.
    pub fn inverse(&self, x: f64, y: f64) -> Result<GeoCoord, ProjError> {
        match self.proj_type() {
            "longlat" | "latlong" => Ok(GeoCoord::new(y, x, 0.0)),
            "merc" | "webmerc" => {
                let (lat, lon) = web_mercator_inverse(x, y);
                Ok(GeoCoord::new(lat, lon, 0.0))
            }
            "utm" | "tmerc" | "etmerc" => {
                let p = self.tmerc_params()?;
                let (lat, lon) = tmerc_inverse(x, y, &p);
                Ok(GeoCoord::new(lat, lon, 0.0))
            }
            other => Err(ProjError::Unsupported(other.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gis::utm::geo_to_utm;

    #[test]
    fn longlat_is_passthrough() {
        let crs = Proj4Crs::parse("+proj=longlat +datum=WGS84").unwrap();
        let geo = GeoCoord::new(39.9, 116.4, 0.0);
        let (x, y) = crs.forward(&geo).unwrap();
        assert_eq!((x, y), (116.4, 39.9));
        let back = crs.inverse(x, y).unwrap();
        assert!((back.lat - 39.9).abs() < 1e-12);
        assert!((back.lon - 116.4).abs() < 1e-12);
    }

    #[test]
    fn utm_matches_dedicated_utm_implementation() {
        // Beijing, zone 50N.
        let crs = Proj4Crs::parse("+proj=utm +zone=50 +datum=WGS84 +units=m").unwrap();
        let geo = GeoCoord::new(39.9042, 116.4074, 0.0);
        let (x, y) = crs.forward(&geo).unwrap();
        let reference = geo_to_utm(&geo);
        assert!((x - reference.easting).abs() < 1e-3, "easting {x}");
        assert!((y - reference.northing).abs() < 1e-3, "northing {y}");
    }

    #[test]
    fn utm_round_trips() {
        let crs = Proj4Crs::parse("+proj=utm +zone=50 +datum=WGS84").unwrap();
        let geo = GeoCoord::new(39.9042, 116.4074, 0.0);
        let (x, y) = crs.forward(&geo).unwrap();
        let back = crs.inverse(x, y).unwrap();
        assert!((back.lat - geo.lat).abs() < 1e-7);
        assert!((back.lon - geo.lon).abs() < 1e-7);
    }

    #[test]
    fn utm_southern_hemisphere_uses_false_northing() {
        let crs = Proj4Crs::parse("+proj=utm +zone=56 +south +datum=WGS84").unwrap();
        let sydney = GeoCoord::new(-33.8688, 151.2093, 0.0);
        let (_, y) = crs.forward(&sydney).unwrap();
        assert!(y > 6_000_000.0, "southern northing should be large: {y}");
        let back = crs.inverse(crs.forward(&sydney).unwrap().0, y).unwrap();
        assert!((back.lat - sydney.lat).abs() < 1e-7);
    }

    #[test]
    fn tmerc_round_trips() {
        let crs =
            Proj4Crs::parse("+proj=tmerc +lat_0=0 +lon_0=117 +k=1 +x_0=500000 +y_0=0").unwrap();
        let geo = GeoCoord::new(31.23, 117.5, 0.0);
        let (x, y) = crs.forward(&geo).unwrap();
        let back = crs.inverse(x, y).unwrap();
        assert!((back.lat - geo.lat).abs() < 1e-7);
        assert!((back.lon - geo.lon).abs() < 1e-7);
    }

    #[test]
    fn web_mercator_known_values() {
        let crs = Proj4Crs::parse("+proj=merc +datum=WGS84").unwrap();
        // Origin maps to (0, 0).
        let (x0, y0) = crs.forward(&GeoCoord::new(0.0, 0.0, 0.0)).unwrap();
        assert!(x0.abs() < 1e-6 && y0.abs() < 1e-6);
        // The antimeridian maps to the EPSG:3857 world extent.
        let (x180, _) = crs.forward(&GeoCoord::new(0.0, 180.0, 0.0)).unwrap();
        assert!((x180 - 20_037_508.342_789).abs() < 1.0, "x180 = {x180}");
    }

    #[test]
    fn web_mercator_round_trips() {
        let crs = Proj4Crs::parse("+proj=webmerc").unwrap();
        let geo = GeoCoord::new(48.8566, 2.3522, 0.0); // Paris
        let (x, y) = crs.forward(&geo).unwrap();
        let back = crs.inverse(x, y).unwrap();
        assert!((back.lat - geo.lat).abs() < 1e-7);
        assert!((back.lon - geo.lon).abs() < 1e-7);
    }

    #[test]
    fn unsupported_projection_errors() {
        let crs = Proj4Crs::parse("+proj=robin +datum=WGS84").unwrap();
        let err = crs.forward(&GeoCoord::new(0.0, 0.0, 0.0)).unwrap_err();
        assert!(matches!(err, ProjError::Unsupported(_)));
    }

    #[test]
    fn utm_without_zone_errors() {
        let crs = Proj4Crs::parse("+proj=utm +datum=WGS84").unwrap();
        assert!(matches!(
            crs.forward(&GeoCoord::new(0.0, 0.0, 0.0)),
            Err(ProjError::BadParam(_))
        ));
    }
}
