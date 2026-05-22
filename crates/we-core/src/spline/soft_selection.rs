//! Soft selection — neighbourhood-based influence system for spline knot editing.
//!
//! Provides falloff functions and influence collection to allow smooth
//! multi-knot movement when dragging a single knot.

use serde::{Deserialize, Serialize};

use super::EditableSpline;

/// Soft selection falloff function type.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FalloffType {
    /// Linear falloff: factor = 1 - (distance / radius)
    Linear,
    /// Gaussian falloff: factor = exp(-k * (distance / radius)^2)
    #[default]
    Gaussian,
    /// Smooth (cubic) falloff: factor = (1 - (d/r)^2)^2
    Smooth,
}

/// Configuration for soft selection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoftSelectionConfig {
    /// Maximum influence radius in world units.
    pub radius: f64,
    /// Falloff function type.
    pub falloff: FalloffType,
    /// Gaussian sharpness (only used for Gaussian falloff). Higher = sharper.
    pub gaussian_k: f64,
}

impl Default for SoftSelectionConfig {
    fn default() -> Self {
        Self {
            radius: 50.0,
            falloff: FalloffType::Gaussian,
            gaussian_k: 3.0,
        }
    }
}

/// Compute the falloff factor for a given distance from the selected knot.
///
/// Returns a value in [0.0, 1.0] where 1.0 = full influence, 0.0 = no influence.
pub fn compute_falloff(config: &SoftSelectionConfig, distance: f64) -> f64 {
    if distance <= 0.0 {
        return 1.0;
    }
    if distance >= config.radius {
        return 0.0;
    }

    let ratio = distance / config.radius;

    match config.falloff {
        FalloffType::Linear => 1.0 - ratio,
        FalloffType::Gaussian => (-config.gaussian_k * ratio * ratio).exp(),
        FalloffType::Smooth => {
            let t = 1.0 - ratio * ratio;
            t * t
        }
    }
}

/// Collect soft selection influence factors for all knots relative to a selected knot.
///
/// Returns a map of (knot_index, influence_factor) for knots within the radius.
/// The selected knot itself always has factor 1.0.
pub fn collect_soft_selection(
    spline: &EditableSpline,
    selected_index: usize,
    config: &SoftSelectionConfig,
) -> Vec<(usize, f64)> {
    if selected_index >= spline.knots.len() {
        return Vec::new();
    }

    let selected = &spline.knots[selected_index];
    let mut result = vec![(selected_index, 1.0)];

    for (i, knot) in spline.knots.iter().enumerate() {
        if i == selected_index {
            continue;
        }
        let dist = selected.distance_3d(knot);
        if dist < config.radius {
            let factor = compute_falloff(config, dist);
            if factor > 1e-6 {
                result.push((i, factor));
            }
        }
    }

    // Sort by index for deterministic output
    result.sort_by_key(|(idx, _)| *idx);
    result
}

