//! MGRS (Military Grid Reference System) conversions.
//!
//! Converts between UTM and MGRS grid references.
//! Supports 100km square identification and precision up to 1m.

use crate::gis::{
    GeoCoord,
    utm::{UtmCoord, geo_to_utm},
};

const COL_LETTERS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ"; // 24 letters (I/O omitted)
const ROW_LETTERS: &[u8] = b"ABCDEFGHJKLMNPQRSTUV"; // 20 letters

/// An MGRS grid reference.
#[derive(Debug, Clone, PartialEq)]
pub struct MgrsRef {
    /// UTM zone number (1–60).
    pub zone: u8,
    /// Band letter (C–X, omitting I and O).
    pub band: char,
    /// 100km column letter.
    pub col: char,
    /// 100km row letter.
    pub row: char,
    /// Easting within 100km square (0–99_999).
    pub easting: u32,
    /// Northing within 100km square (0–99_999).
    pub northing: u32,
    /// Precision (1=10km, 2=1km, 3=100m, 4=10m, 5=1m).
    pub precision: u8,
}

impl MgrsRef {
    /// Format as standard MGRS string, e.g. "50TMK12345678".
    pub fn format_ref(&self) -> String {
        let digits = self.precision as usize;
        let e_str = format!(
            "{:0>width$}",
            self.easting / 10u32.pow(5 - self.precision as u32),
            width = digits
        );
        let n_str = format!(
            "{:0>width$}",
            self.northing / 10u32.pow(5 - self.precision as u32),
            width = digits
        );
        format!(
            "{}{}{}{}{}{}",
            self.zone, self.band, self.col, self.row, e_str, n_str
        )
    }
}

/// Convert geodetic (lat°, lon°) → MGRS reference at given precision.
pub fn geo_to_mgrs(lat_deg: f64, lon_deg: f64, precision: u8) -> Option<MgrsRef> {
    let coord = GeoCoord::new(lat_deg, lon_deg, 0.0);
    let utm = geo_to_utm(&coord);
    utm_to_mgrs(&utm, lat_deg, precision)
}

/// Convert UTM coordinate to MGRS.
pub fn utm_to_mgrs(utm: &UtmCoord, lat_deg: f64, precision: u8) -> Option<MgrsRef> {
    let precision = precision.clamp(1, 5);
    let band = lat_band(lat_deg)?;
    // Column letter: based on zone + easting set
    let set = (utm.zone - 1) % 3; // 0, 1, 2
    let col_offset = (set * 8) as usize; // each set starts 8 columns later
    let col_idx = ((utm.easting as u32 / 100_000) as usize + col_offset) % COL_LETTERS.len();
    let col = COL_LETTERS[col_idx] as char;
    // Row letter: based on zone parity + northing
    let row_base = if utm.zone.is_multiple_of(2) { 5 } else { 0 }; // even zones offset by 5
    let row_idx = ((utm.northing as u32 / 100_000) as usize + row_base) % ROW_LETTERS.len();
    let row = ROW_LETTERS[row_idx] as char;
    let easting = utm.easting as u32 % 100_000;
    let northing = utm.northing as u32 % 100_000;
    Some(MgrsRef {
        zone: utm.zone,
        band,
        col,
        row,
        easting,
        northing,
        precision,
    })
}

/// Latitude band letter (C–X, 8° bands, no I/O).
fn lat_band(lat: f64) -> Option<char> {
    const BANDS: &[u8] = b"CDEFGHJKLMNPQRSTUVWX";
    if !(-80.0..=84.0).contains(&lat) {
        return None; // polar regions use UPS
    }
    let idx = ((lat + 80.0) / 8.0).floor() as usize;
    let idx = idx.min(BANDS.len() - 1);
    Some(BANDS[idx] as char)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lat_band_beijing() {
        // Beijing lat ≈ 39.9°
        let band = lat_band(39.9).unwrap();
        assert_eq!(band, 'S', "band={band}");
    }

    #[test]
    fn test_lat_band_equator() {
        let band = lat_band(0.0).unwrap();
        assert_eq!(band, 'N');
    }

    #[test]
    fn test_lat_band_out_of_range() {
        assert!(lat_band(90.0).is_none());
        assert!(lat_band(-90.0).is_none());
    }

    #[test]
    fn test_geo_to_mgrs_returns_some() {
        let mgrs = geo_to_mgrs(39.9042, 116.4074, 5);
        assert!(mgrs.is_some());
    }

    #[test]
    fn test_mgrs_to_string_format() {
        let mgrs = geo_to_mgrs(39.9042, 116.4074, 5).unwrap();
        let s = mgrs.format_ref();
        // Should start with zone number + band letter
        assert!(s.len() >= 7, "mgrs='{s}'");
    }
}
