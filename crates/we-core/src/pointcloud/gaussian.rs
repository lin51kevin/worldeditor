//! 3D Gaussian Splatting (3DGS) cloud model and PLY parsing.
//!
//! A [`GaussianCloud`] stores the full per-splat attributes required for true
//! anisotropic Gaussian rendering: position, spherical-harmonic colour
//! coefficients (any degree), opacity, and a pre-computed 3D covariance derived
//! from the per-splat scale and rotation.
//!
//! Activation follows the reference 3DGS convention (Kerbl et al. 2023):
//! - `opacity = sigmoid(raw)`
//! - `scale   = exp(raw)`
//! - `rotation = normalize(quaternion)` with component order `(w, x, y, z)`
//!
//! The 3D covariance is `Σ = R S Sᵀ Rᵀ` with `S = diag(scale)` and `R` the
//! rotation matrix of the normalized quaternion. Only the 6 unique entries of
//! the symmetric matrix are stored: `[σxx, σxy, σxz, σyy, σyz, σzz]`.

use super::model::Aabb;
use super::ply::{Format, PlyHeader, parse_ply_header, read_scalar};
use super::{PointCloudError, PointCloudResult};

/// Band-0 spherical-harmonic basis constant `C0 = 1 / (2*sqrt(pi))`.
pub const SH_C0: f32 = 0.282_094_79;

/// A 3D Gaussian Splatting cloud.
///
/// Positions are stored as `f32` relative to [`GaussianCloud::origin`] so that
/// large global coordinates keep precision after the origin shift.
#[derive(Debug, Clone, Default)]
pub struct GaussianCloud {
    /// Flattened local positions, 3 values per splat (`x, y, z`).
    positions: Vec<f32>,
    /// Spherical-harmonic colour coefficients, coeff-major and RGB-interleaved:
    /// `sh[splat*num_coeffs*3 + coeff*3 + channel]`.
    sh_coeffs: Vec<f32>,
    /// SH degree (0..=3). Number of coeffs per channel is `(degree+1)²`.
    sh_degree: u32,
    /// Activated opacity (sigmoid), one value per splat.
    opacity: Vec<f32>,
    /// Pre-computed 3D covariance, 6 unique entries per splat
    /// `[σxx, σxy, σxz, σyy, σyz, σzz]`.
    cov3d: Vec<f32>,
    /// Global origin subtracted from every stored position.
    origin: [f64; 3],
    /// Cached axis-aligned bounds in local coordinates.
    bounds: Aabb,
}

impl GaussianCloud {
    /// Number of splats.
    pub fn len(&self) -> usize {
        self.positions.len() / 3
    }

    /// Whether the cloud has no splats.
    pub fn is_empty(&self) -> bool {
        self.positions.is_empty()
    }

    /// SH degree (0..=3).
    pub fn sh_degree(&self) -> u32 {
        self.sh_degree
    }

    /// Number of SH coefficients per colour channel: `(degree+1)²`.
    pub fn coeffs_per_channel(&self) -> usize {
        let d = self.sh_degree as usize + 1;
        d * d
    }

    /// Global origin subtracted from stored positions.
    pub fn origin(&self) -> [f64; 3] {
        self.origin
    }

    /// Axis-aligned bounds in local coordinates.
    pub fn bounds(&self) -> Aabb {
        self.bounds
    }

    /// Flattened local positions, 3 per splat.
    pub fn positions(&self) -> &[f32] {
        &self.positions
    }

    /// Activated opacity per splat.
    pub fn opacity(&self) -> &[f32] {
        &self.opacity
    }

    /// Pre-computed covariance, 6 per splat.
    pub fn cov3d(&self) -> &[f32] {
        &self.cov3d
    }

    /// Raw SH coefficients (coeff-major, RGB-interleaved).
    pub fn sh_coeffs(&self) -> &[f32] {
        &self.sh_coeffs
    }

