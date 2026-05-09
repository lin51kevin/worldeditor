// Lane-line shader: renders road boundary lines (solid / dashed / botts dots / etc.)
// Works in three.js / WebGL style: receives line segment vertices as a TRIANGLE_STRIP
// with per-vertex width and dash parameters encoded in attributes.

struct Uniforms {
    view_proj: mat4x4<f32>,
    model: mat4x4<f32>,
};

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

// Per-vertex attribute layout (location 1..4):
//   loc 1: vec2 offset   — lateral offset perpendicular to the segment (signed half-width)
//   loc 2: vec4 color    — RGBA
//   loc 3: vec2 dash_info — [cumulative_dist_px, dash_gap_px]
//   loc 4: f32 dash_scale — scale factor for dash pattern

struct VertexInput {
    @location(0) position: vec3<f32>,  // world/local position
    @location(1) offset: vec2<f32>,     // lateral half-extent (x) and z-height (y)
    @location(2) color: vec4<f32>,
    @location(3) dash_info: vec2<f32>, // cumulative_dist, dash_gap
    @location(4) dash_scale: f32,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) dash_info: vec2<f32>,
    @location(2) dash_scale: f32,
};

@vertex
fn vs_main(vertex: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    let world_pos = uniforms.model * vec4<f32>(vertex.position, 1.0);
    // Apply lateral offset in the horizontal plane
    let offset_world = vec3<f32>(vertex.offset.x, vertex.offset.y, 0.0);
    out.clip_position = uniforms.view_proj * (world_pos + offset_world);
    out.color = vertex.color;
    out.dash_info = vertex.dash_info;
    out.dash_scale = vertex.dash_scale;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Dashed-line pattern: cumulative_dist wraps into dash_gap cycle
    let dash = in.dash_info.x;
    let gap  = in.dash_info.y;
    let period = dash + gap;
    if (period > 0.0) {
        let t = mod(dash, period);
        if (t > dash) {
            // In the gap — discard this fragment
            discard;
        }
    }

    // Antialias at dash edges (simple smoothstep)
    let aa = 1.0; // could be increased for thicker lines
    let alpha = 1.0; // could fade at edges here
    return vec4<f32>(in.color.rgb, in.color.a * alpha);
}