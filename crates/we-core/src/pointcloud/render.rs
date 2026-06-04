//! Point cloud render-buffer construction (presentation helpers).
//!
//! These pure functions turn a [`PointCloud`] into an interleaved vertex buffer
//! suitable for GPU upload. They are shared by the WASM bindings and the native
//! desktop commands so colour/decimation behaviour stays identical on both ends.

use super::model::PointCloud;

/// How per-point colours are computed for the render buffer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorMode {
    /// Use stored RGB (falls back to grey when absent).
    Rgb,
    /// Greyscale by normalized intensity (falls back to black when absent).
    Intensity,
    /// Blue → green → red ramp by elevation.
    Elevation,
}

impl ColorMode {
    /// Parse a mode name (`rgb`, `intensity`, anything else → elevation).
    pub fn from_str_or_elevation(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "rgb" => ColorMode::Rgb,
            "intensity" => ColorMode::Intensity,
            _ => ColorMode::Elevation,
        }
    }
}

/// Build an interleaved render buffer `[x, y, z, r, g, b, ...]` in local
/// coordinates with colours in `0..1`, decimated to at most `max_points` via
/// stride sampling. Returns an empty vector for an empty cloud.
pub fn build_render_buffer(cloud: &PointCloud, mode: ColorMode, max_points: usize) -> Vec<f32> {
    let n = cloud.len();
    if n == 0 {
        return Vec::new();
    }
    let budget = max_points.max(1).min(n);
    let stride = n.div_ceil(budget).max(1);

    let b = cloud.bounds();
    let z_min = b.min[2] as f32;
    let z_span = (b.max[2] - b.min[2]) as f32;

    let mut buf = Vec::with_capacity((n / stride + 1) * 6);
    let mut i = 0;
    while i < n {
        if let Some(p) = cloud.point(i) {
            let c = color_for(cloud, i, mode, z_min, z_span);
            buf.extend_from_slice(&[p[0] as f32, p[1] as f32, p[2] as f32, c[0], c[1], c[2]]);
        }
        i += stride;
    }
    buf
}

/// Compute the RGB colour (0..1) for point `i` under `mode`.
fn color_for(cloud: &PointCloud, i: usize, mode: ColorMode, z_min: f32, z_span: f32) -> [f32; 3] {
    match mode {
        ColorMode::Rgb => cloud
            .color(i)
            .map(|c| {
                [
                    c[0] as f32 / 255.0,
                    c[1] as f32 / 255.0,
                    c[2] as f32 / 255.0,
                ]
            })
            .unwrap_or([0.8, 0.8, 0.8]),
        ColorMode::Intensity => {
            let v = cloud.intensity(i).unwrap_or(0.0).clamp(0.0, 1.0);
            [v, v, v]
        }
        ColorMode::Elevation => {
            let p = cloud.point(i).map(|pt| pt[2] as f32).unwrap_or(0.0);
            let t = if z_span > 1e-6 {
                ((p - z_min) / z_span).clamp(0.0, 1.0)
            } else {
                0.5
            };
            ramp(t)
        }
    }
}

/// A simple 3-stop blue → green → red gradient for `t` in `0..1`.
fn ramp(t: f32) -> [f32; 3] {
    if t < 0.5 {
        let u = t * 2.0;
        [0.0, u, 1.0 - u]
    } else {
        let u = (t - 0.5) * 2.0;
        [u, 1.0 - u, 0.0]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_cloud() -> PointCloud {
        let mut c = PointCloud::new();
        c.push([0.0, 0.0, 0.0], Some(0.2), Some([255, 0, 0]));
        c.push([1.0, 0.0, 1.0], Some(0.8), Some([0, 255, 0]));
        c
    }

    #[test]
    fn test_empty_cloud_returns_empty_buffer() {
        let c = PointCloud::new();
        assert!(build_render_buffer(&c, ColorMode::Elevation, 100).is_empty());
    }

    #[test]
    fn test_buffer_has_six_floats_per_point() {
        let c = sample_cloud();
        let buf = build_render_buffer(&c, ColorMode::Elevation, 100);
        assert_eq!(buf.len(), 12);
    }

    #[test]
    fn test_rgb_mode_uses_stored_color() {
        let c = sample_cloud();
        let buf = build_render_buffer(&c, ColorMode::Rgb, 100);
        // First point is pure red.
        assert_eq!(&buf[3..6], &[1.0, 0.0, 0.0]);
    }

    #[test]
    fn test_intensity_mode_is_greyscale() {
        let c = sample_cloud();
        let buf = build_render_buffer(&c, ColorMode::Intensity, 100);
        assert_eq!(&buf[3..6], &[0.2, 0.2, 0.2]);
    }

    #[test]
    fn test_decimation_respects_budget() {
        let mut c = PointCloud::new();
        for i in 0..100 {
            c.push([i as f64, 0.0, 0.0], None, None);
        }
        let buf = build_render_buffer(&c, ColorMode::Elevation, 10);
        // At most ~10 points * 6 floats.
        assert!(buf.len() <= 10 * 6 + 6);
    }

    #[test]
    fn test_mode_from_str() {
        assert_eq!(ColorMode::from_str_or_elevation("rgb"), ColorMode::Rgb);
        assert_eq!(
            ColorMode::from_str_or_elevation("intensity"),
            ColorMode::Intensity
        );
        assert_eq!(
            ColorMode::from_str_or_elevation("anything"),
            ColorMode::Elevation
        );
    }
}
