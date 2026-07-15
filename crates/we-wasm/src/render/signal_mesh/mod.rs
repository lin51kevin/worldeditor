/// Marker color for vertical sign types.
pub(crate) fn sign_marker_color(signal_type: &str) -> [f32; 4] {
    match signal_type {
        t if t.starts_with("1000") => [0.2, 0.8, 0.2, 0.9], // traffic lights → green
        "1010203800001413" | "1010203900001613" => [0.9, 0.2, 0.2, 0.9], // speed limit → red
        _ => [0.8, 0.8, 0.1, 0.9],                          // generic sign → yellow
    }
}

// ── Object geometry helpers ───────────────────────────────────────────────────

/// Emit a transverse bar (stop line, yield line) perpendicular to the road direction.
#[allow(clippy::too_many_arguments)]
pub(super) fn emit_transverse_bar(
    ref_pt: &we_core::geometry::eval::RefLinePoint,
    t: f64,
    z: f32,
    width: f64,     // lateral full-width
    thickness: f64, // along-road thickness
    color: [f32; 4],
    offset_pt: &impl Fn(&we_core::geometry::eval::RefLinePoint, f64, f64) -> (f64, f64, f64),
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
    offset_pt: &impl Fn(&we_core::geometry::eval::RefLinePoint, f64, f64) -> (f64, f64, f64),
    out: &mut Vec<f32>,
) {
    // Treat the square as a transverse bar with equal width and thickness
    emit_transverse_bar(ref_pt, t, z, size, size, color, offset_pt, out);
}

