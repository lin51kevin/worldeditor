use wasm_bindgen::prelude::*;

// ── Geometry helpers (no wgpu dependency) ────────────────────────────────────

/// Select a lane surface color based on the active color mode.
fn select_lane_color(color_mode: &str, lane_type: we_core::model::LaneType, road_idx: usize) -> [f32; 4] {
    match color_mode {
        "single" => [0.45, 0.45, 0.45, 1.0],
        "byRoad" => road_hue_color(road_idx),
        _        => lane_surface_color(lane_type),
    }
}

/// Generate a distinct color for a road by cycling hue using the golden angle.
fn road_hue_color(road_idx: usize) -> [f32; 4] {
    let hue = (road_idx as f32 * 137.508) % 360.0;
    hsv_to_rgba(hue, 0.55, 0.62)
}

/// Convert HSV (h in degrees 0–360, s and v in 0–1) to RGBA (alpha = 1.0).
fn hsv_to_rgba(h: f32, s: f32, v: f32) -> [f32; 4] {
    let h6 = h / 60.0;
    let i = h6.floor() as u32 % 6;
    let f = h6 - h6.floor();
    let p = v * (1.0 - s);
    let q = v * (1.0 - s * f);
    let t = v * (1.0 - s * (1.0 - f));
    let (r, g, b) = match i {
        0 => (v, t, p),
        1 => (q, v, p),
        2 => (p, v, t),
        3 => (p, q, v),
        4 => (t, p, v),
        _ => (v, p, q),
    };
    [r, g, b, 1.0]
}

/// Lane surface color by lane type (RGBA).
fn lane_surface_color(lane_type: we_core::model::LaneType) -> [f32; 4] {
    use we_core::model::LaneType;
    // Colors match C# WorldEditor reference: RoadConfig.cs
    match lane_type {
        LaneType::Driving       => [0.298, 0.298, 0.298, 1.0], // (76,76,76)
        LaneType::Shoulder      => [0.149, 0.149, 0.149, 1.0], // (38,38,38) near-black
        LaneType::Sidewalk      => [0.725, 0.478, 0.341, 1.0], // (185,122,87) brown
        LaneType::Median        => [0.463, 0.741, 0.400, 1.0], // (118,189,102) green
        LaneType::Border        => [0.741, 0.867, 0.745, 1.0], // (189,221,190) pale green
        LaneType::Parking       => [1.000, 0.808, 0.490, 1.0], // (255,206,125) warm yellow
        LaneType::Biking        => [0.776, 0.702, 0.655, 1.0], // (198,179,167) tan
        LaneType::Stop          => [0.349, 0.788, 0.788, 1.0], // (89,201,201) teal
        LaneType::Restricted    => [0.639, 0.682, 0.773, 1.0], // (163,174,197) slate blue
        LaneType::Bidirectional => [0.812, 0.902, 0.961, 1.0], // (207,230,245) light blue
        LaneType::OffRamp       => [0.878, 0.796, 0.796, 1.0], // (224,203,203) rose
        LaneType::OnRamp        => [0.369, 0.565, 0.659, 1.0], // (94,144,168) steel blue
        LaneType::ConnectingRamp=> [0.027, 0.043, 0.314, 1.0], // (7,11,80) navy
        LaneType::Bus           => [0.161, 0.141, 0.129, 1.0], // (41,36,33) very dark
        LaneType::Taxi          => [0.502, 0.541, 0.529, 1.0], // (128,138,135) medium gray
        LaneType::HOV           => [0.929, 0.569, 0.129, 1.0], // (237,145,33) amber
        _ => [0.40, 0.40, 0.35, 1.0],
    }
}

/// Road mark color by mark color enum (RGBA).
fn mark_color(color: we_core::model::RoadMarkColor) -> [f32; 4] {
    use we_core::model::RoadMarkColor;
    match color {
        RoadMarkColor::Yellow => [0.976, 0.827, 0.137, 1.0], // (249,211,35)
        RoadMarkColor::Red    => [1.000, 0.000, 0.000, 1.0],
        RoadMarkColor::Blue   => [0.000, 0.000, 1.000, 1.0],
        RoadMarkColor::Green  => [0.000, 1.000, 0.000, 1.0],
        RoadMarkColor::Orange => [1.000, 0.380, 0.000, 1.0], // (255,97,0)
        RoadMarkColor::Violet => [0.580, 0.000, 0.827, 1.0],
        _ => [1.0, 1.0, 1.0, 1.0], // Standard / White
    }
}

/// Mark line width in meters according to OpenDRIVE weight (Standard = 0.15m, Bold = 0.25m).
fn mark_line_width(rm: &we_core::model::RoadMark) -> f32 {
    if rm.width > 0.0 {
        return rm.width as f32;
    }
    use we_core::model::RoadMarkWeight;
    match rm.weight {
        RoadMarkWeight::Bold => 0.25,
        _ => 0.15,
    }
}

/// Emit all road-mark line vertices for a single `RoadMark` into `out`.
///
/// Handles:
/// - Single-line types (`Solid`, `Broken`, `BottsDots`, `Curb`, `Grass`, `Custom`, `StopLine`)
/// - Double-line types (`SolidSolid`, `SolidBroken`, `BrokenSolid`, `BrokenBroken`):
///   generates two parallel lines separated by `DOUBLE_LINE_SPACING` (0.1 m).
#[allow(clippy::too_many_arguments)]
fn emit_road_mark(
    rm: &we_core::model::RoadMark,
    section_pts: &[&we_core::geometry::eval::RefLinePoint],
    elevations: &[we_core::model::Elevation],
    section_s: f64,
    lane_offsets: &[we_core::model::LaneOffset],
    lateral_offset_at_ds: &dyn Fn(f64) -> f64,
    out: &mut Vec<f32>,
) {
    use we_core::geometry::eval::{evaluate_elevation, offset_point};
    use we_core::model::RoadMarkType;

    let lc = mark_color(rm.color);
    let lw = mark_line_width(rm);

    const DOUBLE_SPACING: f64 = 0.05; // half of 0.1m gap → each line offset ±0.05m

    match rm.mark_type {
        // Double-line: left line is solid, right line is solid
        RoadMarkType::SolidSolid => {
            let verts = gen_road_mark_line(
                section_pts, elevations, section_s, lane_offsets,
                &|ds| lateral_offset_at_ds(ds) + DOUBLE_SPACING,
                lw, lc, false, &evaluate_elevation, &eval_lane_offset, &offset_point,
            );
            for v in &verts { out.extend_from_slice(v); }
            let verts = gen_road_mark_line(
                section_pts, elevations, section_s, lane_offsets,
                &|ds| lateral_offset_at_ds(ds) - DOUBLE_SPACING,
                lw, lc, false, &evaluate_elevation, &eval_lane_offset, &offset_point,
            );
            for v in &verts { out.extend_from_slice(v); }
        }
        // Double-line: left solid, right broken
        RoadMarkType::SolidBroken => {
            let verts = gen_road_mark_line(
                section_pts, elevations, section_s, lane_offsets,
                &|ds| lateral_offset_at_ds(ds) + DOUBLE_SPACING,
                lw, lc, false, &evaluate_elevation, &eval_lane_offset, &offset_point,
            );
            for v in &verts { out.extend_from_slice(v); }
            let verts = gen_road_mark_line(
                section_pts, elevations, section_s, lane_offsets,
                &|ds| lateral_offset_at_ds(ds) - DOUBLE_SPACING,
                lw, lc, true, &evaluate_elevation, &eval_lane_offset, &offset_point,
            );
            for v in &verts { out.extend_from_slice(v); }
        }
        // Double-line: left broken, right solid
        RoadMarkType::BrokenSolid => {
            let verts = gen_road_mark_line(
                section_pts, elevations, section_s, lane_offsets,
                &|ds| lateral_offset_at_ds(ds) + DOUBLE_SPACING,
                lw, lc, true, &evaluate_elevation, &eval_lane_offset, &offset_point,
            );
            for v in &verts { out.extend_from_slice(v); }
            let verts = gen_road_mark_line(
                section_pts, elevations, section_s, lane_offsets,
                &|ds| lateral_offset_at_ds(ds) - DOUBLE_SPACING,
                lw, lc, false, &evaluate_elevation, &eval_lane_offset, &offset_point,
            );
            for v in &verts { out.extend_from_slice(v); }
        }
        // Single-line types (Solid, Broken, BottsDots, Curb, Grass, StopLine, Custom, None ignored)
        _ => {
            let dashed = matches!(rm.mark_type, RoadMarkType::Broken);
            let verts = gen_road_mark_line(
                section_pts, elevations, section_s, lane_offsets,
                lateral_offset_at_ds,
                lw, lc, dashed, &evaluate_elevation, &eval_lane_offset, &offset_point,
            );
            for v in &verts { out.extend_from_slice(v); }
        }
    }
}