    /// Band-0 (view-independent) RGB colour of splat `i`, decoded via
    /// `rgb = C0 * f_dc + 0.5` and clamped to `>= 0`.
    pub fn color_band0(&self, i: usize) -> Option<[f32; 3]> {
        let stride = self.coeffs_per_channel() * 3;
        let base = i * stride;
        if base + 3 > self.sh_coeffs.len() {
            return None;
        }
        Some([
            (SH_C0 * self.sh_coeffs[base] + 0.5).max(0.0),
            (SH_C0 * self.sh_coeffs[base + 1] + 0.5).max(0.0),
            (SH_C0 * self.sh_coeffs[base + 2] + 0.5).max(0.0),
        ])
    }

    /// Build the compact GPU instance buffer for milestone-1 (band-0) rendering.
    ///
    /// Layout is 13 `f32` per splat:
    /// `[x, y, z, σxx, σxy, σxz, σyy, σyz, σzz, r, g, b, opacity]`.
    /// Colour is the view-independent band-0 SH albedo.
    pub fn build_splat_buffer(&self) -> Vec<f32> {
        let n = self.len();
        let mut out = Vec::with_capacity(n * SPLAT_BUFFER_STRIDE);
        for i in 0..n {
            out.push(self.positions[i * 3]);
            out.push(self.positions[i * 3 + 1]);
            out.push(self.positions[i * 3 + 2]);
            for k in 0..6 {
                out.push(self.cov3d[i * 6 + k]);
            }
            let c = self.color_band0(i).unwrap_or([0.5, 0.5, 0.5]);
            out.push(c[0]);
            out.push(c[1]);
            out.push(c[2]);
            out.push(self.opacity[i]);
        }
        out
    }

    /// Stride (floats per splat) of the view-dependent SH instance buffer:
    /// `pos(3) + cov(6) + opacity(1) + shCoeffs((degree+1)²·3)`.
    pub fn sh_buffer_stride(&self) -> usize {
        10 + self.coeffs_per_channel() * 3
    }

    /// Build the view-dependent GPU instance buffer that keeps the *raw* SH
    /// coefficients so the shader can evaluate view-dependent colour.
    ///
    /// Layout is [`sh_buffer_stride`] `f32` per splat:
    /// `[x, y, z, σxx, σxy, σxz, σyy, σyz, σzz, opacity, sh0_r, sh0_g, sh0_b, sh1_r, …]`
    /// where the SH block is coeff-major, RGB-interleaved (same order as
    /// [`sh_coeffs`](Self::sh_coeffs)).
    pub fn build_splat_buffer_sh(&self) -> Vec<f32> {
        let n = self.len();
        let sh_per_splat = self.coeffs_per_channel() * 3;
        let stride = 10 + sh_per_splat;
        let mut out = Vec::with_capacity(n * stride);
        for i in 0..n {
            out.push(self.positions[i * 3]);
            out.push(self.positions[i * 3 + 1]);
            out.push(self.positions[i * 3 + 2]);
            for k in 0..6 {
                out.push(self.cov3d[i * 6 + k]);
            }
            out.push(self.opacity[i]);
            let base = i * sh_per_splat;
            out.extend_from_slice(&self.sh_coeffs[base..base + sh_per_splat]);
        }
        out
    }
}

/// Number of `f32` per splat in the compact GPU instance buffer.
pub const SPLAT_BUFFER_STRIDE: usize = 13;

/// Sigmoid activation `1 / (1 + e^-x)`.
pub fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}

/// Convert a quaternion `(w, x, y, z)` to a 3×3 rotation matrix (row-major).
///
/// The quaternion is normalized first; a zero quaternion yields the identity.
pub fn quat_to_rotmat(q: [f32; 4]) -> [[f32; 3]; 3] {
    let n = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    let (w, x, y, z) = if n > 0.0 {
        (q[0] / n, q[1] / n, q[2] / n, q[3] / n)
    } else {
        (1.0, 0.0, 0.0, 0.0)
    };
    [
        [
            1.0 - 2.0 * (y * y + z * z),
            2.0 * (x * y - w * z),
            2.0 * (x * z + w * y),
        ],
        [
            2.0 * (x * y + w * z),
            1.0 - 2.0 * (x * x + z * z),
            2.0 * (y * z - w * x),
        ],
        [
            2.0 * (x * z - w * y),
            2.0 * (y * z + w * x),
            1.0 - 2.0 * (x * x + y * y),
        ],
    ]
}

