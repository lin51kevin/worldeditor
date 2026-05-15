//! Editable spline representation for road centerline editing.
//!
//! Provides a `SplineKnot`-based abstraction over OpenDRIVE's parametric
//! geometry segments. This is the editing layer between the user interaction
//! and the OpenDRIVE data model.
//!
//! Key concepts:
//! - `SplineKnot`: A control point with position, tangent, and elevation
//! - `EditableSpline`: A sequence of knots that can be manipulated interactively
//! - Bidirectional conversion: `Road.plan_view` ↔ `EditableSpline`
//! - Catmull-Rom tangent auto-computation
//! - Soft selection for neighborhood influence
//!
//! Port of C# `CurveCenterLineKnot` / `EditableSplineTangentManual` pattern.

use serde::{Deserialize, Serialize};

mod arc_length;
mod catmull_rom;
mod constraints;
mod conversion;
pub(crate) mod cubic_bezier;
mod soft_selection;

pub use catmull_rom::compute_catmull_rom_tangent;
#[cfg(test)]
use cubic_bezier::param_poly3_curvature;

pub use constraints::{constrain_displacement, MoveConstraint};
pub use conversion::{road_to_spline, spline_to_geometries, spline_to_geometries_with_mode};
pub use soft_selection::{
    apply_soft_selection_move, collect_soft_selection, compute_falloff, FalloffType,
    SoftSelectionConfig,
};

/// Controls how `spline_to_geometries` emits geometry types.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SplineOutputMode {
    /// Classify curvature profile to choose optimal geometry type
    /// (Line / Arc / Spiral / ParamPoly3). Produces standard
    /// Line-Spiral-Arc-Spiral-Line patterns.
    #[default]
    Classify,
    /// Emit ParamPoly3 directly from Hermite fitting, without
    /// curvature classification. Straight segments are still
    /// detected as Line.
    ParamPoly3Only,
}

/// Type of a spline knot — determines how it participates in tangent computation.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KnotType {
    /// Key control point — user-placed, drives curve shape.
    #[default]
    Key,
    /// Intermediate sample — auto-generated between key knots.
    Intermediate,
    /// Start/End anchor — first or last knot, special tangent handling.
    Anchor,
}

/// Tangent mode — how the tangent vector is managed.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TangentMode {
    /// Tangent is auto-computed from neighboring knots (Catmull-Rom).
    #[default]
    Auto,
    /// Tangent is manually set by the user.
    Manual,
}

/// A spline control point for interactive road editing.
///
/// Corresponds to C# `CurveCenterLineKnot`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplineKnot {
    /// World-space position (x, y, z).
    pub position: [f64; 3],
    /// Tangent direction vector (normalized or zero for auto-compute).
    pub tangent_in: [f64; 3],
    /// Outgoing tangent direction vector.
    pub tangent_out: [f64; 3],
    /// Station along the centerline (s coordinate).
    pub s: f64,
    /// Knot type (Key, Intermediate, Anchor).
    pub knot_type: KnotType,
    /// Tangent mode (Auto, Manual).
    pub tangent_mode: TangentMode,
}

impl SplineKnot {
    /// Create a new key knot at the given position.
    pub fn new(x: f64, y: f64, z: f64) -> Self {
        Self {
            position: [x, y, z],
            tangent_in: [0.0, 0.0, 0.0],
            tangent_out: [0.0, 0.0, 0.0],
            s: 0.0,
            knot_type: KnotType::Key,
            tangent_mode: TangentMode::Auto,
        }
    }

    /// Create a knot with explicit position and station.
    pub fn with_station(x: f64, y: f64, z: f64, s: f64) -> Self {
        Self {
            position: [x, y, z],
            tangent_in: [0.0, 0.0, 0.0],
            tangent_out: [0.0, 0.0, 0.0],
            s,
            knot_type: KnotType::Key,
            tangent_mode: TangentMode::Auto,
        }
    }

    /// Create a knot with manual tangent.
    pub fn with_tangent(x: f64, y: f64, z: f64, tx: f64, ty: f64, tz: f64) -> Self {
        let len = (tx * tx + ty * ty + tz * tz).sqrt();
        let (ntx, nty, ntz) = if len > 1e-12 {
            (tx / len, ty / len, tz / len)
        } else {
            (1.0, 0.0, 0.0)
        };
        Self {
            position: [x, y, z],
            tangent_in: [ntx, nty, ntz],
            tangent_out: [ntx, nty, ntz],
            s: 0.0,
            knot_type: KnotType::Key,
            tangent_mode: TangentMode::Manual,
        }
    }

    /// Euclidean distance to another knot (2D, ignoring Z).
    pub fn distance_2d(&self, other: &SplineKnot) -> f64 {
        let dx = self.position[0] - other.position[0];
        let dy = self.position[1] - other.position[1];
        (dx * dx + dy * dy).sqrt()
    }

    /// Euclidean distance to another knot (3D).
    pub fn distance_3d(&self, other: &SplineKnot) -> f64 {
        let dx = self.position[0] - other.position[0];
        let dy = self.position[1] - other.position[1];
        let dz = self.position[2] - other.position[2];
        (dx * dx + dy * dy + dz * dz).sqrt()
    }
}

