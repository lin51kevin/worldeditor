use wasm_bindgen::prelude::*;

use we_core::geometry::eval::{
    TessellationParams, evaluate_elevation, sample_road_reference_line_adaptive,
};

/// Grey-blue color for bridge deck overlays (RGBA).
const BRIDGE_COLOR: [f32; 4] = [0.50, 0.55, 0.65, 0.80];

/// Dark-brown color for tunnel enclosure overlays.
const TUNNEL_COLOR: [f32; 4] = [0.30, 0.25, 0.20, 0.75];

/// Half-width of the bridge/tunnel visual band (metres).
const HALF_WIDTH: f32 = 6.0;

/// Height offset for bridge deck above road surface.
const BRIDGE_Z_OFFSET: f32 = 1.0;

/// Height of tunnel arch above road surface.
const TUNNEL_ARCH_HEIGHT: f32 = 5.0;

/// Generate bridge and tunnel overlay vertices from a project JSON.
///
/// Each vertex is 7 floats: `[x, y, z, r, g, b, a]`.
/// Returns a flat Float32Array containing bridge deck and tunnel enclosure quads.
#[wasm_bindgen]
pub fn generate_bridge_tunnel_vertices(project_json: &str) -> Result<Vec<f32>, JsError> {
    use we_core::model::Project;

    let project: Project =
        serde_json::from_str(project_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut all_floats: Vec<f32> = Vec::new();

    for road in &project.roads {
        if road.render_hidden {
            continue;
        }
        let has_structures = !road.bridges.is_empty() || !road.tunnels.is_empty();
        if !has_structures {
            continue;
        }

        let ref_pts =
            sample_road_reference_line_adaptive(road, &TessellationParams::default());
        if ref_pts.len() < 2 {
            continue;
        }
        let road_len = road.length.max(f64::EPSILON);

        // Pre-compute world positions and headings for each sample.
        let samples: Vec<(f32, f32, f32, f64)> = ref_pts
            .iter()
            .map(|p| {
                let z = evaluate_elevation(&road.elevation_profile, p.s) as f32;
                (p.x as f32, p.y as f32, z, p.hdg)
            })
            .collect();

        let n = samples.len();

        // Bridges — flat deck quad strip.
        for bridge in &road.bridges {
            let t_start = (bridge.s / road_len).clamp(0.0, 1.0) as f32;
            let t_end = ((bridge.s + bridge.length) / road_len).clamp(0.0, 1.0) as f32;
            let start_idx = ((t_start * (n - 1) as f32) as usize).min(n - 2);
            let end_idx = ((t_end * (n - 1) as f32) as usize).min(n - 1);
            append_flat_strip(
                &samples,
                start_idx,
                end_idx,
                HALF_WIDTH,
                BRIDGE_Z_OFFSET,
                BRIDGE_COLOR,
                &mut all_floats,
            );
        }

        // Tunnels — floor + left wall + right wall.
        for tunnel in &road.tunnels {
            let t_start = (tunnel.s / road_len).clamp(0.0, 1.0) as f32;
            let t_end = ((tunnel.s + tunnel.length) / road_len).clamp(0.0, 1.0) as f32;
            let start_idx = ((t_start * (n - 1) as f32) as usize).min(n - 2);
            let end_idx = ((t_end * (n - 1) as f32) as usize).min(n - 1);

            // Floor
            append_flat_strip(
                &samples,
                start_idx,
                end_idx,
                HALF_WIDTH,
                0.0,
                TUNNEL_COLOR,
                &mut all_floats,
            );
            // Left wall
            append_wall_strip(
                &samples,
                start_idx,
                end_idx,
                -HALF_WIDTH,
                TUNNEL_ARCH_HEIGHT,
                TUNNEL_COLOR,
                &mut all_floats,
            );
            // Right wall
            append_wall_strip(
                &samples,
                start_idx,
                end_idx,
                HALF_WIDTH,
                TUNNEL_ARCH_HEIGHT,
                TUNNEL_COLOR,
                &mut all_floats,
            );
        }
    }

    Ok(all_floats)
}

/// Append a flat horizontal quad strip along the reference line segment [start, end).
fn append_flat_strip(
    samples: &[(f32, f32, f32, f64)],
    start: usize,
    end: usize,
    half_w: f32,
    z_offset: f32,
    color: [f32; 4],
    out: &mut Vec<f32>,
) {
    let [r, g, b, a] = color;
    for i in start..end {
        let (cx, cy, cz, hdg) = samples[i];
        let (nx, ny, nz, nhdg) = samples[i + 1];
        let pw = (-hdg.sin() as f32, hdg.cos() as f32);
        let pnw = (-nhdg.sin() as f32, nhdg.cos() as f32);

        let bl = [cx - pw.0 * half_w, cy - pw.1 * half_w, cz + z_offset];
        let br = [cx + pw.0 * half_w, cy + pw.1 * half_w, cz + z_offset];
        let tl = [nx - pnw.0 * half_w, ny - pnw.1 * half_w, nz + z_offset];
        let tr = [nx + pnw.0 * half_w, ny + pnw.1 * half_w, nz + z_offset];

        for &[vx, vy, vz] in &[bl, br, tl, br, tr, tl] {
            out.extend_from_slice(&[vx, vy, vz, r, g, b, a]);
        }
    }
}

/// Append a vertical wall quad strip at a lateral offset from the reference line.
fn append_wall_strip(
    samples: &[(f32, f32, f32, f64)],
    start: usize,
    end: usize,
    lateral_offset: f32,
    wall_height: f32,
    color: [f32; 4],
    out: &mut Vec<f32>,
) {
    let [r, g, b, a] = color;
    for i in start..end {
        let (cx, cy, cz, hdg) = samples[i];
        let (nx, ny, nz, nhdg) = samples[i + 1];
        let pw = (-hdg.sin() as f32, hdg.cos() as f32);
        let pnw = (-nhdg.sin() as f32, nhdg.cos() as f32);

        let bx0 = cx + pw.0 * lateral_offset;
        let by0 = cy + pw.1 * lateral_offset;
        let bx1 = nx + pnw.0 * lateral_offset;
        let by1 = ny + pnw.1 * lateral_offset;

        let bl = [bx0, by0, cz];
        let tl = [bx0, by0, cz + wall_height];
        let br = [bx1, by1, nz];
        let tr = [bx1, by1, nz + wall_height];

        for &[vx, vy, vz] in &[bl, tl, br, tl, tr, br] {
            out.extend_from_slice(&[vx, vy, vz, r, g, b, a]);
        }
    }
}