/// Sum lane widths at ds across multiple lanes.
fn sum_widths_at_ds(
    widths_list: &[&[we_core::model::LaneWidth]],
    ds: f64,
    eval: &dyn Fn(&[we_core::model::LaneWidth], f64) -> f64,
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

/// Generate a colored triangle strip for one lane.
#[allow(clippy::too_many_arguments, clippy::type_complexity)]
fn gen_lane_strip(
    ref_pts: &[&we_core::geometry::eval::RefLinePoint],
    widths: &[we_core::model::LaneWidth],
    section_s: f64,
    elevations: &[we_core::model::Elevation],
    lane_offsets: &[we_core::model::LaneOffset],
    prev_widths: &[&[we_core::model::LaneWidth]],
    is_left: bool,
    color: [f32; 4],
    eval_elev: &dyn Fn(&[we_core::model::Elevation], f64) -> f64,
    eval_width: &dyn Fn(&[we_core::model::LaneWidth], f64) -> f64,
    eval_lane_off: &dyn Fn(&[we_core::model::LaneOffset], f64) -> f64,
    offset_pt: &dyn Fn(&we_core::geometry::eval::RefLinePoint, f64, f64) -> (f64, f64, f64),
) -> Vec<[f32; 7]> {
    let mut verts = Vec::new();
    let [r, g, b, a] = color;

    for i in 0..ref_pts.len() - 1 {
        let pt0 = ref_pts[i];
        let pt1 = ref_pts[i + 1];

        let ds0 = (pt0.s - section_s).max(0.0);
        let ds1 = (pt1.s - section_s).max(0.0);

        let w0 = eval_width(widths, ds0);
        let w1 = eval_width(widths, ds1);
        if w0 <= 0.0 && w1 <= 0.0 {
            continue;
        }
        let inner0 = sum_widths_at_ds(prev_widths, ds0, eval_width);
        let inner1 = sum_widths_at_ds(prev_widths, ds1, eval_width);

        let z0 = eval_elev(elevations, pt0.s) as f32;
        let z1 = eval_elev(elevations, pt1.s) as f32;

        let lo0 = eval_lane_off(lane_offsets, pt0.s);
        let lo1 = eval_lane_off(lane_offsets, pt1.s);

        let (in0, out0) = if is_left {
            (lo0 + inner0, lo0 + inner0 + w0)
        } else {
            (lo0 - inner0, lo0 - (inner0 + w0))
        };
        let (in1, out1) = if is_left {
            (lo1 + inner1, lo1 + inner1 + w1)
        } else {
            (lo1 - inner1, lo1 - (inner1 + w1))
        };

        let (ix0, iy0, _) = offset_pt(pt0, in0, 0.0);
        let (ox0, oy0, _) = offset_pt(pt0, out0, 0.0);
        let (ix1, iy1, _) = offset_pt(pt1, in1, 0.0);
        let (ox1, oy1, _) = offset_pt(pt1, out1, 0.0);

        verts.push([ix0 as f32, iy0 as f32, z0, r, g, b, a]);
        verts.push([ox0 as f32, oy0 as f32, z0, r, g, b, a]);
        verts.push([ix1 as f32, iy1 as f32, z1, r, g, b, a]);
        verts.push([ox0 as f32, oy0 as f32, z0, r, g, b, a]);
        verts.push([ox1 as f32, oy1 as f32, z1, r, g, b, a]);
        verts.push([ix1 as f32, iy1 as f32, z1, r, g, b, a]);
    }

    verts
}

/// Generate a default ribbon when no lane section data is available.
fn gen_default_ribbon(
    ref_pts: &[we_core::geometry::eval::RefLinePoint],
    elevations: &[we_core::model::Elevation],
    half_width: f64,
    color: [f32; 4],
) -> Vec<[f32; 7]> {
    use we_core::geometry::eval::{evaluate_elevation, offset_point};

    let mut verts = Vec::new();
    let [r, g, b, a] = color;

    for i in 0..ref_pts.len() - 1 {
        let pt0 = &ref_pts[i];
        let pt1 = &ref_pts[i + 1];

        let z0 = evaluate_elevation(elevations, pt0.s) as f32;
        let z1 = evaluate_elevation(elevations, pt1.s) as f32;

        let (lx0, ly0, _) = offset_point(pt0, half_width, 0.0);
        let (rx0, ry0, _) = offset_point(pt0, -half_width, 0.0);
        let (lx1, ly1, _) = offset_point(pt1, half_width, 0.0);
        let (rx1, ry1, _) = offset_point(pt1, -half_width, 0.0);

        verts.push([lx0 as f32, ly0 as f32, z0, r, g, b, a]);
        verts.push([rx0 as f32, ry0 as f32, z0, r, g, b, a]);
        verts.push([lx1 as f32, ly1 as f32, z1, r, g, b, a]);
        verts.push([rx0 as f32, ry0 as f32, z0, r, g, b, a]);
        verts.push([rx1 as f32, ry1 as f32, z1, r, g, b, a]);
        verts.push([lx1 as f32, ly1 as f32, z1, r, g, b, a]);
    }

    verts
}

/// Generate a road marking line as a thin triangle strip at a lateral offset.
///
/// For dashed marks, segments are skipped every `dash_len + gap_len` meters.
#[allow(clippy::too_many_arguments, clippy::type_complexity)]
fn gen_road_mark_line(
    ref_pts: &[&we_core::geometry::eval::RefLinePoint],
    elevations: &[we_core::model::Elevation],
    section_s: f64,
    lane_offsets: &[we_core::model::LaneOffset],
    lateral_offset_at_ds: &dyn Fn(f64) -> f64,
    line_width: f32,
    color: [f32; 4],
    is_dashed: bool,
    eval_elev: &dyn Fn(&[we_core::model::Elevation], f64) -> f64,
    eval_lane_off: &dyn Fn(&[we_core::model::LaneOffset], f64) -> f64,
    offset_pt: &dyn Fn(&we_core::geometry::eval::RefLinePoint, f64, f64) -> (f64, f64, f64),
) -> Vec<[f32; 7]> {
    let mut verts = Vec::new();
    let z_lift = 0.015f32; // 15mm above road surface (matches C# RoadMarkConfig)
    let half_w = (line_width * 0.5) as f64;
    let dash_len = 4.0f64;   // 4m solid segment (C# standard)
    let cycle = 10.0f64;     // 4m dash + 6m gap = 10m period
    let [r, g, b, a] = color;

    for i in 0..ref_pts.len() - 1 {
        let pt0 = ref_pts[i];
        let pt1 = ref_pts[i + 1];

        if is_dashed {
            let phase = ((pt0.s + pt1.s) / 2.0) % cycle;
            if phase > dash_len {
                continue;
            }
        }

        let z0 = eval_elev(elevations, pt0.s) as f32 + z_lift;
        let z1 = eval_elev(elevations, pt1.s) as f32 + z_lift;
        let ds0 = (pt0.s - section_s).max(0.0);
        let ds1 = (pt1.s - section_s).max(0.0);
        let lateral_offset0 = lateral_offset_at_ds(ds0);
        let lateral_offset1 = lateral_offset_at_ds(ds1);

        let lo0 = eval_lane_off(lane_offsets, pt0.s);
        let lo1 = eval_lane_off(lane_offsets, pt1.s);
        let t0 = lo0 + lateral_offset0;
        let t1 = lo1 + lateral_offset1;

        // Center points at lane-offset-adjusted lateral position, then expand ±half_w
        let (cx0, cy0, _) = offset_pt(pt0, t0, 0.0);
        let (cx1, cy1, _) = offset_pt(pt1, t1, 0.0);
        let (lx0, ly0, _) = offset_pt(pt0, t0 + half_w, 0.0);
        let (rx0, ry0, _) = offset_pt(pt0, t0 - half_w, 0.0);
        let (lx1, ly1, _) = offset_pt(pt1, t1 + half_w, 0.0);
        let (rx1, ry1, _) = offset_pt(pt1, t1 - half_w, 0.0);

        // Suppress unused center coords (used only for readability)
        let _ = (cx0, cy0, cx1, cy1);

        verts.push([lx0 as f32, ly0 as f32, z0, r, g, b, a]);
        verts.push([rx0 as f32, ry0 as f32, z0, r, g, b, a]);
        verts.push([lx1 as f32, ly1 as f32, z1, r, g, b, a]);
        verts.push([rx0 as f32, ry0 as f32, z0, r, g, b, a]);
        verts.push([rx1 as f32, ry1 as f32, z1, r, g, b, a]);
        verts.push([lx1 as f32, ly1 as f32, z1, r, g, b, a]);
    }

    verts
}

/// Evaluate road reference position at a given `s` station.
///
/// Finds the geometry element that covers `s` and evaluates it.
pub(crate) fn road_point_at_s(plan_view: &[we_core::model::Geometry], s: f64) -> Option<we_core::geometry::eval::RefLinePoint> {
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

    let ds = (s - geo.s).clamp(0.0, geo.length);
    Some(evaluate_geometry(geo, ds))
}

/// Build filled triangle geometry for a paint arrow, using a centroid fan.
///
/// `subtype` selects the polygon template. The result is a flat list of 7-float
/// vertex records ready for GPU upload.
fn arrow_triangles(
    subtype: &str,
    cx: f32,
    cy: f32,
    z: f32,
    heading: f32,
    scale: f32,
) -> Vec<f32> {
    // Normalized arrow polygons (local space, y-axis = forward):
    // Coordinates are pre-scaled to approx. ±0.5 range.
    // All are closed outlines (last point equals first).
    let template: &[(f32, f32)] = match subtype {
        "StraightAheadArrow" => &[
            (-0.025, -0.5), (-0.025, 0.1), (-0.075, 0.1),
            (0.0, 0.5), (0.075, 0.1), (0.025, 0.1), (0.025, -0.5),
        ],
        "LeftTurnArrow" => &[
            (0.075, -0.5), (0.075, 0.0), (-0.0583, 0.1333),
            (-0.0583, -0.0167), (-0.125, 0.2333), (-0.0583, 0.5),
            (-0.0583, 0.3333), (0.125, 0.15), (0.125, -0.5),
        ],
        "RightTurnArrow" => &[
            (-0.075, -0.5), (-0.075, 0.0), (0.0583, 0.1333),
            (0.0583, -0.0167), (0.125, 0.2333), (0.0583, 0.5),
            (0.0583, 0.3333), (-0.125, 0.15), (-0.125, -0.5),
        ],
        "UTurnArrow" => &[
            (0.025, -0.5), (0.025, 0.25), (-0.1, 0.25),
            (-0.1, -0.1), (-0.2, 0.0), (-0.1, 0.1), (-0.1, 0.45),
            (0.125, 0.45), (0.125, -0.5),
        ],
        "StraightOrLeftTurnArrow" => &[
            (-0.025, -0.5), (-0.025, 0.1), (-0.075, 0.1),
            (0.0, 0.5), (0.075, 0.1), (0.025, 0.1),
            (0.025, 0.0), (0.1, 0.0), (0.1, -0.5),
        ],
        "StraightOrRightTurnArrow" => &[
            (0.025, -0.5), (0.025, 0.1), (0.075, 0.1),
            (0.0, 0.5), (-0.075, 0.1), (-0.025, 0.1),
            (-0.025, 0.0), (-0.1, 0.0), (-0.1, -0.5),
        ],
        "LeftOrRightTurnArrow" => &[
            (-0.1, -0.2), (-0.1, 0.0), (0.0, 0.5), (0.1, 0.0),
            (0.1, -0.2), (0.05, -0.2), (0.05, -0.5),
            (-0.05, -0.5), (-0.05, -0.2),
        ],
        // Fallback: simple upward arrow for unknown subtypes
        _ => &[
            (-0.025, -0.5), (-0.025, 0.1), (-0.075, 0.1),
            (0.0, 0.5), (0.075, 0.1), (0.025, 0.1), (0.025, -0.5),
        ],
    };

    // The C# transform: rotate by (heading - pi/2) so y-forward local → road forward
    // newX = (v.x * cos0 - v.y * sin0) * scale
    // newY = (v.x * sin0 + v.y * cos0) * scale
    // where cos0/sin0 encode road forward direction
    let cos_h = heading.cos();
    let sin_h = heading.sin();

    let transform = |vx: f32, vy: f32| -> (f32, f32) {
        // Local space: y = forward → rotate so it aligns with road heading
        // heading=0 → east, so forward (+y local) should map to east (+x world)
        // Use: world_x = vx*cos - vy*sin + cx (standard 2D rotation)
        let wx = (vx * cos_h - vy * sin_h) * scale + cx;
        let wy = (vx * sin_h + vy * cos_h) * scale + cy;
        (wx, wy)
    };

    // Compute centroid for fan triangulation
    let n = template.len() as f32;
    let cent_lx: f32 = template.iter().map(|(x, _)| x).sum::<f32>() / n;
    let cent_ly: f32 = template.iter().map(|(_, y)| y).sum::<f32>() / n;
    let (ccx, ccy) = transform(cent_lx, cent_ly);

    let [r, g, b, a] = [1.0f32, 1.0, 1.0, 0.95];
    let mut out = Vec::with_capacity(template.len() * 3 * 7);

    for i in 0..template.len() {
        let j = (i + 1) % template.len();
        let (px0, py0) = transform(template[i].0, template[i].1);
        let (px1, py1) = transform(template[j].0, template[j].1);

        // Triangle: centroid, p0, p1
        out.extend_from_slice(&[ccx, ccy, z, r, g, b, a]);
        out.extend_from_slice(&[px0, py0, z, r, g, b, a]);
        out.extend_from_slice(&[px1, py1, z, r, g, b, a]);
    }

    out
}

/// Marker color for vertical sign types.
fn sign_marker_color(signal_type: &str) -> [f32; 4] {
    match signal_type {
        t if t.starts_with("1000") => [0.2, 0.8, 0.2, 0.9], // traffic lights → green
        "1010203800001413" | "1010203900001613" => [0.9, 0.2, 0.2, 0.9], // speed limit → red
        _ => [0.8, 0.8, 0.1, 0.9], // generic sign → yellow
    }
}

pub(crate) fn append_junction_triangles(
    out: &mut Vec<f32>,
    project: &we_core::model::Project,
    junction: &we_core::model::Junction,
    color: [f32; 4],
) {
    let points = build_junction_polygon_points(project, junction);
    if points.len() < 3 {
        return;
    }
    let n = points.len() as f32;
    let cx: f32 = points.iter().map(|p| p[0]).sum::<f32>() / n;
    let cy: f32 = points.iter().map(|p| p[1]).sum::<f32>() / n;
    let cz: f32 = points.iter().map(|p| p[2]).sum::<f32>() / n;
    let [r, g, b, a] = color;
    for i in 0..points.len() {
        let j = (i + 1) % points.len();
        out.extend_from_slice(&[cx, cy, cz, r, g, b, a]);
        out.extend_from_slice(&[points[i][0], points[i][1], points[i][2], r, g, b, a]);
        out.extend_from_slice(&[points[j][0], points[j][1], points[j][2], r, g, b, a]);
    }
}

pub(crate) fn build_junction_polygon_points(
    project: &we_core::model::Project,
    junction: &we_core::model::Junction,
) -> Vec<[f32; 3]> {
    use we_core::geometry::eval::{evaluate_elevation, evaluate_lane_width, offset_point};

    let mut points: Vec<[f32; 3]> = Vec::new();
    for conn in &junction.connections {
        let Some(connecting) = project.roads.iter().find(|r| r.id == conn.connecting_road) else {
            continue;
        };
        if connecting.render_hidden {
            continue;
        }
        let connecting_s = if conn.contact_point == we_core::model::ContactPoint::Start {
            0.0
        } else {
            connecting.length
        };
        let Some(connecting_pt) = road_point_at_s(&connecting.plan_view, connecting_s) else {
            continue;
        };
        append_road_boundary_points(
            connecting,
            connecting_s,
            &mut points,
            &evaluate_elevation,
            &evaluate_lane_width,
            &offset_point,
        );

        // Incoming road endpoint is not described by connection.contactPoint.
        // Choose start/end by nearest distance to connecting-road contact point.
        let Some(incoming) = project.roads.iter().find(|r| r.id == conn.incoming_road) else {
            continue;
        };
        if incoming.render_hidden {
            continue;
        }
        let Some(in_start) = road_point_at_s(&incoming.plan_view, 0.0) else {
            continue;
        };
        let Some(in_end) = road_point_at_s(&incoming.plan_view, incoming.length) else {
            continue;
        };
        let ds_start =
            (in_start.x - connecting_pt.x).powi(2) + (in_start.y - connecting_pt.y).powi(2);
        let ds_end = (in_end.x - connecting_pt.x).powi(2) + (in_end.y - connecting_pt.y).powi(2);
        let incoming_s = if ds_start <= ds_end { 0.0 } else { incoming.length };
        append_road_boundary_points(
            incoming,
            incoming_s,
            &mut points,
            &evaluate_elevation,
            &evaluate_lane_width,
            &offset_point,
        );
    }

    if points.len() < 3 {
        return points;
    }

    // Deduplicate near-identical points.
    let mut dedup: Vec<[f32; 3]> = Vec::new();
    for p in points {
        if !dedup.iter().any(|q| {
            let dx = p[0] - q[0];
            let dy = p[1] - q[1];
            (dx * dx + dy * dy) < 0.01 // 10cm
        }) {
            dedup.push(p);
        }
    }
    if dedup.len() < 3 {
        return dedup;
    }

    // Sort by polar angle around centroid to build a stable polygon ring.
    let cx: f32 = dedup.iter().map(|p| p[0]).sum::<f32>() / dedup.len() as f32;
    let cy: f32 = dedup.iter().map(|p| p[1]).sum::<f32>() / dedup.len() as f32;
    dedup.sort_by(|a, b| {
        let aa = (a[1] - cy).atan2(a[0] - cx);
        let bb = (b[1] - cy).atan2(b[0] - cx);
        aa.total_cmp(&bb)
    });
    dedup
}

#[allow(clippy::type_complexity)]
fn append_road_boundary_points(
    road: &we_core::model::Road,
    s: f64,
    points: &mut Vec<[f32; 3]>,
    evaluate_elevation: &dyn Fn(&[we_core::model::Elevation], f64) -> f64,
    evaluate_lane_width: &dyn Fn(&[we_core::model::LaneWidth], f64) -> f64,
    offset_point: &dyn Fn(&we_core::geometry::eval::RefLinePoint, f64, f64) -> (f64, f64, f64),
) {
    let Some(ref_pt) = road_point_at_s(&road.plan_view, s) else {
        return;
    };
    let lane_offset = eval_lane_offset(&road.lane_offsets, s);
    let Some(section) = road
        .lane_sections
        .iter()
        .rev()
        .find(|ls| !ls.render_hidden && ls.s <= s + 1e-9)
        .or_else(|| road.lane_sections.iter().find(|ls| !ls.render_hidden))
    else {
        return;
    };
    let ds = (s - section.s).max(0.0);
    let left_width: f64 = section
        .left
        .iter()
        .map(|l| evaluate_lane_width(&l.width, ds))
        .sum();
    let right_width: f64 = section
        .right
        .iter()
        .map(|l| evaluate_lane_width(&l.width, ds))
        .sum();
    let z = evaluate_elevation(&road.elevation_profile, s) as f32 - 0.1;
    let (lx, ly, _) = offset_point(&ref_pt, lane_offset + left_width, 0.0);
    let (rx, ry, _) = offset_point(&ref_pt, lane_offset - right_width, 0.0);
    points.push([lx as f32, ly as f32, z]);
    points.push([rx as f32, ry as f32, z]);
}

pub(crate) fn point_in_polygon(x: f64, y: f64, poly: &[[f32; 3]]) -> bool {
    let mut inside = false;
    let mut j = poly.len() - 1;
    for i in 0..poly.len() {
        let xi = poly[i][0] as f64;
        let yi = poly[i][1] as f64;
        let xj = poly[j][0] as f64;
        let yj = poly[j][1] as f64;
        let intersect = ((yi > y) != (yj > y))
            && (x < (xj - xi) * (y - yi) / ((yj - yi).abs().max(1e-12)) + xi);
        if intersect {
            inside = !inside;
        }
        j = i;
    }
    inside
}

// ── Object geometry helpers ───────────────────────────────────────────────────

/// Function type for offsetting a reference line point by lateral (t) and vertical (z) offsets.
type OffsetPtFn = dyn Fn(&we_core::geometry::eval::RefLinePoint, f64, f64) -> (f64, f64, f64);

/// Emit a transverse bar (stop line, yield line) perpendicular to the road direction.
#[allow(clippy::too_many_arguments)]
fn emit_transverse_bar(
    ref_pt: &we_core::geometry::eval::RefLinePoint,
    t: f64,
    z: f32,
    width: f64,  // lateral full-width
    thickness: f64, // along-road thickness
    color: [f32; 4],
    offset_pt: &OffsetPtFn,
    out: &mut Vec<f32>,
) {
    let [r, g, b, a] = color;
    let half_w = width / 2.0;
    let half_t = thickness / 2.0;
    // Generate a rotated rectangle: 2 points per lateral edge × 2 along-road edges
    // Use heading perpendicular: the road heading gives forward; ±90° gives lateral.
    let hdg = ref_pt.hdg;
    let cos_h = hdg.cos();
    let sin_h = hdg.sin();
    let cos_p = (hdg + std::f64::consts::FRAC_PI_2).cos();
    let sin_p = (hdg + std::f64::consts::FRAC_PI_2).sin();

    let (cx, cy, _) = offset_pt(ref_pt, t, 0.0);

    // 4 corners: forward×(±half_t) + lateral×(±half_w)
    let corners = [
        (cx + cos_h * half_t + cos_p * half_w, cy + sin_h * half_t + sin_p * half_w),
        (cx - cos_h * half_t + cos_p * half_w, cy - sin_h * half_t + sin_p * half_w),
        (cx - cos_h * half_t - cos_p * half_w, cy - sin_h * half_t - sin_p * half_w),
        (cx + cos_h * half_t - cos_p * half_w, cy + sin_h * half_t - sin_p * half_w),
    ];
    // Triangle 1
    out.extend_from_slice(&[corners[0].0 as f32, corners[0].1 as f32, z, r, g, b, a]);
    out.extend_from_slice(&[corners[1].0 as f32, corners[1].1 as f32, z, r, g, b, a]);
    out.extend_from_slice(&[corners[2].0 as f32, corners[2].1 as f32, z, r, g, b, a]);
    // Triangle 2
    out.extend_from_slice(&[corners[0].0 as f32, corners[0].1 as f32, z, r, g, b, a]);
    out.extend_from_slice(&[corners[2].0 as f32, corners[2].1 as f32, z, r, g, b, a]);
    out.extend_from_slice(&[corners[3].0 as f32, corners[3].1 as f32, z, r, g, b, a]);
}

/// Emit a small axis-aligned square marker at (ref_pt offset by t, z).
fn emit_square_marker(
    ref_pt: &we_core::geometry::eval::RefLinePoint,
    t: f64,
    z: f32,
    size: f64,
    color: [f32; 4],
    offset_pt: &OffsetPtFn,
    out: &mut Vec<f32>,
) {
    // Treat the square as a transverse bar with equal width and thickness
    emit_transverse_bar(ref_pt, t, z, size, size, color, offset_pt, out);
}

/// Emit a rectangle outline (4 thick sides) at (ref_pt offset by t, z).
#[allow(clippy::too_many_arguments)]
fn emit_rect_outline(
    ref_pt: &we_core::geometry::eval::RefLinePoint,
    t: f64,
    z: f32,
    width: f64,
    length: f64,
    bar_thickness: f64,
    color: [f32; 4],
    offset_pt: &OffsetPtFn,
    out: &mut Vec<f32>,
) {
    let half_l = length / 2.0;
    // Create a fake ref_pt shifted forward/backward along road for the two longitudinal edges
    // For simplicity, emit 4 transverse bars that form the boundary
    let hdg = ref_pt.hdg;
    let cos_h = hdg.cos();
    let sin_h = hdg.sin();
    let (cx, cy, _) = offset_pt(ref_pt, t, 0.0);
    // Shift ref_pt ±half_l along road direction and emit transverse bars
    let mut front = *ref_pt;
    front.x = ref_pt.x + cos_h * half_l;
    front.y = ref_pt.y + sin_h * half_l;
    let mut back = *ref_pt;
    back.x = ref_pt.x - cos_h * half_l;
    back.y = ref_pt.y - sin_h * half_l;
    emit_transverse_bar(&front, t, z, width, bar_thickness, color, offset_pt, out);
    emit_transverse_bar(&back, t, z, width, bar_thickness, color, offset_pt, out);

    // Left and right longitudinal edges (length × bar_thickness)
    let half_w = width / 2.0;
    // Emit as longitudinal bars (rotate 90°): use the perpendicular direction as "forward"
    let mut perp_pt = *ref_pt;
    perp_pt.hdg = hdg + std::f64::consts::FRAC_PI_2;
    perp_pt.x = cx + (hdg + std::f64::consts::FRAC_PI_2).cos() * half_w;
    perp_pt.y = cy + (hdg + std::f64::consts::FRAC_PI_2).sin() * half_w;
    emit_transverse_bar(&perp_pt, 0.0, z, length, bar_thickness, color, offset_pt, out);
    perp_pt.x = cx - (hdg + std::f64::consts::FRAC_PI_2).cos() * half_w;
    perp_pt.y = cy - (hdg + std::f64::consts::FRAC_PI_2).sin() * half_w;
    emit_transverse_bar(&perp_pt, 0.0, z, length, bar_thickness, color, offset_pt, out);
}

/// Emit crosswalk zebra stripes given corner polygon (road-local u/v coordinates).
///
/// `corners[i].x` = u offset along road from object centre (absolute s = obj_s + u).
/// `corners[i].y` = v offset lateral from road centre line.
///
/// Generates white horizontal stripes (0.45 m wide, 1.0 m period) spanning the full
/// u extent of the crosswalk, in the v (across-road) direction.
fn emit_crosswalk_stripes(
    corners: &[we_core::model::Point3D],
    ref_pts: &[we_core::geometry::eval::RefLinePoint],
    elevations: &[we_core::model::Elevation],
    obj_s: f64,
    z_base: f32,
    offset_pt: &OffsetPtFn,
    out: &mut Vec<f32>,
) {
    use we_core::geometry::eval::evaluate_elevation;

    if corners.len() < 3 || ref_pts.is_empty() {
        return;
    }

    // Compute AABB in road-local (u, v) space.
    // c.x = u  (along-road offset from object centre; absolute road s = obj_s + u)
    // c.y = v  (across-road / lateral offset)
    let u_min = corners.iter().map(|c| c.x).fold(f64::INFINITY, f64::min);
    let u_max = corners.iter().map(|c| c.x).fold(f64::NEG_INFINITY, f64::max);
    let v_min = corners.iter().map(|c| c.y).fold(f64::INFINITY, f64::min);
    let v_max = corners.iter().map(|c| c.y).fold(f64::NEG_INFINITY, f64::max);

    if u_max <= u_min || v_max <= v_min {
        return;
    }

    // Resolve (absolute_s, lateral_t) → world (x, y, z).
    // abs_s must be the absolute road s-coordinate, not the u offset.
    let world_at = |abs_s: f64, t: f64| -> (f32, f32, f32) {
        let rp = ref_pts.iter().min_by(|a, b| {
            (a.s - abs_s)
                .abs()
                .partial_cmp(&(b.s - abs_s).abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        if let Some(rp) = rp {
            let (wx, wy, _) = offset_pt(rp, t, 0.0);
            let z = evaluate_elevation(elevations, rp.s) as f32 + 0.02;
            (wx as f32, wy as f32, z)
        } else {
            (abs_s as f32, t as f32, z_base)
        }
    };

    // White zebra stripes in the v (across-road) direction.
    // stripe_width ≈ 0.45 m; total period = 1.0 m (stripe + gap).
    let stripe_width = 0.45_f64;
    let stripe_period = 1.0_f64;
    let [r, g, b, a]: [f32; 4] = [1.0, 1.0, 1.0, 1.0]; // white

    let abs_u_min = obj_s + u_min;
    let abs_u_max = obj_s + u_max;

    let mut v = v_min;
    while v < v_max {
        let v_end = (v + stripe_width).min(v_max);

        let p00 = world_at(abs_u_min, v);
        let p10 = world_at(abs_u_max, v);
        let p11 = world_at(abs_u_max, v_end);
        let p01 = world_at(abs_u_min, v_end);

        out.extend_from_slice(&[p00.0, p00.1, p00.2, r, g, b, a]);
        out.extend_from_slice(&[p10.0, p10.1, p10.2, r, g, b, a]);
        out.extend_from_slice(&[p11.0, p11.1, p11.2, r, g, b, a]);

        out.extend_from_slice(&[p00.0, p00.1, p00.2, r, g, b, a]);
        out.extend_from_slice(&[p11.0, p11.1, p11.2, r, g, b, a]);
        out.extend_from_slice(&[p01.0, p01.1, p01.2, r, g, b, a]);

        v += stripe_period;
    }
}

/// Emit a polygon outline for area objects (parking space, cross-hatch, etc.)
#[allow(clippy::too_many_arguments)]
fn emit_polygon_outline(
    corners: &[we_core::model::Point3D],
    ref_pts: &[we_core::geometry::eval::RefLinePoint],
    elevations: &[we_core::model::Elevation],
    obj_s: f64,
    z_base: f32,
    bar_thickness: f64,
    color: [f32; 4],
    offset_pt: &OffsetPtFn,
    out: &mut Vec<f32>,
) {
    use we_core::geometry::eval::evaluate_elevation;

    if corners.len() < 2 { return; }

    let world_corners: Vec<(f64, f64, f32)> = corners.iter().map(|c| {
        // c.x = u offset; absolute road s = obj_s + c.x
        let abs_s = obj_s + c.x;
        let nearest = ref_pts.iter().min_by(|a, b| {
            (a.s - abs_s).abs().partial_cmp(&(b.s - abs_s).abs()).unwrap_or(std::cmp::Ordering::Equal)
        });
        if let Some(rp) = nearest {
            let (wx, wy, _) = offset_pt(rp, c.y, 0.0);
            let z = evaluate_elevation(elevations, rp.s) as f32 + c.z as f32 + 0.02;
            (wx, wy, z)
        } else {
            (c.x, c.y, z_base)
        }
    }).collect();

    let [r, g, b, a] = color;
    let hw = bar_thickness / 2.0;
    let n = world_corners.len();

    for i in 0..n {
        let (ax, ay, az) = world_corners[i];
        let (bx, by, bz) = world_corners[(i + 1) % n];
        let dx = bx - ax;
        let dy = by - ay;
        let len = (dx * dx + dy * dy).sqrt().max(1e-9);
        let nx = -dy / len * hw;
        let ny = dx / len * hw;

        let p0 = ((ax + nx) as f32, (ay + ny) as f32, az);
        let p1 = ((ax - nx) as f32, (ay - ny) as f32, az);
        let p2 = ((bx - nx) as f32, (by - ny) as f32, bz);
        let p3 = ((bx + nx) as f32, (by + ny) as f32, bz);

        out.extend_from_slice(&[p0.0, p0.1, p0.2, r, g, b, a]);
        out.extend_from_slice(&[p1.0, p1.1, p1.2, r, g, b, a]);
        out.extend_from_slice(&[p2.0, p2.1, p2.2, r, g, b, a]);
        out.extend_from_slice(&[p0.0, p0.1, p0.2, r, g, b, a]);
        out.extend_from_slice(&[p2.0, p2.1, p2.2, r, g, b, a]);
        out.extend_from_slice(&[p3.0, p3.1, p3.2, r, g, b, a]);
    }
}

/// Emit a thin longitudinal strip (guardrail, barrier) along the road direction.
#[allow(clippy::too_many_arguments)]
fn emit_longitudinal_strip(
    ref_pts: &[we_core::geometry::eval::RefLinePoint],
    elevations: &[we_core::model::Elevation],
    s_start: f64,
    t: f64,
    z_base: f32,
    length: f64,
    half_w: f64,
    color: [f32; 4],
    eval_elev: &dyn Fn(&[we_core::model::Elevation], f64) -> f64,
    offset_pt: &OffsetPtFn,
    out: &mut Vec<f32>,
) {
    let [r, g, b, a] = color;
    let s_end = s_start + length;

    let section_pts: Vec<_> = ref_pts.iter()
        .filter(|p| p.s >= s_start - 1e-9 && p.s <= s_end + 1e-9)
        .collect();

    if section_pts.len() < 2 { return; }

    for i in 0..section_pts.len() - 1 {
        let pt0 = section_pts[i];
        let pt1 = section_pts[i + 1];
        let z0 = eval_elev(elevations, pt0.s) as f32 + z_base - 0.02;
        let z1 = eval_elev(elevations, pt1.s) as f32 + z_base - 0.02;

        let (lx0, ly0, _) = offset_pt(pt0, t + half_w, 0.0);
        let (rx0, ry0, _) = offset_pt(pt0, t - half_w, 0.0);
        let (lx1, ly1, _) = offset_pt(pt1, t + half_w, 0.0);
        let (rx1, ry1, _) = offset_pt(pt1, t - half_w, 0.0);

        out.extend_from_slice(&[lx0 as f32, ly0 as f32, z0, r, g, b, a]);
        out.extend_from_slice(&[rx0 as f32, ry0 as f32, z0, r, g, b, a]);
        out.extend_from_slice(&[lx1 as f32, ly1 as f32, z1, r, g, b, a]);
        out.extend_from_slice(&[rx0 as f32, ry0 as f32, z0, r, g, b, a]);
        out.extend_from_slice(&[rx1 as f32, ry1 as f32, z1, r, g, b, a]);
        out.extend_from_slice(&[lx1 as f32, ly1 as f32, z1, r, g, b, a]);
    }
}

// ── Public wasm_bindgen functions ─────────────────────────────────────────────

/// Generate road mesh vertices from a project JSON. Returns vertex data as Float32Array.
///
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
/// `color_mode` controls surface coloring:
/// - `"byLaneType"` (default): per-lane-type palette
/// - `"single"`: uniform asphalt gray for all lanes
/// - `"byRoad"`: distinct hue per road (golden-angle HSV cycling)
#[wasm_bindgen]
pub fn generate_road_vertices(project_json: &str, sample_step: f64, color_mode: &str) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::{evaluate_elevation, evaluate_lane_width, offset_point, sample_road_reference_line};
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut all_floats = Vec::new();

    for (road_idx, road) in project.roads.iter().enumerate() {
        if road.render_hidden {
            continue;
        }

        let ref_pts = sample_road_reference_line(road, sample_step);
        if ref_pts.len() < 2 {
            continue;
        }

        let mut road_verts: Vec<[f32; 7]> = Vec::new();

        for section in &road.lane_sections {
            if section.render_hidden {
                continue;
            }

            let section_end_s = road
                .lane_sections
                .iter()
                .find(|ls| ls.s > section.s + 1e-9)
                .map(|ls| ls.s)
                .unwrap_or(road.length);

            let section_pts: Vec<_> = ref_pts
                .iter()
                .filter(|p| p.s >= section.s - 1e-9 && p.s <= section_end_s + 1e-9)
                .collect();

            if section_pts.len() < 2 {
                continue;
            }

            // Right lanes (negative IDs, inner to outer)
            let mut right_sorted: Vec<_> = section.right.iter().collect();
            right_sorted.sort_by_key(|l| l.id.abs());
            let mut right_prev_widths: Vec<&[we_core::model::LaneWidth]> = Vec::new();
            for lane in &right_sorted {
                if !lane.render_hidden {
                    let color = select_lane_color(color_mode, lane.lane_type, road_idx);
                    road_verts.extend(gen_lane_strip(
                        &section_pts, &lane.width, section.s,
                        &road.elevation_profile, &road.lane_offsets, &right_prev_widths, false, color,
                        &evaluate_elevation, &evaluate_lane_width, &eval_lane_offset, &offset_point,
                    ));
                }
                right_prev_widths.push(&lane.width);
            }

            // Left lanes (positive IDs, inner to outer)
            let mut left_sorted: Vec<_> = section.left.iter().collect();
            left_sorted.sort_by_key(|l| l.id);
            let mut left_prev_widths: Vec<&[we_core::model::LaneWidth]> = Vec::new();
            for lane in &left_sorted {
                if !lane.render_hidden {
                    let color = select_lane_color(color_mode, lane.lane_type, road_idx);
                    road_verts.extend(gen_lane_strip(
                        &section_pts, &lane.width, section.s,
                        &road.elevation_profile, &road.lane_offsets, &left_prev_widths, true, color,
                        &evaluate_elevation, &evaluate_lane_width, &eval_lane_offset, &offset_point,
                    ));
                }
                left_prev_widths.push(&lane.width);
            }
        }

        // Fall back to default gray ribbon when no lane sections are defined
        if road_verts.is_empty() && road.lane_sections.is_empty() {
            let ribbon_color = match color_mode {
                "single"  => [0.45f32, 0.45, 0.45, 1.0],
                "byRoad"  => road_hue_color(road_idx),
                _         => [0.35, 0.35, 0.38, 1.0],
            };
            road_verts.extend(gen_default_ribbon(
                &ref_pts, &road.elevation_profile, 3.5, ribbon_color,
            ));
        }

        for v in &road_verts {
            all_floats.extend_from_slice(v);
        }
    }

    Ok(all_floats)
}

/// Generate junction surface mesh vertices from a project JSON. Returns Float32Array.
///
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
/// Junction areas are rendered as semi-transparent lavender polygons.
#[wasm_bindgen]
pub fn generate_junction_vertices(project_json: &str) -> Result<Vec<f32>, JsError> {
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut all_floats = Vec::new();
    let color = [0.88f32, 0.85, 0.98, 0.65];

    for junction in &project.junctions {
        append_junction_triangles(&mut all_floats, &project, junction, color);
    }

    Ok(all_floats)
}

/// Generate highlight mesh vertices for a single junction.
#[wasm_bindgen]
pub fn generate_single_junction_vertices(
    project_json: &str,
    junction_id: &str,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
) -> Result<Vec<f32>, JsError> {
    use we_core::model::Project;
    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;
    let mut all_floats = Vec::new();
    if let Some(junction) = project.junctions.iter().find(|j| j.id == junction_id) {
        append_junction_triangles(&mut all_floats, &project, junction, [r, g, b, a]);
    }
    Ok(all_floats)
}

/// Generate lane boundary line vertices from a project JSON. Returns Float32Array.
///
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
/// Generates colored road markings (solid/dashed lines) at each lane boundary.
/// Color and dash pattern are driven by each lane's `road_marks` data.
#[wasm_bindgen]
pub fn generate_lane_line_vertices(
    project_json: &str,
    sample_step: f64,
) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::{evaluate_lane_width, sample_road_reference_line};
    use we_core::model::{Project, RoadMarkType};

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut all_floats = Vec::new();

    for road in &project.roads {
        if road.render_hidden {
            continue;
        }

        let ref_pts = sample_road_reference_line(road, sample_step);
        if ref_pts.len() < 2 {
            continue;
        }

        for section in &road.lane_sections {
            if section.render_hidden {
                continue;
            }

            let section_end_s = road
                .lane_sections
                .iter()
                .find(|ls| ls.s > section.s + 1e-9)
                .map(|ls| ls.s)
                .unwrap_or(road.length);

            let section_pts: Vec<_> = ref_pts
                .iter()
                .filter(|p| p.s >= section.s - 1e-9 && p.s <= section_end_s + 1e-9)
                .collect();

            if section_pts.len() < 2 {
                continue;
            }

            // Center lane road mark at offset 0 (the center dividing line)
            if let Some(center_lane) = section.center.first()
                && !center_lane.render_hidden
                && let Some(rm) = center_lane.road_marks.first()
                && rm.mark_type != RoadMarkType::None
            {
                emit_road_mark(
                    rm, &section_pts, &road.elevation_profile,
                    section.s, &road.lane_offsets, &|_| 0.0,
                    &mut all_floats,
                );
            }

            // Right lane outer boundaries (inner → outer, accumulating offset)
            let mut right_sorted: Vec<_> = section.right.iter().collect();
            right_sorted.sort_by_key(|l| l.id.abs());
            let mut right_prev_widths: Vec<&[we_core::model::LaneWidth]> = Vec::new();
            for lane in &right_sorted {
                if !lane.render_hidden
                    && let Some(rm) = lane.road_marks.first()
                    && rm.mark_type != RoadMarkType::None
                {
                    let mut boundary_widths = right_prev_widths.clone();
                    boundary_widths.push(&lane.width);
                    emit_road_mark(
                        rm, &section_pts, &road.elevation_profile,
                        section.s, &road.lane_offsets,
                        &|ds| -sum_widths_at_ds(&boundary_widths, ds, &evaluate_lane_width),
                        &mut all_floats,
                    );
                }
                right_prev_widths.push(&lane.width);
            }

            // Left lane outer boundaries
            let mut left_sorted: Vec<_> = section.left.iter().collect();
            left_sorted.sort_by_key(|l| l.id);
            let mut left_prev_widths: Vec<&[we_core::model::LaneWidth]> = Vec::new();
            for lane in &left_sorted {
                if !lane.render_hidden
                    && let Some(rm) = lane.road_marks.first()
                    && rm.mark_type != RoadMarkType::None
                {
                    let mut boundary_widths = left_prev_widths.clone();
                    boundary_widths.push(&lane.width);
                    emit_road_mark(
                        rm, &section_pts, &road.elevation_profile,
                        section.s, &road.lane_offsets,
                        &|ds| sum_widths_at_ds(&boundary_widths, ds, &evaluate_lane_width),
                        &mut all_floats,
                    );
                }
                left_prev_widths.push(&lane.width);
            }
        }
    }

    Ok(all_floats)
}

/// Generate reference line (centerline) visualization vertices from a project JSON.
///
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
/// Draws a thin colored ribbon along each road's reference line:
/// blue for regular roads, orange for roads inside junctions.
#[wasm_bindgen]
pub fn generate_center_line_vertices(
    project_json: &str,
    sample_step: f64,
) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::{evaluate_elevation, offset_point, sample_road_reference_line};
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut all_floats = Vec::new();
    let line_half_w = 0.10f64; // 0.2m wide ribbon
    let z_lift = 0.02f32;

    for road in &project.roads {
        let ref_pts = sample_road_reference_line(road, sample_step);
        if ref_pts.len() < 2 {
            continue;
        }

        // Orange for connecting roads inside a junction, blue for normal roads
        let [r, g, b, a]: [f32; 4] = if road.junction_id.is_some() {
            [1.0, 0.6, 0.0, 0.85]
        } else {
            [0.0, 0.5, 1.0, 0.85]
        };

        for i in 0..ref_pts.len() - 1 {
            let pt0 = &ref_pts[i];
            let pt1 = &ref_pts[i + 1];

            let z0 = evaluate_elevation(&road.elevation_profile, pt0.s) as f32 + z_lift;
            let z1 = evaluate_elevation(&road.elevation_profile, pt1.s) as f32 + z_lift;

            let (lx0, ly0, _) = offset_point(pt0, line_half_w, 0.0);
            let (rx0, ry0, _) = offset_point(pt0, -line_half_w, 0.0);
            let (lx1, ly1, _) = offset_point(pt1, line_half_w, 0.0);
            let (rx1, ry1, _) = offset_point(pt1, -line_half_w, 0.0);

            all_floats.extend_from_slice(&[lx0 as f32, ly0 as f32, z0, r, g, b, a]);
            all_floats.extend_from_slice(&[rx0 as f32, ry0 as f32, z0, r, g, b, a]);
            all_floats.extend_from_slice(&[lx1 as f32, ly1 as f32, z1, r, g, b, a]);
            all_floats.extend_from_slice(&[rx0 as f32, ry0 as f32, z0, r, g, b, a]);
            all_floats.extend_from_slice(&[rx1 as f32, ry1 as f32, z1, r, g, b, a]);
            all_floats.extend_from_slice(&[lx1 as f32, ly1 as f32, z1, r, g, b, a]);
        }
    }

    Ok(all_floats)
}

/// Generate road mesh vertices for a single road. Returns Float32Array.
///
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
/// The `color` parameter is [r, g, b, a] in 0..1 range.
/// Used for selection highlight rendering (overrides per-lane colors).
#[wasm_bindgen]
pub fn generate_single_road_vertices(
    road_json: &str,
    sample_step: f64,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::sample_road_reference_line;

    let road: we_core::model::Road =
        serde_json::from_str(road_json).map_err(|e| JsError::new(&e.to_string()))?;

    let ref_pts = sample_road_reference_line(&road, sample_step);
    let mesh_verts = gen_default_ribbon(&ref_pts, &road.elevation_profile, 3.5, [r, g, b, a]);

    let mut floats = Vec::with_capacity(mesh_verts.len() * 7);
    for v in &mesh_verts {
        floats.extend_from_slice(v);
    }
    Ok(floats)
}

/// Generate signal paint mark vertices from a project JSON. Returns Float32Array.
///
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
///
/// For `type="Graphics"` signals (road paint arrows), the corresponding arrow
/// polygon is triangulated and placed on the road surface using the signal's
/// s/t position and h_offset heading.
///
/// For other signal types (vertical signs), a small colored diamond marker is
/// placed at the signal position slightly above the road surface.
///
/// # TODO: [Phase 3] Rendering enhancement — replace flat diamond markers with sprite-based
/// traffic sign icons (similar to worldeditoronline SpriteSignalRenderer). Currently rendered
/// as colored point markers; sign types are color-coded (green=traffic lights, red=speed limit,
/// yellow=generic). Lane colors already match the reference (verified against RoadTessellator.ts).
#[wasm_bindgen]
pub fn generate_signal_paint_vertices(
    project_json: &str,
    _sample_step: f64,
) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::{evaluate_elevation, offset_point};
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut all_floats = Vec::new();

    for road in &project.roads {
        if road.signals.is_empty() {
            continue;
        }

        for signal in &road.signals {
            // Evaluate road reference line at signal.s
            let Some(ref_pt) = road_point_at_s(&road.plan_view, signal.s) else {
                continue;
            };

            let z_road = evaluate_elevation(&road.elevation_profile, signal.s) as f32;

            if signal.signal_type == "Graphics" {
                // Paint arrow on the road surface
                let (cx, cy, _) = offset_point(&ref_pt, signal.t, 0.0);
                let heading = ref_pt.hdg + signal.h_offset;
                let scale = if signal.width > 0.0 { signal.width } else { 3.0 };
                let z = z_road + 0.02; // 2 cm above road surface

                let tris = arrow_triangles(&signal.signal_subtype, cx as f32, cy as f32, z, heading as f32, scale as f32);
                all_floats.extend(tris);
            } else {
                // Vertical sign: render as a small diamond marker above the road
                let (mx, my, _) = offset_point(&ref_pt, signal.t, 0.0);
                let z = z_road + 0.5; // 50 cm above road (approximate pole height)
                let sz = 0.4f32; // marker half-size
                let [r, g, b, a] = sign_marker_color(&signal.signal_type);

                // Two triangles forming a diamond (tilted square)
                //   top  (-y)
                //  left  (-x)  right (+x)
                //   bot  (+y)
                let top = [mx as f32, my as f32 - sz, z + sz];
                let bot = [mx as f32, my as f32 + sz, z - sz];
                let lft = [mx as f32 - sz, my as f32, z];
                let rgt = [mx as f32 + sz, my as f32, z];

                for p in &[top, lft, bot, top, bot, rgt] {
                    all_floats.extend_from_slice(&[p[0], p[1], p[2], r, g, b, a]);
                }
            }
        }
    }

    Ok(all_floats)
}

