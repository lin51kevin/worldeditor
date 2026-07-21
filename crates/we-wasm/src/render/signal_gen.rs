//! Signal, sprite, object, and lane-default wasm exports.

use wasm_bindgen::prelude::*;

use super::{arrow_triangles, road_point_at_s, sign_marker_color};

/// Generate signal paint mark vertices from a project JSON. Returns Float32Array.
///
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
///
/// For `type="Graphics"` signals (road paint arrows), the corresponding arrow
/// polygon is triangulated and placed on the road surface using the signal's
/// s/t position and h_offset heading.
///
/// For other signal types (vertical signs) that are NOT covered by the sprite
/// billboard pipeline (i.e. have no matching texture), a small colored diamond
/// marker is placed at the signal position slightly above the road surface.
/// Signals that DO have sprite textures (traffic lights, Chinese GB/T signs,
/// and standard OpenDRIVE codes) are rendered by `generate_sprite_data` as
/// textured billboards and are skipped here to avoid duplicate markers.
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
                // Paint arrow on the road surface.
                // hOffset in OpenDRIVE encodes the signal's facing direction relative
                // to the road s direction (0 = forward/+s, π = backward/-s).
                // Using hOffset directly follows the spec and handles roads where
                // arrows on right lanes (t < 0) intentionally face -s (e.g. when the
                // road is an outgoing leg from a junction and hOffset≈π is set by the
                // authoring tool).
                let (cx, cy, _) = offset_point(&ref_pt, signal.t, 0.0);
                let heading = ref_pt.hdg + signal.h_offset;
                let scale = if signal.width > 0.0 {
                    signal.width
                } else {
                    3.0
                };
                let z = z_road + 0.02; // 2 cm above road surface

                let tris = arrow_triangles(
                    &signal.signal_subtype,
                    cx as f32,
                    cy as f32,
                    z,
                    heading as f32,
                    scale as f32,
                );
                all_floats.extend(tris);
            } else if !is_sprite_covered_signal(&signal.signal_type) {
                // Vertical sign without sprite texture: render as a small diamond
                // marker above the road. Signals with known textures are rendered
                // as textured billboard sprites by generate_sprite_data() instead.
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
            // else: sprite-covered signal — diamond marker suppressed, rendered by
            // generate_sprite_data() as a textured billboard.
        }
    }

    Ok(all_floats)
}

/// Check whether a signal type has a corresponding sprite texture and should
/// be rendered as a billboard rather than a diamond marker.
///
/// Includes:
/// - Traffic lights: types containing commas (e.g. "1,000,001", "1,000,011")
/// - Chinese GB/T road signs: 10+ digit numeric codes (e.g. "1010203800001413")
/// - Standard OpenDRIVE signal codes: 1-5 digit numeric codes that may have
///   a dot-separated subtype (e.g. "206", "267", "274", "274.1", "101", "002")
fn is_sprite_covered_signal(signal_type: &str) -> bool {
    // Traffic lights with comma-separated codes
    if signal_type.contains(',') {
        return true;
    }
    // Chinese GB/T road signs (10+ digit codes)
    if signal_type.len() >= 10 && signal_type.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }
    // Standard OpenDRIVE codes: 1-7 digit codes, optionally with dot-separated subtype
    // (e.g. "206", "267", "274", "274.1"). Reject all-zero strings (not valid sign codes).
    let base = signal_type.split('.').next().unwrap_or("");
    if !base.is_empty()
        && base.len() <= 7
        && base.chars().all(|c| c.is_ascii_digit())
        && base.chars().any(|c| c != '0')
    {
        return true;
    }
    false
}

