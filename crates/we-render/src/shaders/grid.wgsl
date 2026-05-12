// Infinite ground grid shader for WorldEditor viewport.
// Renders a procedural grid in world-space, with fade at distance.

struct Uniforms {
    view_proj: mat4x4<f32>,
    camera_pos: vec3<f32>,
    grid_scale: f32,
};

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_pos: vec3<f32>,
};

// Full-screen quad vertices (two triangles)
@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VertexOutput {
    // Large ground plane quad
    let size = 1000.0;
    var positions = array<vec2<f32>, 6>(
        vec2<f32>(-size, -size),
        vec2<f32>( size, -size),
        vec2<f32>( size,  size),
        vec2<f32>(-size, -size),
        vec2<f32>( size,  size),
        vec2<f32>(-size,  size),
    );
    let pos2d = positions[idx];
    let world_pos = vec3<f32>(pos2d.x, pos2d.y, 0.0);

    var out: VertexOutput;
    out.clip_position = uniforms.view_proj * vec4<f32>(world_pos, 1.0);
    out.world_pos = world_pos;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let scale = uniforms.grid_scale;

    // Anti-aliased grid lines using screen-space derivatives
    let coord = in.world_pos.xy / scale;
    let grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
    let line = min(grid.x, grid.y);
    let alpha = 1.0 - min(line, 1.0);

    // Fade out with distance from camera
    let dist = length(in.world_pos.xy - uniforms.camera_pos.xy);
    let fade = 1.0 - smoothstep(200.0, 500.0, dist);

    // Axis highlighting
    let axis_width = 0.02 * scale;
    var color = vec3<f32>(0.35, 0.35, 0.35); // default grid color
    if abs(in.world_pos.x) < axis_width {
        color = vec3<f32>(0.15, 0.82, 0.30); // Y-axis: bright green
    }
    if abs(in.world_pos.y) < axis_width {
        color = vec3<f32>(0.95, 0.55, 0.05); // X-axis: amber orange (avoids red selection highlight)
    }

    return vec4<f32>(color, alpha * fade * 0.6);
}