/// Emit a rectangle outline (4 thick sides) at (ref_pt offset by t, z).
///
/// When `obj_hdg` is provided (non-zero), the rectangle is rotated by the object's heading
/// relative to the road direction. This is needed for objects like parking spaces whose
/// local coordinate system differs from the road direction.
#[allow(clippy::too_many_arguments)]
pub(super) fn emit_rect_outline(
    ref_pt: &we_core::geometry::eval::RefLinePoint,
    t: f64,
    z: f32,
    width: f64,
    length: f64,
    bar_thickness: f64,
    color: [f32; 4],
    obj_hdg: f64,
    offset_pt: &impl Fn(&we_core::geometry::eval::RefLinePoint, f64, f64) -> (f64, f64, f64),
    out: &mut Vec<f32>,
) {
    let half_l = length / 2.0;
    // Create a fake ref_pt shifted forward/backward along road for the two longitudinal edges
    // For simplicity, emit 4 transverse bars that form the boundary
    let hdg = ref_pt.hdg + obj_hdg;
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

/// Find the alpha (along-road) intersection points of a horizontal scan line at `beta`
/// with a world-space polygon, using the tangent-plane coordinate system.
///
/// Returns sorted alpha values where the scan line enters/exits the polygon.
/// The caller should process pairs `[a0, a1], [a2, a3], ...` as inside segments.
///
/// # Parameters
/// - `world_poly`: world-space polygon vertices `(x, y)` in order
/// - `ox, oy`: world-space origin of the tangent plane
/// - `cos_t, sin_t`: cosine/sine of road heading at origin
/// - `alpha_min, alpha_max`: along-road AABB of the polygon (for scan line extent)
/// - `beta`: lateral position at which to intersect (in road-frame)
#[allow(dead_code, clippy::too_many_arguments)]
fn clip_scanline_alpha(
    world_poly: &[(f64, f64)],
    ox: f64,
    oy: f64,
    cos_t: f64,
    sin_t: f64,
    alpha_min: f64,
    alpha_max: f64,
    beta: f64,
) -> Vec<f64> {
    let n = world_poly.len();
    if n < 3 {
        return vec![];
    }
    // Scan line endpoints in world space — extend 1 m past the AABB so the line
    // fully spans the polygon regardless of floating-point boundary touches.
    let world_xy = |alpha: f64, b: f64| -> (f64, f64) {
        (
            ox + alpha * cos_t - b * sin_t,
            oy + alpha * sin_t + b * cos_t,
        )
    };
    let (sx0, sy0) = world_xy(alpha_min - 1.0, beta);
    let (sx1, sy1) = world_xy(alpha_max + 1.0, beta);
    let dx_line = sx1 - sx0;
    let dy_line = sy1 - sy0;

    let mut hits = Vec::new();
    for i in 0..n {
        let j = (i + 1) % n;
        let (ax, ay) = world_poly[i];
        let (bx, by) = world_poly[j];
        let dx_edge = bx - ax;
        let dy_edge = by - ay;
        let denom = dx_line * dy_edge - dy_line * dx_edge;
        if denom.abs() < 1e-12 {
            continue; // scan line is parallel to this edge
        }
        let t_line = ((ax - sx0) * dy_edge - (ay - sy0) * dx_edge) / denom;
        let t_edge = ((ax - sx0) * dy_line - (ay - sy0) * dx_line) / denom;
        if (-1e-9..=1.0 + 1e-9).contains(&t_edge) {
            // Project hit back to alpha coordinate along the scan line
            let hit_alpha = alpha_min - 1.0 + t_line * (alpha_max - alpha_min + 2.0);
            hits.push(hit_alpha);
        }
    }
    hits.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    hits
}

/// Find the lateral intersection points of a scan line at position `s_coord` along the
/// sweep direction with a world-space polygon.
///
/// The sweep coordinate system is defined by `(cos_sw, sin_sw)` as the along-sweep direction.
/// Returns sorted lateral values where the scan line enters/exits the polygon.
#[allow(clippy::too_many_arguments)]
fn clip_scanline_lateral(
    world_poly: &[(f64, f64)],
    ox: f64,
    oy: f64,
    cos_sw: f64,
    sin_sw: f64,
    l_min: f64,
    l_max: f64,
    s_coord: f64,
) -> Vec<f64> {
    let n = world_poly.len();
    if n < 3 {
        return vec![];
    }
    let world_from_sweep = |s: f64, l: f64| -> (f64, f64) {
        (ox + s * cos_sw - l * sin_sw, oy + s * sin_sw + l * cos_sw)
    };
    let (sx0, sy0) = world_from_sweep(s_coord, l_min - 1.0);
    let (sx1, sy1) = world_from_sweep(s_coord, l_max + 1.0);
    let dx_line = sx1 - sx0;
    let dy_line = sy1 - sy0;

    let mut hits = Vec::new();
    for i in 0..n {
        let j = (i + 1) % n;
        let (ax, ay) = world_poly[i];
        let (bx, by) = world_poly[j];
        let dx_edge = bx - ax;
        let dy_edge = by - ay;
        let denom = dx_line * dy_edge - dy_line * dx_edge;
        if denom.abs() < 1e-12 {
            continue;
        }
        let t_line = ((ax - sx0) * dy_edge - (ay - sy0) * dx_edge) / denom;
        let t_edge = ((ax - sx0) * dy_line - (ay - sy0) * dx_line) / denom;
        if (-1e-9..=1.0 + 1e-9).contains(&t_edge) {
            let hit_l = l_min - 1.0 + t_line * (l_max - l_min + 2.0);
            hits.push(hit_l);
        }
    }
    hits.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    hits
}

/// Detect whether a crosswalk's `cornerLocal` coordinates are stored in the
/// object's own heading frame (apply `obj_hdg` rotation) or already in the
/// road frame (identity).
///
/// This is the single source of truth shared by [`emit_crosswalk_stripes`]
/// (which draws the zebra surface) and [`crosswalk_world_polygon`] (used for
/// the selection-highlight outline and picking), so the outline always matches
/// the rendered stripes.
///
/// See `emit_crosswalk_stripes` for the detailed rationale behind each case.
pub(crate) fn detect_crosswalk_apply_hdg(
    corners: &[we_core::model::Point3D],
    obj_hdg: f64,
    obj_length: f64,
    obj_width: f64,
) -> bool {
    if obj_length > 0.0 && obj_width > 0.0 {
        // Case 1: hdg ≈ ±π — always treat as object-local (aspect ratio is ambiguous).
        let hdg_near_pi = (obj_hdg.abs() - std::f64::consts::PI).abs() < 0.17; // ≈ 10°
        if hdg_near_pi {
            true
        } else {
            // Case 2: aspect-ratio heuristic for other headings (reliable for hdg ≈ π/2).
            let (u_min, u_max) = corners
                .iter()
                .fold((f64::INFINITY, f64::NEG_INFINITY), |(mn, mx), c| {
                    (mn.min(c.x), mx.max(c.x))
                });
            let (v_min, v_max) = corners
                .iter()
                .fold((f64::INFINITY, f64::NEG_INFINITY), |(mn, mx), c| {
                    (mn.min(c.y), mx.max(c.y))
                });
            (u_max - u_min) > (v_max - v_min)
        }
    } else {
        // Case 3: no size info — always apply.
        true
    }
}

/// Map a crosswalk's `cornerLocal` corners to world-space `(x, y)` polygon
/// vertices using [`detect_crosswalk_apply_hdg`] so the result is identical to
/// the polygon used by [`emit_crosswalk_stripes`] when clipping the stripes.
pub(crate) fn crosswalk_world_polygon(
    corners: &[we_core::model::Point3D],
    ref_pt: &we_core::geometry::eval::RefLinePoint,
    obj_t: f64,
    obj_hdg: f64,
    offset_pt: &impl Fn(&we_core::geometry::eval::RefLinePoint, f64, f64) -> (f64, f64, f64),
    obj_length: f64,
    obj_width: f64,
) -> Vec<(f64, f64)> {
    let (ox, oy, _) = offset_pt(ref_pt, obj_t, 0.0);
    let road_theta = ref_pt.hdg;
    let (cos_road, sin_road) = (road_theta.cos(), road_theta.sin());
    let apply_hdg = detect_crosswalk_apply_hdg(corners, obj_hdg, obj_length, obj_width);
    let (cos_h, sin_h) = if apply_hdg {
        (obj_hdg.cos(), obj_hdg.sin())
    } else {
        (1.0_f64, 0.0_f64)
    };
    corners
        .iter()
        .map(|c| {
            let alpha = c.x * cos_h - c.y * sin_h;
            let beta = c.x * sin_h + c.y * cos_h;
            (
                ox + alpha * cos_road - beta * sin_road,
                oy + alpha * sin_road + beta * cos_road,
            )
        })
        .collect()
}

/// Emit a closed outline (thick line loop) around a world-space polygon at a
/// fixed elevation. Used by the crosswalk selection highlight so the outline
/// hugs the exact stripe area.
pub(crate) fn emit_world_polygon_outline(
    world_poly: &[(f64, f64)],
    z: f32,
    bar_thickness: f64,
    color: [f32; 4],
    out: &mut Vec<f32>,
) {
    let n = world_poly.len();
    if n < 2 {
        return;
    }
    let [r, g, b, a] = color;
    let hw = bar_thickness / 2.0;
    for i in 0..n {
        let (ax, ay) = world_poly[i];
        let (bx, by) = world_poly[(i + 1) % n];
        let dx = bx - ax;
        let dy = by - ay;
        let len = (dx * dx + dy * dy).sqrt().max(1e-9);
        let nx = -dy / len * hw;
        let ny = dx / len * hw;
        let p0 = ((ax + nx) as f32, (ay + ny) as f32);
        let p1 = ((ax - nx) as f32, (ay - ny) as f32);
        let p2 = ((bx - nx) as f32, (by - ny) as f32);
        let p3 = ((bx + nx) as f32, (by + ny) as f32);
        out.extend_from_slice(&[p0.0, p0.1, z, r, g, b, a]);
        out.extend_from_slice(&[p1.0, p1.1, z, r, g, b, a]);
        out.extend_from_slice(&[p2.0, p2.1, z, r, g, b, a]);
        out.extend_from_slice(&[p0.0, p0.1, z, r, g, b, a]);
        out.extend_from_slice(&[p2.0, p2.1, z, r, g, b, a]);
        out.extend_from_slice(&[p3.0, p3.1, z, r, g, b, a]);
    }
}

/// Emit crosswalk zebra stripes given `cornerLocal` polygon data and the object's heading.
///
/// Uses the caller-provided `exact_ref_pt` (evaluated exactly at `obj_s`) to build all
/// stripe vertices.
///
/// Algorithm:
/// 1. Compute the object world-space origin `(Ox, Oy)` including the `obj_t` lateral offset.
/// 2. Transform each `cornerLocal (u, v)` to world space via obj_hdg rotation + road tangent
///    plane mapping. WEO always applies hdg via Euler rotation in `toRoadObject()`.
/// 3. Build world-space polygon edges for stripe clipping.
/// 4. Sweep stripes in the lateral direction (perpendicular to road tangent + Angle offset);
///    each stripe bar extends along the road tangent direction, clipped to the polygon.
///    This matches WEO's `buildCrosswalkSurface`: sweep along t, bars along heading.
#[allow(clippy::too_many_arguments)]
pub(super) fn emit_crosswalk_stripes(
    corners: &[we_core::model::Point3D],
    exact_ref_pt: &we_core::geometry::eval::RefLinePoint,
    elevations: &[we_core::model::Elevation],
    _obj_s: f64,
    obj_t: f64,
    obj_hdg: f64,
    _z_base: f32,
    offset_pt: &impl Fn(&we_core::geometry::eval::RefLinePoint, f64, f64) -> (f64, f64, f64),
    angle_deg: f64,
    line_width: f64,
    line_gap: f64,
    obj_length: f64,
    obj_width: f64,
    out: &mut Vec<f32>,
) {
    use we_core::geometry::eval::evaluate_elevation;

    if corners.len() < 3 {
        return;
    }

    // Crosswalk stripes must be rendered clearly above the road surface.
    // Using 5 cm (vs. the former 2 cm) prevents depth-fighting in perspective
    // and avoids roads covering the crosswalk when corner z-values are negative.
    const CROSSWALK_Z_LIFT: f32 = 0.05;

    let ref_pt = exact_ref_pt;

    // Object world-space origin (includes the lateral obj_t offset).
    let (ox, oy, _) = offset_pt(ref_pt, obj_t, 0.0);
    let z_base = evaluate_elevation(elevations, ref_pt.s) as f32 + CROSSWALK_Z_LIFT;

    // Stripe directions: bars extend along road tangent (parallel to traffic),
    // spaced in the lateral (perpendicular) direction.
    // WEO: angleOffset = -(Angle * PI / 180), rotates the bar direction.
    let angle_offset_rad = -angle_deg.to_radians();
    let bar_theta = ref_pt.hdg + angle_offset_rad; // direction bars extend
    let sweep_theta = bar_theta + std::f64::consts::FRAC_PI_2; // spacing direction (lateral)
    let (cos_sw, sin_sw) = (sweep_theta.cos(), sweep_theta.sin());

    // Build world-space polygon vertices for stripe clipping. Uses the shared
    // `crosswalk_world_polygon` helper so the selection-highlight outline (which
    // calls the same helper) hugs exactly the same area.
    let world_poly = crosswalk_world_polygon(
        corners, ref_pt, obj_t, obj_hdg, offset_pt, obj_length, obj_width,
    );

    // Project world polygon onto sweep coordinate system to compute AABB.
    let mut s_min = f64::INFINITY;
    let mut s_max = f64::NEG_INFINITY;
    let mut l_min = f64::INFINITY;
    let mut l_max = f64::NEG_INFINITY;

    for &(wx, wy) in &world_poly {
        let dx = wx - ox;
        let dy = wy - oy;
        let s_coord = dx * cos_sw + dy * sin_sw;
        let l_coord = -dx * sin_sw + dy * cos_sw;
        s_min = s_min.min(s_coord);
        s_max = s_max.max(s_coord);
        l_min = l_min.min(l_coord);
        l_max = l_max.max(l_coord);
    }

    if s_max <= s_min || l_max <= l_min {
        return;
    }

    // Map sweep-frame → world.
    let world_from_sweep = |s_coord: f64, l_coord: f64| -> (f64, f64) {
        (
            ox + s_coord * cos_sw - l_coord * sin_sw,
            oy + s_coord * sin_sw + l_coord * cos_sw,
        )
    };

    let stripe_width = if line_width > 0.0 { line_width } else { 0.45 };
    let stripe_period = stripe_width + if line_gap > 0.0 { line_gap } else { 0.60 };
    let [r, g, b_color, a]: [f32; 4] = [1.0, 1.0, 1.0, 1.0];

    // Sweep along road tangent (s direction), each stripe bar spans lateral (l) direction.
    let mut s_pos = s_min;
    while s_pos < s_max {
        let s_end = (s_pos + stripe_width).min(s_max);
        let s_mid = (s_pos + s_end) / 2.0;

        let hits = clip_scanline_lateral(&world_poly, ox, oy, cos_sw, sin_sw, l_min, l_max, s_mid);

        let mut pair_idx = 0;
        while pair_idx + 1 < hits.len() {
            let l_start = hits[pair_idx].max(l_min);
            let l_end = hits[pair_idx + 1].min(l_max);
            pair_idx += 2;

            if l_end - l_start < 1e-6 {
                continue;
            }

            let p00 = world_from_sweep(s_pos, l_start);
            let p10 = world_from_sweep(s_pos, l_end);
            let p11 = world_from_sweep(s_end, l_end);
            let p01 = world_from_sweep(s_end, l_start);

            // Do not add corners[0].z: corner z-values from XODR data are often
            // slightly negative (e.g. 51World exports), which would push stripes
            // back down to or below the road surface, causing z-fighting.
            let z = z_base;

            out.extend_from_slice(&[p00.0 as f32, p00.1 as f32, z, r, g, b_color, a]);
            out.extend_from_slice(&[p10.0 as f32, p10.1 as f32, z, r, g, b_color, a]);
            out.extend_from_slice(&[p11.0 as f32, p11.1 as f32, z, r, g, b_color, a]);

            out.extend_from_slice(&[p00.0 as f32, p00.1 as f32, z, r, g, b_color, a]);
            out.extend_from_slice(&[p11.0 as f32, p11.1 as f32, z, r, g, b_color, a]);
            out.extend_from_slice(&[p01.0 as f32, p01.1 as f32, z, r, g, b_color, a]);
        }

        s_pos += stripe_period;
    }
}

/// Emit a polygon outline for area objects (parking space, cross-hatch, etc.)
///
/// Uses the caller-provided `exact_ref_pt` (evaluated exactly at `obj_s`) to form the
/// tangent-plane origin, then maps each cornerLocal `(u, v)` into world space.
///
/// ## Coordinate convention detection
///
/// Two real-world xodr conventions exist for `cornerLocal`:
/// - **Road-frame** (non-spec): `u` = along-road, `v` = lateral.
///   The parent `<object>` has `length="0" width="0"` (or both absent).
///   → No `obj_hdg` rotation applied: `wx = Ox + u·cos(θ) − v·sin(θ)`
/// - **Object-local frame** (OpenDRIVE spec): `u` = along object heading, `v` = cross-heading.
///   The parent `<object>` carries non-zero `length` and `width`.
///   → Apply `obj_hdg` rotation first: `alpha = u·cos(h) − v·sin(h)`, `beta = u·sin(h) + v·cos(h)`
///   → Then: `wx = Ox + alpha·cos(θ) − beta·sin(θ)`
///
/// Detection uses `obj_length > 0 && obj_width > 0` from the XML attributes, which
/// reliably distinguishes the two conventions regardless of corner aspect ratio.
#[allow(clippy::too_many_arguments)]
pub(crate) fn emit_polygon_outline(
    corners: &[we_core::model::Point3D],
    exact_ref_pt: &we_core::geometry::eval::RefLinePoint,
    elevations: &[we_core::model::Elevation],
    _obj_s: f64,
    obj_t: f64,
    obj_hdg: f64,
    _z_base: f32,
    bar_thickness: f64,
    color: [f32; 4],
    offset_pt: &impl Fn(&we_core::geometry::eval::RefLinePoint, f64, f64) -> (f64, f64, f64),
    out: &mut Vec<f32>,
    obj_length: f64,
    obj_width: f64,
) {
    use we_core::geometry::eval::evaluate_elevation;

    if corners.len() < 2 {
        return;
    }

    let ref_pt = exact_ref_pt;

    let (ox, oy, _) = offset_pt(ref_pt, obj_t, 0.0);
    let z_base_eval = evaluate_elevation(elevations, ref_pt.s) as f32 + 0.02;
    let theta = ref_pt.hdg;
    let (cos_t, sin_t) = (theta.cos(), theta.sin());

    // Detect coordinate convention via object length/width attributes:
    // - length > 0 && width > 0 → spec-compliant object-local frame → apply obj_hdg rotation
    // - otherwise → road-frame storage → no rotation (identity)
    let apply_rotation = obj_length > 0.0 && obj_width > 0.0;

    let (cos_h, sin_h) = if apply_rotation {
        (obj_hdg.cos(), obj_hdg.sin())
    } else {
        (1.0_f64, 0.0_f64) // identity: alpha=u, beta=v
    };

    // Deduplicate closing vertex (some xodr files repeat the first corner at the end,
    // which produces a degenerate zero-length edge that creates invalid quad geometry).
    // NOTE: deduplication is now performed by the OpenDRIVE parser; this block is kept
    // as a safety guard for corners created programmatically (not from parsed xodr).
    let world_corners: Vec<(f64, f64, f32)> = corners
        .iter()
        .map(|c| {
            let alpha = c.x * cos_h - c.y * sin_h;
            let beta = c.x * sin_h + c.y * cos_h;
            let wx = ox + alpha * cos_t - beta * sin_t;
            let wy = oy + alpha * sin_t + beta * cos_t;
            let z = z_base_eval + c.z as f32;
            (wx, wy, z)
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

/// Emit a polygon outline for area objects whose corners use `cornerRoad` (s, t, dz).
///
/// Unlike `cornerLocal`, `cornerRoad` corners are absolute road-frame coordinates —
/// each corner (s, t) must be independently evaluated on the road reference line.
/// No object heading rotation is applied.
#[allow(clippy::too_many_arguments)]
pub(super) fn emit_polygon_outline_road_corners(
    corners: &[we_core::model::Point3D],
    plan_view: &[we_core::model::Geometry],
    elevations: &[we_core::model::Elevation],
    bar_thickness: f64,
    color: [f32; 4],
    offset_pt: &impl Fn(&we_core::geometry::eval::RefLinePoint, f64, f64) -> (f64, f64, f64),
    road_point_at_s: &impl Fn(
        &[we_core::model::Geometry],
        f64,
    ) -> Option<we_core::geometry::eval::RefLinePoint>,
    out: &mut Vec<f32>,
) {
    use we_core::geometry::eval::evaluate_elevation;

    if corners.len() < 2 {
        return;
    }

    // Each corner (s, t, dz) is evaluated independently on the road reference line.
    let world_corners: Vec<(f64, f64, f32)> = corners
        .iter()
        .filter_map(|c| {
            let rp = road_point_at_s(plan_view, c.x)?;
            let (wx, wy, _) = offset_pt(&rp, c.y, 0.0);
            // Use the same 5 cm lift as the stripe path; clamp corner dz to ≥ 0
            // so negative cornerRoad z values cannot push below road surface.
            let z = evaluate_elevation(elevations, c.x) as f32 + (c.z as f32).max(0.0) + 0.05;
            Some((wx, wy, z))
        })
        .collect();

    if world_corners.len() < 2 {
        return;
    }

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
    eval_elev: &impl Fn(&[we_core::model::Elevation], f64) -> f64,
    offset_pt: &impl Fn(&we_core::geometry::eval::RefLinePoint, f64, f64) -> (f64, f64, f64),
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

#[cfg(test)]
mod tests;
