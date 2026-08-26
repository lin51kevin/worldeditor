//! Paint arrow geometry generation for road surface markings.
//!
//! Builds filled triangle geometry for directional paint arrows (straight,
//! turn, U-turn, and combined variants) from normalized polygon templates.
//! The crosswalk warning diamond ("CrosswalkWarningDiamond") is a hollow
//! frame rather than a filled outline, so it is triangulated separately
//! instead of going through the centroid-fan path below.

/// Build filled triangle geometry for a paint arrow, using a centroid fan.
///
/// `subtype` selects the polygon template. The result is a flat list of 7-float
/// vertex records ready for GPU upload.
pub(crate) fn arrow_triangles(
    subtype: &str,
    cx: f32,
    cy: f32,
    z: f32,
    heading: f32,
    scale: f32,
) -> Vec<f32> {
    if subtype == "CrosswalkWarningDiamond" {
        return crosswalk_warning_diamond_triangles(cx, cy, z, heading, scale);
    }

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

/// Build filled triangle geometry for the crosswalk warning diamond
/// ("菱形预告标线"), a hollow rhombus frame placed on the road surface ahead
/// of a crosswalk. Unlike the arrow templates above, this shape has a hole
/// in the middle, so it is triangulated as 4 trapezoid segments between an
/// outer and an inner diamond outline rather than fanned from a centroid.
///
/// Outer/inner proportions and the 0.5527864045000421 inner-scale ratio match
/// the reference implementation (WorldEditorOnline `CrosswalkWarningDiamond`).
fn crosswalk_warning_diamond_triangles(cx: f32, cy: f32, z: f32, heading: f32, scale: f32) -> Vec<f32> {
    const INNER_RATIO: f32 = 0.5527864045000421;
    // Outer diamond: half-length 0.5 (forward axis), half-width 0.25 (lateral axis).
    let outer: [(f32, f32); 4] = [(0.0, 0.5), (0.25, 0.0), (0.0, -0.5), (-0.25, 0.0)];
    let inner: [(f32, f32); 4] = outer.map(|(x, y)| (x * INNER_RATIO, y * INNER_RATIO));

    let cos_h = heading.cos();
    let sin_h = heading.sin();
    let transform = |vx: f32, vy: f32| -> (f32, f32) {
        let wx = (vx * sin_h + vy * cos_h) * scale + cx;
        let wy = (-vx * cos_h + vy * sin_h) * scale + cy;
        (wx, wy)
    };

    let [r, g, b, a] = [1.0f32, 1.0, 1.0, 0.95];
    let mut out = Vec::with_capacity(4 * 2 * 3 * 7);

    for i in 0..4 {
        let j = (i + 1) % 4;
        let (ox0, oy0) = transform(outer[i].0, outer[i].1);
        let (ox1, oy1) = transform(outer[j].0, outer[j].1);
        let (ix0, iy0) = transform(inner[i].0, inner[i].1);
        let (ix1, iy1) = transform(inner[j].0, inner[j].1);

        // Trapezoid segment split into 2 triangles: (outer0, outer1, inner1), (outer0, inner1, inner0)
        out.extend_from_slice(&[ox0, oy0, z, r, g, b, a]);
        out.extend_from_slice(&[ox1, oy1, z, r, g, b, a]);
        out.extend_from_slice(&[ix1, iy1, z, r, g, b, a]);

        out.extend_from_slice(&[ox0, oy0, z, r, g, b, a]);
        out.extend_from_slice(&[ix1, iy1, z, r, g, b, a]);
        out.extend_from_slice(&[ix0, iy0, z, r, g, b, a]);
    }

    out
}
