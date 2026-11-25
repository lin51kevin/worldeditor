//! SOG (Spatially Ordered Gaussians) decoding into the packed Gaussian layout.
//!
//! A SOG dataset is a `meta.json` plus lossless WebP images in which pixel `i`
//! of every image describes Gaussian `i` (see the PlayCanvas SOG v3 spec). This
//! module decodes such a dataset straight into layout version 2
//! ([`PACKED_GAUSSIAN_LAYOUT_VERSION`]) so the renderer needs no SOG-specific
//! path. File fetching is the caller's job: pass the decoded images by name.
//!
//! Only SOG version 3 is supported. Opacity above 1 (merged Gaussians) is
//! clamped to 1, as the spec prescribes for renderers without an over-unity
//! profile, and SH bands above 3 are dropped.

use std::collections::HashMap;
use std::io::Cursor;

use serde::Deserialize;

use super::gaussian::{
    PACKED_GAUSSIAN_LAYOUT_VERSION, PackedGaussians, f32_to_f16_bits, normalize_quaternion,
    packed_gaussian_stride,
};
use super::model::Aabb;
use super::{PointCloudError, PointCloudResult};

/// Coefficients per colour channel stored in the SH palette for 1..=4 bands.
const SH_PALETTE_COEFFS: [usize; 4] = [3, 8, 15, 24];

/// Entries per palette row in `shN_centroids`.
const SH_PALETTE_ROW: usize = 64;

/// Opacity byte that encodes an opacity of exactly 1.
const OPACITY_ONE_BYTE: f32 = 204.0;

/// Highest SH degree the packed layout supports.
const MAX_SH_DEGREE: usize = 3;

/// `meta.json` of a SOG v3 dataset (fields this decoder needs).
#[derive(Debug, Clone, Deserialize)]
pub struct SogMeta {
    /// Format version; only 3 is supported.
    pub version: u32,
    /// Number of Gaussians (`<=` pixels per image).
    pub count: usize,
    /// Position ranges and image names.
    pub means: SogMeans,
    /// Log-scale codebook and image name.
    pub scales: SogCodebook,
    /// Rotation image name.
    pub quats: SogFiles,
    /// DC colour codebook and image name (alpha carries opacity).
    pub sh0: SogCodebook,
    /// Higher-order SH palette, when present.
    #[serde(rename = "shN")]
    pub sh_n: Option<SogShN>,
}

/// Position quantization ranges (log domain) and the two image names.
#[derive(Debug, Clone, Deserialize)]
pub struct SogMeans {
    /// Per-axis minimum of the log-transformed positions.
    pub mins: [f64; 3],
    /// Per-axis maximum of the log-transformed positions.
    pub maxs: [f64; 3],
    /// `[lower-8-bits image, upper-8-bits image]`.
    pub files: Vec<String>,
}

/// A 256-entry codebook plus its image name(s).
#[derive(Debug, Clone, Deserialize)]
pub struct SogCodebook {
    /// 256 codebook values.
    pub codebook: Vec<f32>,
    /// Image names (first entry is used).
    pub files: Vec<String>,
}

/// Image names only.
#[derive(Debug, Clone, Deserialize)]
pub struct SogFiles {
    /// Image names (first entry is used).
    pub files: Vec<String>,
}

/// Higher-order SH palette description.
#[derive(Debug, Clone, Deserialize)]
pub struct SogShN {
    /// Palette size.
    pub count: usize,
    /// Number of SH bands (1..=4) held in the palette.
    pub bands: usize,
    /// 256 shared coefficient values.
    pub codebook: Vec<f32>,
    /// `[centroids image, labels image]`.
    pub files: Vec<String>,
}

