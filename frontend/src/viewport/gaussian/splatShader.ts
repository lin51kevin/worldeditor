/**
 * WGSL shader for 3D Gaussian Splatting (EWA splatting) with view-dependent SH.
 *
 * Each splat is drawn as one instanced screen-space quad (triangle-strip, 4
 * vertices). The vertex stage evaluates the spherical-harmonic colour for the
 * current view direction, projects the 3D covariance to a 2D ellipse (Zwicker
 * et al. EWA), sizes the quad to the ellipse axes, and emits the splat's
 * reverse-Z depth so opaque geometry occludes it. The fragment stage applies
 * the Gaussian falloff and outputs premultiplied alpha for back-to-front
 * "over" compositing.
 *
 * EWA projection ported from antimatter15/splat; SH evaluation follows the
 * reference 3DGS decode (Kerbl et al. / INRIA).
 *
 * Storage layout — `splats: array<f32>`, stride = 10 + (deg+1)²·3 floats/splat:
 *   [x, y, z, σxx, σxy, σxz, σyy, σyz, σzz, opacity, sh0_r, sh0_g, sh0_b, sh1_r, …]
 * SH block is coeff-major, RGB-interleaved. `order: array<u32>` holds the
 * back-to-front sorted splat indices.
 */
export const GAUSSIAN_SPLAT_SHADER = /* wgsl */ `
struct SplatUniforms {
  view_proj : mat4x4<f32>,
  view      : mat4x4<f32>,
  cam_pos   : vec3<f32>,
  sh_degree : f32,
  focal     : vec2<f32>,
  viewport  : vec2<f32>,
  dilation  : f32,
  _pad0     : f32,
  _pad1     : vec2<f32>,
};

@group(0) @binding(0) var<uniform> u : SplatUniforms;
@group(0) @binding(1) var<storage, read> splats : array<f32>;
@group(0) @binding(2) var<storage, read> order  : array<u32>;

// Spherical-harmonic basis constants (bands 0..3).
const SH_C0 : f32 = 0.28209479177387814;
const SH_C1 : f32 = 0.4886025119029199;
const SH_C2_0 : f32 = 1.0925484305920792;
const SH_C2_1 : f32 = -1.0925484305920792;
const SH_C2_2 : f32 = 0.31539156525252005;
const SH_C2_3 : f32 = -1.0925484305920792;
const SH_C2_4 : f32 = 0.5462742152960396;
const SH_C3_0 : f32 = -0.5900435899266435;
const SH_C3_1 : f32 = 2.890611442640554;
const SH_C3_2 : f32 = -0.4570457994644658;
const SH_C3_3 : f32 = 0.3731763325901154;
const SH_C3_4 : f32 = -0.4570457994644658;
const SH_C3_5 : f32 = 1.445305721320277;
const SH_C3_6 : f32 = -0.5900435899266435;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) color : vec4<f32>,
  @location(1) quad  : vec2<f32>,
};

fn culled() -> VSOut {
  var out : VSOut;
  // Push outside the clip volume so the primitive is discarded.
  out.pos = vec4<f32>(0.0, 0.0, 2.0, 1.0);
  out.color = vec4<f32>(0.0);
  out.quad = vec2<f32>(0.0);
  return out;
}

// Read SH coefficient k (a per-channel RGB triple) at storage offset shBase.
fn shCoeff(shBase : u32, k : u32) -> vec3<f32> {
  let o = shBase + k * 3u;
  return vec3<f32>(splats[o], splats[o + 1u], splats[o + 2u]);
}

// Evaluate view-dependent SH colour for direction \`dir\` (normalized).
fn evalSH(shBase : u32, degree : u32, dir : vec3<f32>) -> vec3<f32> {
  var c = SH_C0 * shCoeff(shBase, 0u);
  if (degree >= 1u) {
    let x = dir.x; let y = dir.y; let z = dir.z;
    c = c - SH_C1 * y * shCoeff(shBase, 1u)
          + SH_C1 * z * shCoeff(shBase, 2u)
          - SH_C1 * x * shCoeff(shBase, 3u);
    if (degree >= 2u) {
      let xx = x * x; let yy = y * y; let zz = z * z;
      let xy = x * y; let yz = y * z; let xz = x * z;
      c = c + SH_C2_0 * xy * shCoeff(shBase, 4u)
            + SH_C2_1 * yz * shCoeff(shBase, 5u)
            + SH_C2_2 * (2.0 * zz - xx - yy) * shCoeff(shBase, 6u)
            + SH_C2_3 * xz * shCoeff(shBase, 7u)
            + SH_C2_4 * (xx - yy) * shCoeff(shBase, 8u);
      if (degree >= 3u) {
        c = c + SH_C3_0 * y * (3.0 * xx - yy) * shCoeff(shBase, 9u)
              + SH_C3_1 * xy * z * shCoeff(shBase, 10u)
              + SH_C3_2 * y * (4.0 * zz - xx - yy) * shCoeff(shBase, 11u)
              + SH_C3_3 * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * shCoeff(shBase, 12u)
              + SH_C3_4 * x * (4.0 * zz - xx - yy) * shCoeff(shBase, 13u)
              + SH_C3_5 * z * (xx - yy) * shCoeff(shBase, 14u)
              + SH_C3_6 * x * (xx - 3.0 * yy) * shCoeff(shBase, 15u);
      }
    }
  }
  return max(c + vec3<f32>(0.5), vec3<f32>(0.0));
}

@vertex
fn vs_main(@builtin(vertex_index) vtx : u32,
           @builtin(instance_index) inst : u32) -> VSOut {
  let degree = u32(u.sh_degree);
  let coeffs = (degree + 1u) * (degree + 1u);
  let stride = 10u + coeffs * 3u;

  let si = order[inst];
  let b = si * stride;
  let center = vec3<f32>(splats[b], splats[b + 1u], splats[b + 2u]);
  let opacityRaw = splats[b + 9u];

  let clip = u.view_proj * vec4<f32>(center, 1.0);
  if (clip.w <= 0.0) { return culled(); }

  let cam = u.view * vec4<f32>(center, 1.0);

  // View-dependent colour (dir points from camera to the splat mean).
  let dir = normalize(center - u.cam_pos);
  let color = evalSH(b + 10u, degree, dir);

  // Symmetric 3D covariance.
  let Vrk = mat3x3<f32>(
    vec3<f32>(splats[b + 3u], splats[b + 4u], splats[b + 5u]),
    vec3<f32>(splats[b + 4u], splats[b + 6u], splats[b + 7u]),
    vec3<f32>(splats[b + 5u], splats[b + 7u], splats[b + 8u]),
  );

  // Perspective Jacobian at the splat mean. Perspective (J2) terms live in the
  // third ROW (col0.z / col1.z) — matches the working pcd-editor / PlayCanvas /
  // antimatter15 form. Putting them in the third column transposes J and yields
  // mis-oriented ellipses (the hairy/furry look).
  let J1x = u.focal.x / cam.z;
  let J1y = u.focal.y / cam.z;
  let J2x = -(u.focal.x * cam.x) / (cam.z * cam.z);
  let J2y = -(u.focal.y * cam.y) / (cam.z * cam.z);
  let J = mat3x3<f32>(
    vec3<f32>(J1x, 0.0, J2x),
    vec3<f32>(0.0, J1y, J2y),
    vec3<f32>(0.0, 0.0, 0.0),
  );

  let W = mat3x3<f32>(u.view[0].xyz, u.view[1].xyz, u.view[2].xyz);
  let T = transpose(W) * J;
  var cov2d = transpose(T) * Vrk * T;

  // 2D low-pass keeps splats >= ~1px (anti-aliasing). NO opacity compensation:
  // thin flat surface splats keep full opacity so they blend into a SOLID
  // surface instead of fading into a furry haze.
  cov2d[0][0] = cov2d[0][0] + u.dilation;
  cov2d[1][1] = cov2d[1][1] + u.dilation;
  let opacity = opacityRaw;

  // Eigendecomposition of the 2×2 covariance.
  let a = cov2d[0][0];
  let bc = cov2d[0][1];
  let cc = cov2d[1][1];
  let mid = 0.5 * (a + cc);
  let disc = sqrt(max(0.0, mid * mid - (a * cc - bc * bc)));
  let lambda1 = mid + disc;
  let lambda2 = max(0.0, mid - disc);

  // Principal eigenvector (major axis). Fall back to the X axis for near-
  // isotropic splats so normalize never sees a zero vector.
  var ev = vec2<f32>(1.0, 0.0);
  if (abs(bc) > 1e-6) { ev = normalize(vec2<f32>(bc, lambda1 - a)); }

  // Pixel radii along each axis.
  let r1 = min(sqrt(2.0 * lambda1), 1024.0);
  let r2 = min(sqrt(2.0 * lambda2), 1024.0);
  let majorAxis = ev * r1;
  let minorAxis = vec2<f32>(-ev.y, ev.x) * r2;

  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-2.0, -2.0),
    vec2<f32>( 2.0, -2.0),
    vec2<f32>(-2.0,  2.0),
    vec2<f32>( 2.0,  2.0),
  );
  let q = corners[vtx];

  // NDC centre + displaced quad corner. Dividing by (viewport * 0.5) maps the
  // pixel-space ellipse axes into NDC correctly (NDC spans 2 over the viewport)
  // — dividing by the full viewport (as before) made splats HALF size, leaving
  // gaps between them (the sparse/furry look).
  let ndc = clip.xy / clip.w;
  let offset = (q.x * majorAxis + q.y * minorAxis) / (u.viewport * 0.5);

  var out : VSOut;
  out.pos = vec4<f32>(ndc + offset, clip.z / clip.w, 1.0);
  out.color = vec4<f32>(color, opacity);
  out.quad = q;
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  // in.quad is the corner in [-2, 2]; r2 = dot(quad, quad) in [0, 8]. A soft
  // gaussian with a smoothstep edge-fade (pcd-editor) avoids the hard circular
  // ring that a plain cutoff produces, so splats blend seamlessly.
  let r2 = dot(in.quad, in.quad);
  if (r2 > 7.5) { discard; }
  let g = exp(-1.35 * r2);
  let edgeFade = 1.0 - smoothstep(6.0, 7.5, r2);
  let alpha = in.color.a * g * edgeFade;
  if (alpha < 0.00392156862745) { discard; }   // < 1/255
  // Premultiplied alpha for src=one, dst=one-minus-src-alpha blending.
  return vec4<f32>(in.color.rgb * alpha, alpha);
}
`;