/// Compute the 6 unique entries of the 3D covariance `Σ = R S Sᵀ Rᵀ`.
///
/// `scale` is the already-activated (post-`exp`) scale; `rot` is the raw
/// quaternion `(w, x, y, z)` (normalized internally). Returns
/// `[σxx, σxy, σxz, σyy, σyz, σzz]`.
pub fn compute_cov3d(scale: [f32; 3], rot: [f32; 4]) -> [f32; 6] {
    let r = quat_to_rotmat(rot);
    let s2 = [scale[0] * scale[0], scale[1] * scale[1], scale[2] * scale[2]];
    // Σ[i][k] = Σ_j R[i][j] R[k][j] s_j²
    let sigma = |i: usize, k: usize| -> f32 {
        (0..3).map(|j| r[i][j] * r[k][j] * s2[j]).sum()
    };
    [
        sigma(0, 0),
        sigma(0, 1),
        sigma(0, 2),
        sigma(1, 1),
        sigma(1, 2),
        sigma(2, 2),
    ]
}

/// Infer the SH degree from the total number of `f_rest_*` properties.
///
/// Per channel there are `(degree+1)²` coefficients: 1 band-0 (`f_dc`) plus
/// `((degree+1)² - 1)` rest coefficients. With 3 channels the rest count is
/// `3 * ((degree+1)² - 1)`. Returns `None` if `n_rest` does not correspond to a
/// valid degree in `0..=3`.
pub fn infer_sh_degree(n_rest: usize) -> Option<u32> {
    if !n_rest.is_multiple_of(3) {
        return None;
    }
    let per_channel_total = n_rest / 3 + 1; // (degree+1)²
    for degree in 0u32..=3 {
        let d = (degree + 1) as usize;
        if d * d == per_channel_total {
            return Some(degree);
        }
    }
    None
}

/// Parse a 3D Gaussian Splatting PLY from raw bytes.
///
/// Recognises the standard 3DGS vertex properties: `x/y/z`, `f_dc_0..2`,
/// `f_rest_*` (channel-major), `opacity`, `scale_0..2`, `rot_0..3`. Returns
/// [`PointCloudError::Unsupported`] if the required splat properties are absent.
pub fn parse_gaussian_ply(bytes: &[u8]) -> PointCloudResult<GaussianCloud> {
    parse_gaussian_ply_capped(bytes, None)
}