impl SogMeta {
    /// Parse and validate a `meta.json` document.
    pub fn parse(json: &str) -> PointCloudResult<Self> {
        let meta: SogMeta = serde_json::from_str(json)
            .map_err(|e| PointCloudError::InvalidHeader(format!("SOG meta.json: {e}")))?;
        if meta.version != 3 {
            return Err(PointCloudError::Unsupported(format!(
                "SOG version {} (only version 3 is supported)",
                meta.version
            )));
        }
        if meta.count == 0 {
            return Err(PointCloudError::InvalidData("SOG has no Gaussians".into()));
        }
        if meta.means.files.len() < 2 || meta.quats.files.is_empty() || meta.scales.files.is_empty()
        {
            return Err(PointCloudError::InvalidHeader(
                "SOG meta.json is missing image names".into(),
            ));
        }
        if meta.sh0.files.is_empty() {
            return Err(PointCloudError::InvalidHeader(
                "SOG meta.json is missing the sh0 image".into(),
            ));
        }
        if meta.scales.codebook.len() < 256 || meta.sh0.codebook.len() < 256 {
            return Err(PointCloudError::InvalidHeader(
                "SOG codebook must have 256 entries".into(),
            ));
        }
        if let Some(sh) = &meta.sh_n
            && (sh.files.len() < 2 || sh.codebook.len() < 256 || !(1..=4).contains(&sh.bands))
        {
            return Err(PointCloudError::InvalidHeader(
                "SOG shN block is malformed".into(),
            ));
        }
        Ok(meta)
    }

    /// Every image file name needed to decode this dataset.
    pub fn required_files(&self) -> Vec<String> {
        let mut files = vec![
            self.means.files[0].clone(),
            self.means.files[1].clone(),
            self.scales.files[0].clone(),
            self.quats.files[0].clone(),
            self.sh0.files[0].clone(),
        ];
        if let Some(sh) = &self.sh_n {
            files.push(sh.files[0].clone());
            files.push(sh.files[1].clone());
        }
        files
    }

    /// SH degree of the decoded output (`bands` clamped to the packed layout).
    pub fn sh_degree(&self) -> u32 {
        self.sh_n
            .as_ref()
            .map_or(0, |sh| sh.bands.min(MAX_SH_DEGREE) as u32)
    }
}

/// A decoded 8-bit RGBA image, row-major from the top-left.
#[derive(Debug, Clone, Default)]
pub struct SogImage {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// `width * height * 4` bytes.
    pub rgba: Vec<u8>,
}

/// Decode a lossless WebP into RGBA8 (RGB images get `A = 255`).
pub fn decode_webp_rgba(bytes: &[u8]) -> PointCloudResult<SogImage> {
    let invalid = |e: image_webp::DecodingError| {
        PointCloudError::InvalidData(format!("WebP decode failed: {e}"))
    };
    let mut decoder = image_webp::WebPDecoder::new(Cursor::new(bytes)).map_err(invalid)?;
    let (width, height) = decoder.dimensions();
    let size = decoder
        .output_buffer_size()
        .ok_or_else(|| PointCloudError::InvalidData("WebP image too large".into()))?;
    let mut buf = vec![0u8; size];
    decoder.read_image(&mut buf).map_err(invalid)?;
    let rgba = if decoder.has_alpha() {
        buf
    } else {
        let mut out = Vec::with_capacity(buf.len() / 3 * 4);
        for px in buf.chunks_exact(3) {
            out.extend_from_slice(&[px[0], px[1], px[2], 255]);
        }
        out
    };
    Ok(SogImage {
        width,
        height,
        rgba,
    })
}

