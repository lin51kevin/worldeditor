//! Tests for signal/crosswalk/polygon mesh emission.

use super::*;
use we_core::geometry::eval::RefLinePoint;
use we_core::model::{Elevation, Point3D};

/// Helper: straight road along +x with ref_pts at s=0..10 (1m steps).
fn straight_road_pts() -> Vec<RefLinePoint> {
    (0..=10)
        .map(|i| RefLinePoint {
            s: i as f64,
            x: i as f64,
            y: 0.0,
            hdg: 0.0,
        })
        .collect()
}

fn offset_pt_flat(rp: &RefLinePoint, t: f64, _: f64) -> (f64, f64, f64) {
    // For a straight road along +x, lateral t is in +y direction.
    (rp.x, rp.y + t, 0.0)
}

/// Verify that stripes are generated even when obj_s + alpha > road length.
///
/// The world-space approach uses a single ref_pt lookup so abs_s overflow
/// (degenerate zero-area triangles) cannot occur.
#[test]
fn test_crosswalk_stripes_past_road_end_produces_output() {
    // Road ref_pts only go to s=10. Put crosswalk at s=9 with alpha=[1,5] → abs_s=[10,14].
    let ref_pts = straight_road_pts();
    // Corners: hdg=0 (no rotation), so alpha=u, beta=v.
    // alpha range [1,5] (along road), beta range [-1,1] (lateral) → 4m × 2m crosswalk.
    let corners = vec![
        Point3D {
            x: 1.0,
            y: -1.0,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: 5.0,
            y: -1.0,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: 5.0,
            y: 1.0,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: 1.0,
            y: 1.0,
            z: 0.0,
            id: None,
        },
    ];
    let elevations: Vec<Elevation> = vec![];
    let mut out = Vec::new();
    let offset_fn = &offset_pt_flat;

    emit_crosswalk_stripes(
        &corners,
        &ref_pts[9],
        &elevations,
        9.0,
        0.0,
        0.0,
        0.0,
        offset_fn,
        0.0,
        0.0,
        0.0,
        4.0,
        2.0,
        &mut out,
    );

    // Must produce at least one valid (non-degenerate) stripe quad = 6 vertices × 7 floats.
    assert!(
        out.len() >= 42,
        "Expected at least one stripe but got {} floats",
        out.len()
    );

    // Lateral-sweep: road along +x (theta=0), sweep along +y.
    // Corners in world: x ∈ [10,14], y ∈ [-1,1]. Bars extend in x, spaced in y.
    // Verify stripe vertices are within the crosswalk world-space bounds.
    let all_x: Vec<f32> = out.chunks(7).map(|v| v[0]).collect();
    let all_y: Vec<f32> = out.chunks(7).map(|v| v[1]).collect();
    assert!(
        all_x.iter().all(|&x| (9.5..=14.5).contains(&x)),
        "Stripe x coords should be in [10,14] range, got {:?}",
        all_x
    );
    assert!(
        all_y.iter().all(|&y| (-1.5..=1.5).contains(&y)),
        "Stripe y coords should be in [-1,1] range, got {:?}",
        all_y
    );
}

