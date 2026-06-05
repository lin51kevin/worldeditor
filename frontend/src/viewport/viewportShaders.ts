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
  let size = 100000.0;
  var positions = array<vec2<f32>, 6>(
    vec2<f32>(-size, -size),
    vec2<f32>( size, -size),
    vec2<f32>( size,  size),
    vec2<f32>(-size, -size),
    vec2<f32>( size,  size),
    vec2<f32>(-size,  size),
  );
  let pos2d = positions[idx];
  // Center grid quad on camera position so grid covers visible area regardless of world offset
  let world_pos = vec3<f32>(pos2d.x + uniforms.camera_pos.x, pos2d.y + uniforms.camera_pos.y, 0.0);
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
  let fade_radius = uniforms.cam_dist * 8.0;
  let fade_start = fade_radius * 0.6;
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

/**
 * Sprite billboard shader — renders textured quads that always face the camera.
 *
 * Vertex input (per-instance quad, 6 verts):
 *   position: vec3<f32>  — world center of the sprite
 *   uv: vec2<f32>        — texture coordinate (0-1)
 *   offset: vec2<f32>    — billboard corner offset in clip-space pixels
 *
 * Uniforms (group 0):
 *   view_proj: mat4x4    — combined view-projection matrix
 *   viewport_size: vec2  — canvas pixel dimensions (for screen-space sizing)
 *   sprite_scale: f32    — global scale multiplier
 *
 * Texture (group 1):
 *   texture + sampler    — the sprite PNG
 */
export const SPRITE_SHADER = `
struct Uniforms {
  view_proj: mat4x4<f32>,
  viewport_size: vec2<f32>,
  sprite_scale: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(1) @binding(0) var sprite_texture: texture_2d<f32>;
@group(1) @binding(1) var sprite_sampler: sampler;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) offset: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(vertex: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  // Project center to clip space
  let clip_center = uniforms.view_proj * vec4<f32>(vertex.position, 1.0);
  // Apply screen-space offset (billboard expansion) — offset is in NDC pixels
  let pixel_scale = uniforms.sprite_scale * 2.0 / uniforms.viewport_size;
  out.clip_position = vec4<f32>(
    clip_center.xy + vertex.offset * pixel_scale * clip_center.w,
    clip_center.z,
    clip_center.w,
  );
  out.uv = vertex.uv;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let color = textureSample(sprite_texture, sprite_sampler, in.uv);
  // Discard fully transparent pixels
  if (color.a < 0.05) { discard; }
  return color;
}
`;

/**
 * Road paint shader — renders textured quads flat on the road surface (ground-aligned).
 *
 * Vertex input (per-quad, 6 verts):
 *   position: vec3<f32>  — world position of the vertex (pre-transformed on CPU)
 *   uv: vec2<f32>        — texture coordinate
 *
 * Same uniform/texture binding as SPRITE_SHADER but no billboard expansion.
 */
export const ROAD_PAINT_SHADER = `
struct Uniforms {
  view_proj: mat4x4<f32>,
  viewport_size: vec2<f32>,
  sprite_scale: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(1) @binding(0) var paint_texture: texture_2d<f32>;
@group(1) @binding(1) var paint_sampler: sampler;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) uv: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(vertex: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.clip_position = uniforms.view_proj * vec4<f32>(vertex.position, 1.0);
  out.uv = vertex.uv;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let color = textureSample(paint_texture, paint_sampler, in.uv);
  if (color.a < 0.05) { discard; }
  return color;
}
`;
