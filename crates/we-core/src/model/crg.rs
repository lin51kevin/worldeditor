//! CRG (Curved Regular Grid) profile data model.
//!
//! The OpenCRG format describes road surface profiles as a curved regular grid.
//! This module defines the data model and serialisation types.
//!
//! Reference: OpenCRG 1.5 specification

use serde::{Deserialize, Serialize};

/// CRG file reference attached to a road section.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CrgReference {
    /// Path to the CRG file (relative or absolute).
    pub file: String,
    /// Start station along the road reference line (m).
    pub s_start: f64,
    /// End station (m). If `None`, extends to the end of the road.
    pub s_end: Option<f64>,
    /// Orientation of the CRG profile relative to the road.
    pub orientation: CrgOrientation,
    /// Lateral offset of the CRG grid centre from the road reference line (m).
    pub s_offset: f64,
    /// Longitudinal offset of the CRG grid (m).
    pub t_offset: f64,
    /// Height offset of the CRG grid (m).
    pub z_offset: f64,
    /// Scaling factor for height values.
    pub z_scale: f64,
}

impl Default for CrgReference {
    fn default() -> Self {
        Self {
            file: String::new(),
            s_start: 0.0,
            s_end: None,
            orientation: CrgOrientation::Same,
            s_offset: 0.0,
            t_offset: 0.0,
            z_offset: 0.0,
            z_scale: 1.0,
        }
    }
}

/// Orientation of the CRG data relative to the road direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CrgOrientation {
    /// CRG data runs in the same direction as the road.
    Same,
    /// CRG data runs in the opposite direction.
    Opposite,
}

/// An in-memory CRG surface profile (loaded data).
///
/// The grid is a regular rectangular grid in the curved reference frame of the road.
/// U-axis runs along the road (longitudinal), V-axis runs laterally.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrgProfile {
    /// Reference metadata (file path, offsets, orientation).
    pub reference: CrgReference,
    /// Number of grid points in the longitudinal (U) direction.
    pub u_count: u32,
    /// Number of grid points in the lateral (V) direction.
    pub v_count: u32,
    /// Longitudinal grid spacing (m).
    pub u_resolution: f64,
    /// Lateral grid spacing (m).
    pub v_resolution: f64,
    /// Start of the V (lateral) axis (m, typically negative = left).
    pub v_min: f64,
    /// Height values, row-major: `data[u * v_count + v]` = height at (u, v).
    pub data: Vec<f32>,
}

impl CrgProfile {
    /// Create a new empty profile with the given grid dimensions.
    pub fn new(
        reference: CrgReference,
        u_count: u32,
        v_count: u32,
        u_resolution: f64,
        v_resolution: f64,
        v_min: f64,
    ) -> Self {
        let total = (u_count * v_count) as usize;
        Self {
            reference,
            u_count,
            v_count,
            u_resolution,
            v_resolution,
            v_min,
            data: vec![0.0; total],
        }
    }

    /// Get the height at grid index `(u_idx, v_idx)`.
    ///
    /// Returns `None` if indices are out of bounds.
    pub fn height_at(&self, u_idx: u32, v_idx: u32) -> Option<f32> {
        if u_idx >= self.u_count || v_idx >= self.v_count {
            return None;
        }
        self.data.get((u_idx * self.v_count + v_idx) as usize).copied()
    }

    /// Bilinearly interpolate height at continuous (u, v) coordinates (in metres).
    ///
    /// Clamps to grid bounds.
    pub fn interpolate_height(&self, u_m: f64, v_m: f64) -> f32 {
        let u_f = (u_m / self.u_resolution).clamp(0.0, (self.u_count - 1) as f64);
        let v_f = ((v_m - self.v_min) / self.v_resolution).clamp(0.0, (self.v_count - 1) as f64);

        let u0 = u_f.floor() as u32;
        let v0 = v_f.floor() as u32;
        let u1 = (u0 + 1).min(self.u_count - 1);
        let v1 = (v0 + 1).min(self.v_count - 1);

        let tu = (u_f - u0 as f64) as f32;
        let tv = (v_f - v0 as f64) as f32;

        let h00 = self.height_at(u0, v0).unwrap_or(0.0);
        let h10 = self.height_at(u1, v0).unwrap_or(0.0);
        let h01 = self.height_at(u0, v1).unwrap_or(0.0);
        let h11 = self.height_at(u1, v1).unwrap_or(0.0);

        // Bilinear interpolation
        h00 * (1.0 - tu) * (1.0 - tv)
            + h10 * tu * (1.0 - tv)
            + h01 * (1.0 - tu) * tv
            + h11 * tu * tv
    }