/// Verify that a crosswalk with hdg=π/2 and length=0/width=0 (junction_crosswalk_signal
/// style) applies hdg rotation so that stripes have correct count and orientation.
///
/// Corners: u ∈ [-3.6, 7.1] (10.7m), v ∈ [-5.0, -1.0] (4.0m).
/// With hdg=π/2 rotation: alpha=-v ∈ [1,5] (4m along-road), beta=u ∈ [-3.6,7.1] (10.7m lateral).
/// Lateral sweep → 10.7m → ~10 stripes, each bar spans 4m along-road.
#[test]
fn test_crosswalk_stripes_hdg_pi_half_perpendicular_to_road() {
    let ref_pts = straight_road_pts();
    let corners = vec![
        Point3D {
            x: -3.6,
            y: -1.0,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: 7.1,
            y: -1.0,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: 7.1,
            y: -5.0,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: -3.6,
            y: -5.0,
            z: 0.0,
            id: None,
        },
    ];
    let elevations: Vec<Elevation> = vec![];
    let mut out = Vec::new();
    let offset_fn = &offset_pt_flat;

    // length=0, width=0 → apply hdg rotation
    emit_crosswalk_stripes(
        &corners,
        &ref_pts[5],
        &elevations,
        5.0,
        0.0,
        std::f64::consts::FRAC_PI_2,
        0.0,
        offset_fn,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        &mut out,
    );

    assert!(!out.is_empty(), "Expected stripes for hdg=π/2 crosswalk");

    // With rotation: lateral range = 10.7m; period = 1.05m → ~10 stripes.
    let num_stripes = out.len() / 42;
    assert!(
        (8..=12).contains(&num_stripes),
        "Expected ~10 stripes for 10.7 m lateral range, got {num_stripes}"
    );

    // Each stripe bar spans the along-road extent (~4m in x after rotation).
    let first_stripe_xs: Vec<f32> = out[..42].chunks(7).map(|v| v[0]).collect();
    let x_min = first_stripe_xs
        .iter()
        .cloned()
        .fold(f32::INFINITY, f32::min);
    let x_max = first_stripe_xs
        .iter()
        .cloned()
        .fold(f32::NEG_INFINITY, f32::max);
    assert!(
        (x_max - x_min) > 3.0,
        "First stripe along-road extent={:.1}, expected ~4.0m",
        x_max - x_min
    );
}

/// Verify that a crosswalk with hdg=π/2 and length>0/width>0 (CityScape style)
/// does NOT apply hdg rotation, keeping stripes correct.
///
/// Corners: u ∈ [-2.16, 1.48] (3.6m), v ∈ [-6.57, 4.36] (10.9m).
/// Without rotation: along-road = 3.6m, lateral = 10.9m.
/// Lateral sweep → 10.9m → ~10 stripes, each bar spans 3.6m along-road.
#[test]
fn test_crosswalk_stripes_hdg_pi_half_cityscape_style() {
    let ref_pts = straight_road_pts();
    let corners = vec![
        Point3D {
            x: -2.16,
            y: 4.36,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: 1.48,
            y: 4.36,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: 1.48,
            y: -6.57,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: -2.16,
            y: -6.57,
            z: 0.0,
            id: None,
        },
    ];
    let elevations: Vec<Elevation> = vec![];
    let mut out = Vec::new();
    let offset_fn = &offset_pt_flat;

    // length=3.64, width=10.99 → don't apply hdg rotation
    emit_crosswalk_stripes(
        &corners,
        &ref_pts[5],
        &elevations,
        5.0,
        0.0,
        std::f64::consts::FRAC_PI_2,
        0.0,
        offset_fn,
        0.0,
        0.0,
        0.0,
        3.64,
        10.99,
        &mut out,
    );

    assert!(
        !out.is_empty(),
        "Expected stripes for CityScape-style crosswalk"
    );

    // Without rotation: lateral range = 10.9m; period = 1.05m → ~10 stripes.
    let num_stripes = out.len() / 42;
    assert!(
        (8..=12).contains(&num_stripes),
        "Expected ~10 stripes for 10.9 m lateral range, got {num_stripes}"
    );

    // Each stripe bar spans the along-road extent (~3.6m in x, no rotation).
    let first_stripe_xs: Vec<f32> = out[..42].chunks(7).map(|v| v[0]).collect();
    let x_min = first_stripe_xs
        .iter()
        .cloned()
        .fold(f32::INFINITY, f32::min);
    let x_max = first_stripe_xs
        .iter()
        .cloned()
        .fold(f32::NEG_INFINITY, f32::max);
    assert!(
        (x_max - x_min) > 2.5,
        "First stripe along-road extent={:.1}, expected ~3.6m",
        x_max - x_min
    );
}