/// Parse a 3D Gaussian Splatting PLY, keeping at most `max_splats` splats.
///
/// When `max_splats` is `Some(budget)` smaller than the file's splat count, the
/// splats are uniformly stride-sampled during parsing so both the intermediate
/// [`GaussianCloud`] and the derived GPU buffer stay bounded — this is what
/// keeps very large clouds from exhausting the wasm32 heap on load. `None`
/// keeps every splat. See [`parse_gaussian_ply`] for the property contract.
pub fn parse_gaussian_ply_capped(
    bytes: &[u8],
    max_splats: Option<usize>,
) -> PointCloudResult<GaussianCloud> {
    let header = parse_ply_header(bytes)?;

    let ix = header
        .find("x")
        .ok_or_else(|| PointCloudError::InvalidHeader("missing x".into()))?;
    let iy = header
        .find("y")
        .ok_or_else(|| PointCloudError::InvalidHeader("missing y".into()))?;
    let iz = header
        .find("z")
        .ok_or_else(|| PointCloudError::InvalidHeader("missing z".into()))?;

    let dc = [
        header.find("f_dc_0"),
        header.find("f_dc_1"),
        header.find("f_dc_2"),
    ];
    let scale = [
        header.find("scale_0"),
        header.find("scale_1"),
        header.find("scale_2"),
    ];
    let rot = [
        header.find("rot_0"),
        header.find("rot_1"),
        header.find("rot_2"),
        header.find("rot_3"),
    ];
    let iopacity = header.find("opacity");

    let has_all = dc.iter().all(Option::is_some)
        && scale.iter().all(Option::is_some)
        && rot.iter().all(Option::is_some)
        && iopacity.is_some();
    if !has_all {
        return Err(PointCloudError::Unsupported(
            "PLY is not a 3D Gaussian Splatting cloud (missing f_dc/scale/rot/opacity)".into(),
        ));
    }
    let dc = [dc[0].unwrap(), dc[1].unwrap(), dc[2].unwrap()];
    let scale = [scale[0].unwrap(), scale[1].unwrap(), scale[2].unwrap()];
    let rot = [
        rot[0].unwrap(),
        rot[1].unwrap(),
        rot[2].unwrap(),
        rot[3].unwrap(),
    ];
    let iopacity = iopacity.unwrap();

    // Collect f_rest_* properties, ordered by their trailing index.
    let mut rest: Vec<(usize, usize)> = header
        .props_iter()
        .enumerate()
        .filter_map(|(idx, name)| {
            name.strip_prefix("f_rest_")
                .and_then(|k| k.parse::<usize>().ok())
                .map(|k| (k, idx))
        })
        .collect();
    rest.sort_by_key(|(k, _)| *k);
    let rest_indices: Vec<usize> = rest.iter().map(|(_, idx)| *idx).collect();
    let n_rest = rest_indices.len();
    let sh_degree = infer_sh_degree(n_rest).ok_or_else(|| {
        PointCloudError::Unsupported(format!("unsupported SH: {n_rest} f_rest properties"))
    })?;
    let rest_per_channel = n_rest / 3;
    let num_coeffs = rest_per_channel + 1; // (degree+1)²

    let count = header.vertex_count();
    let mut cloud = GaussianCloud {
        sh_degree,
        ..Default::default()
    };

    // `getter(record_index, prop_index) -> f64`
    let read_record = RecordReader::new(bytes, &header)?;
    let n = read_record.count().min(count);
    if n == 0 {
        return Err(PointCloudError::InvalidData("no PLY vertices".into()));
    }

    // Uniform stride sampling to honour the splat budget (LOD for large clouds).
    let step = match max_splats {
        Some(budget) if budget > 0 && budget < n => n.div_ceil(budget),
        _ => 1,
    };
    let kept = n.div_ceil(step);
    cloud.positions.reserve(kept * 3);
    cloud.sh_coeffs.reserve(kept * num_coeffs * 3);
    cloud.opacity.reserve(kept);
    cloud.cov3d.reserve(kept * 6);

    let mut origin = [0.0f64; 3];
    let mut bounds = Aabb::empty();
    let mut r = 0usize;
    let mut first = true;
    while r < n {
        let get = |p: usize| read_record.value(r, p);
        let wx = get(ix);
        let wy = get(iy);
        let wz = get(iz);
        if first {
            origin = [wx, wy, wz];
            first = false;
        }
        let lx = (wx - origin[0]) as f32;
        let ly = (wy - origin[1]) as f32;
        let lz = (wz - origin[2]) as f32;
        bounds.expand([lx as f64, ly as f64, lz as f64]);
        cloud.positions.extend_from_slice(&[lx, ly, lz]);

        // SH coeffs: coeff-major, RGB-interleaved.
        #[allow(clippy::needless_range_loop)]
        for coeff in 0..num_coeffs {
            for ch in 0..3 {
                let v = if coeff == 0 {
                    get(dc[ch]) as f32
                } else {
                    let idx = ch * rest_per_channel + (coeff - 1);
                    get(rest_indices[idx]) as f32
                };
                cloud.sh_coeffs.push(v);
            }
        }

        cloud.opacity.push(sigmoid(get(iopacity) as f32));

        let s = [
            (get(scale[0]) as f32).exp(),
            (get(scale[1]) as f32).exp(),
            (get(scale[2]) as f32).exp(),
        ];
        let q = [
            get(rot[0]) as f32,
            get(rot[1]) as f32,
            get(rot[2]) as f32,
            get(rot[3]) as f32,
        ];
        cloud.cov3d.extend_from_slice(&compute_cov3d(s, q));

        r += step;
    }

    cloud.origin = origin;
    cloud.bounds = bounds;
    Ok(cloud)
}

/// Reads scalar property values from a parsed PLY body (ASCII or binary).
enum RecordReader<'a> {
    Ascii {
        rows: Vec<Vec<f64>>,
    },
    Binary {
        header: &'a PlyHeader,
        data: &'a [u8],
        stride: usize,
        offsets: Vec<usize>,
        count: usize,
    },
}