    /// Total number of data points.
    pub fn len(&self) -> usize {
        self.data.len()
    }

    /// Returns `true` if the profile has no data points.
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_ref() -> CrgReference {
        CrgReference {
            file: "surface.crg".to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn test_crg_reference_default() {
        let r = CrgReference::default();
        assert!(r.file.is_empty());
        assert!((r.s_start - 0.0).abs() < f64::EPSILON);
        assert!(r.s_end.is_none());
        assert_eq!(r.orientation, CrgOrientation::Same);
        assert!((r.z_scale - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_crg_profile_new() {
        let p = CrgProfile::new(default_ref(), 10, 5, 1.0, 0.5, -1.0);
        assert_eq!(p.u_count, 10);
        assert_eq!(p.v_count, 5);
        assert_eq!(p.len(), 50);
        assert!(p.data.iter().all(|&h| h == 0.0));
    }

    #[test]
    fn test_height_at_valid_index() {
        let mut p = CrgProfile::new(default_ref(), 3, 3, 1.0, 1.0, -1.0);
        p.data[1 * 3 + 2] = 5.0; // u=1, v=2
        assert_eq!(p.height_at(1, 2), Some(5.0));
    }

    #[test]
    fn test_height_at_out_of_bounds() {
        let p = CrgProfile::new(default_ref(), 3, 3, 1.0, 1.0, -1.0);
        assert!(p.height_at(3, 0).is_none());
        assert!(p.height_at(0, 3).is_none());
    }

    #[test]
    fn test_interpolate_height_flat_grid() {
        // All heights = 2.0; interpolation should return 2.0 everywhere
        let mut p = CrgProfile::new(default_ref(), 5, 5, 1.0, 1.0, 0.0);
        for h in &mut p.data {
            *h = 2.0;
        }
        let h = p.interpolate_height(2.5, 1.5);
        assert!((h - 2.0).abs() < 1e-5, "Expected 2.0, got {h}");
    }

    #[test]
    fn test_interpolate_height_ramp() {
        // Linear ramp: height = u_idx as f32
        let mut p = CrgProfile::new(default_ref(), 4, 1, 1.0, 1.0, 0.0);
        for u in 0..4u32 {
            p.data[u as usize] = u as f32;
        }
        // At u=2.5, expected ~2.5
        let h = p.interpolate_height(2.5, 0.0);
        assert!((h - 2.5).abs() < 0.01, "Expected ~2.5, got {h}");
    }

    #[test]
    fn test_crg_profile_is_empty() {
        let mut p = CrgProfile::new(default_ref(), 0, 0, 1.0, 1.0, 0.0);
        p.data.clear();
        assert!(p.is_empty());
    }

    #[test]
    fn test_crg_orientation_serialization() {
        let json = serde_json::to_string(&CrgOrientation::Opposite).unwrap();
        let back: CrgOrientation = serde_json::from_str(&json).unwrap();
        assert_eq!(back, CrgOrientation::Opposite);
    }

    #[test]
    fn test_crg_reference_serialization() {
        let r = CrgReference {
            file: "test.crg".to_string(),
            s_start: 10.0,
            s_end: Some(50.0),
            orientation: CrgOrientation::Opposite,
            ..Default::default()
        };
        let json = serde_json::to_string(&r).unwrap();
        let back: CrgReference = serde_json::from_str(&json).unwrap();
        assert_eq!(back.file, "test.crg");
        assert_eq!(back.s_end, Some(50.0));
        assert_eq!(back.orientation, CrgOrientation::Opposite);
    }
}