/// Verify that a crosswalk with hdg=π/2 and length>0/width>0 but u-extent > v-extent
/// (51World / spec-compliant style) DOES apply hdg rotation.
///
/// Corners from crosswalk_signals.xodr id=115:
/// u ∈ [-6.33, 4.31] (10.6m), v ∈ [-2.81, 1.87] (4.7m).
/// Since u-extent (10.6) > v-extent (4.7), corners are in object-local frame.
/// After hdg=π/2 rotation: along-road ≈ v-extent (4.7m), lateral ≈ u-extent (10.6m).
/// Lateral sweep → 10.6m → ~10 stripes, each bar spans ~4.7m along-road.
#[test]
fn test_crosswalk_stripes_51world_convention_length_gt_zero() {
    let ref_pts = straight_road_pts();
    let corners = vec![
        Point3D {
            x: 4.1716,
            y: 1.8650,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: -6.3277,
            y: 1.7411,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: -6.3277,
            y: -2.8060,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: 4.3121,
            y: -2.6651,
            z: 0.0,
            id: None,
        },
    ];
    let elevations: Vec<Elevation> = vec![];
    let mut out = Vec::new();
    let offset_fn = &offset_pt_flat;

    // length=10.64, width=4.67 (both > 0) but u-extent > v-extent → apply hdg
    emit_crosswalk_stripes(
        &corners,
        &ref_pts[5],
        &elevations,
        5.0,
        0.0,
        std::f64::consts::FRAC_PI_2,
        0.0,
        offset_fn,
        0.0,
        0.45,
        0.6,
        10.64,
        4.67,
        &mut out,
    );

    assert!(
        !out.is_empty(),
        "Expected stripes for 51World-style crosswalk"
    );

    // With rotation: lateral range ≈ 10.6m; period = 1.05m → ~10 stripes.
    let num_stripes = out.len() / 42;
    assert!(
        (8..=12).contains(&num_stripes),
        "Expected ~10 stripes for 10.6m lateral range, got {num_stripes}"
    );

    // Each stripe bar should span the along-road extent (~4.7m after rotation),
    // NOT 10.6m (which would be the broken behavior without rotation).
    let first_stripe_xs: Vec<f32> = out[..42].chunks(7).map(|v| v[0]).collect();
    let x_min = first_stripe_xs
        .iter()
        .cloned()
        .fold(f32::INFINITY, f32::min);
    let x_max = first_stripe_xs
        .iter()
        .cloned()
        .fold(f32::NEG_INFINITY, f32::max);
    let bar_extent = x_max - x_min;
    assert!(
        bar_extent > 3.0 && bar_extent < 6.0,
        "First stripe along-road extent={:.1}, expected ~4.7m (not 10.6m)",
        bar_extent
    );
}

/// Verify that a crosswalk with hdg≈π and length>0/width>0 (51World / Industrypark2 style)
/// DOES apply hdg rotation even though u_span < v_span (old aspect-ratio heuristic
/// would have set apply_hdg=false and placed the polygon on the wrong side of the road).
///
/// Corners are in object-local frame (u = depth backward along road, v = lateral):
///   u ∈ [-1.24, 0.80] (depth 2.04 m), v ∈ [-6.97, 10.45] (width 17.42 m).
/// u_span(2.04) < v_span(17.42) — old detection would skip rotation.
/// With hdg≈π fix → apply_hdg=true: alpha=−u, beta=−v.
///
/// On a straight east-pointing road (ref y=0, obj_t=0):
///   apply_hdg=true  centroid_y ≈ −1.74  (correct: polygon reflects to negative side)
///   apply_hdg=false centroid_y ≈ +1.74  (old bug)
#[test]
fn test_crosswalk_stripes_hdg_pi_51world_applies_rotation() {
    let ref_pts = straight_road_pts();
    // Corners from Industrypark2 crosswalk 198882 (object-local, hdg≈π).
    let corners = vec![
        Point3D {
            x: 0.80,
            y: -6.95,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: 0.23,
            y: 10.45,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: -1.24,
            y: 10.42,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: -0.59,
            y: -6.97,
            z: 0.0,
            id: None,
        },
    ];
    let elevations: Vec<Elevation> = vec![];
    let mut out = Vec::new();
    let offset_fn = &offset_pt_flat;

    // u_span=2.04 < v_span=17.42 — old code would give apply_hdg=false.
    // hdg≈π → new code must use apply_hdg=true.
    emit_crosswalk_stripes(
        &corners,
        &ref_pts[5],
        &elevations,
        5.0,
        0.0, // obj_t = 0 → ref at road centre
        std::f64::consts::PI,
        0.0,
        offset_fn,
        0.0,
        0.45,
        0.6,
        2.04,  // obj_length > 0
        17.42, // obj_width > 0
        &mut out,
    );

    assert!(
        !out.is_empty(),
        "Expected stripes for Industrypark2-style hdg≈π crosswalk"
    );

    // Compute mean y-coordinate of all output vertices (every 7th float starting at [1]).
    let ys: Vec<f32> = out.iter().skip(1).step_by(7).cloned().collect();
    assert!(!ys.is_empty(), "No vertex y-values in output");
    let mean_y: f32 = ys.iter().sum::<f32>() / ys.len() as f32;

    // apply_hdg=true  → polygon reflected; centroid y ≈ −1.74 on east road at y=0.
    // apply_hdg=false → centroid y ≈ +1.74 (the old wrong result).
    assert!(
        mean_y < 0.0,
        "mean_y={:.2} — expected negative (apply_hdg=true used); positive means \
         hdg rotation was not applied (old bug)",
        mean_y
    );
}