impl<'a> RecordReader<'a> {
    fn new(bytes: &'a [u8], header: &'a PlyHeader) -> PointCloudResult<Self> {
        match header.format() {
            Format::Ascii => {
                let text = std::str::from_utf8(&bytes[header.data_offset()..])
                    .map_err(|_| PointCloudError::InvalidData("non-UTF8 PLY body".into()))?;
                let n_props = header.props_len();
                let mut rows = Vec::new();
                for line in text.lines() {
                    let cols: Vec<&str> = line.split_whitespace().collect();
                    if cols.len() < n_props {
                        continue;
                    }
                    rows.push(
                        cols.iter()
                            .take(n_props)
                            .map(|c| c.parse::<f64>().unwrap_or(0.0))
                            .collect(),
                    );
                }
                Ok(RecordReader::Ascii { rows })
            }
            Format::BinaryLe => {
                let stride = header.stride();
                if stride == 0 {
                    return Err(PointCloudError::InvalidHeader("zero PLY stride".into()));
                }
                let data = &bytes[header.data_offset()..];
                let count = data.len() / stride;
                Ok(RecordReader::Binary {
                    header,
                    data,
                    stride,
                    offsets: header.prop_offsets(),
                    count,
                })
            }
        }
    }

    fn count(&self) -> usize {
        match self {
            RecordReader::Ascii { rows, .. } => rows.len(),
            RecordReader::Binary { count, .. } => *count,
        }
    }