/// Generate sprite instance data for billboard rendering of traffic lights and road signs.
///
/// Returns a JSON string: array of objects `{ pos: [x, y, z], type: string, subtype: string, w: number, h: number, rot: number }`.
/// The frontend uses the `type`/`subtype` fields to resolve the texture URL via the manifest.
///
/// This function is complementary to `generate_signal_paint_vertices` — that one emits
/// colored geometry (arrows + diamond markers), while this one provides metadata for
/// textured sprite rendering that replaces/overlays the diamond markers.
#[wasm_bindgen]
pub fn generate_sprite_data(project_json: &str) -> Result<JsValue, JsError> {
    use we_core::geometry::eval::{evaluate_elevation, offset_point};
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut sprites: Vec<SpriteInstanceData> = Vec::new();
    let paints: Vec<PaintInstanceData> = Vec::new();

    for road in &project.roads {
        if road.signals.is_empty() {
            continue;
        }

        for signal in &road.signals {
            if signal.signal_type == "Graphics" {
                // Road paint arrows are rendered by generate_signal_paint_vertices()
                // as flat white arrow geometry. Skip them here to avoid duplicate
                // textured quads overlaying the correct flat arrow rendering.
                continue;
            }

            let Some(ref_pt) = road_point_at_s(&road.plan_view, signal.s) else {
                continue;
            };
            let z_road = evaluate_elevation(&road.elevation_profile, signal.s) as f32;

            // All non-Graphics signals that pass is_sprite_covered_signal()
            // are emitted as billboard sprites. The frontend resolves the
            // texture URL via the manifest; if no texture exists the frontend
            // filters them out (textureUrl === '').
            if !is_sprite_covered_signal(&signal.signal_type) {
                continue;
            }

            // Vertical signal — billboard sprite
            let (mx, my, _) = offset_point(&ref_pt, signal.t, 0.0);
            let z_offset = if signal.z_offset > 0.0 {
                signal.z_offset as f32
            } else {
                3.5 // default pole height
            };
            let z = z_road + z_offset;
            // WEO uses 2×2 world-unit billboards; clamp to sane range
            let w = if signal.width > 0.0 && signal.width < 5.0 {
                signal.width as f32
            } else {
                0.9
            };
            let h = if signal.height > 0.0 && signal.height < 5.0 {
                signal.height as f32
            } else {
                0.9
            };

            sprites.push(SpriteInstanceData {
                pos: [mx as f32, my as f32, z],
                signal_type: signal.signal_type.clone(),
                subtype: signal.signal_subtype.clone(),
                w,
                h,
                value: signal.value.clone().unwrap_or_default(),
            });
        }
    }

    let result = SpriteDataResult { sprites, paints };
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsError::new(&e.to_string()))
}

#[derive(serde::Serialize)]
struct SpriteInstanceData {
    pos: [f32; 3],
    signal_type: String,
    subtype: String,
    w: f32,
    h: f32,
    value: String,
}

#[derive(serde::Serialize)]
struct PaintInstanceData {
    pos: [f32; 3],
    subtype: String,
    w: f32,
    h: f32,
    rot: f32,
}