/// Verify that parking spaces with road-frame convention (e.g. parkinglot.xodr, length=0/width=0)
/// do NOT get hdg rotation applied, producing correct perpendicular stall orientation.
///
/// Uses Style B parking (v_span > u_span, like id=50 in parkinglot.xodr):
/// u∈[-1.12, 1.15] (width=2.27m), v∈[-2.77, 0.68] (depth=3.45m), hdg=π/2.
///
/// Detection: obj_length=0, obj_width=0 → road-frame → NO rotation.
/// Without rotation: ds = u → along road 2.27m, dt = v → lateral 3.45m.
/// This produces narrow stalls along the road (2.27m) with depth perpendicular (3.45m).
#[test]
fn test_polygon_outline_adjacent_spaces_touch_not_overlap() {
    let ref_pts: Vec<RefLinePoint> = (0..=200)
        .map(|i| {
            let s = i as f64 * 0.1;
            RefLinePoint {
                s,
                x: s,
                y: 0.0,
                hdg: 0.0,
            }
        })
        .collect();
    let elevations: Vec<Elevation> = vec![];
    let offset_fn = &offset_pt_flat;

    // Space 50: s=0.81, v_span(3.45) > u_span(2.27), hdg=π/2
    let corners_50 = vec![
        Point3D {
            x: -1.12,
            y: -2.77,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: -1.12,
            y: 0.68,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: 1.15,
            y: 0.68,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: 1.15,
            y: -2.77,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: -1.12,
            y: -2.77,
            z: 0.0,
            id: None,
        },
    ];

    let mut out50 = Vec::new();
    emit_polygon_outline(
        &corners_50,
        &ref_pts[8],
        &elevations,
        0.81,
        0.0,
        std::f64::consts::FRAC_PI_2,
        0.0,
        0.10,
        [0.0, 1.0, 0.0, 1.0],
        offset_fn,
        &mut out50,
        0.0,
        0.0,
    ); // length=0, width=0 → road-frame → no rotation

    assert!(
        !out50.is_empty(),
        "Space 50 should produce outline vertices"
    );

    // Detection: obj_length=0, obj_width=0 → road-frame → no rotation.
    // ds = u → x ∈ [0.81-1.12, 0.81+1.15] = [-0.31, 1.96]
    let x_max_50 = out50
        .chunks(7)
        .map(|v| v[0])
        .fold(f32::NEG_INFINITY, f32::max);
    let _x_min_50 = out50.chunks(7).map(|v| v[0]).fold(f32::INFINITY, f32::min);

    // Without rotation: x_max ≈ 0.81 + 1.15 + hw(0.05) ≈ 2.01
    // With rotation (wrong): x_max ≈ 0.81 + 2.77 + hw ≈ 3.63
    assert!(
        x_max_50 < 2.5,
        "Space 50 x_max={x_max_50:.3}: expected ~2.0 (no rotation for road-frame corners). \
         Value > 2.5 means rotation was incorrectly applied"
    );

    // dt = v → lateral extent ≈ 3.45m (v_span). This is the stall depth.
    let y_max_50 = out50
        .chunks(7)
        .map(|v| v[1])
        .fold(f32::NEG_INFINITY, f32::max);
    let y_min_50 = out50.chunks(7).map(|v| v[1]).fold(f32::INFINITY, f32::min);
    let y_extent = y_max_50 - y_min_50;

    // Without rotation: lateral extent ≈ 3.45m (v_span) — correct deep perpendicular stalls
    assert!(
        y_extent > 3.0,
        "Space 50 y_extent={y_extent:.3}: expected ~3.45m (v_span for deep perpendicular stalls)"
    );
}

