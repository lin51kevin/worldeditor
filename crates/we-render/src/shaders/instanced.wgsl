// Instanced vertex-color shader.
//
// Slot 0: per-vertex data (position, color) — same as basic.wgsl.
// Slot 1: per-instance data (4×vec4 model matrix columns + vec4 color override).
//
// The per-instance model matrix replaces the uniform model matrix from the
// basic shader, allowing thousands of objects with different transforms
// to be drawn in a single draw call.

struct Uniforms {
    view_proj: mat4x4<f32>,
};

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

struct VertexInput {
    // Per-vertex (slot 0)
    @location(0) position: vec3<f32>,
    @location(1) color: vec4<f32>,

    // Per-instance (slot 1)
    @location(2) model_col0: vec4<f32>,
    @location(3) model_col1: vec4<f32>,
    @location(4) model_col2: vec4<f32>,
    @location(5) model_col3: vec4<f32>,
    @location(6) instance_color: vec4<f32>,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(vertex: VertexInput) -> VertexOutput {
    let model = mat4x4<f32>(
        vertex.model_col0,
        vertex.model_col1,
        vertex.model_col2,
        vertex.model_col3,
    );

    var out: VertexOutput;
    let world_pos = model * vec4<f32>(vertex.position, 1.0);
    out.clip_position = uniforms.view_proj * world_pos;

    // Use instance color; if alpha is zero, fall back to vertex color.
    if (vertex.instance_color.a > 0.0) {
        out.color = vertex.instance_color;
    } else {
        out.color = vertex.color;
    }

    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Fixed upward normal
    let normal = normalize(vec3<f32>(0.0, 0.0, 1.0));

    // Simple directional lighting (same as basic.wgsl)
    let ambient = 0.15;
    var lighting = 0.0;

    let d1 = normalize(vec3<f32>(0.5, 0.5, 0.7071));
    lighting += max(dot(normal, d1), 0.0) * 0.25;

    let d2 = normalize(vec3<f32>(-0.5, 0.3, 0.6));
    lighting += max(dot(normal, d2), 0.0) * 0.15;

    let d3 = normalize(vec3<f32>(0.0, -0.5, 0.5));
    lighting += max(dot(normal, d3), 0.0) * 0.10;

    let total_light = ambient + lighting;
    return vec4<f32>(in.color.rgb * total_light, in.color.a);
}
