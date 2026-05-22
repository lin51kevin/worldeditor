//! Bidirectional conversion between OpenDRIVE road geometry and editable splines.
//!
//! - `road_to_spline`: Road.plan_view → EditableSpline
//! - `spline_to_geometries`: EditableSpline → Vec<Geometry>

use super::arc_length::param_poly3_arc_length;
use super::cubic_bezier::{CurveClassification, classify_param_poly3, fit_hermite_param_poly3};
use super::{EditableSpline, KnotType, SplineKnot, SplineOutputMode, TangentMode};

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
/// Uses [`SplineOutputMode::Classify`] by default, which produces optimal
/// geometry types (Line / Arc / Spiral / ParamPoly3).
///
/// See [`spline_to_geometries_with_mode`] for explicit mode control.
pub fn spline_to_geometries(spline: &EditableSpline) -> Vec<crate::model::Geometry> {
    spline_to_geometries_with_mode(spline, SplineOutputMode::Classify)
}

/// Convert an EditableSpline back to OpenDRIVE geometry segments (plan_view)
/// with explicit output mode control.
///
/// - [`SplineOutputMode::Classify`]: Generates optimal geometry types between
///   consecutive key knots (Line / Arc / Spiral / ParamPoly3) by analyzing
///   curvature profiles. Produces standard road design patterns.
///
/// - [`SplineOutputMode::ParamPoly3Only`]: Emits ParamPoly3 directly from
///   Hermite fitting without curvature classification. Straight segments are
///   still detected as Line.
pub fn spline_to_geometries_with_mode(
    spline: &EditableSpline,
    mode: SplineOutputMode,
) -> Vec<crate::model::Geometry> {
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
            // Curved — fit Hermite → ParamPoly3 first, then optionally classify
            let (a_u, b_u, c_u, d_u, a_v, b_v, c_v, d_v) =
                fit_hermite_param_poly3(k0, k1, chord_len);

            // Compute true arc length for this segment
            let arc_len = param_poly3_arc_length(b_u, c_u, d_u, b_v, c_v, d_v);

            let geo_type = match mode {
                SplineOutputMode::Classify => {
                    // Classify curvature profile to pick optimal geometry type
                    let classification =
                        classify_param_poly3(b_u, c_u, d_u, b_v, c_v, d_v, arc_len);

                    match classification {
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
                    }
                }
                SplineOutputMode::ParamPoly3Only => {
                    // Emit ParamPoly3 directly — no curvature classification
                    GeometryType::ParamPoly3 {
                        a_u,
                        b_u,
                        c_u,
                        d_u,
                        a_v,
                        b_v,
                        c_v,
                        d_v,
                        p_range: ParamPoly3Range::Normalized,
                    }
                }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Geometry, GeometryType};
    use crate::spline::{EditableSpline, KnotType, SplineKnot};

    fn line_geometry(x: f64, y: f64, hdg: f64, length: f64) -> Geometry {
        Geometry {
            s: 0.0,
            x,
            y,
            hdg,
            length,
            geo_type: GeometryType::Line,
        }
    }

    fn straight_road(length: f64) -> crate::model::Road {
        crate::model::Road::from_centerline("r1", vec![line_geometry(0.0, 0.0, 0.0, length)])
    }

    // ── road_to_spline ────────────────────────────────────────────────────────

    #[test]
    fn test_road_to_spline_empty_returns_empty() {
        let road = crate::model::Road::new("r0", 0.0);
        let spline = road_to_spline(&road, 1.0);
        assert!(spline.knots.is_empty());
    }

    #[test]
    fn test_road_to_spline_single_line_produces_two_anchors() {
        let road = straight_road(10.0);
        let spline = road_to_spline(&road, 20.0); // sample_step > length → no intermediates
        assert!(
            spline.knots.len() >= 2,
            "expected ≥2 knots, got {}",
            spline.knots.len()
        );
    }

    #[test]
    fn test_road_to_spline_start_matches_road_origin() {
        let road = straight_road(10.0);
        let spline = road_to_spline(&road, 5.0);
        let first = &spline.knots[0];
        assert!(
            first.position[0].abs() < 1e-6,
            "start x = {}",
            first.position[0]
        );
        assert!(
            first.position[1].abs() < 1e-6,
            "start y = {}",
            first.position[1]
        );
    }

    #[test]
    fn test_road_to_spline_end_matches_road_end() {
        let road = straight_road(10.0);
        let spline = road_to_spline(&road, 5.0);
        let last = spline.knots.last().unwrap();
        assert!(
            (last.position[0] - 10.0).abs() < 1e-3,
            "end x = {}",
            last.position[0]
        );
    }

    #[test]
    fn test_road_to_spline_long_segment_has_intermediates() {
        // length=100, sample_step=5 → n = 20 intermediate points
        let road = straight_road(100.0);
        let spline = road_to_spline(&road, 5.0);
        let n_intermediate = spline
            .knots
            .iter()
            .filter(|k| k.knot_type == KnotType::Intermediate)
            .count();
        assert!(n_intermediate > 0, "long segment should have intermediates");
    }

    #[test]
    fn test_road_to_spline_short_segment_no_intermediates() {
        // length=10, sample_step=15 → length < 2*step → no intermediates
        let road = straight_road(10.0);
        let spline = road_to_spline(&road, 15.0);
        let n_intermediate = spline
            .knots
            .iter()
            .filter(|k| k.knot_type == KnotType::Intermediate)
            .count();
        assert_eq!(n_intermediate, 0);
    }

    // ── spline_to_geometries ──────────────────────────────────────────────────

    #[test]
    fn test_spline_to_geometries_empty_spline_returns_empty() {
        let spline = EditableSpline::new();
        assert!(spline_to_geometries(&spline).is_empty());
    }

    #[test]
    fn test_spline_to_geometries_single_knot_returns_empty() {
        let mut spline = EditableSpline::new();
        spline.knots.push(SplineKnot::new(0.0, 0.0, 0.0));
        assert!(spline_to_geometries(&spline).is_empty());
    }

    #[test]
    fn test_spline_to_geometries_aligned_tangents_produce_line() {
        // Two knots pointing east → line geometry
        let road = straight_road(10.0);
        let spline = road_to_spline(&road, 20.0); // no intermediates
        let geos = spline_to_geometries(&spline);
        assert!(!geos.is_empty(), "expected at least one geometry");
        let has_line = geos
            .iter()
            .any(|g| matches!(g.geo_type, GeometryType::Line));
        assert!(
            has_line,
            "aligned tangents should produce Line, got {:?}",
            geos
        );
    }

    #[test]
    fn test_spline_to_geometries_lengths_are_positive() {
        let road = straight_road(20.0);
        let spline = road_to_spline(&road, 8.0);
        let geos = spline_to_geometries(&spline);
        for g in &geos {
            assert!(
                g.length > 0.0,
                "geometry length must be positive, got {}",
                g.length
            );
        }
    }

    #[test]
    fn test_spline_to_geometries_parampoly3_mode_produces_output() {
        // A curved spline with ParamPoly3Only mode should still produce geometries
        let road = straight_road(10.0);
        let spline = road_to_spline(&road, 20.0);
        let geos = spline_to_geometries_with_mode(&spline, SplineOutputMode::ParamPoly3Only);
        assert!(
            !geos.is_empty(),
            "ParamPoly3Only should produce geometries for 2-knot spline"
        );
    }
}
