// Basic vertex-color shader for rendering road geometry, lanes, etc.

struct Uniforms {
    view_proj: mat4x4<f32>,
    model: mat4x4<f32>,
};

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) color: vec4<f32>,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(vertex: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.clip_position = uniforms.view_proj * uniforms.model * vec4<f32>(vertex.position, 1.0);
    out.color = vertex.color;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Fixed upward normal
    let normal = normalize(vec3<f32>(0.0, 0.0, 1.0));

    // 5-direction Lambertian diffuse lighting
    let ambient = 0.1;
    var lighting = 0.0;

    let d1 = normalize(vec3<f32>(0.5, 0.5, 0.7071));
    lighting += max(dot(normal, d1), 0.0) * 0.2;

    let d2 = normalize(vec3<f32>(-0.5, 0.5, 0.7071));
    lighting += max(dot(normal, d2), 0.0) * 0.2;

    let d3 = normalize(vec3<f32>(0.0, -0.5, 0.7071));
    lighting += max(dot(normal, d3), 0.0) * 0.15;

    let d4 = normalize(vec3<f32>(0.7071, 0.0, 0.7071));
    lighting += max(dot(normal, d4), 0.0) * 0.15;

    let d5 = normalize(vec3<f32>(-0.7071, 0.0, 0.7071));
    lighting += max(dot(normal, d5), 0.0) * 0.15;

    let light_factor = ambient + lighting;
    let lit_color = vec3<f32>(in.color.x, in.color.y, in.color.z) * light_factor;
    return vec4<f32>(lit_color, in.color.w);
}