/// Verify that spec-compliant parking spaces (non-zero length/width) get hdg rotation applied.
///
/// `park_ground_park_ground.xodr` style: u∈[-3.16, 2.09] (uSpan=5.25m, stall depth),
/// v∈[-1.49, 0.99] (vSpan=2.49m, stall width), hdg=π/2, length=5.25, width=2.48.
///
/// Detection: obj_length=5.25 > 0 && obj_width=2.48 > 0 → spec-compliant → apply rotation.
/// With rotation (hdg=π/2): alpha = -v ∈ [-0.99, 1.49] → 2.49m along road.
/// Spaces at s=4.57 and s=7.07 (spacing=2.5m): each takes 2.49m → barely touching.
///
/// Without rotation: u=5.25m along road → MASSIVE overlap at 2.5m spacing.
#[test]
fn test_polygon_outline_spec_compliant_hdg_rotation() {
    let ref_pts: Vec<RefLinePoint> = (0..=100)
        .map(|i| {
            let s = i as f64 * 0.1;
            RefLinePoint {
                s,
                x: s,
                y: 0.0,
                hdg: 0.0,
            }
        })
        .collect();
    let elevations: Vec<Elevation> = vec![];
    let offset_fn = &offset_pt_flat;

    // Space at s=4.57: u∈[-3.156, 2.094] (uSpan=5.25), v∈[-1.491, 0.994] (vSpan=2.485)
    // uSpan > vSpan → rotation applied.  alpha = -v ∈ [-0.994, 1.491]
    // x_range: [4.57 - 0.994, 4.57 + 1.491] = [3.576, 6.061]
    let corners_a = vec![
        Point3D {
            x: -3.156,
            y: -1.491,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: 2.094,
            y: -1.491,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: 2.094,
            y: 0.994,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: -3.156,
            y: 0.994,
            z: 0.0,
            id: None,
        },
        Point3D {
            x: -3.156,
            y: -1.491,
            z: 0.0,
            id: None,
        },
    ];

    // Space at s=7.07: same corner shape → x_range: [7.07 - 0.994, 7.07 + 1.491] = [6.076, 8.561]
    let corners_b = corners_a.clone();

    let mut out_a = Vec::new();
    emit_polygon_outline(
        &corners_a,
        &ref_pts[46],
        &elevations,
        4.57,
        0.0,
        std::f64::consts::FRAC_PI_2,
        0.0,
        0.10,
        [0.0, 1.0, 0.0, 1.0],
        offset_fn,
        &mut out_a,
        5.25,
        2.48,
    ); // non-zero length/width → spec-compliant → rotation applied
    let mut out_b = Vec::new();
    emit_polygon_outline(
        &corners_b,
        &ref_pts[71],
        &elevations,
        7.07,
        0.0,
        std::f64::consts::FRAC_PI_2,
        0.0,
        0.10,
        [0.0, 1.0, 0.0, 1.0],
        offset_fn,
        &mut out_b,
        5.25,
        2.48,
    );

    assert!(!out_a.is_empty(), "Space A should produce vertices");
    assert!(!out_b.is_empty(), "Space B should produce vertices");

    let x_max_a = out_a
        .chunks(7)
        .map(|v| v[0])
        .fold(f32::NEG_INFINITY, f32::max);
    let x_min_b = out_b.chunks(7).map(|v| v[0]).fold(f32::INFINITY, f32::min);

    // With hdg rotation: space A x_max ≈ 4.57+1.491+hw ≈ 6.11, space B x_min ≈ 7.07-0.994-hw ≈ 6.02
    // Spaces should be very close (touching), not widely separated or heavily overlapping.
    // Without rotation: space A x_max ≈ 4.57+3.156+hw ≈ 7.79 → would violate x_max_a < 7.0
    assert!(
        x_max_a < 7.0,
        "Space A x_max={x_max_a:.3}: expected ~6.1 (with hdg rotation applied), \
         got large value indicating rotation was NOT applied"
    );

    // Spaces should roughly touch: overlap < 0.5m (allowing for bar thickness)
    let overlap = x_max_a - x_min_b;
    assert!(
        overlap < 0.5,
        "Spec-compliant spaces overlap by {overlap:.3}m; rotation should produce touching not overlapping spaces"
    );
}

