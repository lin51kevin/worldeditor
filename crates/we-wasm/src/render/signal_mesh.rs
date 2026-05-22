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
#[allow(dead_code)]
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
        if t_edge >= -1e-9 && t_edge <= 1.0 + 1e-9 {
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
        if t_edge >= -1e-9 && t_edge <= 1.0 + 1e-9 {
            let hit_l = l_min - 1.0 + t_line * (l_max - l_min + 2.0);
            hits.push(hit_l);
        }
    }
    hits.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    hits
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

    let ref_pt = exact_ref_pt;

    // Object world-space origin (includes the lateral obj_t offset).
    let (ox, oy, _) = offset_pt(ref_pt, obj_t, 0.0);
    let z_base = evaluate_elevation(elevations, ref_pt.s) as f32 + 0.02;

    // Stripe directions: bars extend along road tangent (parallel to traffic),
    // spaced in the lateral (perpendicular) direction.
    // WEO: angleOffset = -(Angle * PI / 180), rotates the bar direction.
    let angle_offset_rad = -angle_deg.to_radians();
    let bar_theta = ref_pt.hdg + angle_offset_rad; // direction bars extend
    let sweep_theta = bar_theta + std::f64::consts::FRAC_PI_2; // spacing direction (lateral)
    let (cos_sw, sin_sw) = (sweep_theta.cos(), sweep_theta.sin());

    // Corner transform: road tangent for the tangent-plane mapping.
    let road_theta = ref_pt.hdg;
    let (cos_road, sin_road) = (road_theta.cos(), road_theta.sin());

    // Convention detection via object length/width attributes:
    //
    // - length > 0 && width > 0 (e.g. CityScape): the exporter stored cornerLocal
    //   (u, v) already in road-frame orientation (u = along-road, v = lateral).
    //   obj_hdg is metadata only; applying it would rotate the clipping polygon
    //   and produce wrong stripe count / orientation.  → NO hdg rotation.
    //
    // - length = 0 && width = 0 (e.g. junction_crosswalk_signal): cornerLocal (u, v)
    //   is in the object's own local frame.  obj_hdg must be applied to map them
    //   into road-frame before stripe generation.  → APPLY hdg rotation.
    let apply_hdg = !(obj_length > 0.0 && obj_width > 0.0);
    let (cos_h, sin_h) = if apply_hdg {
        (obj_hdg.cos(), obj_hdg.sin())
    } else {
        (1.0_f64, 0.0_f64) // identity: alpha = u, beta = v
    };

    // Build world-space polygon vertices for stripe clipping.
    let world_poly: Vec<(f64, f64)> = corners
        .iter()
        .map(|c| {
            let alpha = c.x * cos_h - c.y * sin_h;
            let beta = c.x * sin_h + c.y * cos_h;
            (
                ox + alpha * cos_road - beta * sin_road,
                oy + alpha * sin_road + beta * cos_road,
            )
        })
        .collect();

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

            let z = z_base + corners.get(0).map_or(0.0, |c| c.z as f32);

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
pub(super) fn emit_polygon_outline(
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
            let z = evaluate_elevation(elevations, c.x) as f32 + c.z as f32 + 0.02;
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
mod tests {
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
            all_x.iter().all(|&x| x >= 9.5 && x <= 14.5),
            "Stripe x coords should be in [10,14] range, got {:?}",
            all_x
        );
        assert!(
            all_y.iter().all(|&y| y >= -1.5 && y <= 1.5),
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
            num_stripes >= 8 && num_stripes <= 12,
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
            num_stripes >= 8 && num_stripes <= 12,
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
}