#[derive(serde::Serialize)]
struct SpriteDataResult {
    sprites: Vec<SpriteInstanceData>,
    paints: Vec<PaintInstanceData>,
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

/// Generate highlight vertices for a single signal.
///
/// Looks up the signal by road_id + signal_id, evaluates its world position,
/// and returns a diamond marker mesh tinted with the given colour.
/// Each vertex is 7 floats: [x, y, z, r, g, b, a].
#[wasm_bindgen]
pub fn generate_single_signal_vertices(
    project_json: &str,
    road_id: &str,
    signal_id: &str,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::{evaluate_elevation, offset_point};
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let road = project.roads.iter().find(|rd| rd.id == road_id);
    let signal = road.and_then(|rd| rd.signals.iter().find(|s| s.id == signal_id));

    let (road, signal) = match (road, signal) {
        (Some(road), Some(signal)) => (road, signal),
        _ => return Ok(Vec::new()),
    };

    let Some(ref_pt) = road_point_at_s(&road.plan_view, signal.s) else {
        return Ok(Vec::new());
    };

    let (mx, my, _) = offset_point(&ref_pt, signal.t, 0.0);
    let z_road = evaluate_elevation(&road.elevation_profile, signal.s) as f32;
    let mx = mx as f32;
    let my = my as f32;
    let sz = 0.6f32; // slightly larger than the normal 0.4 marker
    let z = z_road + 0.55;

    // Diamond: 6 vertices (2 triangles)
    let top = [mx, my - sz, z + sz];
    let bot = [mx, my + sz, z - sz];
    let lft = [mx - sz, my, z];
    let rgt = [mx + sz, my, z];

    let mut floats = Vec::with_capacity(6 * 7);
    for p in &[top, lft, bot, top, bot, rgt] {
        floats.extend_from_slice(&[p[0], p[1], p[2], r, g, b, a]);
    }
    Ok(floats)
}

/// Cached version of `generate_single_signal_vertices` — reads from PROJECT_CACHE
/// to avoid JSON re-serialization (~1.3s savings on large maps).
#[wasm_bindgen]
pub fn generate_single_signal_vertices_cached(
    road_id: &str,
    signal_id: &str,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::{evaluate_elevation, offset_point};

    crate::picking::with_project_cache(|cache| {
        let project = cache.project();
        let road = project.roads.iter().find(|rd| rd.id == road_id);
        let signal = road.and_then(|rd| rd.signals.iter().find(|s| s.id == signal_id));

        let (road, signal) = match (road, signal) {
            (Some(road), Some(signal)) => (road, signal),
            _ => return Ok(Vec::new()),
        };

        let Some(ref_pt) = road_point_at_s(&road.plan_view, signal.s) else {
            return Ok(Vec::new());
        };

        let (mx, my, _) = offset_point(&ref_pt, signal.t, 0.0);
        let z_road = evaluate_elevation(&road.elevation_profile, signal.s) as f32;
        let mx = mx as f32;
        let my = my as f32;
        let sz = 0.6f32;
        let z = z_road + 0.55;

        let top = [mx, my - sz, z + sz];
        let bot = [mx, my + sz, z - sz];
        let lft = [mx - sz, my, z];
        let rgt = [mx + sz, my, z];

        let mut floats = Vec::with_capacity(6 * 7);
        for p in &[top, lft, bot, top, bot, rgt] {
            floats.extend_from_slice(&[p[0], p[1], p[2], r, g, b, a]);
        }
        Ok(floats)
    })
}

/// Cached version of `generate_single_object_vertices` — reads from PROJECT_CACHE
/// to avoid JSON re-serialization (~1.3s savings on large maps).
#[wasm_bindgen]
pub fn generate_single_object_vertices_cached(
    road_id: &str,
    object_id: &str,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
) -> Result<Vec<f32>, JsError> {
    use we_core::geometry::eval::{evaluate_elevation, offset_point};
    use we_core::model::{CornerType, ObjectType};

    crate::picking::with_project_cache(|cache| {
        let project = cache.project();
        let road = project.roads.iter().find(|rd| rd.id == road_id);
        let obj = road.and_then(|rd| rd.objects.iter().find(|o| o.id == object_id));

        let (road, obj) = match (road, obj) {
            (Some(road), Some(obj)) => (road, obj),
            _ => return Ok(Vec::new()),
        };

        let s = obj.position.x;
        let t = obj.position.y;
        let Some(ref_pt) = road_point_at_s(&road.plan_view, s) else {
            return Ok(Vec::new());
        };

        let color = [r, g, b, a];
        let z_base = evaluate_elevation(&road.elevation_profile, s) as f32 + 0.08;
        let mut floats: Vec<f32> = Vec::new();

        // StopLine: highlight as a transverse-bar rect outline at the corrected position.
        // The renderer shifts the bar by ds/dt derived from corner data (see object_gen.rs),
        // so the highlight must replicate that same position correction.
        if obj.object_type == ObjectType::StopLine {
            let (stop_ref, bar_t, bar_w) = if obj.corners.len() >= 2 {
                let (cos_h, sin_h) = (obj.hdg.cos(), obj.hdg.sin());
                let ds0 = obj.corners[0].x * cos_h - obj.corners[0].y * sin_h;
                let ds1 = obj.corners[1].x * cos_h - obj.corners[1].y * sin_h;
                let dt0 = obj.corners[0].x * sin_h + obj.corners[0].y * cos_h;
                let dt1 = obj.corners[1].x * sin_h + obj.corners[1].y * cos_h;
                let w = (dt1 - dt0).abs();
                let center = t + (dt0 + dt1) / 2.0;
                let actual_s = (s + (ds0 + ds1) / 2.0).clamp(0.0, road.length);
                let rp = road_point_at_s(&road.plan_view, actual_s).unwrap_or(ref_pt);
                (rp, center, if w > 0.01 { w } else { obj.width.max(3.5) })
            } else {
                (ref_pt, t, if obj.width > 0.0 { obj.width } else { 3.5 })
            };
            let z = evaluate_elevation(&road.elevation_profile, stop_ref.s) as f32 + 0.08;
            let half_w = bar_w / 2.0;
            let half_thick = 0.2; // half of 0.4 m bar thickness
            let (cx, cy, _) = offset_point(&stop_ref, bar_t, 0.0);
            let cos_h = stop_ref.hdg.cos();
            let sin_h = stop_ref.hdg.sin();
            // cos/sin of (hdg + PI/2): perpendicular direction
            let cos_p = -sin_h;
            let sin_p = cos_h;
            let bar_corners = [
                (
                    cx + cos_h * half_thick + cos_p * half_w,
                    cy + sin_h * half_thick + sin_p * half_w,
                ),
                (
                    cx - cos_h * half_thick + cos_p * half_w,
                    cy - sin_h * half_thick + sin_p * half_w,
                ),
                (
                    cx - cos_h * half_thick - cos_p * half_w,
                    cy - sin_h * half_thick - sin_p * half_w,
                ),
                (
                    cx + cos_h * half_thick - cos_p * half_w,
                    cy + sin_h * half_thick - sin_p * half_w,
                ),
            ];
            let hw = 0.18f64;
            let [cr, cg, cb, ca] = color;
            for i in 0..4 {
                let (ax, ay) = bar_corners[i];
                let (bx, by) = bar_corners[(i + 1) % 4];
                let dx = bx - ax;
                let dy = by - ay;
                let len = (dx * dx + dy * dy).sqrt().max(1e-5);
                let nx = -dy / len * hw;
                let ny = dx / len * hw;
                floats.extend_from_slice(&[(ax + nx) as f32, (ay + ny) as f32, z, cr, cg, cb, ca]);
                floats.extend_from_slice(&[(ax - nx) as f32, (ay - ny) as f32, z, cr, cg, cb, ca]);
                floats.extend_from_slice(&[(bx - nx) as f32, (by - ny) as f32, z, cr, cg, cb, ca]);
                floats.extend_from_slice(&[(ax + nx) as f32, (ay + ny) as f32, z, cr, cg, cb, ca]);
                floats.extend_from_slice(&[(bx - nx) as f32, (by - ny) as f32, z, cr, cg, cb, ca]);
                floats.extend_from_slice(&[(bx + nx) as f32, (by + ny) as f32, z, cr, cg, cb, ca]);
            }
            return Ok(floats);
        }

        if !obj.corners.is_empty() {
            use crate::render::signal_mesh::{
                crosswalk_world_polygon, emit_polygon_outline, emit_world_polygon_outline,
            };
            // Crosswalks (cornerLocal) render as zebra stripes; reuse the same
            // world polygon so the highlight outline hugs the stripe area.
            let is_crosswalk_local =
                obj.object_type == ObjectType::Crosswalk && obj.corner_type == CornerType::Local;
            if is_crosswalk_local {
                let world_poly = crosswalk_world_polygon(
                    &obj.corners,
                    &ref_pt,
                    t,
                    obj.hdg,
                    &offset_point,
                    obj.length,
                    obj.width,
                );
                emit_world_polygon_outline(&world_poly, z_base, 0.35, color, &mut floats);
            } else {
                emit_polygon_outline(
                    &obj.corners,
                    &ref_pt,
                    &road.elevation_profile,
                    s,
                    t,
                    obj.hdg,
                    z_base,
                    0.35,
                    color,
                    &offset_point,
                    &mut floats,
                    obj.length,
                    obj.width,
                );
            }
        } else {
            let (mx, my, _) = offset_point(&ref_pt, t, 0.0);
            let mx = mx as f32;
            let my = my as f32;
            let half_l = if obj.length > 0.0 {
                (obj.length / 2.0) as f32
            } else {
                0.6
            };
            let half_w = if obj.width > 0.0 {
                (obj.width / 2.0) as f32
            } else {
                0.6
            };
            let z = z_base;
            let (cos_h, sin_h) = (obj.hdg.cos() as f32, obj.hdg.sin() as f32);
            let corners = [
                (
                    mx + cos_h * half_l - sin_h * half_w,
                    my + sin_h * half_l + cos_h * half_w,
                ),
                (
                    mx + cos_h * half_l + sin_h * half_w,
                    my + sin_h * half_l - cos_h * half_w,
                ),
                (
                    mx - cos_h * half_l + sin_h * half_w,
                    my - sin_h * half_l - cos_h * half_w,
                ),
                (
                    mx - cos_h * half_l - sin_h * half_w,
                    my - sin_h * half_l + cos_h * half_w,
                ),
            ];
            let hw = 0.18f32;
            let [cr, cg, cb, ca] = color;
            for i in 0..4 {
                let (ax, ay) = corners[i];
                let (bx, by) = corners[(i + 1) % 4];
                let dx = bx - ax;
                let dy = by - ay;
                let len = (dx * dx + dy * dy).sqrt().max(1e-5);
                let nx = -dy / len * hw;
                let ny = dx / len * hw;
                floats.extend_from_slice(&[ax + nx, ay + ny, z, cr, cg, cb, ca]);
                floats.extend_from_slice(&[ax - nx, ay - ny, z, cr, cg, cb, ca]);
                floats.extend_from_slice(&[bx - nx, by - ny, z, cr, cg, cb, ca]);
                floats.extend_from_slice(&[ax + nx, ay + ny, z, cr, cg, cb, ca]);
                floats.extend_from_slice(&[bx - nx, by - ny, z, cr, cg, cb, ca]);
                floats.extend_from_slice(&[bx + nx, by + ny, z, cr, cg, cb, ca]);
            }
        }
        Ok(floats)
    })
}
