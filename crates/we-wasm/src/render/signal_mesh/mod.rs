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

/// Detect whether a crosswalk's `cornerLocal` coordinates are stored in the
/// object's own heading frame (apply `obj_hdg` rotation) or already in the
/// road frame (identity).
///
/// This is the single source of truth shared by the zebra-stripe surface fill
/// and [`crosswalk_world_polygon`] (used for the selection-highlight outline
/// and picking), so the outline always matches the rendered stripes.
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

/// Emit a thick 2D segment as two triangles (half-width offset along the normal).
pub(crate) fn emit_thick_segment(
    a: (f64, f64),
    b: (f64, f64),
    z: f32,
    thickness: f64,
    color: [f32; 4],
    out: &mut Vec<f32>,
) {
    let [r, g, bl, al] = color;
    let hw = thickness / 2.0;
    let (ax, ay) = a;
    let (bx, by) = b;
    let dx = bx - ax;
    let dy = by - ay;
    let len = (dx * dx + dy * dy).sqrt();
    if len < 1e-9 {
        return;
    }
    let nx = -dy / len * hw;
    let ny = dx / len * hw;
    let p0 = ((ax + nx) as f32, (ay + ny) as f32);
    let p1 = ((ax - nx) as f32, (ay - ny) as f32);
    let p2 = ((bx - nx) as f32, (by - ny) as f32);
    let p3 = ((bx + nx) as f32, (by + ny) as f32);
    out.extend_from_slice(&[p0.0, p0.1, z, r, g, bl, al]);
    out.extend_from_slice(&[p1.0, p1.1, z, r, g, bl, al]);
    out.extend_from_slice(&[p2.0, p2.1, z, r, g, bl, al]);
    out.extend_from_slice(&[p0.0, p0.1, z, r, g, bl, al]);
    out.extend_from_slice(&[p2.0, p2.1, z, r, g, bl, al]);
    out.extend_from_slice(&[p3.0, p3.1, z, r, g, bl, al]);
}

/// Emit an *open* thick polyline through world-space points.
///
/// Used for objects the legacy editor stores as `type="AlongRoad"` (guardrails,
/// curbs, flower beds …), whose corner list is a path rather than a footprint.
pub(crate) fn emit_world_polyline(
    world_pts: &[(f64, f64)],
    z: f32,
    thickness: f64,
    color: [f32; 4],
    out: &mut Vec<f32>,
) {
    for pair in world_pts.windows(2) {
        emit_thick_segment(pair[0], pair[1], z, thickness, color, out);
    }
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
    for i in 0..n {
        emit_thick_segment(
            world_poly[i],
            world_poly[(i + 1) % n],
            z,
            bar_thickness,
            color,
            out,
        );
    }
}

#[cfg(test)]
mod tests;
