/**
 * WGSL shader for instanced actor (NPC/ego) Gaussian splat rendering.
 *
 * Actor splats are always degree-0 (SH band 0 only) and the model-local packed
 * data lives in a persistent GPU buffer uploaded ONCE per model URL. Per frame,
 * only a tiny per-instance transform buffer is updated (M × 32 bytes).
 *
 * Binding layout:
 *   group(0) binding(0) — SplatUniforms (same struct as packed shader)
 *   group(0) binding(1) — splats: merged model-local packed buffer (all instances)
 *   group(0) binding(2) — order: sorted depth permutation (Uint32)
 *   group(0) binding(3) — instanceIds: per-splat actor instance index (Uint32)
 *   group(1) binding(0) — actorTransforms: per-instance transform (8 floats)
 *
 * The vertex shader reads model-local center/scale/quaternion, looks up the
 * per-splat instance index, fetches the matching ActorTransform, applies the
 * yaw rotation + translation to center, and composes the yaw quaternion with
 * the model-local orientation.  Covariance projection and fragment blending are
 * identical to the packed fallback shader.
 *
 * Stride is fixed at 12 u32 words (degree-0 layout v2):
 *   words  0-2:  position xyz      (f32 × 3)
 *   words  3-5:  activated scale   (f32 × 3)
 *   words  6-9:  quaternion wxyz   (f32 × 4)
 *   words 10-11: opacity + sh0 rgb (f16 pairs × 2 words)
 */
