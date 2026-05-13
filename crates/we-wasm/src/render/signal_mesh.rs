/// Build filled triangle geometry for a paint arrow, using a centroid fan.
///
/// `subtype` selects the polygon template. The result is a flat list of 7-float
/// vertex records ready for GPU upload.
pub(super) fn arrow_triangles(
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
            (-0.025, -0.5),
            (-0.025, 0.1),
            (-0.075, 0.1),
            (0.0, 0.5),
            (0.075, 0.1),
            (0.025, 0.1),
            (0.025, -0.5),
        ],
        "LeftTurnArrow" => &[
            (0.075, -0.5),
            (0.075, 0.0),
            (-0.0583, 0.1333),
            (-0.0583, -0.0167),
            (-0.125, 0.2333),
            (-0.0583, 0.5),
            (-0.0583, 0.3333),
            (0.125, 0.15),
            (0.125, -0.5),
        ],
        "RightTurnArrow" => &[
            (-0.075, -0.5),
            (-0.075, 0.0),
            (0.0583, 0.1333),
            (0.0583, -0.0167),
            (0.125, 0.2333),
            (0.0583, 0.5),
            (0.0583, 0.3333),
            (-0.125, 0.15),
            (-0.125, -0.5),
        ],
        "UTurnArrow" => &[
            (0.025, -0.5),
            (0.025, 0.25),
            (-0.1, 0.25),
            (-0.1, -0.1),
            (-0.2, 0.0),
            (-0.1, 0.1),
            (-0.1, 0.45),
            (0.125, 0.45),
            (0.125, -0.5),
        ],
        "StraightOrLeftTurnArrow" => &[
            (-0.025, -0.5),
            (-0.025, 0.1),
            (-0.075, 0.1),
            (0.0, 0.5),
            (0.075, 0.1),
            (0.025, 0.1),
            (0.025, 0.0),
            (0.1, 0.0),
            (0.1, -0.5),
        ],
        "StraightOrRightTurnArrow" => &[
            (0.025, -0.5),
            (0.025, 0.1),
            (0.075, 0.1),
            (0.0, 0.5),
            (-0.075, 0.1),
            (-0.025, 0.1),
            (-0.025, 0.0),
            (-0.1, 0.0),
            (-0.1, -0.5),
        ],
        "LeftOrRightTurnArrow" => &[
            (-0.1, -0.2),
            (-0.1, 0.0),
            (0.0, 0.5),
            (0.1, 0.0),
            (0.1, -0.2),
            (0.05, -0.2),
            (0.05, -0.5),
            (-0.05, -0.5),
            (-0.05, -0.2),
        ],
        // Fallback: simple upward arrow for unknown subtypes
        _ => &[
            (-0.025, -0.5),
            (-0.025, 0.1),
            (-0.075, 0.1),
            (0.0, 0.5),
            (0.075, 0.1),
            (0.025, 0.1),
            (0.025, -0.5),
        ],
    };

    // Rotate by (heading - π/2) so local +y maps to road forward direction.
    // Using the identity: cos(h-π/2)=sin(h), sin(h-π/2)=-cos(h), the standard
    // rotation matrix simplifies to:
    //   wx = (vx * sin_h + vy * cos_h) * scale
    //   wy = (-vx * cos_h + vy * sin_h) * scale
    let cos_h = heading.cos();
    let sin_h = heading.sin();

    let transform = |vx: f32, vy: f32| -> (f32, f32) {
        // Local +y (arrow tip) → road forward (cos heading, sin heading)
        let wx = (vx * sin_h + vy * cos_h) * scale + cx;
        let wy = (-vx * cos_h + vy * sin_h) * scale + cy;
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
pub(super) fn sign_marker_color(signal_type: &str) -> [f32; 4] {
    match signal_type {
        t if t.starts_with("1000") => [0.2, 0.8, 0.2, 0.9], // traffic lights → green
        "1010203800001413" | "1010203900001613" => [0.9, 0.2, 0.2, 0.9], // speed limit → red
        _ => [0.8, 0.8, 0.1, 0.9],                          // generic sign → yellow
    }
}

// ── Object geometry helpers ───────────────────────────────────────────────────

/// Function type for offsetting a reference line point by lateral (t) and vertical (z) offsets.
type OffsetPtFn = dyn Fn(&we_core::geometry::eval::RefLinePoint, f64, f64) -> (f64, f64, f64);

/// Emit a transverse bar (stop line, yield line) perpendicular to the road direction.
#[allow(clippy::too_many_arguments)]
pub(super) fn emit_transverse_bar(
    ref_pt: &we_core::geometry::eval::RefLinePoint,
    t: f64,
    z: f32,
    width: f64,     // lateral full-width
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
        (
            cx + cos_h * half_t + cos_p * half_w,
            cy + sin_h * half_t + sin_p * half_w,
        ),
        (
            cx - cos_h * half_t + cos_p * half_w,
            cy - sin_h * half_t + sin_p * half_w,
        ),
        (
            cx - cos_h * half_t - cos_p * half_w,
            cy - sin_h * half_t - sin_p * half_w,
        ),
        (
            cx + cos_h * half_t - cos_p * half_w,
            cy + sin_h * half_t - sin_p * half_w,
        ),
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
pub(super) fn emit_square_marker(
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
pub(super) fn emit_rect_outline(
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
    emit_transverse_bar(
        &perp_pt,
        0.0,
        z,
        length,
        bar_thickness,
        color,
        offset_pt,
        out,
    );
    perp_pt.x = cx - (hdg + std::f64::consts::FRAC_PI_2).cos() * half_w;
    perp_pt.y = cy - (hdg + std::f64::consts::FRAC_PI_2).sin() * half_w;
    emit_transverse_bar(
        &perp_pt,
        0.0,
        z,
        length,
        bar_thickness,
        color,
        offset_pt,
        out,
    );
}

/// Emit crosswalk zebra stripes given corner polygon (road-local u/v coordinates).
///
/// `corners[i].x` = u offset along road from object centre (absolute s = obj_s + u).
/// `corners[i].y` = v offset lateral from road centre line.
///
/// Generates white horizontal stripes (0.45 m wide, 1.0 m period) spanning the full
/// u extent of the crosswalk, in the v (across-road) direction.
pub(super) fn emit_crosswalk_stripes(
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
    let u_max = corners
        .iter()
        .map(|c| c.x)
        .fold(f64::NEG_INFINITY, f64::max);
    let v_min = corners.iter().map(|c| c.y).fold(f64::INFINITY, f64::min);
    let v_max = corners
        .iter()
        .map(|c| c.y)
        .fold(f64::NEG_INFINITY, f64::max);

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
pub(super) fn emit_polygon_outline(
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

    if corners.len() < 2 {
        return;
    }

    let world_corners: Vec<(f64, f64, f32)> = corners
        .iter()
        .map(|c| {
            // c.x = u offset; absolute road s = obj_s + c.x
            let abs_s = obj_s + c.x;
            let nearest = ref_pts.iter().min_by(|a, b| {
                (a.s - abs_s)
                    .abs()
                    .partial_cmp(&(b.s - abs_s).abs())
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            if let Some(rp) = nearest {
                let (wx, wy, _) = offset_pt(rp, c.y, 0.0);
                let z = evaluate_elevation(elevations, rp.s) as f32 + c.z as f32 + 0.02;
                (wx, wy, z)
            } else {
                (c.x, c.y, z_base)
            }
        })
        .collect();

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
pub(super) fn emit_longitudinal_strip(
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

    let section_pts: Vec<_> = ref_pts
        .iter()
        .filter(|p| p.s >= s_start - 1e-9 && p.s <= s_end + 1e-9)
        .collect();

    if section_pts.len() < 2 {
        return;
    }

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
