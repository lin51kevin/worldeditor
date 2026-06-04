//! PCD (Point Cloud Data) format parser.
//!
//! Supports the common ASCII and uncompressed little-endian binary variants
//! with `x y z` geometry plus optional `intensity` and packed `rgb`/`rgba`
//! fields. Ported and adapted from the legacy C# `LibPointCloud` loader.
//!
//! Positions are stored relative to the first point's coordinate so that large
//! global georeferenced clouds keep full `f64` precision.

use super::model::PointCloud;
use super::{PointCloudError, PointCloudResult, RawRecord};

/// Scalar storage type for a PCD field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FieldType {
    /// Floating point (`F`).
    Float,
    /// Unsigned integer (`U`).
    Unsigned,
    /// Signed integer (`I`).
    Signed,
}

/// A single PCD field descriptor resolved from the header.
#[derive(Debug, Clone)]
struct Field {
    name: String,
    size: usize,
    ty: FieldType,
    /// Byte offset of this field within a binary record.
    offset: usize,
    /// Column index of this field within an ASCII record.
    column: usize,
}

#[derive(Debug, Default)]
struct Header {
    fields: Vec<Field>,
    width: usize,
    height: usize,
    points: usize,
    /// `true` for binary data, `false` for ASCII.
    binary: bool,
    /// Byte length of one binary record.
    stride: usize,
    /// Byte offset of the data section (binary only).
    data_offset: usize,
}

fn parse_type(token: &str) -> PointCloudResult<FieldType> {
    match token {
        "F" => Ok(FieldType::Float),
        "U" => Ok(FieldType::Unsigned),
        "I" => Ok(FieldType::Signed),
        other => Err(PointCloudError::Unsupported(format!(
            "PCD field type '{other}'"
        ))),
    }
}

/// Parse the PCD header from the leading bytes of the file.
fn parse_header(bytes: &[u8]) -> PointCloudResult<Header> {
    let mut names: Vec<String> = Vec::new();
    let mut sizes: Vec<usize> = Vec::new();
    let mut types: Vec<FieldType> = Vec::new();
    let mut counts: Vec<usize> = Vec::new();
    let mut header = Header::default();

    let mut cursor = 0usize;
    loop {
        // Find the end of the current line.
        let line_start = cursor;
        let mut line_end = cursor;
        while line_end < bytes.len() && bytes[line_end] != b'\n' {
            line_end += 1;
        }
        if line_end >= bytes.len() && line_start == line_end {
            return Err(PointCloudError::InvalidHeader(
                "missing DATA section".into(),
            ));
        }

        // Strip a trailing '\r'.
        let mut raw_end = line_end;
        if raw_end > line_start && bytes[raw_end - 1] == b'\r' {
            raw_end -= 1;
        }
        let line = std::str::from_utf8(&bytes[line_start..raw_end])
            .map_err(|_| PointCloudError::InvalidHeader("non-UTF8 header".into()))?
            .trim();
        cursor = line_end + 1;

        if line.is_empty() || line.starts_with('#') {
            if cursor >= bytes.len() {
                return Err(PointCloudError::InvalidHeader(
                    "missing DATA section".into(),
                ));
            }
            continue;
        }

        let mut parts = line.split_whitespace();
        let key = parts.next().unwrap_or("");
        let values: Vec<&str> = parts.collect();

        match key {
            "FIELDS" | "COLUMNS" => names = values.iter().map(|s| s.to_string()).collect(),
            "SIZE" => {
                sizes = values
                    .iter()
                    .map(|s| s.parse::<usize>())
                    .collect::<Result<_, _>>()
                    .map_err(|_| PointCloudError::InvalidHeader("SIZE".into()))?;
            }
            "TYPE" => {
                types = values
                    .iter()
                    .map(|s| parse_type(s))
                    .collect::<Result<_, _>>()?;
            }
            "COUNT" => {
                counts = values
                    .iter()
                    .map(|s| s.parse::<usize>())
                    .collect::<Result<_, _>>()
                    .map_err(|_| PointCloudError::InvalidHeader("COUNT".into()))?;
            }
            "WIDTH" => {
                header.width = values
                    .first()
                    .and_then(|s| s.parse().ok())
                    .ok_or_else(|| PointCloudError::InvalidHeader("WIDTH".into()))?;
            }
            "HEIGHT" => {
                header.height = values
                    .first()
                    .and_then(|s| s.parse().ok())
                    .ok_or_else(|| PointCloudError::InvalidHeader("HEIGHT".into()))?;
            }
            "POINTS" => {
                header.points = values
                    .first()
                    .and_then(|s| s.parse().ok())
                    .ok_or_else(|| PointCloudError::InvalidHeader("POINTS".into()))?;
            }
            "DATA" => {
                match values.first().copied() {
                    Some("ascii") => header.binary = false,
                    Some("binary") => header.binary = true,
                    Some("binary_compressed") => {
                        return Err(PointCloudError::Unsupported("PCD binary_compressed".into()));
                    }
                    other => {
                        return Err(PointCloudError::InvalidHeader(format!(
                            "DATA '{}'",
                            other.unwrap_or("")
                        )));
                    }
                }
                header.data_offset = cursor;
                break;
            }
            _ => {} // VERSION, VIEWPOINT, etc. ignored.
        }

        if cursor >= bytes.len() {
            return Err(PointCloudError::InvalidHeader(
                "missing DATA section".into(),
            ));
        }
    }

    if names.is_empty() || sizes.len() != names.len() || types.len() != names.len() {
        return Err(PointCloudError::InvalidHeader(
            "FIELDS/SIZE/TYPE mismatch".into(),
        ));
    }
    if counts.is_empty() {
        counts = vec![1; names.len()];
    }

    let mut offset = 0usize;
    let mut column = 0usize;
    for i in 0..names.len() {
        let count = counts[i].max(1);
        header.fields.push(Field {
            name: names[i].clone(),
            size: sizes[i],
            ty: types[i],
            offset,
            column,
        });
        offset += sizes[i] * count;
        column += count;
    }
    header.stride = offset;

    if header.points == 0 {
        header.points = header.width.saturating_mul(header.height.max(1));
    }

    Ok(header)
}

