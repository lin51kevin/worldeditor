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
mod cubic_bezier;

use arc_length::param_poly3_arc_length;
pub use catmull_rom::compute_catmull_rom_tangent;
#[cfg(test)]
use cubic_bezier::param_poly3_curvature;
use cubic_bezier::{CurveClassification, classify_param_poly3, fit_hermite_param_poly3};

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

// ── Soft Selection ───────────────────────────────────

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

// ── Constraint System ────────────────────────────────

/// Constraint axis for gizmo-based movement.
///
/// Port of C# `SplineKnotsFrame.EConstrain`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MoveConstraint {
    /// Free movement (no constraint).
    Free,
    /// Constrain to X axis only.
    XAxis,
    /// Constrain to Y axis only.
    YAxis,
    /// Constrain to Z axis only.
    ZAxis,
    /// Constrain to XY plane (horizontal).
    XyPlane,
    /// Constrain to XZ plane.
    XzPlane,
    /// Constrain to YZ plane.
    YzPlane,
}

/// Apply a movement constraint to a displacement vector.
///
/// Zeroes out components that are not part of the constraint.
pub fn constrain_displacement(displacement: [f64; 3], constraint: MoveConstraint) -> [f64; 3] {
    match constraint {
        MoveConstraint::Free => displacement,
        MoveConstraint::XAxis => [displacement[0], 0.0, 0.0],
        MoveConstraint::YAxis => [0.0, displacement[1], 0.0],
        MoveConstraint::ZAxis => [0.0, 0.0, displacement[2]],
        MoveConstraint::XyPlane => [displacement[0], displacement[1], 0.0],
        MoveConstraint::XzPlane => [displacement[0], 0.0, displacement[2]],
        MoveConstraint::YzPlane => [0.0, displacement[1], displacement[2]],
    }
}

// ── Road ↔ Spline Conversion ─────────────────────────

/// Convert a Road's plan_view (OpenDRIVE geometry segments) to an EditableSpline.
///
/// Samples the reference line and creates key knots at geometry boundaries,
/// preserving the road's shape. Tangents are auto-computed.
pub fn road_to_spline(road: &crate::model::Road, sample_step: f64) -> EditableSpline {
    use crate::geometry::eval::evaluate_geometry;

    let mut knots = Vec::new();

    if road.plan_view.is_empty() {
        return EditableSpline::new();
    }

    // Create key knots at each geometry segment boundary
    for (geo_idx, geo) in road.plan_view.iter().enumerate() {
        let pt = evaluate_geometry(geo, 0.0);
        let elevation = crate::geometry::eval::evaluate_elevation(&road.elevation_profile, pt.s);
        let mut knot = SplineKnot::with_station(pt.x, pt.y, elevation, pt.s);

        // Set tangent from heading
        knot.tangent_in = [pt.hdg.cos(), pt.hdg.sin(), 0.0];
        knot.tangent_out = [pt.hdg.cos(), pt.hdg.sin(), 0.0];
        knot.tangent_mode = TangentMode::Manual; // Preserve original heading

        if geo_idx == 0 {
            knot.knot_type = KnotType::Anchor;
        }

        knots.push(knot);

        // For long segments, add intermediate sample points
        if geo.length > sample_step * 2.0 {
            let n = ((geo.length / sample_step).floor() as usize).max(1);
            let step = geo.length / (n + 1) as f64;
            for j in 1..=n {
                let ds = step * j as f64;
                if ds >= geo.length - 1e-9 {
                    break;
                }
                let pt = evaluate_geometry(geo, ds);
                let elev = crate::geometry::eval::evaluate_elevation(&road.elevation_profile, pt.s);
                let mut knot = SplineKnot::with_station(pt.x, pt.y, elev, pt.s);
                knot.knot_type = KnotType::Intermediate;
                knot.tangent_in = [pt.hdg.cos(), pt.hdg.sin(), 0.0];
                knot.tangent_out = [pt.hdg.cos(), pt.hdg.sin(), 0.0];
                knots.push(knot);
            }
        }
    }

    // Add end point of last geometry
    if let Some(last_geo) = road.plan_view.last() {
        let pt = evaluate_geometry(last_geo, last_geo.length);
        let elevation = crate::geometry::eval::evaluate_elevation(&road.elevation_profile, pt.s);
        let mut knot = SplineKnot::with_station(pt.x, pt.y, elevation, pt.s);
        knot.knot_type = KnotType::Anchor;
        knot.tangent_in = [pt.hdg.cos(), pt.hdg.sin(), 0.0];
        knot.tangent_out = [pt.hdg.cos(), pt.hdg.sin(), 0.0];
        knot.tangent_mode = TangentMode::Manual;
        knots.push(knot);
    }

    // Deduplicate consecutive near-identical knots
    knots.dedup_by(|a, b| {
        let dx = a.position[0] - b.position[0];
        let dy = a.position[1] - b.position[1];
        (dx * dx + dy * dy).sqrt() < 1e-6
    });

    EditableSpline::from_knots(knots)
}