/// Apply a displacement to knots with soft selection influence.
///
/// `displacement` is the delta movement of the primary knot.
/// Other knots are moved by `displacement * factor`.
pub fn apply_soft_selection_move(
    spline: &mut EditableSpline,
    factors: &[(usize, f64)],
    displacement: [f64; 3],
) {
    for &(idx, factor) in factors {
        if idx < spline.knots.len() {
            spline.knots[idx].position[0] += displacement[0] * factor;
            spline.knots[idx].position[1] += displacement[1] * factor;
            spline.knots[idx].position[2] += displacement[2] * factor;
        }
    }
    spline.recompute_stations();
    spline.compute_tangents();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spline::{EditableSpline, SplineKnot};

    fn make_spline(positions: &[[f64; 3]]) -> EditableSpline {
        let knots = positions
            .iter()
            .map(|&[x, y, z]| SplineKnot::new(x, y, z))
            .collect();
        EditableSpline::from_knots(knots)
    }

    // ── compute_falloff ───────────────────────────────────────────────────────

    #[test]
    fn test_falloff_at_zero_distance_is_one() {
        let config = SoftSelectionConfig::default();
        assert_eq!(compute_falloff(&config, 0.0), 1.0);
    }

    #[test]
    fn test_falloff_at_exact_radius_is_zero() {
        let config = SoftSelectionConfig {
            radius: 10.0,
            ..Default::default()
        };
        assert_eq!(compute_falloff(&config, 10.0), 0.0);
    }

    #[test]
    fn test_falloff_beyond_radius_is_zero() {
        let config = SoftSelectionConfig {
            radius: 10.0,
            ..Default::default()
        };
        assert_eq!(compute_falloff(&config, 20.0), 0.0);
    }

    #[test]
    fn test_falloff_linear_midpoint_is_half() {
        let config = SoftSelectionConfig {
            radius: 10.0,
            falloff: FalloffType::Linear,
            gaussian_k: 3.0,
        };
        let f = compute_falloff(&config, 5.0);
        assert!((f - 0.5).abs() < 1e-12, "linear mid = {f}");
    }

    #[test]
    fn test_falloff_gaussian_at_midpoint() {
        let config = SoftSelectionConfig {
            radius: 10.0,
            falloff: FalloffType::Gaussian,
            gaussian_k: 3.0,
        };
        let f = compute_falloff(&config, 5.0);
        let expected = (-3.0_f64 * 0.25).exp(); // ratio = 0.5, ratio² = 0.25
        assert!((f - expected).abs() < 1e-12, "gaussian mid = {f}");
    }

    #[test]
    fn test_falloff_smooth_midpoint() {
        let config = SoftSelectionConfig {
            radius: 10.0,
            falloff: FalloffType::Smooth,
            gaussian_k: 3.0,
        };
        let f = compute_falloff(&config, 5.0);
        let r = 0.5_f64;
        let expected = (1.0 - r * r) * (1.0 - r * r);
        assert!((f - expected).abs() < 1e-12, "smooth mid = {f}");
    }

    // ── collect_soft_selection ────────────────────────────────────────────────

    #[test]
    fn test_collect_empty_spline_returns_empty() {
        let spline = EditableSpline::new();
        let config = SoftSelectionConfig::default();
        assert!(collect_soft_selection(&spline, 0, &config).is_empty());
    }

    #[test]
    fn test_collect_out_of_range_index_returns_empty() {
        let spline = make_spline(&[[0.0, 0.0, 0.0]]);
        let config = SoftSelectionConfig::default();
        assert!(collect_soft_selection(&spline, 99, &config).is_empty());
    }

    #[test]
    fn test_collect_selected_knot_always_factor_one() {
        let spline = make_spline(&[[0.0, 0.0, 0.0], [5.0, 0.0, 0.0]]);
        let config = SoftSelectionConfig {
            radius: 100.0,
            ..Default::default()
        };
        let result = collect_soft_selection(&spline, 0, &config);
        let (_, factor) = result.iter().find(|(i, _)| *i == 0).copied().unwrap();
        assert!((factor - 1.0).abs() < 1e-12);
    }

    #[test]
    fn test_collect_knot_beyond_radius_excluded() {
        let spline = make_spline(&[[0.0, 0.0, 0.0], [200.0, 0.0, 0.0]]);
        let config = SoftSelectionConfig {
            radius: 50.0,
            ..Default::default()
        };
        let result = collect_soft_selection(&spline, 0, &config);
        // Only the selected knot should be present
        assert_eq!(
            result.len(),
            1,
            "expected only selected knot, got {:?}",
            result
        );
    }

    #[test]
    fn test_collect_results_sorted_by_index() {
        let spline = make_spline(&[
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [2.0, 0.0, 0.0],
            [3.0, 0.0, 0.0],
        ]);
        let config = SoftSelectionConfig {
            radius: 100.0,
            ..Default::default()
        };
        let result = collect_soft_selection(&spline, 1, &config);
        let indices: Vec<usize> = result.iter().map(|(i, _)| *i).collect();
        let mut sorted = indices.clone();
        sorted.sort();
        assert_eq!(indices, sorted, "result should be sorted by index");
    }

    // ── apply_soft_selection_move ─────────────────────────────────────────────

    #[test]
    fn test_apply_moves_knots_by_factor() {
        let mut spline = make_spline(&[[0.0, 0.0, 0.0], [5.0, 0.0, 0.0]]);
        let factors = vec![(0, 1.0), (1, 0.5)];
        apply_soft_selection_move(&mut spline, &factors, [10.0, 0.0, 0.0]);
        assert!((spline.knots[0].position[0] - 10.0).abs() < 1e-12);
        // 5.0 + 10.0 * 0.5 = 10.0
        assert!((spline.knots[1].position[0] - 10.0).abs() < 1e-12);
    }

    #[test]
    fn test_apply_skips_out_of_range_index() {
        let mut spline = make_spline(&[[0.0, 0.0, 0.0]]);
        let factors = vec![(0, 1.0), (99, 1.0)]; // index 99 is invalid
        // Should not panic
        apply_soft_selection_move(&mut spline, &factors, [1.0, 0.0, 0.0]);
        assert!((spline.knots[0].position[0] - 1.0).abs() < 1e-12);
    }

    #[test]
    fn test_falloff_type_default_is_gaussian() {
        assert_eq!(FalloffType::default(), FalloffType::Gaussian);
    }
}
