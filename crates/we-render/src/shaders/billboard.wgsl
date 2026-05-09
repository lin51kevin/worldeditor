// Billboard shader for traffic signal icons
// Always faces camera, uses texture for icon

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) color: vec4<f32>,
    @location(2) billboard_pos: vec3<f32>,
    @location(3) size: vec2<f32>,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) tex_coords: vec2<f32>,
    @location(1) color: vec4<f32>,
};

struct Uniforms {
    view_proj: mat4x4<f32>,
};

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;

    // billboard_pos is at the center
    // position is the local offset (-1 to 1 range scaled by size)

    // Billboard technique: transform local position relative to world position
    // The quad scale is handled by the vertex position itself
    let world_pos = input.billboard_pos + input.position * vec3<f32>(input.size.x, input.size.y, 0.0);

    output.clip_position = uniforms.view_proj * vec4<f32>(world_pos, 1.0);

    // Map position to tex coords
    // Assuming input.position ranges from -0.5 to 0.5 or similar
    output.tex_coords = input.position.xy * vec2<f32>(-0.5, -0.5) + vec2<f32>(0.5, 0.5);
    output.color = input.color;

    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // For now, render a colored circle or square as the signal
    // Icons would use @group(1) @binding(0) texture in future

    let uv = input.tex_coords * 2.0 - 1.0; // -1 to 1 range
    let dist = length(uv);

    // Circle shape
    if (dist > 1.0) {
        discard;
    }

    return input.color;
}