/// Inverse of the symmetric log transform used for stored positions.
fn unlog(n: f64) -> f64 {
    n.signum() * (n.abs().exp() - 1.0)
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// Decode a rotation from the 24-bit exponential-map bytes (`w, x, y, z`).
fn decode_quat(r: u8, g: u8, b: u8) -> [f32; 4] {
    let px = (f32::from(r) - 128.0) / 127.0;
    let py = (f32::from(g) - 128.0) / 127.0;
    let pz = (f32::from(b) - 128.0) / 127.0;
    let len = (px * px + py * py + pz * pz).sqrt();
    let theta = std::f32::consts::FRAC_PI_2 * len;
    let k = if len > 0.0 { theta.sin() / len } else { 0.0 };
    normalize_quaternion([theta.cos(), px * k, py * k, pz * k])
}

/// Look up a required image and check it can hold `count` pixels.
fn image<'a>(
    images: &'a HashMap<String, SogImage>,
    name: &str,
    count: usize,
) -> PointCloudResult<&'a SogImage> {
    let img = images
        .get(name)
        .ok_or_else(|| PointCloudError::InvalidData(format!("missing SOG image {name}")))?;
    if img.rgba.len() < count * 4 || img.rgba.len() != img.width as usize * img.height as usize * 4
    {
        return Err(PointCloudError::InvalidData(format!(
            "SOG image {name} cannot hold {count} Gaussians"
        )));
    }
    Ok(img)
}

