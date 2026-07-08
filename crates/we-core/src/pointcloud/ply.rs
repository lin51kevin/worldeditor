//! PLY (Polygon File Format) point cloud parser.
//!
//! Supports `ascii` and `binary_little_endian` formats. Only the `vertex`
//! element is read; face data is ignored. Recognized vertex properties:
//! `x`, `y`, `z`, `intensity`, and `red`/`green`/`blue` (uchar 0..=255).
//!
//! 3D Gaussian Splatting clouds store no `red`/`green`/`blue`; their base colour
//! lives in the band-0 spherical-harmonic coefficients `f_dc_0/1/2`. When those
//! are present (and RGB is not) they are decoded to RGB via `SH2RGB(c) = C0*c +
//! 0.5`, so splat clouds render in their real albedo instead of falling back to
//! the elevation ramp.

use super::model::PointCloud;
use super::{PointCloudError, PointCloudResult, RawRecord};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PlyScalar {
    Char,
    Uchar,
    Short,
    Ushort,
    Int,
    Uint,
    Float,
    Double,
}

impl PlyScalar {
    fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "char" | "int8" => Self::Char,
            "uchar" | "uint8" => Self::Uchar,
            "short" | "int16" => Self::Short,
            "ushort" | "uint16" => Self::Ushort,
            "int" | "int32" => Self::Int,
            "uint" | "uint32" => Self::Uint,
            "float" | "float32" => Self::Float,
            "double" | "float64" => Self::Double,
            _ => return None,
        })
    }

    pub(super) fn size(self) -> usize {
        match self {
            Self::Char | Self::Uchar => 1,
            Self::Short | Self::Ushort => 2,
            Self::Int | Self::Uint | Self::Float => 4,
            Self::Double => 8,
        }
    }
}

#[derive(Debug, Clone)]
pub(super) struct Property {
    pub(super) name: String,
    pub(super) ty: PlyScalar,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Format {
    Ascii,
    BinaryLe,
}

/// A parsed PLY header plus the byte offset where the vertex data begins.
pub(super) struct PlyHeader {
    pub(super) format: Format,
    pub(super) vertex_count: usize,
    pub(super) props: Vec<Property>,
    /// Byte offset into the original buffer where the first vertex record starts.
    pub(super) data_offset: usize,
}

impl PlyHeader {
    /// Byte stride of one vertex record (sum of all property sizes).
    pub(super) fn stride(&self) -> usize {
        self.props.iter().map(|p| p.ty.size()).sum()
    }

    /// Byte offset of each property within a record (parallel to `props`).
    pub(super) fn prop_offsets(&self) -> Vec<usize> {
        let mut offsets = Vec::with_capacity(self.props.len());
        let mut acc = 0usize;
        for p in &self.props {
            offsets.push(acc);
            acc += p.ty.size();
        }
        offsets
    }

    /// Index of the first property whose name matches `name` (case-insensitive).
    pub(super) fn find(&self, name: &str) -> Option<usize> {
        self.props.iter().position(|p| p.name.eq_ignore_ascii_case(name))
    }

    /// The PLY body format (ASCII or binary little-endian).
    pub(super) fn format(&self) -> Format {
        self.format
    }

    /// Declared number of `vertex` records.
    pub(super) fn vertex_count(&self) -> usize {
        self.vertex_count
    }

    /// Byte offset where the vertex data begins.
    pub(super) fn data_offset(&self) -> usize {
        self.data_offset
    }

    /// Number of vertex properties.
    pub(super) fn props_len(&self) -> usize {
        self.props.len()
    }

    /// Scalar type of property `i`.
    pub(super) fn prop_ty(&self, i: usize) -> PlyScalar {
        self.props[i].ty
    }

