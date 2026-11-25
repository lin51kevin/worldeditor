/**
 * Conservative per-splat frustum culling shared by the GPU sort's key pass.
 *
 * The vertex stage drops a splat when its EWA quad lies fully outside the NDC
 * square. The key pass has no covariance, only the centre and the largest
 * activated scale `smax`, so it bounds the quad instead: the 2D covariance's
 * largest eigenvalue is at most `smax² · ‖J‖F² + 2·dilation` (J = projection
 * Jacobian; the view rotation is orthonormal), and the quad half-extent per axis
 * is at most `quadRadius(≤2) · (|major.x| + |minor.x|) ≤ 2·√2·r`. Every splat
 * culled here is therefore also culled by the vertex stage, so culling is lossless.
 */

/** Extra pixels added to the bound so float rounding can never drop a visible splat. */
const BOUND_SLACK_PX = 2;
/** Multiplier on the pixel bound (2·√2 rounded up, plus 1% for rounding). */
const BOUND_SCALE = 3.0 * 1.01;
/** Floor of the minor eigenvalue in the vertex shader (px²). */
const MIN_LAMBDA = 0.1;

/**
 * WGSL helper for a compute shader that declares `var<uniform> cu : SplatUniforms`
 * (the splat render uniform, 208 bytes) and passes the NDC guard band.
 */
export const SPLAT_FRUSTUM_CULL_WGSL = /* wgsl */ `
struct SplatUniforms {
  view_proj : mat4x4<f32>,
  view      : mat4x4<f32>,
  cam_pos   : vec3<f32>,
  sh_degree : f32,
  projection_scale : vec2<f32>,
  viewport  : vec2<f32>,
  dilation  : f32,
  linear_to_srgb : f32,
  projection_kind : f32,
  clamp_anisotropy : f32,
  near_plane : f32,
  occluder_alpha_min : f32,
  occluder_sigma : f32,
  occluder_depth_bias : f32,
};

// True when the splat at \`pos\` (largest scale \`smax\`) cannot reach the screen.
// \`guard\` widens the visible NDC square so a re-sort that lags a moving camera
// does not expose empty borders.
fn splat_frustum_culled(pos : vec3<f32>, smax : f32, guard : f32) -> bool {
  let cam = cu.view * vec4<f32>(pos, 1.0);
  let clip = cu.view_proj * vec4<f32>(pos, 1.0);
  let view_depth = -cam.z;
  if (view_depth <= 1e-6 || clip.w <= 1e-6) { return true; }
  var jf2 = cu.projection_scale.x * cu.projection_scale.x + cu.projection_scale.y * cu.projection_scale.y;
  if (cu.projection_kind < 0.5) {
    let d2 = view_depth * view_depth;
    let px = cu.projection_scale.x * cam.x;
    let py = cu.projection_scale.y * cam.y;
    jf2 = jf2 / d2 + (px * px + py * py) / (d2 * d2);
  }
  let t = smax * smax * jf2;
  var lam = ${MIN_LAMBDA};
  if (t != t) { lam = 1e30; } else { lam = max(t + 2.0 * cu.dilation, ${MIN_LAMBDA}); }
  let vmin = min(1024.0, min(cu.viewport.x, cu.viewport.y));
  let r = min(sqrt(2.0 * lam), vmin);
  let radius_px = ${BOUND_SCALE} * r + ${BOUND_SLACK_PX}.0;
  let r_ndc = radius_px / (cu.viewport * 0.5) + vec2<f32>(guard);
  let ndc = clip.xy / clip.w;
  return ndc.x + r_ndc.x < -1.0 || ndc.x - r_ndc.x > 1.0 ||
         ndc.y + r_ndc.y < -1.0 || ndc.y - r_ndc.y > 1.0;
}
// PCG-style integer hash: a stable per-splat random number.
fn splat_hash(v : u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

// True when interactive thinning drops splat \`index\`: splats whose on-screen size
// (largest axis, in pixels) is below \`tau\` survive with probability (size/tau)^2,
// so large and near splats are never lost. \`tau <= 0\` keeps everything.
fn splat_thinned(index : u32, pos : vec3<f32>, smax : f32, tau : f32) -> bool {
  if (tau <= 0.0) { return false; }
  let cam = cu.view * vec4<f32>(pos, 1.0);
  let view_depth = -cam.z;
  if (view_depth <= 1e-6) { return false; }
  var jf2 = cu.projection_scale.x * cu.projection_scale.x + cu.projection_scale.y * cu.projection_scale.y;
  if (cu.projection_kind < 0.5) {
    let d2 = view_depth * view_depth;
    let px = cu.projection_scale.x * cam.x;
    let py = cu.projection_scale.y * cam.y;
    jf2 = jf2 / d2 + (px * px + py * py) / (d2 * d2);
  }
  let size = smax * sqrt(jf2);
  if (size >= tau) { return false; }
  let keep = (size / tau) * (size / tau);
  return f32(splat_hash(index)) * 2.3283064365386963e-10 >= keep;
}
`;

