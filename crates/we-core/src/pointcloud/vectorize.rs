//! Convert candidate polylines into OpenDRIVE roads.
//!
//! Reuses the existing spline machinery: a polyline becomes an
//! [`EditableSpline`], which is converted to plan-view geometry segments via
//! [`spline_to_geometries`], and finally wrapped in a [`Road`] with a default
//! driving lane on each side. Optionally, elevations are snapped to a ground
//! [`Heightmap`] so traced roads follow the terrain.
//!
//! All coordinates are in the same local frame as the source point cloud /
//! heightmap; the caller is responsible for any origin offset when integrating
//! into a world-space project.

use serde::{Deserialize, Serialize};

use super::heightmap::Heightmap;
use crate::model::Road;
use crate::spline::{EditableSpline, SplineKnot, spline_to_geometries};

/// Options controlling polyline → road conversion.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct VectorizeConfig {
    /// Lane width (meters) applied to both driving lanes.
    pub lane_width: f64,
}

impl Default for VectorizeConfig {
    fn default() -> Self {
        Self { lane_width: 3.5 }
    }
}

/// Convert a single polyline into a [`Road`].
///
/// Returns `None` if the polyline has fewer than two distinct points or the
/// resulting plan view is empty. When `heightmap` is provided, each knot's `z`
/// is replaced by the sampled ground elevation (falling back to the original
/// `z` outside the grid).
pub fn polyline_to_road(
    id: impl Into<String>,
    polyline: &[[f64; 3]],
    config: &VectorizeConfig,
    heightmap: Option<&Heightmap>,
) -> Option<Road> {
    if polyline.len() < 2 {
        return None;
    }

    let mut knots = Vec::with_capacity(polyline.len());
    for p in polyline {
        let z = match heightmap {
            Some(h) => h.sample(p[0], p[1]).map(|s| s as f64).unwrap_or(p[2]),
            None => p[2],
        };
        knots.push(SplineKnot::new(p[0], p[1], z));
    }

    let spline = EditableSpline::from_knots(knots.clone());
    let geometries = spline_to_geometries(&spline);
    if geometries.is_empty() {
        return None;
    }

    let total_length: f64 = geometries.iter().map(|g| g.length).sum();
    let mut road = Road::from_centerline_with_width(id, geometries, config.lane_width);
    road.elevation_profile = build_elevation_profile(&knots, total_length);
    Some(road)
}

/// Build a piecewise-linear elevation profile from knot `z` values.
///
/// Stations are accumulated from XY chord lengths and rescaled so the last
/// station matches the road's geometric `total_length`.
fn build_elevation_profile(
    knots: &[SplineKnot],
    total_length: f64,
) -> Vec<crate::model::Elevation> {
    use crate::model::Elevation;

    if knots.len() < 2 {
        let a = knots.first().map(|k| k.position[2]).unwrap_or(0.0);
        return vec![Elevation {
            s: 0.0,
            a,
            b: 0.0,
            c: 0.0,
            d: 0.0,
        }];
    }

    // Cumulative XY chord length per knot.
    let mut chord = vec![0.0f64; knots.len()];
    for i in 1..knots.len() {
        let dx = knots[i].position[0] - knots[i - 1].position[0];
        let dy = knots[i].position[1] - knots[i - 1].position[1];
        chord[i] = chord[i - 1] + (dx * dx + dy * dy).sqrt();
    }
    let chord_total = *chord.last().unwrap_or(&0.0);
    let scale = if chord_total > 1e-9 {
        total_length / chord_total
    } else {
        1.0
    };

    let mut profile = Vec::with_capacity(knots.len() - 1);
    for i in 0..knots.len() - 1 {
        let s0 = chord[i] * scale;
        let s1 = chord[i + 1] * scale;
        let ds = (s1 - s0).max(1e-9);
        let z0 = knots[i].position[2];
        let z1 = knots[i + 1].position[2];
        profile.push(Elevation {
            s: s0,
            a: z0,
            b: (z1 - z0) / ds,
            c: 0.0,
            d: 0.0,
        });
    }
    profile
}

/// Convert several polylines into roads, assigning ids `"<prefix>{n}"`.
pub fn polylines_to_roads(
    prefix: &str,
    polylines: &[Vec<[f64; 3]>],
    config: &VectorizeConfig,
    heightmap: Option<&Heightmap>,
) -> Vec<Road> {
    polylines
        .iter()
        .enumerate()
        .filter_map(|(i, line)| polyline_to_road(format!("{prefix}{i}"), line, config, heightmap))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_polyline_to_road_straight() {
        let line = vec![[0.0, 0.0, 0.0], [10.0, 0.0, 0.0], [20.0, 0.0, 0.0]];
        let road = polyline_to_road("r0", &line, &VectorizeConfig::default(), None).unwrap();
        assert!(!road.plan_view.is_empty());
        assert!(road.length > 19.0);
        // Default road has one left and one right driving lane.
        assert_eq!(road.lane_sections.len(), 1);
    }

    #[test]
    fn test_polyline_too_short() {
        let line = vec![[0.0, 0.0, 0.0]];
        assert!(polyline_to_road("r", &line, &VectorizeConfig::default(), None).is_none());
    }

    #[test]
    fn test_elevation_snapped_from_heightmap() {
        let mut h = Heightmap::new([0.0, 0.0], 1.0, 21, 3);
        for iy in 0..3 {
            for ix in 0..21 {
                h.set_cell(ix, iy, 5.0);
            }
        }
        let line = vec![[0.0, 1.0, 0.0], [10.0, 1.0, 0.0], [20.0, 1.0, 0.0]];
        let road = polyline_to_road("r0", &line, &VectorizeConfig::default(), Some(&h)).unwrap();
        // Elevation profile should reflect the ~5.0 ground height.
        let z = crate::geometry::eval::evaluate_elevation(&road.elevation_profile, 0.0);
        assert!((z - 5.0).abs() < 1e-3, "expected snapped z≈5, got {z}");
    }

    #[test]
    fn test_polylines_to_roads_ids() {
        let lines = vec![
            vec![[0.0, 0.0, 0.0], [10.0, 0.0, 0.0]],
            vec![[0.0, 5.0, 0.0], [10.0, 5.0, 0.0]],
        ];
        let roads = polylines_to_roads("pc_", &lines, &VectorizeConfig::default(), None);
        assert_eq!(roads.len(), 2);
        assert_eq!(roads[0].id, "pc_0");
        assert_eq!(roads[1].id, "pc_1");
    }
}
