// road_textured.wgsl
// Road surface shader with UV coordinates for procedural asphalt/concrete pattern.
// Uses UV tile coordinates to generate a subtle grid pattern simulating pavement.
// No external texture sampler required — the pattern is fully procedural.

struct Uniforms {
    view_proj: mat4x4<f32>,
    model: mat4x4<f32>,
    /// tile_scale: number of UV tiles per meter (e.g. 4.0 = tile every 0.25m)
    tile_scale: f32,
    /// texture_blend: 0.0 = pure vertex color, 1.0 = full procedural overlay
    texture_blend: f32,
    _pad0: f32,
    _pad1: f32,
};

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) uv:       vec2<f32>, // road-space UV (u=lateral, v=longitudinal)
    @location(2) color:    vec4<f32>, // per-vertex lane type color
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) uv:    vec2<f32>,
    @location(1) color: vec4<f32>,
};

@vertex
fn vs_main(v: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.clip_position = uniforms.view_proj * uniforms.model * vec4<f32>(v.position, 1.0);
    out.uv    = v.uv;
    out.color = v.color;
    return out;
}

// Procedural asphalt: dark grey with subtle regular aggregate pattern.
fn asphalt_color(uv: vec2<f32>, tile_scale: f32) -> vec3<f32> {
    let scaled = uv * tile_scale;
    // Grid lines at tile boundaries (simulate expansion joints)
    let fx = fract(scaled.x);
    let fy = fract(scaled.y);
    let joint = step(0.97, fx) + step(0.97, fy);
    let joint_factor = clamp(joint, 0.0, 1.0);
    // Asphalt base colour (dark grey with slight warm tint)
    let base = vec3<f32>(0.25, 0.24, 0.23);
    // Joint colour (slightly lighter)
    let joint_col = vec3<f32>(0.35, 0.34, 0.33);
    return mix(base, joint_col, joint_factor);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let proc_rgb = asphalt_color(in.uv, uniforms.tile_scale);
    let vert_rgb = in.color.rgb;
    // Blend procedural texture with vertex color
    let final_rgb = mix(vert_rgb, proc_rgb, uniforms.texture_blend);
    return vec4<f32>(final_rgb, in.color.a);
}
