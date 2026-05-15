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
