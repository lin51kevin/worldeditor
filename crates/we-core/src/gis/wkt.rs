//! WKT (Well-Known Text) coordinate reference system stub parser.
//!
//! Extracts the CRS name and authority code from WKT strings.
//! Full WKT parsing is deferred to Phase 3.

/// A minimal parsed WKT CRS record.
#[derive(Debug, Clone, PartialEq)]
pub struct WktCrs {
    /// CRS type keyword: GEOGCS, PROJCS, VERTCS, etc.
    pub crs_type: String,
    /// Human-readable CRS name extracted from the WKT string.
    pub name: String,
    /// Optional EPSG authority code.
    pub epsg: Option<u32>,
}

impl WktCrs {
    /// Parse a WKT string and extract minimal metadata.
    pub fn parse(wkt: &str) -> Result<Self, String> {
        let wkt = wkt.trim();
        if wkt.is_empty() {
            return Err("Empty WKT string".into());
        }
        // Extract CRS type keyword (before first '[')
        let bracket = wkt.find('[').ok_or("Missing '[' in WKT")?;
        let crs_type = wkt[..bracket].trim().to_uppercase();
        // Extract name: first quoted string after '['
        let after_bracket = &wkt[bracket + 1..];
        let name_start = after_bracket.find('"').ok_or("Missing name in WKT")? + 1;
        let after_start = &after_bracket[name_start..];
        let name_end = after_start.find('"').ok_or("Unterminated name in WKT")?;
        let name = after_start[..name_end].to_owned();
        // Extract EPSG code: look for AUTHORITY["EPSG","XXXX"]
        let epsg = extract_epsg(wkt);
        Ok(Self { crs_type, name, epsg })
    }
}

fn extract_epsg(wkt: &str) -> Option<u32> {
    // Find AUTHORITY["EPSG","XXXX"] pattern
    let auth_pos = wkt.to_uppercase().find("AUTHORITY")?;
    let after = &wkt[auth_pos..];
    // Find "EPSG" then the code
    let epsg_pos = after.to_uppercase().find("\"EPSG\"")?;
    let after_epsg = &after[epsg_pos + 6..];
    // Skip comma and find the code string
    let code_start = after_epsg.find('"')? + 1;
    let code_str = &after_epsg[code_start..];
    let code_end = code_str.find('"')?;
    code_str[..code_end].parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const WGS84_WKT: &str = r#"GEOGCS["WGS 84",
        DATUM["WGS_1984",
          SPHEROID["WGS 84",6378137,298.257223563]],
        PRIMEM["Greenwich",0],
        UNIT["degree",0.0174532925199433],
        AUTHORITY["EPSG","4326"]]"#;

    #[test]
    fn test_parse_wgs84_type() {
        let crs = WktCrs::parse(WGS84_WKT).unwrap();
        assert_eq!(crs.crs_type, "GEOGCS");
    }

    #[test]
    fn test_parse_wgs84_name() {
        let crs = WktCrs::parse(WGS84_WKT).unwrap();
        assert_eq!(crs.name, "WGS 84");
    }

    #[test]
    fn test_parse_wgs84_epsg() {
        let crs = WktCrs::parse(WGS84_WKT).unwrap();
        assert_eq!(crs.epsg, Some(4326));
    }

    #[test]
    fn test_parse_empty_fails() {
        assert!(WktCrs::parse("").is_err());
    }

    #[test]
    fn test_parse_no_bracket_fails() {
        assert!(WktCrs::parse("GEOGCS no bracket here").is_err());
    }
}