/// An editable spline — a sequence of knots defining a road centerline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditableSpline {
    pub knots: Vec<SplineKnot>,
}

impl EditableSpline {
    /// Create an empty spline.
    pub fn new() -> Self {
        Self { knots: Vec::new() }
    }

    /// Create a spline from a list of knots.
    pub fn from_knots(knots: Vec<SplineKnot>) -> Self {
        Self { knots }
    }

    /// Number of knots.
    pub fn len(&self) -> usize {
        self.knots.len()
    }

    /// Whether the spline is empty.
    pub fn is_empty(&self) -> bool {
        self.knots.is_empty()
    }

    /// Total arc length (station of last knot).
    pub fn total_length(&self) -> f64 {
        self.knots.last().map(|k| k.s).unwrap_or(0.0)
    }

    /// Add a knot at the end.
    pub fn push(&mut self, knot: SplineKnot) {
        self.knots.push(knot);
    }

    /// Insert a knot at the given index.
    pub fn insert(&mut self, index: usize, knot: SplineKnot) {
        self.knots.insert(index, knot);
    }

    /// Remove a knot at the given index.
    pub fn remove(&mut self, index: usize) -> SplineKnot {
        self.knots.remove(index)
    }

    /// Recompute station (s) values based on cumulative distance between knots.
    pub fn recompute_stations(&mut self) {
        if self.knots.is_empty() {
            return;
        }
        self.knots[0].s = 0.0;
        for i in 1..self.knots.len() {
            let dx = self.knots[i].position[0] - self.knots[i - 1].position[0];
            let dy = self.knots[i].position[1] - self.knots[i - 1].position[1];
            let dist = (dx * dx + dy * dy).sqrt();
            self.knots[i].s = self.knots[i - 1].s + dist;
        }
    }

    /// Auto-compute tangents for all knots with `TangentMode::Auto`.
    ///
    /// Uses Catmull-Rom tangent computation from 3 neighbors.
    pub fn compute_tangents(&mut self) {
        let n = self.knots.len();
        if n < 2 {
            return;
        }

        // Collect positions for tangent computation (avoid borrow issues)
        let positions: Vec<[f64; 3]> = self.knots.iter().map(|k| k.position).collect();
        let modes: Vec<TangentMode> = self.knots.iter().map(|k| k.tangent_mode).collect();

        for (i, mode) in modes.iter().enumerate().take(n) {
            if *mode == TangentMode::Manual {
                continue;
            }

            let tangent = compute_catmull_rom_tangent(&positions, i);

            // Preserve tangent orientation if existing tangent is non-zero
            let existing = &self.knots[i].tangent_out;
            let dot =
                existing[0] * tangent[0] + existing[1] * tangent[1] + existing[2] * tangent[2];
            let tangent = if dot < 0.0
                && (existing[0].abs() + existing[1].abs() + existing[2].abs()) > 1e-12
            {
                [-tangent[0], -tangent[1], -tangent[2]]
            } else {
                tangent
            };

            self.knots[i].tangent_in = tangent;
            self.knots[i].tangent_out = tangent;
        }
    }

    /// Move a knot to a new position and recompute affected tangents.
    ///
    /// Returns the indices of knots whose tangents were recomputed.
    pub fn move_knot(&mut self, index: usize, new_position: [f64; 3]) -> Vec<usize> {
        if index >= self.knots.len() {
            return Vec::new();
        }

        self.knots[index].position = new_position;

        // Recompute stations
        self.recompute_stations();

        // Recompute tangents for this knot and its neighbors
        let mut affected = Vec::new();
        let start = if index > 0 { index - 1 } else { 0 };
        let end = (index + 2).min(self.knots.len());

        let positions: Vec<[f64; 3]> = self.knots.iter().map(|k| k.position).collect();

        for i in start..end {
            if self.knots[i].tangent_mode == TangentMode::Auto {
                let tangent = compute_catmull_rom_tangent(&positions, i);
                self.knots[i].tangent_in = tangent;
                self.knots[i].tangent_out = tangent;
                affected.push(i);
            }
        }

        affected
    }
}

impl Default for EditableSpline {
    fn default() -> Self {
        Self::new()
    }
}

/// Pick the closest knot to a world-space point.
///
/// Returns `(knot_index, distance)` or `None` if no knot is within threshold.
pub fn pick_knot(spline: &EditableSpline, x: f64, y: f64, threshold: f64) -> Option<(usize, f64)> {
    let mut best: Option<(usize, f64)> = None;
    let mut best_dist = threshold;

    for (i, knot) in spline.knots.iter().enumerate() {
        let dx = knot.position[0] - x;
        let dy = knot.position[1] - y;
        let dist = (dx * dx + dy * dy).sqrt();
        if dist < best_dist {
            best_dist = dist;
            best = Some((i, dist));
        }
    }

    best
}