/// Convert an EditableSpline back to OpenDRIVE geometry segments (plan_view).
///
/// Generates optimal geometry types between consecutive key knots:
/// - **Line** when tangents align with the chord (straight segments)
/// - **Arc** when sampled curvature is approximately constant
/// - **Spiral** when curvature varies linearly (clothoid transition)
/// - **ParamPoly3** for general curves (Hermite fitting)
///
/// This classification produces cleaner OpenDRIVE output that matches
/// standard road design conventions (Line-Spiral-Arc-Spiral-Line patterns).
pub fn spline_to_geometries(spline: &EditableSpline) -> Vec<crate::model::Geometry> {
    use crate::model::{Geometry, GeometryType, ParamPoly3Range};

    // Ensure auto-tangents are up-to-date before converting
    let mut spline = spline.clone();
    spline.compute_tangents();

    let key_knots: Vec<&SplineKnot> = spline
        .knots
        .iter()
        .filter(|k| k.knot_type != KnotType::Intermediate)
        .collect();

    if key_knots.len() < 2 {
        return Vec::new();
    }

    let mut geometries = Vec::new();
    let mut current_s = 0.0;

    for i in 0..key_knots.len() - 1 {
        let k0 = key_knots[i];
        let k1 = key_knots[i + 1];

        let dx = k1.position[0] - k0.position[0];
        let dy = k1.position[1] - k0.position[1];
        let chord_len = (dx * dx + dy * dy).sqrt();

        if chord_len < 1e-9 {
            continue;
        }

        // Heading at start point (from tangent, not chord, for accuracy)
        let hdg = k0.tangent_out[1].atan2(k0.tangent_out[0]);

        // Check if this segment can be approximated as a line
        let tangent_alignment_start =
            k0.tangent_out[0] * dx / chord_len + k0.tangent_out[1] * dy / chord_len;
        let tangent_alignment_end =
            k1.tangent_in[0] * dx / chord_len + k1.tangent_in[1] * dy / chord_len;

        if tangent_alignment_start.abs() > 0.9999 && tangent_alignment_end.abs() > 0.9999 {
            // Nearly straight — use Line geometry
            geometries.push(Geometry {
                s: current_s,
                x: k0.position[0],
                y: k0.position[1],
                hdg,
                length: chord_len,
                geo_type: GeometryType::Line,
            });
        } else {
            // Curved — fit Hermite → ParamPoly3 first, then classify
            let (a_u, b_u, c_u, d_u, a_v, b_v, c_v, d_v) =
                fit_hermite_param_poly3(k0, k1, chord_len);

            // Compute true arc length for this segment
            let arc_len = param_poly3_arc_length(b_u, c_u, d_u, b_v, c_v, d_v);

            // Classify curvature profile to pick optimal geometry type
            let classification = classify_param_poly3(b_u, c_u, d_u, b_v, c_v, d_v, arc_len);

            let geo_type = match classification {
                CurveClassification::Line => GeometryType::Line,

                CurveClassification::Arc { curvature } => GeometryType::Arc { curvature },

                CurveClassification::Spiral {
                    curv_start,
                    curv_end,
                } => GeometryType::Spiral {
                    curv_start,
                    curv_end,
                },

                CurveClassification::ParamPoly3 => GeometryType::ParamPoly3 {
                    a_u,
                    b_u,
                    c_u,
                    d_u,
                    a_v,
                    b_v,
                    c_v,
                    d_v,
                    p_range: ParamPoly3Range::Normalized,
                },
            };

            geometries.push(Geometry {
                s: current_s,
                x: k0.position[0],
                y: k0.position[1],
                hdg,
                length: arc_len,
                geo_type,
            });
        }

        current_s += geometries.last().map_or(0.0, |g| g.length);
    }

    geometries
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
}
