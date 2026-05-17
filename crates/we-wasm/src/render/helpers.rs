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
