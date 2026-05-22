/// Sum lane widths at ds across multiple lanes.
pub(super) fn sum_widths_at_ds(
    widths_list: &[&[we_core::model::LaneWidth]],
    ds: f64,
    eval: &impl Fn(&[we_core::model::LaneWidth], f64) -> f64,
) -> f64 {
    widths_list.iter().map(|w| eval(w, ds)).sum()
}

/// Evaluate laneOffset polynomial at station `s`.
///
/// OpenDRIVE `laneOffset` applies to the whole lane cross-section:
/// positive values shift all lanes to the left of the reference line.
pub(crate) fn eval_lane_offset(offsets: &[we_core::model::LaneOffset], s: f64) -> f64 {
    let Some(entry) = offsets.iter().rev().find(|o| o.s <= s + 1e-9) else {
        return 0.0;
    };
    let ds = (s - entry.s).max(0.0);
    entry.evaluate(ds)
}

/// Evaluate road reference position at a given `s` station.
///
/// Finds the geometry element that covers `s` and evaluates it.
/// When `s` exceeds the last geometry segment's range, the position
/// is extrapolated by extending in the tangent direction from the
/// segment endpoint.  This allows objects defined with s > road.length
/// (common in XODR parking-space rows) to render at the correct
/// world position.
pub(crate) fn road_point_at_s(
    plan_view: &[we_core::model::Geometry],
    s: f64,
) -> Option<we_core::geometry::eval::RefLinePoint> {
    use we_core::geometry::eval::evaluate_geometry;

    if plan_view.is_empty() {
        return None;
    }

    // Find the geometry segment that contains s
    let geo = plan_view
        .iter()
        .rev()
        .find(|g| g.s <= s + 1e-9)
        .unwrap_or(&plan_view[0]);

    let ds = s - geo.s;
    if ds <= geo.length + 1e-9 {
        // Normal case: s within segment
        let ds_clamped = ds.clamp(0.0, geo.length);
        Some(evaluate_geometry(geo, ds_clamped))
    } else {
        // Extrapolate: evaluate at segment end, then extend along tangent
        let end_pt = evaluate_geometry(geo, geo.length);
        let overshoot = ds - geo.length;
        Some(we_core::geometry::eval::RefLinePoint {
            x: end_pt.x + overshoot * end_pt.hdg.cos(),
            y: end_pt.y + overshoot * end_pt.hdg.sin(),
            hdg: end_pt.hdg,
            s,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{eval_lane_offset, road_point_at_s, sum_widths_at_ds};
    use std::f64::consts::FRAC_PI_2;
    use we_core::model::{Geometry, GeometryType, LaneOffset, LaneWidth};

    #[test]
    fn test_sum_widths_at_ds_accumulates_across_lane_lists() {
        let lane_a = vec![LaneWidth {
            s_offset: 0.0,
            a: 2.0,
            b: 0.0,
            c: 0.0,
            d: 0.0,
        }];
        let lane_b = vec![LaneWidth {
            s_offset: 0.0,
            a: 1.5,
            b: 0.0,
            c: 0.0,
            d: 0.0,
        }];

        let total = sum_widths_at_ds(&[&lane_a, &lane_b], 3.0, &|widths: &[LaneWidth], _| {
            widths[0].a
        });

        assert!((total - 3.5).abs() < f64::EPSILON);
    }

    #[test]
    fn test_eval_lane_offset_uses_latest_applicable_polynomial() {
        let offsets = vec![
            LaneOffset {
                s: 0.0,
                a: 1.0,
                b: 0.0,
                c: 0.0,
                d: 0.0,
            },
            LaneOffset {
                s: 5.0,
                a: 2.0,
                b: 0.5,
                c: 0.0,
                d: 0.0,
            },
        ];

        assert!((eval_lane_offset(&offsets, 2.0) - 1.0).abs() < f64::EPSILON);
        assert!((eval_lane_offset(&offsets, 7.0) - 3.0).abs() < f64::EPSILON);
        assert_eq!(eval_lane_offset(&[], 7.0), 0.0);
    }

    #[test]
    fn test_road_point_at_s_returns_none_for_empty_plan_view() {
        assert!(road_point_at_s(&[], 1.0).is_none());
    }

    #[test]
    fn test_road_point_at_s_extrapolates_beyond_last_geometry() {
        let plan_view = vec![Geometry {
            s: 0.0,
            x: 10.0,
            y: 0.0,
            hdg: FRAC_PI_2,
            length: 5.0,
            geo_type: GeometryType::Line,
        }];

        let pt = road_point_at_s(&plan_view, 12.0).unwrap();

        assert!((pt.x - 10.0).abs() < 1e-6);
        assert!((pt.y - 12.0).abs() < 1e-6);
        assert!((pt.hdg - FRAC_PI_2).abs() < 1e-6);
    }
}