    /// Iterator over property names in declaration order.
    pub(super) fn props_iter(&self) -> impl Iterator<Item = &str> {
        self.props.iter().map(|p| p.name.as_str())
    }
}

/// Parse the ASCII PLY header (up to and including `end_header`).
pub(super) fn parse_ply_header(bytes: &[u8]) -> PointCloudResult<PlyHeader> {
    let mut cursor = 0usize;
    let mut line_no = 0usize;
    let mut format: Option<Format> = None;
    let mut vertex_count = 0usize;
    let mut props: Vec<Property> = Vec::new();
    let mut current_element_is_vertex = false;

    loop {
        let start = cursor;
        while cursor < bytes.len() && bytes[cursor] != b'\n' {
            cursor += 1;
        }
        if cursor >= bytes.len() && start == cursor {
            return Err(PointCloudError::InvalidHeader("missing end_header".into()));
        }
        let mut end = cursor;
        if end > start && bytes[end - 1] == b'\r' {
            end -= 1;
        }
        let line = std::str::from_utf8(&bytes[start..end])
            .map_err(|_| PointCloudError::InvalidHeader("non-UTF8 PLY header".into()))?
            .trim();
        cursor += 1;
        line_no += 1;

        if line_no == 1 && line != "ply" {
            return Err(PointCloudError::InvalidHeader("missing 'ply' magic".into()));
        }

        let mut parts = line.split_whitespace();
        match parts.next() {
            Some("format") => {
                format = match parts.next() {
                    Some("ascii") => Some(Format::Ascii),
                    Some("binary_little_endian") => Some(Format::BinaryLe),
                    Some("binary_big_endian") => {
                        return Err(PointCloudError::Unsupported("PLY big endian".into()));
                    }
                    _ => return Err(PointCloudError::InvalidHeader("format".into())),
                };
            }
            Some("element") => {
                let name = parts.next().unwrap_or("");
                let count = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
                current_element_is_vertex = name == "vertex";
                if current_element_is_vertex {
                    vertex_count = count;
                }
            }
            Some("property") => {
                if current_element_is_vertex {
                    let tokens: Vec<&str> = parts.collect();
                    if tokens.first() == Some(&"list") {
                        // list property on vertex — unsupported, skip.
                        continue;
                    }
                    if let (Some(ty), Some(name)) = (tokens.first(), tokens.get(1))
                        && let Some(scalar) = PlyScalar::from_str(ty)
                    {
                        props.push(Property {
                            name: (*name).to_string(),
                            ty: scalar,
                        });
                    }
                }
            }
            Some("end_header") => break,
            _ => {}
        }

        if cursor >= bytes.len() {
            return Err(PointCloudError::InvalidHeader("missing end_header".into()));
        }
    }

    let format = format.ok_or_else(|| PointCloudError::InvalidHeader("missing format".into()))?;
    Ok(PlyHeader {
        format,
        vertex_count,
        props,
        data_offset: cursor,
    })
}

/// Parse a PLY point cloud from raw bytes.
pub fn parse_ply(bytes: &[u8]) -> PointCloudResult<PointCloud> {
    let header = parse_ply_header(bytes)?;
    let PlyHeader {
        format,
        vertex_count,
        props,
        data_offset,
    } = &header;
    let (format, vertex_count) = (*format, *vertex_count);
    let cursor = *data_offset;

    let ix = header
        .find("x")
        .ok_or_else(|| PointCloudError::InvalidHeader("missing x".into()))?;
    let iy = header
        .find("y")
        .ok_or_else(|| PointCloudError::InvalidHeader("missing y".into()))?;
    let iz = header
        .find("z")
        .ok_or_else(|| PointCloudError::InvalidHeader("missing z".into()))?;
    let ii = header.find("intensity");
    let ir = header.find("red").or_else(|| header.find("r"));
    let ig = header.find("green").or_else(|| header.find("g"));
    let ib = header.find("blue").or_else(|| header.find("b"));
    let has_rgb = ir.is_some() && ig.is_some() && ib.is_some();
    // 3D Gaussian Splatting: band-0 spherical-harmonic colour (view-independent).
    let idc0 = header.find("f_dc_0");
    let idc1 = header.find("f_dc_1");
    let idc2 = header.find("f_dc_2");
    let has_sh = !has_rgb && idc0.is_some() && idc1.is_some() && idc2.is_some();

    let mut records: Vec<RawRecord> = Vec::with_capacity(vertex_count);

    match format {
        Format::Ascii => {
            let text = std::str::from_utf8(&bytes[cursor..])
                .map_err(|_| PointCloudError::InvalidData("non-UTF8 PLY body".into()))?;
            for line in text.lines() {
                if records.len() >= vertex_count {
                    break;
                }
                let cols: Vec<&str> = line.split_whitespace().collect();
                if cols.len() < props.len() {
                    continue;
                }
                let num = |i: usize| cols[i].parse::<f64>().unwrap_or(0.0);
                let x = num(ix);
                let y = num(iy);
                let z = num(iz);
                let intensity = ii.map(|i| num(i) as f32);
                let rgb = if has_rgb {
                    Some([
                        num(ir.unwrap()).clamp(0.0, 255.0) as u8,
                        num(ig.unwrap()).clamp(0.0, 255.0) as u8,
                        num(ib.unwrap()).clamp(0.0, 255.0) as u8,
                    ])
                } else if has_sh {
                    Some([
                        sh_dc_to_u8(num(idc0.unwrap())),
                        sh_dc_to_u8(num(idc1.unwrap())),
                        sh_dc_to_u8(num(idc2.unwrap())),
                    ])
                } else {
                    None
                };
                records.push((x, y, z, intensity, rgb));
            }
        }
        Format::BinaryLe => {
            let stride = header.stride();
            let offsets = header.prop_offsets();
            let data = &bytes[cursor..];
            if stride == 0 {
                return Err(PointCloudError::InvalidHeader("zero PLY stride".into()));
            }
            let available = data.len() / stride;
            let n = vertex_count.min(available);
            let read =
                |rec: &[u8], i: usize| -> f64 { read_scalar(&rec[offsets[i]..], props[i].ty) };
            for r in 0..n {
                let rec = &data[r * stride..(r + 1) * stride];
                let x = read(rec, ix);
                let y = read(rec, iy);
                let z = read(rec, iz);
                let intensity = ii.map(|i| read(rec, i) as f32);
                let rgb = if has_rgb {
                    Some([
                        read(rec, ir.unwrap()).clamp(0.0, 255.0) as u8,
                        read(rec, ig.unwrap()).clamp(0.0, 255.0) as u8,
                        read(rec, ib.unwrap()).clamp(0.0, 255.0) as u8,
                    ])
                } else if has_sh {
                    Some([
                        sh_dc_to_u8(read(rec, idc0.unwrap())),
                        sh_dc_to_u8(read(rec, idc1.unwrap())),
                        sh_dc_to_u8(read(rec, idc2.unwrap())),
                    ])
                } else {
                    None
                };
                records.push((x, y, z, intensity, rgb));
            }
        }
    }

    if records.is_empty() {
        return Err(PointCloudError::InvalidData("no PLY vertices".into()));
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

/// Decode a band-0 spherical-harmonic coefficient to an 8-bit colour channel.
///
/// 3D Gaussian Splatting stores view-independent colour as SH band-0
/// coefficients; the reference decode is `rgb = C0 * c + 0.5` (clamped), where
/// `C0 = 1 / (2*sqrt(pi))` is the band-0 basis constant.
fn sh_dc_to_u8(c: f64) -> u8 {
    const SH_C0: f64 = 0.282_094_791_773_878_14;
    ((0.5 + SH_C0 * c).clamp(0.0, 1.0) * 255.0).round() as u8
}

pub(super) fn read_scalar(s: &[u8], ty: PlyScalar) -> f64 {
    match ty {
        PlyScalar::Char => (s[0] as i8) as f64,
        PlyScalar::Uchar => s[0] as f64,
        PlyScalar::Short => i16::from_le_bytes([s[0], s[1]]) as f64,
        PlyScalar::Ushort => u16::from_le_bytes([s[0], s[1]]) as f64,
        PlyScalar::Int => i32::from_le_bytes([s[0], s[1], s[2], s[3]]) as f64,
        PlyScalar::Uint => u32::from_le_bytes([s[0], s[1], s[2], s[3]]) as f64,
        PlyScalar::Float => f32::from_le_bytes([s[0], s[1], s[2], s[3]]) as f64,
        PlyScalar::Double => f64::from_le_bytes([s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ascii_ply_xyz_rgb() {
        let body = "\
ply
format ascii 1.0
element vertex 2
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
end_header
0 0 0 255 0 0
1 2 3 0 255 0
";
        let cloud = parse_ply(body.as_bytes()).unwrap();
        assert_eq!(cloud.len(), 2);
        assert!(cloud.has_rgb());
        assert_eq!(cloud.point(1), Some([1.0, 2.0, 3.0]));
        assert_eq!(cloud.color(0), Some([255, 0, 0]));
    }

    #[test]
    fn test_parse_ascii_ply_gaussian_splat_sh_color() {
        // A 3DGS cloud carries colour in f_dc_* (SH band-0), not red/green/blue.
        // f_dc = 0 → mid-grey (0.5 → 128); a large positive/negative coefficient
        // saturates to white/black via `C0 * c + 0.5`.
        let body = "\
ply
format ascii 1.0
element vertex 2
property float x
property float y
property float z
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
end_header
0 0 0 0 0 0 1
1 2 3 10 -10 0 1
";
        let cloud = parse_ply(body.as_bytes()).unwrap();
        assert_eq!(cloud.len(), 2);
        assert!(cloud.has_rgb(), "f_dc SH coefficients should decode to RGB");
        // f_dc = 0 → 0.5 → round(127.5) = 128 on every channel.
        assert_eq!(cloud.color(0), Some([128, 128, 128]));
        // Large +/- coefficients saturate to white/black; blue stays mid-grey.
        assert_eq!(cloud.color(1), Some([255, 0, 128]));
    }

    #[test]
    fn test_parse_binary_le_ply() {
        let header = "\
ply
format binary_little_endian 1.0
element vertex 2
property float x
property float y
property float z
property float intensity
end_header
";
        let mut bytes = header.as_bytes().to_vec();
        for (p, i) in [([0.0f32, 0.0, 0.0], 0.5f32), ([4.0, 5.0, 6.0], 0.9)] {
            for v in p {
                bytes.extend_from_slice(&v.to_le_bytes());
            }
            bytes.extend_from_slice(&i.to_le_bytes());
        }
        let cloud = parse_ply(&bytes).unwrap();
        assert_eq!(cloud.len(), 2);
        assert!(cloud.has_intensity());
        assert_eq!(cloud.point(1), Some([4.0, 5.0, 6.0]));
        assert_eq!(cloud.intensity(1), Some(0.9));
    }

    #[test]
    fn test_missing_magic_errors() {
        assert!(parse_ply(b"not a ply\n").is_err());
    }
}