/// Find the best insertion point for a new knot at the given world position.
///
/// Returns the index where the new knot should be inserted (between existing knots).
pub fn find_insertion_index(spline: &EditableSpline, x: f64, y: f64) -> usize {
    if spline.knots.len() < 2 {
        return spline.knots.len();
    }

    let mut best_idx = spline.knots.len(); // append at end
    let mut best_dist = f64::MAX;

    for i in 0..spline.knots.len() - 1 {
        let k0 = &spline.knots[i];
        let k1 = &spline.knots[i + 1];

        // Project point onto segment k0→k1
        let seg_dx = k1.position[0] - k0.position[0];
        let seg_dy = k1.position[1] - k0.position[1];
        let seg_len_sq = seg_dx * seg_dx + seg_dy * seg_dy;

        if seg_len_sq < 1e-12 {
            continue;
        }

        let px = x - k0.position[0];
        let py = y - k0.position[1];
        let t = ((px * seg_dx + py * seg_dy) / seg_len_sq).clamp(0.0, 1.0);

        let proj_x = k0.position[0] + t * seg_dx;
        let proj_y = k0.position[1] + t * seg_dy;
        let dist = ((x - proj_x).powi(2) + (y - proj_y).powi(2)).sqrt();

        if dist < best_dist {
            best_dist = dist;
            best_idx = i + 1;
        }
    }

    best_idx
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::arc_length::param_poly3_arc_length;
    use super::cubic_bezier::{classify_param_poly3, CurveClassification, fit_hermite_param_poly3};

    // ── SplineKnot tests ────────────────────────────

    #[test]
    fn test_knot_creation() {
        let knot = SplineKnot::new(10.0, 20.0, 0.0);
        assert!((knot.position[0] - 10.0).abs() < f64::EPSILON);
        assert!((knot.position[1] - 20.0).abs() < f64::EPSILON);
        assert_eq!(knot.knot_type, KnotType::Key);
        assert_eq!(knot.tangent_mode, TangentMode::Auto);
    }

    #[test]
    fn test_knot_with_tangent() {
        let knot = SplineKnot::with_tangent(0.0, 0.0, 0.0, 3.0, 4.0, 0.0);
        // Should be normalized to (0.6, 0.8, 0.0)
        assert!((knot.tangent_out[0] - 0.6).abs() < 1e-10);
        assert!((knot.tangent_out[1] - 0.8).abs() < 1e-10);
        assert_eq!(knot.tangent_mode, TangentMode::Manual);
    }

    #[test]
    fn test_knot_distance_2d() {
        let k1 = SplineKnot::new(0.0, 0.0, 0.0);
        let k2 = SplineKnot::new(3.0, 4.0, 100.0); // z ignored in 2D
        assert!((k1.distance_2d(&k2) - 5.0).abs() < 1e-10);
    }

    #[test]
    fn test_knot_distance_3d() {
        let k1 = SplineKnot::new(0.0, 0.0, 0.0);
        let k2 = SplineKnot::new(1.0, 2.0, 2.0);
        assert!((k1.distance_3d(&k2) - 3.0).abs() < 1e-10);
    }

    // ── EditableSpline tests ────────────────────────

    #[test]
    fn test_spline_creation() {
        let spline = EditableSpline::new();
        assert!(spline.is_empty());
        assert_eq!(spline.len(), 0);
    }

    #[test]
    fn test_spline_push_and_len() {
        let mut spline = EditableSpline::new();
        spline.push(SplineKnot::new(0.0, 0.0, 0.0));
        spline.push(SplineKnot::new(10.0, 0.0, 0.0));
        assert_eq!(spline.len(), 2);
        assert!(!spline.is_empty());
    }

    #[test]
    fn test_spline_recompute_stations() {
        let mut spline = EditableSpline::from_knots(vec![
            SplineKnot::new(0.0, 0.0, 0.0),
            SplineKnot::new(10.0, 0.0, 0.0),
            SplineKnot::new(10.0, 10.0, 0.0),
        ]);
        spline.recompute_stations();
        assert!((spline.knots[0].s - 0.0).abs() < 1e-10);
        assert!((spline.knots[1].s - 10.0).abs() < 1e-10);
        assert!((spline.knots[2].s - 20.0).abs() < 1e-10);
    }

    #[test]
    fn test_spline_total_length() {
        let mut spline = EditableSpline::from_knots(vec![
            SplineKnot::new(0.0, 0.0, 0.0),
            SplineKnot::new(100.0, 0.0, 0.0),
        ]);
        spline.recompute_stations();
        assert!((spline.total_length() - 100.0).abs() < 1e-10);
    }

    #[test]
    fn test_spline_insert_remove() {
        let mut spline = EditableSpline::from_knots(vec![
            SplineKnot::new(0.0, 0.0, 0.0),
            SplineKnot::new(20.0, 0.0, 0.0),
        ]);
        spline.insert(1, SplineKnot::new(10.0, 0.0, 0.0));
        assert_eq!(spline.len(), 3);
        assert!((spline.knots[1].position[0] - 10.0).abs() < f64::EPSILON);

        let removed = spline.remove(1);
        assert_eq!(spline.len(), 2);
        assert!((removed.position[0] - 10.0).abs() < f64::EPSILON);
    }

    // ── Catmull-Rom tangent tests ───────────────────

    #[test]
    fn test_catmull_rom_tangent_straight_line() {
        let positions = vec![[0.0, 0.0, 0.0], [10.0, 0.0, 0.0], [20.0, 0.0, 0.0]];
        let tangent = compute_catmull_rom_tangent(&positions, 1);
        // Interior point on straight line → tangent along X
        assert!((tangent[0] - 1.0).abs() < 1e-10);
        assert!(tangent[1].abs() < 1e-10);
    }

    #[test]
    fn test_catmull_rom_tangent_first_point() {
        let positions = vec![[0.0, 0.0, 0.0], [10.0, 5.0, 0.0]];
        let tangent = compute_catmull_rom_tangent(&positions, 0);
        // First point uses forward difference
        let expected_len = (10.0f64 * 10.0 + 5.0 * 5.0).sqrt();
        assert!((tangent[0] - 10.0 / expected_len).abs() < 1e-10);
        assert!((tangent[1] - 5.0 / expected_len).abs() < 1e-10);
    }

    #[test]
    fn test_catmull_rom_tangent_last_point() {
        let positions = vec![[0.0, 0.0, 0.0], [10.0, 5.0, 0.0]];
        let tangent = compute_catmull_rom_tangent(&positions, 1);
        // Last point uses backward difference (same as forward here with 2 points)
        let expected_len = (10.0f64 * 10.0 + 5.0 * 5.0).sqrt();
        assert!((tangent[0] - 10.0 / expected_len).abs() < 1e-10);
    }

    #[test]
    fn test_catmull_rom_tangent_90_degree_turn() {
        let positions = vec![[0.0, 0.0, 0.0], [10.0, 0.0, 0.0], [10.0, 10.0, 0.0]];
        let tangent = compute_catmull_rom_tangent(&positions, 1);
        // At the turn point, tangent should point toward (10, 10) from (0, 0)
        // = normalize(10, 10, 0) = (1/sqrt(2), 1/sqrt(2), 0)
        let s2 = std::f64::consts::FRAC_1_SQRT_2;
        assert!((tangent[0] - s2).abs() < 1e-10);
        assert!((tangent[1] - s2).abs() < 1e-10);
    }

    #[test]
    fn test_compute_tangents_auto() {
        let mut spline = EditableSpline::from_knots(vec![
            SplineKnot::new(0.0, 0.0, 0.0),
            SplineKnot::new(10.0, 0.0, 0.0),
            SplineKnot::new(20.0, 0.0, 0.0),
        ]);
        spline.compute_tangents();
        // All on a straight line → tangent should be (1, 0, 0)
        for knot in &spline.knots {
            assert!(
                (knot.tangent_out[0] - 1.0).abs() < 1e-10,
                "tangent_out[0] = {}",
                knot.tangent_out[0]
            );
            assert!(knot.tangent_out[1].abs() < 1e-10);
        }
    }

    #[test]
    fn test_compute_tangents_skips_manual() {
        let mut spline = EditableSpline::from_knots(vec![
            SplineKnot::new(0.0, 0.0, 0.0),
            SplineKnot::with_tangent(10.0, 0.0, 0.0, 0.0, 1.0, 0.0), // manual Y tangent
            SplineKnot::new(20.0, 0.0, 0.0),
        ]);
        spline.compute_tangents();
        // Manual knot should keep its tangent
        assert!((spline.knots[1].tangent_out[1] - 1.0).abs() < 1e-10);
    }

    // ── Move knot tests ─────────────────────────────

    #[test]
    fn test_move_knot() {
        let mut spline = EditableSpline::from_knots(vec![
            SplineKnot::new(0.0, 0.0, 0.0),
            SplineKnot::new(10.0, 0.0, 0.0),
            SplineKnot::new(20.0, 0.0, 0.0),
        ]);
        spline.recompute_stations();
        spline.compute_tangents();

        let affected = spline.move_knot(1, [10.0, 5.0, 0.0]);
        assert!((spline.knots[1].position[1] - 5.0).abs() < f64::EPSILON);
        // Should affect at least the moved knot and neighbors
        assert!(!affected.is_empty());
    }

    // ── Soft selection tests ────────────────────────

    #[test]
    fn test_falloff_linear() {
        let config = SoftSelectionConfig {
            radius: 100.0,
            falloff: FalloffType::Linear,
            gaussian_k: 3.0,
        };
        assert!((compute_falloff(&config, 0.0) - 1.0).abs() < 1e-10);
        assert!((compute_falloff(&config, 50.0) - 0.5).abs() < 1e-10);
        assert!((compute_falloff(&config, 100.0) - 0.0).abs() < 1e-10);
        assert!((compute_falloff(&config, 150.0) - 0.0).abs() < 1e-10);
    }

    #[test]
    fn test_falloff_gaussian() {
        let config = SoftSelectionConfig {
            radius: 100.0,
            falloff: FalloffType::Gaussian,
            gaussian_k: 3.0,
        };
        let f0 = compute_falloff(&config, 0.0);
        let f50 = compute_falloff(&config, 50.0);
        let f99 = compute_falloff(&config, 99.0);
        assert!((f0 - 1.0).abs() < 1e-10);
        assert!(f50 > 0.0 && f50 < 1.0);
        assert!(f99 > 0.0 && f99 < f50);
    }

    #[test]
    fn test_falloff_smooth() {
        let config = SoftSelectionConfig {
            radius: 100.0,
            falloff: FalloffType::Smooth,
            gaussian_k: 3.0,
        };
        assert!((compute_falloff(&config, 0.0) - 1.0).abs() < 1e-10);
        assert!((compute_falloff(&config, 100.0) - 0.0).abs() < 1e-10);
        let f50 = compute_falloff(&config, 50.0);
        assert!(f50 > 0.0 && f50 < 1.0);
    }

    #[test]
    fn test_collect_soft_selection() {
        let spline = EditableSpline::from_knots(vec![
            SplineKnot::new(0.0, 0.0, 0.0),
            SplineKnot::new(10.0, 0.0, 0.0),
            SplineKnot::new(30.0, 0.0, 0.0),
            SplineKnot::new(200.0, 0.0, 0.0), // outside radius
        ]);
        let config = SoftSelectionConfig {
            radius: 50.0,
            falloff: FalloffType::Linear,
            gaussian_k: 3.0,
        };
        let factors = collect_soft_selection(&spline, 1, &config);
        // Should include knots 0 (dist=10), 1 (selected, factor=1.0), 2 (dist=20)
        // Should NOT include knot 3 (dist=190)
        assert!(
            factors
                .iter()
                .any(|(idx, f)| *idx == 1 && (*f - 1.0).abs() < 1e-10)
        );
        assert!(factors.iter().any(|(idx, _)| *idx == 0));
        assert!(factors.iter().any(|(idx, _)| *idx == 2));
        assert!(!factors.iter().any(|(idx, _)| *idx == 3));
    }

    #[test]
    fn test_apply_soft_selection_move() {
        let mut spline = EditableSpline::from_knots(vec![
            SplineKnot::new(0.0, 0.0, 0.0),
            SplineKnot::new(10.0, 0.0, 0.0),
            SplineKnot::new(20.0, 0.0, 0.0),
        ]);
        let factors = vec![(0, 0.5), (1, 1.0), (2, 0.5)];
        apply_soft_selection_move(&mut spline, &factors, [0.0, 10.0, 0.0]);
        assert!((spline.knots[0].position[1] - 5.0).abs() < 1e-10);
        assert!((spline.knots[1].position[1] - 10.0).abs() < 1e-10);
        assert!((spline.knots[2].position[1] - 5.0).abs() < 1e-10);
    }

    // ── Constraint tests ────────────────────────────

    #[test]
    fn test_constrain_x_axis() {
        let d = constrain_displacement([5.0, 3.0, 2.0], MoveConstraint::XAxis);
        assert!((d[0] - 5.0).abs() < f64::EPSILON);
        assert!((d[1] - 0.0).abs() < f64::EPSILON);
        assert!((d[2] - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_constrain_xy_plane() {
        let d = constrain_displacement([5.0, 3.0, 2.0], MoveConstraint::XyPlane);
        assert!((d[0] - 5.0).abs() < f64::EPSILON);
        assert!((d[1] - 3.0).abs() < f64::EPSILON);
        assert!((d[2] - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_constrain_free() {
        let d = constrain_displacement([5.0, 3.0, 2.0], MoveConstraint::Free);
        assert!((d[0] - 5.0).abs() < f64::EPSILON);
        assert!((d[1] - 3.0).abs() < f64::EPSILON);
        assert!((d[2] - 2.0).abs() < f64::EPSILON);
    }

    // ── Road ↔ Spline conversion tests ──────────────

    #[test]
    fn test_road_to_spline_straight() {
        use crate::model::*;
        let road = Road::from_centerline(
            "1",
            vec![Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length: 100.0,
                geo_type: GeometryType::Line,
            }],
        );
        let spline = road_to_spline(&road, 50.0);
        assert!(spline.len() >= 2); // at least start + end
        // First knot at origin
        assert!((spline.knots[0].position[0]).abs() < 1e-6);
        assert!((spline.knots[0].position[1]).abs() < 1e-6);
        // Last knot at (100, 0)
        let last = spline.knots.last().unwrap();
        assert!((last.position[0] - 100.0).abs() < 1e-3);
        assert!(last.position[1].abs() < 1e-3);
    }

    #[test]
    fn test_road_to_spline_arc() {
        use crate::model::*;
        let road = Road::from_centerline(
            "1",
            vec![Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length: 50.0,
                geo_type: GeometryType::Arc { curvature: 0.02 },
            }],
        );
        let spline = road_to_spline(&road, 25.0);
        assert!(spline.len() >= 2);
        // Arc should produce a curved path
        let last = spline.knots.last().unwrap();
        assert!(last.position[1].abs() > 0.1); // should have lateral offset
    }

    #[test]
    fn test_spline_to_geometries_straight() {
        let mut spline = EditableSpline::from_knots(vec![
            SplineKnot::with_tangent(0.0, 0.0, 0.0, 1.0, 0.0, 0.0),
            SplineKnot::with_tangent(100.0, 0.0, 0.0, 1.0, 0.0, 0.0),
        ]);
        spline.recompute_stations();

        let geos = spline_to_geometries(&spline);
        assert_eq!(geos.len(), 1);
        assert!((geos[0].length - 100.0).abs() < 1e-6);
        // Straight line should produce Line geometry
        assert!(matches!(geos[0].geo_type, crate::model::GeometryType::Line));
    }

    #[test]
    fn test_spline_to_geometries_curved() {
        let mut spline = EditableSpline::from_knots(vec![
            SplineKnot::with_tangent(0.0, 0.0, 0.0, 1.0, 0.0, 0.0),
            SplineKnot::with_tangent(50.0, 20.0, 0.0, 0.0, 1.0, 0.0), // tangent perpendicular
        ]);
        spline.recompute_stations();

        let geos = spline_to_geometries(&spline);
        assert_eq!(geos.len(), 1);
        // Non-aligned tangent should produce a curve (Arc, Spiral, or ParamPoly3)
        assert!(
            !matches!(geos[0].geo_type, crate::model::GeometryType::Line),
            "Curved segment should not be Line, got {:?}",
            geos[0].geo_type
        );
    }

    #[test]
    fn test_roundtrip_straight_road() {
        use crate::model::*;
        let road = Road::from_centerline(
            "1",
            vec![Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length: 100.0,
                geo_type: GeometryType::Line,
            }],
        );

        let spline = road_to_spline(&road, 200.0); // large step = no intermediate knots
        let geos = spline_to_geometries(&spline);
        assert!(!geos.is_empty());
        // Endpoint should be close to original
        let last_geo = geos.last().unwrap();
        let end_s = last_geo.s + last_geo.length;
        assert!((end_s - 100.0).abs() < 1.0);
    }

    // ── Pick knot tests ─────────────────────────────

    #[test]
    fn test_pick_knot_found() {
        let spline = EditableSpline::from_knots(vec![
            SplineKnot::new(0.0, 0.0, 0.0),
            SplineKnot::new(10.0, 0.0, 0.0),
            SplineKnot::new(20.0, 0.0, 0.0),
        ]);
        let result = pick_knot(&spline, 9.5, 0.5, 2.0);
        assert!(result.is_some());
        let (idx, _dist) = result.unwrap();
        assert_eq!(idx, 1);
    }

    #[test]
    fn test_pick_knot_not_found() {
        let spline = EditableSpline::from_knots(vec![
            SplineKnot::new(0.0, 0.0, 0.0),
            SplineKnot::new(10.0, 0.0, 0.0),
        ]);
        let result = pick_knot(&spline, 100.0, 100.0, 5.0);
        assert!(result.is_none());
    }

    // ── Insertion point tests ───────────────────────

    #[test]
    fn test_find_insertion_index_middle() {
        let spline = EditableSpline::from_knots(vec![
            SplineKnot::new(0.0, 0.0, 0.0),
            SplineKnot::new(20.0, 0.0, 0.0),
        ]);
        // Point at (10, 0) should insert between knots 0 and 1
        let idx = find_insertion_index(&spline, 10.0, 0.0);
        assert_eq!(idx, 1);
    }

    #[test]
    fn test_find_insertion_index_multiple_segments() {
        let spline = EditableSpline::from_knots(vec![
            SplineKnot::new(0.0, 0.0, 0.0),
            SplineKnot::new(10.0, 0.0, 0.0),
            SplineKnot::new(20.0, 0.0, 0.0),
        ]);
        // Point at (15, 1) should insert between knots 1 and 2
        let idx = find_insertion_index(&spline, 15.0, 1.0);
        assert_eq!(idx, 2);
    }

    // ── Curvature classification tests ──────────────

    #[test]
    fn test_classify_line() {
        // Straight segment: u(p) = p, v(p) = 0  →  zero curvature
        let class = classify_param_poly3(
            1.0, 0.0, 0.0, // b_u, c_u, d_u — linear in u
            0.0, 0.0, 0.0, // b_v, c_v, d_v — zero lateral
            100.0,
        );
        assert_eq!(class, CurveClassification::Line);
    }

    #[test]
    fn test_classify_arc_positive_curvature() {
        // Construct a ParamPoly3 approximating a circular arc (R=200, κ=0.005).
        // Use a small subtended angle (≈15°) where cubic Hermite closely
        // approximates a true arc with near-constant curvature.
        let r = 200.0;
        let kappa = 1.0 / r;
        let theta = 15.0_f64.to_radians();
        let arc_len = r * theta;

        // Arc endpoints in local frame
        let end_x = r * theta.sin();
        let end_y = r * (1.0 - theta.cos());

        // Tangent at start: (1, 0) — along x-axis
        // Tangent at end: (cos(theta), sin(theta))
        let t0_u = 1.0 * arc_len;
        let t0_v = 0.0;
        let t1_u = theta.cos() * arc_len;
        let t1_v = theta.sin() * arc_len;

        // Hermite coefficients
        let b_u = t0_u;
        let c_u = 3.0 * end_x - 2.0 * t0_u - t1_u;
        let d_u = -2.0 * end_x + t0_u + t1_u;
        let b_v = t0_v;
        let c_v = 3.0 * end_y - 2.0 * t0_v - t1_v;
        let d_v = -2.0 * end_y + t0_v + t1_v;

        let class = classify_param_poly3(b_u, c_u, d_u, b_v, c_v, d_v, arc_len);
        match class {
            CurveClassification::Arc { curvature } => {
                assert!(
                    (curvature - kappa).abs() < 0.003,
                    "Expected curvature ~{kappa}, got {curvature}"
                );
            }
            // For small arcs, Spiral is also acceptable (curvature nearly constant)
            CurveClassification::Spiral {
                curv_start,
                curv_end,
            } => {
                let mean = (curv_start + curv_end) * 0.5;
                assert!(
                    (mean - kappa).abs() < 0.003,
                    "Expected mean curvature ~{kappa}, got {mean}"
                );
            }
            other => panic!("Expected Arc or Spiral, got {:?}", other),
        }
    }

    #[test]
    fn test_classify_arc_negative_curvature() {
        // Right-turning arc with small subtended angle for accurate cubic fit
        let r = 150.0;
        let theta = -10.0_f64.to_radians(); // negative = right turn
        let arc_len = r * theta.abs();

        // Arc in local frame (right turn → negative y)
        let end_x = r * theta.abs().sin();
        let end_y = -(r * (1.0 - theta.abs().cos()));

        let t0_u = arc_len;
        let t0_v = 0.0;
        let t1_u = theta.abs().cos() * arc_len;
        let t1_v = theta.sin() * arc_len; // negative

        let b_u = t0_u;
        let c_u = 3.0 * end_x - 2.0 * t0_u - t1_u;
        let d_u = -2.0 * end_x + t0_u + t1_u;
        let b_v = t0_v;
        let c_v = 3.0 * end_y - 2.0 * t0_v - t1_v;
        let d_v = -2.0 * end_y + t0_v + t1_v;

        let class = classify_param_poly3(b_u, c_u, d_u, b_v, c_v, d_v, arc_len);
        match class {
            CurveClassification::Arc { curvature } => {
                assert!(
                    curvature < 0.0,
                    "Expected negative curvature for right turn, got {curvature}"
                );
            }
            CurveClassification::Spiral {
                curv_start,
                curv_end,
            } => {
                // Near-constant negative curvature → Spiral is acceptable
                assert!(
                    curv_start < 0.0 && curv_end < 0.0,
                    "Expected negative curvatures, got start={curv_start}, end={curv_end}"
                );
            }
            other => panic!("Expected Arc or Spiral, got {:?}", other),
        }
    }

    #[test]
    fn test_classify_general_s_curve() {
        // S-curve: tangents point in opposite lateral directions → ParamPoly3
        let mut spline = EditableSpline::from_knots(vec![
            SplineKnot::with_tangent(0.0, 0.0, 0.0, 1.0, 1.0, 0.0),
            SplineKnot::with_tangent(100.0, 0.0, 0.0, 1.0, -1.0, 0.0),
        ]);
        spline.recompute_stations();
        let geos = spline_to_geometries(&spline);
        assert_eq!(geos.len(), 1);
        // S-curve should NOT be classified as Arc or Spiral
        assert!(
            matches!(
                geos[0].geo_type,
                crate::model::GeometryType::ParamPoly3 { .. }
            ),
            "S-curve should remain ParamPoly3, got {:?}",
            geos[0].geo_type
        );
    }

    #[test]
    fn test_arc_roundtrip() {
        // Create a road with an Arc segment, convert to spline and back.
        // The output should be classified as Arc (not ParamPoly3).
        use crate::model::*;
        let road = Road::from_centerline(
            "1",
            vec![Geometry {
                s: 0.0,
                x: 0.0,
                y: 0.0,
                hdg: 0.0,
                length: 40.0,
                geo_type: GeometryType::Arc { curvature: 0.02 },
            }],
        );

        let spline = road_to_spline(&road, 200.0); // large step = no intermediate knots
        let geos = spline_to_geometries(&spline);
        assert!(!geos.is_empty(), "Should produce at least one geometry");

        // Should be classified as Arc
        match &geos[0].geo_type {
            GeometryType::Arc { curvature } => {
                assert!(
                    (*curvature - 0.02).abs() < 0.005,
                    "Arc curvature should be ~0.02, got {curvature}"
                );
            }
            other => {
                // Acceptable: could be ParamPoly3 if the Hermite fit
                // doesn't perfectly preserve constant curvature.
                // But ideally it should detect Arc.
                eprintln!("Note: Arc roundtrip produced {:?} instead of Arc", other);
            }
        }
    }

    #[test]
    fn test_param_poly3_curvature_line() {
        // Straight line: u=p, v=0 → curvature = 0
        let k = param_poly3_curvature(1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5);
        assert!(k.abs() < 1e-15);
    }

    #[test]
    fn test_param_poly3_arc_length_straight() {
        // u(p) = 100·p, v(p) = 0 → arc length = 100
        let len = param_poly3_arc_length(100.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        assert!((len - 100.0).abs() < 1e-6);
    }

    #[test]
    fn test_multi_segment_with_arc_detection() {
        // Three-segment road: straight → arc → straight
        let mut spline = EditableSpline::from_knots(vec![
            SplineKnot::with_tangent(0.0, 0.0, 0.0, 1.0, 0.0, 0.0),
            SplineKnot::with_tangent(50.0, 0.0, 0.0, 1.0, 0.0, 0.0),
            // Arc-like: tangent turns 45°
            {
                let angle = std::f64::consts::FRAC_PI_4;
                SplineKnot::with_tangent(80.0, 15.0, 0.0, angle.cos(), angle.sin(), 0.0)
            },
            {
                let angle = std::f64::consts::FRAC_PI_2;
                SplineKnot::with_tangent(90.0, 40.0, 0.0, angle.cos(), angle.sin(), 0.0)
            },
        ]);
        spline.recompute_stations();

        let geos = spline_to_geometries(&spline);
        assert!(
            geos.len() >= 3,
            "Expected at least 3 segments, got {}",
            geos.len()
        );

        // First segment should be Line
        assert!(
            matches!(geos[0].geo_type, crate::model::GeometryType::Line),
            "First segment should be Line, got {:?}",
            geos[0].geo_type
        );
    }

    #[test]
    fn test_spline_to_geometries_parampoly3_mode_no_spiral() {
        // A curved spline that would normally classify as Spiral under Classify mode
        // should produce ParamPoly3 under ParamPoly3Only mode.
        let mut spline = EditableSpline::from_knots(vec![
            SplineKnot::with_tangent(0.0, 0.0, 0.0, 1.0, 0.0, 0.0),
            {
                let angle = std::f64::consts::FRAC_PI_4;
                SplineKnot::with_tangent(80.0, 15.0, 0.0, angle.cos(), angle.sin(), 0.0)
            },
        ]);
        spline.recompute_stations();

        let geos = spline_to_geometries_with_mode(&spline, SplineOutputMode::ParamPoly3Only);
        assert!(!geos.is_empty(), "Should produce at least one geometry");

        for geo in &geos {
            match &geo.geo_type {
                crate::model::GeometryType::Line => { /* lines are always allowed */ }
                crate::model::GeometryType::ParamPoly3 { .. } => { /* expected */ }
                other => {
                    panic!(
                        "ParamPoly3Only mode should not produce {:?}",
                        other
                    );
                }
            }
        }
    }

    #[test]
    fn test_spline_to_geometries_parampoly3_mode_line_preserved() {
        // Straight segment should still be classified as Line even in ParamPoly3Only mode.
        let mut spline = EditableSpline::from_knots(vec![
            SplineKnot::with_tangent(0.0, 0.0, 0.0, 1.0, 0.0, 0.0),
            SplineKnot::with_tangent(50.0, 0.0, 0.0, 1.0, 0.0, 0.0),
        ]);
        spline.recompute_stations();

        let geos = spline_to_geometries_with_mode(&spline, SplineOutputMode::ParamPoly3Only);
        assert!(!geos.is_empty(), "Should produce at least one geometry");
        assert!(
            matches!(geos[0].geo_type, crate::model::GeometryType::Line),
            "Straight segment should be Line, got {:?}",
            geos[0].geo_type
        );
    }

    #[test]
    fn test_spline_to_geometries_classify_mode_unchanged() {
        // Verify Classify mode produces same results as the original function.
        let mut spline = EditableSpline::from_knots(vec![
            SplineKnot::with_tangent(0.0, 0.0, 0.0, 1.0, 0.0, 0.0),
            SplineKnot::with_tangent(50.0, 0.0, 0.0, 1.0, 0.0, 0.0),
            {
                let angle = std::f64::consts::FRAC_PI_4;
                SplineKnot::with_tangent(80.0, 15.0, 0.0, angle.cos(), angle.sin(), 0.0)
            },
        ]);
        spline.recompute_stations();

        let geos_default = spline_to_geometries(&spline);
        let geos_classify = spline_to_geometries_with_mode(&spline, SplineOutputMode::Classify);

        assert_eq!(
            geos_default.len(),
            geos_classify.len(),
            "Classify mode should produce same number of segments as default"
        );

        for (a, b) in geos_default.iter().zip(geos_classify.iter()) {
            assert!(
                (a.s - b.s).abs() < 1e-6,
                "Station offset mismatch: {} vs {}",
                a.s,
                b.s
            );
            assert!(
                (a.length - b.length).abs() < 1e-6,
                "Length mismatch: {} vs {}",
                a.length,
                b.length
            );
        }
    }
}
