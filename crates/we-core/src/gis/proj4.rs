//! Proj4 coordinate system stub.
//!
//! Provides a simplified Proj4 string parser and CRS identifier.
//! Full transformation is deferred to Phase 3 (WASM PROJ bindings).

use std::collections::HashMap;

/// A parsed Proj4 coordinate reference system definition.
#[derive(Debug, Clone, PartialEq)]
pub struct Proj4Crs {
    /// Raw Proj4 string.
    pub proj_string: String,
    /// Key-value parameters extracted from the Proj4 string.
    pub params: HashMap<String, String>,
}

impl Proj4Crs {
    /// Parse a Proj4 string into a `Proj4Crs`.
    pub fn parse(proj: &str) -> Result<Self, String> {
        if proj.trim().is_empty() {
            return Err("Empty Proj4 string".into());
        }
        let mut params = HashMap::new();
        for token in proj.split_whitespace() {
            if let Some(stripped) = token.strip_prefix('+') {
                if let Some((k, v)) = stripped.split_once('=') {
                    params.insert(k.to_owned(), v.to_owned());
                } else {
                    params.insert(stripped.to_owned(), "true".to_owned());
                }
            }
        }
        if !params.contains_key("proj") {
            return Err("Missing +proj parameter".into());
        }
        Ok(Self {
            proj_string: proj.to_owned(),
            params,
        })
    }

    /// Return the projection type (e.g. "utm", "longlat", "merc").
    pub fn proj_type(&self) -> &str {
        self.params.get("proj").map(String::as_str).unwrap_or("")
    }

    /// Return the EPSG code if specified as `+epsg=XXXX`.
    pub fn epsg(&self) -> Option<u32> {
        self.params.get("epsg").and_then(|v| v.parse().ok())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_utm_proj4() {
        let crs = Proj4Crs::parse("+proj=utm +zone=50 +datum=WGS84 +units=m +no_defs").unwrap();
        assert_eq!(crs.proj_type(), "utm");
        assert_eq!(crs.params.get("zone").map(String::as_str), Some("50"));
    }

    #[test]
    fn test_parse_longlat() {
        let crs = Proj4Crs::parse("+proj=longlat +datum=WGS84 +no_defs").unwrap();
        assert_eq!(crs.proj_type(), "longlat");
    }

    #[test]
    fn test_parse_empty_fails() {
        assert!(Proj4Crs::parse("").is_err());
    }

    #[test]
    fn test_parse_missing_proj_fails() {
        assert!(Proj4Crs::parse("+datum=WGS84 +no_defs").is_err());
    }

    #[test]
    fn test_flag_param() {
        let crs = Proj4Crs::parse("+proj=utm +zone=50 +no_defs").unwrap();
        assert_eq!(crs.params.get("no_defs").map(String::as_str), Some("true"));
    }
}