/// Read a numeric field value as `f64` from a binary record slice.
fn read_scalar(record: &[u8], field: &Field) -> f64 {
    let s = &record[field.offset..field.offset + field.size];
    match (field.ty, field.size) {
        (FieldType::Float, 4) => f32::from_le_bytes([s[0], s[1], s[2], s[3]]) as f64,
        (FieldType::Float, 8) => {
            f64::from_le_bytes([s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]])
        }
        (FieldType::Unsigned, 1) => s[0] as f64,
        (FieldType::Unsigned, 2) => u16::from_le_bytes([s[0], s[1]]) as f64,
        (FieldType::Unsigned, 4) => u32::from_le_bytes([s[0], s[1], s[2], s[3]]) as f64,
        (FieldType::Signed, 1) => (s[0] as i8) as f64,
        (FieldType::Signed, 2) => i16::from_le_bytes([s[0], s[1]]) as f64,
        (FieldType::Signed, 4) => i32::from_le_bytes([s[0], s[1], s[2], s[3]]) as f64,
        _ => 0.0,
    }
}

/// Decode a packed PCD `rgb`/`rgba` float (or uint) value into `[r, g, b]`.
fn decode_packed_rgb(value: f64) -> [u8; 3] {
    let bits = (value as f32).to_bits();
    let packed = if bits == 0 { value as u32 } else { bits };
    [
        ((packed >> 16) & 0xff) as u8,
        ((packed >> 8) & 0xff) as u8,
        (packed & 0xff) as u8,
    ]
}

struct FieldIndices {
    x: usize,
    y: usize,
    z: usize,
    intensity: Option<usize>,
    rgb: Option<usize>,
}

fn resolve_indices(fields: &[Field]) -> PointCloudResult<FieldIndices> {
    let find = |name: &str| {
        fields
            .iter()
            .position(|f| f.name.eq_ignore_ascii_case(name))
    };
    let x = find("x").ok_or_else(|| PointCloudError::InvalidHeader("missing x field".into()))?;
    let y = find("y").ok_or_else(|| PointCloudError::InvalidHeader("missing y field".into()))?;
    let z = find("z").ok_or_else(|| PointCloudError::InvalidHeader("missing z field".into()))?;
    let intensity = find("intensity").or_else(|| find("i"));
    let rgb = find("rgb").or_else(|| find("rgba"));
    Ok(FieldIndices {
        x,
        y,
        z,
        intensity,
        rgb,
    })
}

