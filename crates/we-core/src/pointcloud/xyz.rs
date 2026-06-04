//! XYZ ASCII point cloud parser.
//!
//! Each non-empty, non-comment line holds whitespace-separated columns. The
//! first three are `x y z`. Common optional layouts are auto-detected:
//! - `x y z`
//! - `x y z intensity`
//! - `x y z r g b`
//! - `x y z intensity r g b`
//!
//! RGB columns are interpreted as `0..=255` integers.

use super::model::PointCloud;
use super::{PointCloudError, PointCloudResult, RawRecord};

/// Parse an XYZ ASCII point cloud from raw bytes.
pub fn parse_xyz(bytes: &[u8]) -> PointCloudResult<PointCloud> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| PointCloudError::InvalidData("non-UTF8 XYZ body".into()))?;

    let mut records: Vec<RawRecord> = Vec::new();

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
            continue;
        }
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 3 {
            continue;
        }
        let parse = |s: &str| s.parse::<f64>().ok();
        let (x, y, z) = match (parse(cols[0]), parse(cols[1]), parse(cols[2])) {
            (Some(x), Some(y), Some(z)) => (x, y, z),
            _ => continue, // header or non-numeric line
        };

        let (intensity, rgb) = match cols.len() {
            4 => (parse(cols[3]).map(|v| v as f32), None),
            n if n >= 7 => {
                let i = parse(cols[3]).map(|v| v as f32);
                let rgb = parse_rgb(&cols[4..7]);
                (i, rgb)
            }
            n if n >= 6 => {
                let rgb = parse_rgb(&cols[3..6]);
                (None, rgb)
            }
            _ => (None, None),
        };
        records.push((x, y, z, intensity, rgb));
    }

    if records.is_empty() {
        return Err(PointCloudError::InvalidData("no XYZ points".into()));
    }

    let origin = records
        .first()
        .map(|(x, y, z, _, _)| [*x, *y, *z])
        .unwrap_or([0.0; 3]);
    let mut cloud = PointCloud::with_origin(origin);
    cloud.reserve(records.len());
    for (x, y, z, intensity, rgb) in records {
        cloud.push(
            [x - origin[0], y - origin[1], z - origin[2]],
            intensity,
            rgb,
        );
    }
    Ok(cloud)
}

fn parse_rgb(cols: &[&str]) -> Option<[u8; 3]> {
    let r = cols[0].parse::<f64>().ok()?;
    let g = cols[1].parse::<f64>().ok()?;
    let b = cols[2].parse::<f64>().ok()?;
    Some([
        r.clamp(0.0, 255.0) as u8,
        g.clamp(0.0, 255.0) as u8,
        b.clamp(0.0, 255.0) as u8,
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_xyz_basic() {
        let body = "0 0 0\n1 2 3\n4 5 6\n";
        let cloud = parse_xyz(body.as_bytes()).unwrap();
        assert_eq!(cloud.len(), 3);
        assert_eq!(cloud.point(1), Some([1.0, 2.0, 3.0]));
        assert!(!cloud.has_intensity());
        assert!(!cloud.has_rgb());
    }

    #[test]
    fn test_parse_xyz_intensity() {
        let body = "# comment\n0 0 0 0.5\n1 1 1 0.9\n";
        let cloud = parse_xyz(body.as_bytes()).unwrap();
        assert_eq!(cloud.len(), 2);
        assert!(cloud.has_intensity());
        assert_eq!(cloud.intensity(1), Some(0.9));
    }

    #[test]
    fn test_parse_xyz_rgb() {
        let body = "0 0 0 255 128 0\n1 1 1 0 0 255\n";
        let cloud = parse_xyz(body.as_bytes()).unwrap();
        assert!(cloud.has_rgb());
        assert_eq!(cloud.color(0), Some([255, 128, 0]));
        assert_eq!(cloud.color(1), Some([0, 0, 255]));
    }

    #[test]
    fn test_parse_xyz_intensity_and_rgb() {
        let body = "0 0 0 0.5 255 128 0\n";
        let cloud = parse_xyz(body.as_bytes()).unwrap();
        assert!(cloud.has_intensity());
        assert!(cloud.has_rgb());
        assert_eq!(cloud.intensity(0), Some(0.5));
        assert_eq!(cloud.color(0), Some([255, 128, 0]));
    }

    #[test]
    fn test_empty_errors() {
        assert!(parse_xyz(b"# only comments\n").is_err());
    }
}