export const GAUSSIAN_SPLAT_ACTOR_INSTANCED_SHADER = /* wgsl */`
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
  _pad1 : f32,
  _pad2 : f32,
  _pad3 : f32,
};

struct ActorTransform {
  cos_yaw : f32,  // cos(heading) — for XY position rotation
  sin_yaw : f32,  // sin(heading)
  hw      : f32,  // cos(heading/2) — yaw quaternion w
  hz      : f32,  // sin(heading/2) — yaw quaternion z  (q = (hw,0,0,hz))
  pos_x   : f32,  // world position minus scene origin, x
  pos_y   : f32,  // world position minus scene origin, y
  pos_z   : f32,  // world position minus scene origin, z
  _pad    : f32,
};

@group(0) @binding(0) var<uniform> u : SplatUniforms;
@group(0) @binding(1) var<storage, read> splats      : array<u32>;
@group(0) @binding(2) var<storage, read> order       : array<u32>;
@group(0) @binding(3) var<storage, read> instanceIds : array<u32>;
@group(1) @binding(0) var<storage, read> actorTransforms : array<ActorTransform>;

const SH_C0 : f32 = 0.28209479177387814;
const ALPHA_CUTOFF : f32 = 0.00392156862745;
const EXP4 : f32 = 0.01831563889;
// Fixed degree-0 packed stride (words per splat).
const STRIDE : u32 = 12u;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) color : vec4<f32>,
  @location(1) quad  : vec2<f32>,
};

fn culled() -> VSOut {
  var out : VSOut;
  out.pos = vec4<f32>(0.0, 0.0, 2.0, 1.0);
  out.color = vec4<f32>(0.0);
  out.quad = vec2<f32>(0.0);
  return out;
}

// Decode a f16 value from the packed f16 pair word at splat base + 10 + (e >> 1).
// Even e → low 16 bits; odd e → high 16 bits.
fn halfAt(b : u32, e : u32) -> f32 {
  let pair = unpack2x16float(splats[b + 10u + (e >> 1u)]);
  return select(pair.x, pair.y, (e & 1u) == 1u);
}

// Reconstruct Σ = R·diag(scale²)·Rᵀ.
fn covarianceFromTransform(scale : vec3<f32>, quaternion : vec4<f32>) -> mat3x3<f32> {
  let norm2 = dot(quaternion, quaternion);
  let normalized = quaternion * inverseSqrt(max(norm2, 1e-20));
  var q = vec4<f32>(1.0, 0.0, 0.0, 0.0);
  if (norm2 > 1e-20) { q = normalized; }
  let w = q.x; let x = q.y; let y = q.z; let z = q.w;
  let xx = x * x; let yy = y * y; let zz = z * z;
  let xy = x * y; let xz = x * z; let yz = y * z;
  let wx = w * x; let wy = w * y; let wz = w * z;
  let c0 = vec3<f32>(1.0 - 2.0*(yy+zz), 2.0*(xy+wz), 2.0*(xz-wy));
  let c1 = vec3<f32>(2.0*(xy-wz), 1.0 - 2.0*(xx+zz), 2.0*(yz+wx));
  let c2 = vec3<f32>(2.0*(xz+wy), 2.0*(yz-wx), 1.0 - 2.0*(xx+yy));
  let s2 = scale * scale;
  return mat3x3<f32>(
    s2.x*c0.x*c0 + s2.y*c1.x*c1 + s2.z*c2.x*c2,
    s2.x*c0.y*c0 + s2.y*c1.y*c1 + s2.z*c2.y*c2,
    s2.x*c0.z*c0 + s2.y*c1.z*c1 + s2.z*c2.z*c2,
  );
}

@vertex
fn vs_main(@builtin(vertex_index) vtx : u32,
           @builtin(instance_index) inst : u32) -> VSOut {
  let si = order[inst];
  let b  = si * STRIDE;

  // Read model-local transform from packed splat data.
  let local_center = vec3<f32>(
    bitcast<f32>(splats[b]),
    bitcast<f32>(splats[b + 1u]),
    bitcast<f32>(splats[b + 2u]),
  );
  let scale = vec3<f32>(
    bitcast<f32>(splats[b + 3u]),
    bitcast<f32>(splats[b + 4u]),
    bitcast<f32>(splats[b + 5u]),
  );
  let lqw = bitcast<f32>(splats[b + 6u]);
  let lqx = bitcast<f32>(splats[b + 7u]);
  let lqy = bitcast<f32>(splats[b + 8u]);
  let lqz = bitcast<f32>(splats[b + 9u]);

  // Fetch per-instance transform.
  let iid = instanceIds[si];
  let xf  = actorTransforms[iid];

  // Apply yaw rotation + translation to center (scene-origin already subtracted
  // from xf.pos_* by the host when it assembles the transforms buffer).
  let center = vec3<f32>(
    local_center.x * xf.cos_yaw - local_center.y * xf.sin_yaw + xf.pos_x,
    local_center.x * xf.sin_yaw + local_center.y * xf.cos_yaw + xf.pos_y,
    local_center.z + xf.pos_z,
  );

  // Compose quaternion: q' = yaw_quat ⊗ q_model
  // yaw_quat = (hw, 0, 0, hz)  component order (w, x, y, z).
  let quaternion = vec4<f32>(
    xf.hw * lqw - xf.hz * lqz,
    xf.hw * lqx - xf.hz * lqy,
    xf.hw * lqy + xf.hz * lqx,
    xf.hw * lqz + xf.hz * lqw,
  );

  // Opacity (element 0) and SH0 color (elements 1-3).
  let opacityRaw = halfAt(b, 0u);
  let sh_r = halfAt(b, 1u);
  let sh_g = halfAt(b, 2u);
  let sh_b = halfAt(b, 3u);
  let color = clamp(vec3<f32>(sh_r, sh_g, sh_b) * SH_C0 + vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(1.0));

  // Standard EWA splatting from here — identical to packed fallback shader.
  let cam    = u.view * vec4<f32>(center, 1.0);
  let clip   = u.view_proj * vec4<f32>(center, 1.0);
  let viewDepth = -cam.z;
  if (viewDepth <= 1e-6 || clip.w <= 1e-6) { return culled(); }
  let clipDepth = clamp(clip.z / clip.w, 0.0, 1.0);

  if (opacityRaw <= ALPHA_CUTOFF) { return culled(); }

  let Vrk = covarianceFromTransform(scale, quaternion);

  var J = mat3x3<f32>(
    vec3<f32>(u.projection_scale.x, 0.0, 0.0),
    vec3<f32>(0.0, u.projection_scale.y, 0.0),
    vec3<f32>(0.0, 0.0, 0.0),
  );
  if (u.projection_kind < 0.5) {
    let J1x = u.projection_scale.x / viewDepth;
    let J1y = u.projection_scale.y / viewDepth;
    let J2x = u.projection_scale.x * cam.x / (viewDepth * viewDepth);
    let J2y = u.projection_scale.y * cam.y / (viewDepth * viewDepth);
    J = mat3x3<f32>(
      vec3<f32>(J1x, 0.0, J2x),
      vec3<f32>(0.0, J1y, J2y),
      vec3<f32>(0.0, 0.0, 0.0),
    );
  }

  let W = mat3x3<f32>(u.view[0].xyz, u.view[1].xyz, u.view[2].xyz);
  let T = transpose(W) * J;
  var cov2d = transpose(T) * Vrk * T;
  cov2d[0][0] = cov2d[0][0] + u.dilation;
  cov2d[1][1] = cov2d[1][1] + u.dilation;

  let a = cov2d[0][0];
  let bc = cov2d[0][1];
  let cc = cov2d[1][1];
  let mid = 0.5 * (a + cc);
  let disc = sqrt(max(0.0, mid*mid - (a*cc - bc*bc)));
  let lambda1 = mid + disc;
  if (lambda1 <= 0.0) { return culled(); }
  var lambda2 = max(0.1, mid - disc);
  if (u.clamp_anisotropy > 0.5) {
    lambda2 = max(lambda2, lambda1 * 0.015625);
  }

  var ev = vec2<f32>(1.0, 0.0);
  if (abs(bc) > 1e-6) { ev = normalize(vec2<f32>(bc, lambda1 - a)); }

  let alphaEdge = EXP4 + ALPHA_CUTOFF * (1.0 - EXP4) / opacityRaw;
  let quadRadius = sqrt(clamp(-log(clamp(alphaEdge, EXP4, 1.0)), 0.0, 4.0));
  let vmin = min(1024.0, min(u.viewport.x, u.viewport.y));
  let r1 = min(sqrt(2.0 * lambda1), vmin);
  let r2 = min(sqrt(2.0 * lambda2), vmin);
  let majorAxis = ev * r1;
  let minorAxis = vec2<f32>(-ev.y, ev.x) * r2;
  let diameter = 2.0 * quadRadius * max(r1, r2);
  if (diameter < 2.0) { return culled(); }

  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0),
  );
  let corner = corners[vtx];
  let delta = quadRadius * (corner.x * majorAxis + corner.y * minorAxis);

  let ndcCenter = clip.xy / clip.w;
  let ndcDelta = delta * 2.0 / u.viewport;
  var out : VSOut;
  out.pos   = vec4<f32>(ndcCenter + ndcDelta, clipDepth, 1.0);
  out.color = vec4<f32>(color * opacityRaw, opacityRaw);
  out.quad  = corner * quadRadius;
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  let d = dot(in.quad, in.quad);
  let alpha = in.color.a * exp(-0.5 * d);
  if (alpha < ALPHA_CUTOFF) { discard; }
  return vec4<f32>(in.color.rgb * alpha, alpha);
}
`;