/// Generate road mesh data as JSON from a single road's geometry.
///
/// Generate road object vertices from a project JSON. Returns vertex data as Float32Array.
///
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
///
/// Renders the following object types:
/// - `StopLine`: white transverse bar (0.4 m thick) across the road.
/// - `Crosswalk`: navy-blue zebra stripes (0.45 m stripes / 0.6 m gaps) or outline box.
/// - `ParkingSpace`: olive-green boundary polygon.
/// - `CrossHatchArea`: orange boundary polygon.
/// - `WovenArea`: hot-pink boundary polygon.
/// - `ForwardWaitingArea`, `TurnLeftWaitingArea`: white boundary box.
/// - `SlowDownToYieldLine`: sky-blue transverse bar.
/// - `StopToYieldLine`: red transverse bar.
/// - `Guardrail`, `Barrier`: colored thin strip along the road direction.
/// - Other: small colored square marker.
#[wasm_bindgen]
pub fn generate_object_vertices(project_json: &str) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::{evaluate_elevation, offset_point, sample_road_reference_line};
    use we_core::model::{ObjectType, Project};

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut all_floats = Vec::new();

    for road in &project.roads {
        if road.render_hidden || road.objects.is_empty() {
            continue;
        }

        let ref_pts = sample_road_reference_line(road, 1.0);
        if ref_pts.len() < 2 {
            continue;
        }

        for obj in &road.objects {
            let s = obj.position.x;
            let t = obj.position.y;
            let z_offset = obj.position.z as f32;

            // Find reference line point at object s-coordinate
            let Some(ref_pt) = road_point_at_s(&road.plan_view, s) else { continue };
            let z_road = evaluate_elevation(&road.elevation_profile, s) as f32 + z_offset + 0.02;

            match &obj.object_type {
                ObjectType::StopLine => {
                    // White transverse bar 0.4m thick, width = obj.width or full lane width
                    let bar_w = if obj.width > 0.0 { obj.width } else { 3.5 };
                    emit_transverse_bar(
                        &ref_pt, t, z_road, bar_w, 0.4, [1.0, 1.0, 1.0, 1.0],
                        &offset_point, &mut all_floats,
                    );
                }
                ObjectType::SlowDownToYieldLine => {
                    // Sky-blue transverse bar
                    let bar_w = if obj.width > 0.0 { obj.width } else { 3.5 };
                    emit_transverse_bar(
                        &ref_pt, t, z_road, bar_w, 0.4,
                        [0.000, 0.749, 1.000, 1.0], // (0,191,255)
                        &offset_point, &mut all_floats,
                    );
                }
                ObjectType::StopToYieldLine => {
                    // Red transverse bar
                    let bar_w = if obj.width > 0.0 { obj.width } else { 3.5 };
                    emit_transverse_bar(
                        &ref_pt, t, z_road, bar_w, 0.3,
                        [0.816, 0.008, 0.106, 1.0], // (208,2,27)
                        &offset_point, &mut all_floats,
                    );
                }
                ObjectType::Crosswalk => {
                    if !obj.corners.is_empty() {
                        // Corner-based zebra stripe generation
                        emit_crosswalk_stripes(
                            &obj.corners, &ref_pts, &road.elevation_profile, s,
                            z_road, &offset_point, &mut all_floats,
                        );
                    } else {
                        // Fallback: navy rectangle outline
                        let len = if obj.length > 0.0 { obj.length } else { 4.0 };
                        let wid = if obj.width > 0.0 { obj.width } else { 3.5 };
                        emit_rect_outline(
                            &ref_pt, t, z_road, wid, len, 0.3,
                            [0.000, 0.000, 0.502, 1.0], // navy
                            &offset_point, &mut all_floats,
                        );
                    }
                }
                ObjectType::ParkingSpace => {
                    // Olive-green boundary
                    if !obj.corners.is_empty() {
                        emit_polygon_outline(
                            &obj.corners, &ref_pts, &road.elevation_profile, s,
                            z_road, 0.15,
                            [0.424, 0.549, 0.278, 1.0], // (108,140,71)
                            &offset_point, &mut all_floats,
                        );
                    } else {
                        let len = if obj.length > 0.0 { obj.length } else { 5.0 };
                        let wid = if obj.width > 0.0 { obj.width } else { 2.5 };
                        emit_rect_outline(
                            &ref_pt, t, z_road, wid, len, 0.12,
                            [0.424, 0.549, 0.278, 1.0],
                            &offset_point, &mut all_floats,
                        );
                    }
                }
                ObjectType::CrossHatchArea => {
                    // Orange boundary
                    if !obj.corners.is_empty() {
                        emit_polygon_outline(
                            &obj.corners, &ref_pts, &road.elevation_profile, s,
                            z_road, 0.15,
                            [0.965, 0.651, 0.137, 1.0], // (246,166,35)
                            &offset_point, &mut all_floats,
                        );
                    } else {
                        let len = if obj.length > 0.0 { obj.length } else { 5.0 };
                        let wid = if obj.width > 0.0 { obj.width } else { 3.0 };
                        emit_rect_outline(
                            &ref_pt, t, z_road, wid, len, 0.15,
                            [0.965, 0.651, 0.137, 1.0],
                            &offset_point, &mut all_floats,
                        );
                    }
                }
                ObjectType::WovenArea => {
                    // Hot-pink boundary
                    let color = [1.000, 0.051, 0.651, 1.0]; // (255,13,166)
                    if !obj.corners.is_empty() {
                        emit_polygon_outline(
                            &obj.corners, &ref_pts, &road.elevation_profile, s,
                            z_road, 0.15, color, &offset_point, &mut all_floats,
                        );
                    } else {
                        let len = if obj.length > 0.0 { obj.length } else { 5.0 };
                        let wid = if obj.width > 0.0 { obj.width } else { 3.5 };
                        emit_rect_outline(
                            &ref_pt, t, z_road, wid, len, 0.15, color,
                            &offset_point, &mut all_floats,
                        );
                    }
                }
                ObjectType::ForwardWaitingArea | ObjectType::TurnLeftWaitingArea => {
                    // White boundary box
                    let len = if obj.length > 0.0 { obj.length } else { 4.0 };
                    let wid = if obj.width > 0.0 { obj.width } else { 3.5 };
                    emit_rect_outline(
                        &ref_pt, t, z_road, wid, len, 0.15,
                        [1.0, 1.0, 1.0, 0.9],
                        &offset_point, &mut all_floats,
                    );
                }
                ObjectType::Guardrail => {
                    // Dark thin strip along road direction
                    let len = if obj.length > 0.0 { obj.length } else { 5.0 };
                    emit_longitudinal_strip(
                        &ref_pts, &road.elevation_profile, s, t, z_road, len, 0.2,
                        [0.173, 0.173, 0.173, 1.0], // (44,44,44)
                        &evaluate_elevation, &offset_point, &mut all_floats,
                    );
                }
                ObjectType::Barrier => {
                    let len = if obj.length > 0.0 { obj.length } else { 5.0 };
                    emit_longitudinal_strip(
                        &ref_pts, &road.elevation_profile, s, t, z_road, len, 0.3,
                        [0.800, 0.600, 0.200, 1.0], // orange
                        &evaluate_elevation, &offset_point, &mut all_floats,
                    );
                }
                ObjectType::SimpleSignalPole | ObjectType::TrafficLightPole => {
                    // Cyan / blue-purple small square marker
                    let color = match &obj.object_type {
                        ObjectType::TrafficLightPole => [0.400, 0.251, 1.000, 1.0],
                        _ => [0.000, 1.000, 1.000, 1.0],
                    };
                    emit_square_marker(&ref_pt, t, z_road, 0.6, color, &offset_point, &mut all_floats);
                }
                ObjectType::StreetLightPole => {
                    emit_square_marker(
                        &ref_pt, t, z_road, 0.6,
                        [0.612, 0.553, 0.839, 1.0], // lavender (156,141,214)
                        &offset_point, &mut all_floats,
                    );
                }
                ObjectType::SignGantry => {
                    emit_square_marker(
                        &ref_pt, t, z_road, 1.0,
                        [0.071, 0.455, 0.212, 1.0], // dark green (18,116,54)
                        &offset_point, &mut all_floats,
                    );
                }
                ObjectType::Sign | ObjectType::Pillar | ObjectType::TrafficCone
                | ObjectType::LTypeSignalPole => {
                    let size = if obj.width > 0.0 { obj.width.min(1.0) } else { 0.5 };
                    emit_square_marker(
                        &ref_pt, t, z_road, size,
                        [0.9, 0.9, 0.9, 1.0],
                        &offset_point, &mut all_floats,
                    );
                }
                _ => {} // Curb, Wall, Custom — omit for now
            }
        }
    }

    Ok(all_floats)
}

