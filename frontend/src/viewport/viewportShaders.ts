/** WGSL shaders for the viewport renderer (same logic as crates/we-render/src/shaders/). */

export const GRID_SHADER = `
struct Uniforms {
  view_proj: mat4x4<f32>,
  camera_pos: vec3<f32>,
  grid_scale: f32,
  grid_color: vec3<f32>,
  cam_dist: f32,
  show_grid: f32,
  show_axis: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) world_pos: vec3<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VertexOutput {
  let size = 10000.0;
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
  let coord = in.world_pos.xy / scale;
  let grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
  let line = max(min(grid.x, grid.y), 0.0);
  let grid_alpha = 1.0 - min(line, 1.0);
  let dist = length(in.world_pos.xy - uniforms.camera_pos.xy);
  let fade_radius = uniforms.cam_dist * 2.0;
  let fade_start = fade_radius * 0.4;
  let fade_end = fade_radius;
  let fade = 1.0 - smoothstep(fade_start, fade_end, dist);
  // Axis: screen-space constant width (approx 2px) regardless of zoom
  let axis_width = 2.0 * fwidth(in.world_pos.x);
  var color = uniforms.grid_color;
  // Grid lines: only visible when show_grid is set
  var final_alpha = select(0.0, grid_alpha * fade * 0.85, uniforms.show_grid > 0.5);
  // Axis lines: independent of grid; override color and ensure full opacity at axis
  if (uniforms.show_axis > 0.5) {
    if (abs(in.world_pos.x) < axis_width) { color = vec3<f32>(0.2, 0.7, 0.2); final_alpha = max(final_alpha, fade * 0.9); }
    if (abs(in.world_pos.y) < axis_width) { color = vec3<f32>(0.7, 0.2, 0.2); final_alpha = max(final_alpha, fade * 0.9); }
  }
  return vec4<f32>(color, final_alpha);
}
`;

export const BASIC_SHADER = `
struct Uniforms {
  view_proj: mat4x4<f32>,
  model: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

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
  return in.color;
}
`;