/// Verify that parking spaces with u_span > v_span but length=0/width=0
/// do NOT get hdg rotation applied (this was the broken case for IDs 57,58,59,64,65
/// in parkinglot.xodr where the outline rectangle is wider in u than v).
#[test]
fn test_polygon_outline_u_wider_than_v_no_rotation_when_length_zero() {
    let ref_pts: Vec<RefLinePoint> = (0..=200)
        .map(|i| {
            let s = i as f64 * 0.1;
            RefLinePoint {
                s,
                x: s,
                y: 0.0,
                hdg: 0.0,
            }
        })
        .collect();
    let elevations: Vec<Elevation> = vec![];
    let offset_fn = &offset_pt_flat;

    // Space 58 (Road 10): u∈[-0.68, 2.75] (u_span=3.43), v∈[-1.16, 1.18] (v_span=2.34)
    // u_span > v_span, but length=0 width=0 → road-frame → NO rotation.
    let corners_58 = vec![
        Point3D {
            x: -0.684,
            y: -1.161,
            z: 0.03,
            id: None,
        },
        Point3D {
            x: 2.745,
            y: -1.144,
            z: 0.03,
            id: None,
        },
        Point3D {
            x: 2.729,
            y: 1.176,
            z: 0.03,
            id: None,
        },
        Point3D {
            x: -0.716,
            y: 1.136,
            z: 0.03,
            id: None,
        },
    ];

    let mut out = Vec::new();
    emit_polygon_outline(
        &corners_58,
        &ref_pts[11],
        &elevations,
        1.11,
        3.62,
        std::f64::consts::FRAC_PI_2,
        0.0,
        0.15,
        [0.424, 0.549, 0.278, 1.0],
        offset_fn,
        &mut out,
        0.0,
        0.0,
    ); // length=0, width=0 → road-frame → no rotation

    assert!(!out.is_empty(), "Space 58 should produce outline vertices");

    // Without rotation: u maps to x → x_extent ≈ 3.43m (u_span)
    // With rotation (wrong): u maps to y → x_extent ≈ 2.34m (v_span)
    let x_max = out
        .chunks(7)
        .map(|v| v[0])
        .fold(f32::NEG_INFINITY, f32::max);
    let x_min = out.chunks(7).map(|v| v[0]).fold(f32::INFINITY, f32::min);
    let x_extent = x_max - x_min;

    // Without rotation: x_extent ≈ 3.43m (u_span). With rotation: x_extent ≈ 2.34m.
    assert!(
        x_extent > 3.0,
        "Space 58 x_extent={x_extent:.3}: expected ~3.43 (no rotation for road-frame corners). \
         Value < 3.0 means rotation was incorrectly applied"
    );

    // Without rotation: y_extent ≈ 2.34m (v_span). With rotation: y_extent ≈ 3.43m.
    let y_max = out
        .chunks(7)
        .map(|v| v[1])
        .fold(f32::NEG_INFINITY, f32::max);
    let y_min = out.chunks(7).map(|v| v[1]).fold(f32::INFINITY, f32::min);
    let y_extent = y_max - y_min;
    assert!(
        y_extent < 3.0,
        "Space 58 y_extent={y_extent:.3}: expected ~2.34 (no rotation). \
         Value > 3.0 means rotation was incorrectly applied"
    );
}