/// Progressive WASM data pipeline (#6): validates that we-core geometry types
/// can be deserialized from JSON, mesh-generated, and returned as JSON vertices.
/// Returns a JSON object with "vertices" (array of [x,y,z,r,g,b,a]) and "count".
///
/// Input JSON: serialized `we_core::model::Road`.
/// Output JSON: `{ "vertices": [[x,y,z,r,g,b,a], ...], "count": N }`
// TODO: [Phase 3] 待实现 — replace the simple ribbon bridge with full WASM road mesh generation
#[wasm_bindgen]
pub fn generate_road_mesh_from_json(road_json: &str, sample_step: f64) -> Result<String, JsError> {
    use we_core::geometry::eval::{evaluate_elevation, offset_point, sample_road_reference_line};
    use we_core::model::Road;

    let road: Road =
        serde_json::from_str(road_json).map_err(|e| JsError::new(&e.to_string()))?;

    if road.render_hidden {
        return Ok(r#"{"vertices":[],"count":0}"#.to_string());
    }

    let ref_pts = sample_road_reference_line(&road, sample_step);
    if ref_pts.len() < 2 {
        return Ok(r#"{"vertices":[],"count":0}"#.to_string());
    }

    // Generate a simple ribbon mesh (same as gen_default_ribbon)
    let half_width = 3.5;
    let color = [0.35_f32, 0.35, 0.38, 1.0];
    let mut vertices: Vec<[f64; 7]> = Vec::new();

    for i in 0..ref_pts.len() - 1 {
        let pt0 = &ref_pts[i];
        let pt1 = &ref_pts[i + 1];
        let z0 = evaluate_elevation(&road.elevation_profile, pt0.s);
        let z1 = evaluate_elevation(&road.elevation_profile, pt1.s);
        let (lx0, ly0, _) = offset_point(pt0, half_width, 0.0);
        let (rx0, ry0, _) = offset_point(pt0, -half_width, 0.0);
        let (lx1, ly1, _) = offset_point(pt1, half_width, 0.0);
        let (rx1, ry1, _) = offset_point(pt1, -half_width, 0.0);

        for v in &[[lx0, ly0, z0], [rx0, ry0, z0], [lx1, ly1, z1],
                   [rx0, ry0, z0], [rx1, ry1, z1], [lx1, ly1, z1]] {
            vertices.push([v[0], v[1], v[2], color[0] as f64, color[1] as f64, color[2] as f64, color[3] as f64]);
        }
    }

    let result = serde_json::json!({
        "vertices": vertices,
        "count": vertices.len()
    });
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// Generate a default lane section as JSON.
///
/// Creates symmetric layout with `n_lanes` per side at `lane_width` meters.
#[wasm_bindgen]
pub fn generate_default_lane_section(
    s: f64,
    n_lanes_per_side: u32,
    lane_width: f64,
    with_shoulder: bool,
) -> Result<String, JsError> {
    let section = we_core::lane_ops::generate_default_lane_section(
        s,
        n_lanes_per_side,
        lane_width,
        with_shoulder,
    );
    serde_json::to_string(&section).map_err(|e| JsError::new(&e.to_string()))
}