/// Decode a SOG dataset into packed layout version 2.
///
/// `origin` is subtracted from every position (as the PLY path does); when
/// `None` the first Gaussian's position is used. `images` maps each file name
/// from [`SogMeta::required_files`] to its decoded pixels.
pub fn decode_sog_packed(
    meta: &SogMeta,
    images: &HashMap<String, SogImage>,
    origin: Option<[f64; 3]>,
) -> PointCloudResult<PackedGaussians> {
    let count = meta.count;
    let means_l = image(images, &meta.means.files[0], count)?;
    let means_u = image(images, &meta.means.files[1], count)?;
    let scales = image(images, &meta.scales.files[0], count)?;
    let quats = image(images, &meta.quats.files[0], count)?;
    let sh0 = image(images, &meta.sh0.files[0], count)?;
    let sh_images = match &meta.sh_n {
        Some(sh) => Some((
            image(images, &sh.files[0], 1)?,
            image(images, &sh.files[1], count)?,
            sh,
        )),
        None => None,
    };

    let degree = meta.sh_degree();
    let stride = packed_gaussian_stride(degree);
    let coeff_count = (degree as usize + 1) * (degree as usize + 1) - 1;
    // Coefficients per channel kept from each palette entry (band-ordered prefix).
    let palette_coeffs = sh_images
        .as_ref()
        .map_or(0, |(_, _, sh)| SH_PALETTE_COEFFS[sh.bands - 1]);

    let mut buffer: Vec<u32> = Vec::with_capacity(count * stride);
    let mut halves: Vec<f32> = Vec::with_capacity(1 + (coeff_count + 1) * 3);
    let mut bounds = Aabb::empty();
    let mut origin = origin;

    for i in 0..count {
        let p = i * 4;
        let q = |lo: u8, hi: u8| (u32::from(hi) << 8) | u32::from(lo);
        let axis = |k: usize| {
            let t = f64::from(q(means_l.rgba[p + k], means_u.rgba[p + k])) / 65535.0;
            unlog(lerp(meta.means.mins[k], meta.means.maxs[k], t))
        };
        let world = [axis(0), axis(1), axis(2)];
        let origin = *origin.get_or_insert(world);
        let local = [
            (world[0] - origin[0]) as f32,
            (world[1] - origin[1]) as f32,
            (world[2] - origin[2]) as f32,
        ];
        bounds.expand([
            f64::from(local[0]),
            f64::from(local[1]),
            f64::from(local[2]),
        ]);
        buffer.extend(local.iter().map(|v| v.to_bits()));

        for k in 0..3 {
            let s = meta.scales.codebook[usize::from(scales.rgba[p + k])].exp();
            buffer.push(s.to_bits());
        }
        let rot = decode_quat(quats.rgba[p], quats.rgba[p + 1], quats.rgba[p + 2]);
        buffer.extend(rot.iter().map(|v| v.to_bits()));

        halves.clear();
        let opacity = (f32::from(sh0.rgba[p + 3]) / OPACITY_ONE_BYTE)
            .powi(2)
            .min(1.0);
        halves.push(opacity);
        for k in 0..3 {
            halves.push(meta.sh0.codebook[usize::from(sh0.rgba[p + k])]);
        }
        if let Some((centroids, labels, sh)) = &sh_images {
            let label = usize::from(labels.rgba[p])
                | (usize::from(labels.rgba[p + 1]) << 8)
                | (usize::from(labels.rgba[p + 2]) << 16);
            if label >= sh.count {
                return Err(PointCloudError::InvalidData(format!(
                    "SH label {label} out of range (palette has {})",
                    sh.count
                )));
            }
            let width = centroids.width as usize;
            let row = label / SH_PALETTE_ROW;
            for c in 0..coeff_count {
                let u = (label % SH_PALETTE_ROW) * palette_coeffs + c;
                if u >= width || row >= centroids.height as usize {
                    return Err(PointCloudError::InvalidData(
                        "SH palette image is too small".into(),
                    ));
                }
                let at = (row * width + u) * 4;
                for ch in 0..3 {
                    halves.push(sh.codebook[usize::from(centroids.rgba[at + ch])]);
                }
            }
        }

        for pair in halves.chunks(2) {
            let lo = u32::from(f32_to_f16_bits(pair[0]));
            let hi = pair.get(1).map_or(0, |v| u32::from(f32_to_f16_bits(*v)));
            buffer.push((hi << 16) | lo);
        }
    }

    Ok(PackedGaussians {
        buffer,
        count,
        source_count: count,
        sh_degree: degree,
        stride,
        layout_version: PACKED_GAUSSIAN_LAYOUT_VERSION,
        origin: origin.unwrap_or([0.0; 3]),
        bounds,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pointcloud::gaussian::parse_gaussian_ply_packed;
    use std::path::{Path, PathBuf};

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("sog")
            .join(name)
    }

    fn load_images(dir: &Path, meta: &SogMeta) -> HashMap<String, SogImage> {
        meta.required_files()
            .into_iter()
            .map(|name| {
                let bytes = std::fs::read(dir.join(&name)).unwrap();
                let img = decode_webp_rgba(&bytes).unwrap();
                (name, img)
            })
            .collect()
    }

    fn f16_to_f32(bits: u16) -> f32 {
        let sign = if bits & 0x8000 != 0 { -1.0 } else { 1.0 };
        let exp = i32::from((bits >> 10) & 0x1f);
        let frac = f32::from(bits & 0x3ff);
        match exp {
            0 => sign * frac * 2f32.powi(-24),
            31 => sign * f32::INFINITY,
            _ => sign * (1.0 + frac / 1024.0) * 2f32.powi(exp - 15),
        }
    }

    /// Decode the fixture and compare against the PLY that splat-transform wrote from it.
    fn assert_matches_roundtrip(name: &str, expected_degree: u32) {
        let dir = fixture(name);
        let meta =
            SogMeta::parse(&std::fs::read_to_string(dir.join("meta.json")).unwrap()).unwrap();
        let images = load_images(&dir, &meta);
        let ply = std::fs::read(dir.join("roundtrip.ply")).unwrap();
        let expected = parse_gaussian_ply_packed(&ply, None).unwrap();

        let got = decode_sog_packed(&meta, &images, Some(expected.origin)).unwrap();
        assert_eq!(got.count, expected.count);
        assert_eq!(got.sh_degree, expected_degree);
        assert_eq!(got.sh_degree, expected.sh_degree);
        assert_eq!(got.stride, expected.stride);
        assert_eq!(got.layout_version, PACKED_GAUSSIAN_LAYOUT_VERSION);
        assert_eq!(got.buffer.len(), expected.buffer.len());

        let stride = got.stride;
        for i in 0..got.count {
            let a = &got.buffer[i * stride..(i + 1) * stride];
            let b = &expected.buffer[i * stride..(i + 1) * stride];
            let f = |w: u32| f32::from_bits(w);
            for k in 0..3 {
                assert!((f(a[k]) - f(b[k])).abs() < 2e-3, "splat {i} position {k}");
            }
            for k in 3..6 {
                let (x, y) = (f(a[k]), f(b[k]));
                assert!(
                    (x - y).abs() <= 1e-4 * y.abs().max(1e-6),
                    "splat {i} scale {k}"
                );
            }
            let dot: f32 = (6..10).map(|k| f(a[k]) * f(b[k])).sum();
            assert!(dot.abs() > 1.0 - 1e-5, "splat {i} rotation dot {dot}");
            for k in 10..stride {
                for shift in [0u32, 16] {
                    let x = f16_to_f32(((a[k] >> shift) & 0xffff) as u16);
                    let y = f16_to_f32(((b[k] >> shift) & 0xffff) as u16);
                    assert!((x - y).abs() < 4e-3, "splat {i} half word {k}: {x} vs {y}");
                }
            }
        }
    }

    #[test]
    fn test_decode_sog_sh0_matches_splat_transform_roundtrip() {
        assert_matches_roundtrip("sh0", 0);
    }

    #[test]
    fn test_decode_sog_sh1_matches_splat_transform_roundtrip() {
        assert_matches_roundtrip("sh1", 1);
    }

    #[test]
    fn test_decode_sog_default_origin_is_first_splat() {
        let dir = fixture("sh0");
        let meta =
            SogMeta::parse(&std::fs::read_to_string(dir.join("meta.json")).unwrap()).unwrap();
        let images = load_images(&dir, &meta);
        let got = decode_sog_packed(&meta, &images, None).unwrap();
        assert_eq!(f32::from_bits(got.buffer[0]), 0.0);
        assert_eq!(f32::from_bits(got.buffer[1]), 0.0);
        assert_eq!(f32::from_bits(got.buffer[2]), 0.0);
    }

    #[test]
    fn test_decode_sog_origin_shift_is_consistent() {
        let dir = fixture("sh0");
        let meta =
            SogMeta::parse(&std::fs::read_to_string(dir.join("meta.json")).unwrap()).unwrap();
        let images = load_images(&dir, &meta);
        let a = decode_sog_packed(&meta, &images, Some([0.0; 3])).unwrap();
        let b = decode_sog_packed(&meta, &images, Some([10.0, -20.0, 5.0])).unwrap();
        let (ax, bx) = (f32::from_bits(a.buffer[0]), f32::from_bits(b.buffer[0]));
        assert!((ax - bx - 10.0).abs() < 1e-3);
        assert_eq!(b.origin, [10.0, -20.0, 5.0]);
    }

    #[test]
    fn test_parse_meta_rejects_unsupported_version() {
        let dir = fixture("sh0");
        let json = std::fs::read_to_string(dir.join("meta.json"))
            .unwrap()
            .replacen("\"version\":3", "\"version\":2", 1);
        let err = SogMeta::parse(&json).unwrap_err();
        assert!(matches!(err, PointCloudError::Unsupported(_)));
    }

    #[test]
    fn test_decode_sog_reports_missing_image() {
        let dir = fixture("sh0");
        let meta =
            SogMeta::parse(&std::fs::read_to_string(dir.join("meta.json")).unwrap()).unwrap();
        let err = decode_sog_packed(&meta, &HashMap::new(), None).unwrap_err();
        assert!(matches!(err, PointCloudError::InvalidData(_)));
    }

    #[test]
    fn test_required_files_lists_sh_palette_images() {
        let dir = fixture("sh1");
        let meta =
            SogMeta::parse(&std::fs::read_to_string(dir.join("meta.json")).unwrap()).unwrap();
        let files = meta.required_files();
        assert!(files.contains(&"shN_centroids.webp".to_string()));
        assert!(files.contains(&"shN_labels.webp".to_string()));
        assert_eq!(meta.sh_degree(), 1);
    }

    #[test]
    fn test_decode_webp_rejects_garbage() {
        assert!(decode_webp_rgba(b"not a webp").is_err());
    }
}
