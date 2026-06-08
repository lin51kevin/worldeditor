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
            // Road paint arrows (Graphics type) are rendered by generate_signal_paint_vertices
            // as tessellated white polygons — skip them here (PNGs have gray backgrounds).
            if signal.signal_type == "Graphics" {
                continue;
            }

            // Only generate sprites for signals that have matching PNG textures:
            // - Traffic lights: types with commas (e.g. "1,000,011")
            // - Chinese GB/T road signs: 10+ digit numeric codes (e.g. "1010203800001413")
            let type_str = &signal.signal_type;
            let is_traffic_light = type_str.contains(',');
            let is_chinese_sign =
                type_str.len() >= 10 && type_str.chars().all(|c| c.is_ascii_digit());

            if !is_traffic_light && !is_chinese_sign {
                continue;
            }

            let Some(ref_pt) = road_point_at_s(&road.plan_view, signal.s) else {
                continue;
            };
            let z_road = evaluate_elevation(&road.elevation_profile, signal.s) as f32;

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

        let (mx, my, _) = offset_point(&ref_pt, t, 0.0);
        let z_road = evaluate_elevation(&road.elevation_profile, s) as f32;
        let mx = mx as f32;
        let my = my as f32;
        let sz = 0.6f32;
        let z = z_road + 0.05;

        let tl = [mx - sz, my - sz, z];
        let tr = [mx + sz, my - sz, z];
        let bl = [mx - sz, my + sz, z];
        let br = [mx + sz, my + sz, z];

        let mut floats = Vec::with_capacity(6 * 7);
        for p in &[tl, tr, br, tl, br, bl] {
            floats.extend_from_slice(&[p[0], p[1], p[2], r, g, b, a]);
        }
        Ok(floats)
    })
}