    fn value(&self, record: usize, prop: usize) -> f64 {
        match self {
            RecordReader::Ascii { rows, .. } => rows[record].get(prop).copied().unwrap_or(0.0),
            RecordReader::Binary {
                header,
                data,
                stride,
                offsets,
                ..
            } => {
                let rec = &data[record * stride..(record + 1) * stride];
                read_scalar(&rec[offsets[prop]..], header.prop_ty(prop))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_infer_sh_degree() {
        assert_eq!(infer_sh_degree(0), Some(0));
        assert_eq!(infer_sh_degree(9), Some(1)); // (1+3)=4=(1+1)²
        assert_eq!(infer_sh_degree(24), Some(2)); // (1+8)=9=(2+1)²
        assert_eq!(infer_sh_degree(45), Some(3)); // (1+15)=16=(3+1)²
        assert_eq!(infer_sh_degree(7), None); // not divisible by 3
        assert_eq!(infer_sh_degree(6), None); // per-channel total 3, not a square
    }

    #[test]
    fn test_sigmoid() {
        assert!((sigmoid(0.0) - 0.5).abs() < 1e-6);
        assert!(sigmoid(10.0) > 0.99);
        assert!(sigmoid(-10.0) < 0.01);
    }

    #[test]
    fn test_quat_identity_is_identity_matrix() {
        let r = quat_to_rotmat([1.0, 0.0, 0.0, 0.0]);
        for i in 0..3 {
            for j in 0..3 {
                let expect = if i == j { 1.0 } else { 0.0 };
                assert!((r[i][j] - expect).abs() < 1e-6, "r[{i}][{j}]={}", r[i][j]);
            }
        }
    }

    #[test]
    fn test_quat_normalizes_input() {
        // Unnormalized quaternion scaled by 2 must yield the same rotation.
        let a = quat_to_rotmat([1.0, 0.0, 0.0, 0.0]);
        let b = quat_to_rotmat([2.0, 0.0, 0.0, 0.0]);
        for i in 0..3 {
            for j in 0..3 {
                assert!((a[i][j] - b[i][j]).abs() < 1e-6);
            }
        }
    }

    #[test]
    fn test_quat_90deg_about_z() {
        // 90° about +Z: (w,x,y,z) = (cos45, 0, 0, sin45).
        let c = std::f32::consts::FRAC_1_SQRT_2;
        let r = quat_to_rotmat([c, 0.0, 0.0, c]);
        // Rotates +X → +Y.
        assert!((r[0][0]).abs() < 1e-5);
        assert!((r[1][0] - 1.0).abs() < 1e-5);
    }

    #[test]
    fn test_compute_cov3d_identity() {
        // Unit scale (exp(0)=1 → scale 1) + identity rotation → identity cov.
        let cov = compute_cov3d([1.0, 1.0, 1.0], [1.0, 0.0, 0.0, 0.0]);
        assert!((cov[0] - 1.0).abs() < 1e-6); // σxx
        assert!(cov[1].abs() < 1e-6); // σxy
        assert!(cov[2].abs() < 1e-6); // σxz
        assert!((cov[3] - 1.0).abs() < 1e-6); // σyy
        assert!(cov[4].abs() < 1e-6); // σyz
        assert!((cov[5] - 1.0).abs() < 1e-6); // σzz
    }

    #[test]
    fn test_compute_cov3d_anisotropic_diagonal() {
        // Anisotropic scale, identity rotation → diagonal cov = scale².
        let cov = compute_cov3d([2.0, 3.0, 4.0], [1.0, 0.0, 0.0, 0.0]);
        assert!((cov[0] - 4.0).abs() < 1e-5);
        assert!((cov[3] - 9.0).abs() < 1e-5);
        assert!((cov[5] - 16.0).abs() < 1e-5);
    }

    fn degree0_ascii() -> &'static str {
        // x y z  f_dc_0 f_dc_1 f_dc_2  opacity  scale_0..2  rot_0..3
        "\
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
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
0 0 0 0 0 0 0 0 0 0 1 0 0 0
1 2 3 0 0 0 0 0 0 0 1 0 0 0
"
    }

    #[test]
    fn test_parse_gaussian_ascii_degree0() {
        let cloud = parse_gaussian_ply(degree0_ascii().as_bytes()).unwrap();
        assert_eq!(cloud.len(), 2);
        assert_eq!(cloud.sh_degree(), 0);
        assert_eq!(cloud.coeffs_per_channel(), 1);
        // Origin is the first splat; positions are relative.
        assert_eq!(cloud.origin(), [0.0, 0.0, 0.0]);
        assert_eq!(&cloud.positions()[3..6], &[1.0, 2.0, 3.0]);
        // opacity = sigmoid(0) = 0.5
        assert!((cloud.opacity()[0] - 0.5).abs() < 1e-6);
        // band-0 colour: dc=0 → 0.5
        let c = cloud.color_band0(0).unwrap();
        assert!((c[0] - 0.5).abs() < 1e-6);
        // cov3d: scale exp(0)=1 + identity rot → identity.
        assert!((cloud.cov3d()[0] - 1.0).abs() < 1e-6);
        assert!((cloud.cov3d()[3] - 1.0).abs() < 1e-6);
        assert!((cloud.cov3d()[5] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_parse_gaussian_capped_stride_samples() {
        // Budget of 1 stride-samples the 2-splat cloud down to the first splat.
        let cloud = parse_gaussian_ply_capped(degree0_ascii().as_bytes(), Some(1)).unwrap();
        assert_eq!(cloud.len(), 1);
        // The kept splat is the first record (origin), position [0,0,0].
        assert_eq!(&cloud.positions()[0..3], &[0.0, 0.0, 0.0]);
    }

    #[test]
    fn test_parse_gaussian_capped_none_keeps_all() {
        let cloud = parse_gaussian_ply_capped(degree0_ascii().as_bytes(), None).unwrap();
        assert_eq!(cloud.len(), 2);
    }

    #[test]
    fn test_parse_gaussian_capped_budget_above_count_keeps_all() {
        let cloud = parse_gaussian_ply_capped(degree0_ascii().as_bytes(), Some(999)).unwrap();
        assert_eq!(cloud.len(), 2);
    }

    #[test]
    fn test_build_splat_buffer_layout() {
        let cloud = parse_gaussian_ply(degree0_ascii().as_bytes()).unwrap();
        let buf = cloud.build_splat_buffer();
        assert_eq!(buf.len(), SPLAT_BUFFER_STRIDE * 2);
        // First splat position at the start.
        assert_eq!(&buf[0..3], &[0.0, 0.0, 0.0]);
        // opacity is the final float of each stride.
        assert!((buf[SPLAT_BUFFER_STRIDE - 1] - 0.5).abs() < 1e-6);
    }

    #[test]
    fn test_build_splat_buffer_sh_degree0() {
        let cloud = parse_gaussian_ply(degree0_ascii().as_bytes()).unwrap();
        // degree 0 → 1 coeff/channel → stride = 10 + 3 = 13.
        assert_eq!(cloud.sh_buffer_stride(), 13);
        let buf = cloud.build_splat_buffer_sh();
        assert_eq!(buf.len(), 13 * 2);
        // Layout: pos(3) cov(6) opacity(1) sh(3). opacity at index 9.
        assert!((buf[9] - 0.5).abs() < 1e-6); // sigmoid(0)
        // Raw DC coeff (0) stored at index 10..13 (NOT decoded colour).
        assert_eq!(&buf[10..13], &[0.0, 0.0, 0.0]);
    }

    #[test]
    fn test_build_splat_buffer_sh_degree1_stride() {
        // 9 f_rest → degree 1 → 4 coeffs/channel → stride = 10 + 12 = 22.
        let mut header = String::from(
            "ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nproperty float f_dc_0\nproperty float f_dc_1\nproperty float f_dc_2\n",
        );
        for k in 0..9 {
            header.push_str(&format!("property float f_rest_{k}\n"));
        }
        header.push_str(
            "property float opacity\nproperty float scale_0\nproperty float scale_1\nproperty float scale_2\nproperty float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\nend_header\n",
        );
        let mut row = String::from("0 0 0 1 2 3 ");
        for k in 0..9 {
            row.push_str(&format!("{} ", k + 4));
        }
        row.push_str("0 0 0 0 1 0 0 0\n");
        header.push_str(&row);
        let cloud = parse_gaussian_ply(header.as_bytes()).unwrap();
        assert_eq!(cloud.sh_buffer_stride(), 22);
        let buf = cloud.build_splat_buffer_sh();
        assert_eq!(buf.len(), 22);
        // SH block starts at index 10; first coeff is the DC triple (1,2,3).
        assert_eq!(&buf[10..13], &[1.0, 2.0, 3.0]);
    }

    #[test]
    fn test_parse_gaussian_degree1_sh_degree() {
        // 9 f_rest → degree 1.
        let mut header = String::from(
            "ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nproperty float f_dc_0\nproperty float f_dc_1\nproperty float f_dc_2\n",
        );
        for k in 0..9 {
            header.push_str(&format!("property float f_rest_{k}\n"));
        }
        header.push_str(
            "property float opacity\nproperty float scale_0\nproperty float scale_1\nproperty float scale_2\nproperty float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\nend_header\n",
        );
        // 3 pos + 3 dc + 9 rest + 1 opacity + 3 scale + 4 rot = 23 columns.
        let mut row = String::from("0 0 0 0 0 0 ");
        for _ in 0..9 {
            row.push_str("0 ");
        }
        row.push_str("0 0 0 0 1 0 0 0\n");
        header.push_str(&row);
        let cloud = parse_gaussian_ply(header.as_bytes()).unwrap();
        assert_eq!(cloud.sh_degree(), 1);
        assert_eq!(cloud.coeffs_per_channel(), 4);
        // sh_coeffs length: num_coeffs(4) * 3 channels * 1 splat.
        assert_eq!(cloud.sh_coeffs().len(), 12);
    }

    #[test]
    fn test_non_gaussian_ply_rejected() {
        let body = "\
ply
format ascii 1.0
element vertex 1
property float x
property float y
property float z
end_header
0 0 0
";
        assert!(matches!(
            parse_gaussian_ply(body.as_bytes()),
            Err(PointCloudError::Unsupported(_))
        ));
    }

    #[test]
    fn test_parse_gaussian_binary() {
        let mut bytes = b"ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nproperty float f_dc_0\nproperty float f_dc_1\nproperty float f_dc_2\nproperty float opacity\nproperty float scale_0\nproperty float scale_1\nproperty float scale_2\nproperty float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\nend_header\n".to_vec();
        let vals: [f32; 14] = [
            5.0, 6.0, 7.0, // pos
            0.0, 0.0, 0.0, // dc
            0.0, // opacity
            0.0, 0.0, 0.0, // scale
            1.0, 0.0, 0.0, 0.0, // rot
        ];
        for v in vals {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        let cloud = parse_gaussian_ply(&bytes).unwrap();
        assert_eq!(cloud.len(), 1);
        assert_eq!(cloud.origin(), [5.0, 6.0, 7.0]);
        assert!((cloud.opacity()[0] - 0.5).abs() < 1e-6);
    }
}