/**
 * CPU mirror of `splat_thinned` for tests and tooling.
 * `uniform` is the 48-float splat uniform (see `buildSplatUniform`).
 */
export function isSplatThinned(
  uniform: Float32Array,
  index: number,
  position: readonly number[],
  maxScale: number,
  tau: number,
): boolean {
  if (tau <= 0) return false;
  const size = splatScreenSize(uniform, position, maxScale);
  if (!Number.isFinite(size) || size >= tau) return false;
  const keep = (size / tau) * (size / tau);
  return Math.fround(splatHash(index)) * 2.3283064365386963e-10 >= keep;
}

/** On-screen size of a splat's largest axis in pixels (`smax · ‖J‖F`); `Infinity` behind the eye. */
export function splatScreenSize(
  uniform: Float32Array,
  position: readonly number[],
  maxScale: number,
): number {
  const viewDepth = -column(uniform, 16, 2, position);
  if (viewDepth <= 1e-6) return Infinity;
  const fx = uniform[36]!;
  const fy = uniform[37]!;
  let jf2 = fx * fx + fy * fy;
  if (uniform[42]! < 0.5) {
    const d2 = viewDepth * viewDepth;
    const px = fx * column(uniform, 16, 0, position);
    const py = fy * column(uniform, 16, 1, position);
    jf2 = jf2 / d2 + (px * px + py * py) / (d2 * d2);
  }
  return maxScale * Math.sqrt(jf2);
}

/** Same integer hash as the WGSL `splat_hash`. */
function splatHash(v: number): number {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

/**
 * CPU mirror of `splat_frustum_culled` for tests and tooling.
 * `uniform` is the 48-float splat uniform (see `buildSplatUniform`).
 */
export function isSplatFrustumCulled(
  uniform: Float32Array,
  position: readonly number[],
  maxScale: number,
  guardNdc: number,
): boolean {
  const camZ = column(uniform, 16, 2, position);
  const clipW = column(uniform, 0, 3, position);
  const viewDepth = -camZ;
  if (viewDepth <= 1e-6 || clipW <= 1e-6) return true;

  const fx = uniform[36]!;
  const fy = uniform[37]!;
  let jf2 = fx * fx + fy * fy;
  if (uniform[42]! < 0.5) {
    const d2 = viewDepth * viewDepth;
    const px = fx * column(uniform, 16, 0, position);
    const py = fy * column(uniform, 16, 1, position);
    jf2 = jf2 / d2 + (px * px + py * py) / (d2 * d2);
  }
  const t = maxScale * maxScale * jf2;
  const lambda = Number.isNaN(t) ? 1e30 : Math.max(t + 2 * uniform[40]!, MIN_LAMBDA);
  const viewportW = uniform[38]!;
  const viewportH = uniform[39]!;
  const vmin = Math.min(1024, Math.min(viewportW, viewportH));
  const r = Math.min(Math.sqrt(2 * lambda), vmin);
  const radiusPx = BOUND_SCALE * r + BOUND_SLACK_PX;
  const rx = radiusPx / (viewportW * 0.5) + guardNdc;
  const ry = radiusPx / (viewportH * 0.5) + guardNdc;
  const ndcX = column(uniform, 0, 0, position) / clipW;
  const ndcY = column(uniform, 0, 1, position) / clipW;
  return ndcX + rx < -1 || ndcX - rx > 1 || ndcY + ry < -1 || ndcY - ry > 1;
}

/** Row `row` of `matrix · [position, 1]` for a column-major 4x4 stored at `offset`. */
function column(
  matrix: Float32Array,
  offset: number,
  row: number,
  position: readonly number[],
): number {
  return (
    matrix[offset + row]! * position[0]! +
    matrix[offset + 4 + row]! * position[1]! +
    matrix[offset + 8 + row]! * position[2]! +
    matrix[offset + 12 + row]!
  );
}