/// Parse a PCD point cloud from raw bytes (ASCII or binary).
pub fn parse_pcd(bytes: &[u8]) -> PointCloudResult<PointCloud> {
    let header = parse_header(bytes)?;
    let idx = resolve_indices(&header.fields)?;

    // Read every point into a temporary record list first so the origin can be
    // taken from the first point and subtracted for `f64` precision.
    let mut records: Vec<RawRecord> = Vec::with_capacity(header.points);

    if header.binary {
        if header.stride == 0 {
            return Err(PointCloudError::InvalidHeader("zero record stride".into()));
        }
        let data = &bytes[header.data_offset..];
        let available = data.len() / header.stride;
        let n = header.points.min(available);
        for r in 0..n {
            let record = &data[r * header.stride..(r + 1) * header.stride];
            let x = read_scalar(record, &header.fields[idx.x]);
            let y = read_scalar(record, &header.fields[idx.y]);
            let z = read_scalar(record, &header.fields[idx.z]);
            let intensity = idx
                .intensity
                .map(|i| read_scalar(record, &header.fields[i]) as f32);
            let rgb = idx
                .rgb
                .map(|i| decode_packed_rgb(read_scalar(record, &header.fields[i])));
            records.push((x, y, z, intensity, rgb));
        }
    } else {
        let text = std::str::from_utf8(&bytes[header.data_offset..])
            .map_err(|_| PointCloudError::InvalidData("non-UTF8 ASCII body".into()))?;
        let max_col = header.fields.iter().map(|f| f.column).max().unwrap_or(0);
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() <= max_col {
                continue;
            }
            let col = |field_idx: usize| -> f64 {
                let c = header.fields[field_idx].column;
                cols.get(c)
                    .and_then(|s| s.parse::<f64>().ok())
                    .unwrap_or(0.0)
            };
            let x = col(idx.x);
            let y = col(idx.y);
            let z = col(idx.z);
            let intensity = idx.intensity.map(|i| col(i) as f32);
            let rgb = idx.rgb.map(|i| decode_packed_rgb(col(i)));
            records.push((x, y, z, intensity, rgb));
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    const ASCII_PCD: &str = "\
# .PCD v0.7 - Point Cloud Data file format
VERSION 0.7
FIELDS x y z intensity
SIZE 4 4 4 4
TYPE F F F F
COUNT 1 1 1 1
WIDTH 3
HEIGHT 1
VIEWPOINT 0 0 0 1 0 0 0
POINTS 3
DATA ascii
0.0 0.0 0.0 0.5
1.0 2.0 3.0 0.8
-1.0 -2.0 1.0 0.2
";

    #[test]
    fn test_parse_ascii_pcd_xyz_intensity() {
        let cloud = parse_pcd(ASCII_PCD.as_bytes()).unwrap();
        assert_eq!(cloud.len(), 3);
        assert!(cloud.has_intensity());
        assert!(!cloud.has_rgb());
        // First point is the origin → stored at local zero.
        assert_eq!(cloud.point(0), Some([0.0, 0.0, 0.0]));
        assert_eq!(cloud.point(1), Some([1.0, 2.0, 3.0]));
        assert_eq!(cloud.origin(), [0.0, 0.0, 0.0]);
        assert_eq!(cloud.intensity(2), Some(0.2));
    }

    #[test]
    fn test_parse_binary_pcd_xyz() {
        let header = "\
FIELDS x y z
SIZE 4 4 4
TYPE F F F
COUNT 1 1 1
WIDTH 2
HEIGHT 1
POINTS 2
DATA binary
";
        let mut bytes = header.as_bytes().to_vec();
        for p in [[0.0f32, 0.0, 0.0], [5.0, 6.0, 7.0]] {
            for v in p {
                bytes.extend_from_slice(&v.to_le_bytes());
            }
        }
        let cloud = parse_pcd(&bytes).unwrap();
        assert_eq!(cloud.len(), 2);
        assert_eq!(cloud.point(1), Some([5.0, 6.0, 7.0]));
    }

    #[test]
    fn test_missing_data_section_errors() {
        let bad = "FIELDS x y z\nSIZE 4 4 4\nTYPE F F F\n";
        assert!(parse_pcd(bad.as_bytes()).is_err());
    }

    #[test]
    fn test_missing_xyz_errors() {
        let bad = "FIELDS a b c\nSIZE 4 4 4\nTYPE F F F\nWIDTH 1\nHEIGHT 1\nPOINTS 1\nDATA ascii\n1 2 3\n";
        assert!(parse_pcd(bad.as_bytes()).is_err());
    }

    #[test]
    fn test_decode_packed_rgb() {
        // 0x00FF8040 packed into a float's bits.
        let packed = f32::from_bits(0x00FF_8040);
        assert_eq!(decode_packed_rgb(packed as f64), [0xff, 0x80, 0x40]);
    }
}
