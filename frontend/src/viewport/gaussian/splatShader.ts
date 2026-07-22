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
 * The upload transposes packed layout v2 into paged texture arrays: three
 * RGBA32F transform layers and `ceil((1 + SH_RGB_values) / 4)` RGBA16F feature
 * layers per page. The only storage buffer is the single global sorted order.
 */
export const GAUSSIAN_SPLAT_SHADER = /* wgsl */ `
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
};

@group(0) @binding(0) var<uniform> u : SplatUniforms;
@group(0) @binding(1) var transforms : texture_2d_array<f32>;
@group(0) @binding(2) var features   : texture_2d_array<f32>;
@group(0) @binding(3) var<storage, read> order : array<u32>;

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
const ALPHA_CUTOFF : f32 = 0.00392156862745;
const EXP4 : f32 = 0.01831563889;
// Minor/major eigenvalue floor ratio (=1/aspect²) used only for decimated
// previews: caps a splat's screen-space aspect ratio at ~8:1 so large splats
// left without their small neighbours cannot project into long bright needles.
const ANISO_MIN_RATIO : f32 = 0.015625;

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

// Map a global splat index to its 2D texel and array page.
fn splatAddress(si : u32) -> vec3<u32> {
  let dimensions = textureDimensions(transforms, 0);
  let splatsPerPage = dimensions.x * dimensions.y;
  let page = si / splatsPerPage;
  let local = si - page * splatsPerPage;
  return vec3<u32>(local % dimensions.x, local / dimensions.x, page);
}

fn transformAt(si : u32, chunk : u32) -> vec4<f32> {
  let address = splatAddress(si);
  let page = address.z;
  return textureLoad(
    transforms,
    vec2<i32>(address.xy),
    i32(page * 3u + chunk),
    0,
  );
}

// Read one opacity/SH half element from a four-half RGBA16F layer.
fn featureAt(si : u32, e : u32) -> f32 {
  let address = splatAddress(si);
  let page = address.z;
  let coeffs = (u32(u.sh_degree) + 1u) * (u32(u.sh_degree) + 1u);
  let featureLayers = (1u + coeffs * 3u + 3u) / 4u;
  let chunk = e >> 2u;
  let value = textureLoad(
    features,
    vec2<i32>(address.xy),
    i32(page * featureLayers + chunk),
    0,
  );
  let lane = e & 3u;
  if (lane == 0u) { return value.x; }
  if (lane == 1u) { return value.y; }
  if (lane == 2u) { return value.z; }
  return value.w;
}

// Read SH coefficient k (a per-channel RGB triple) after opacity element 0.
fn shCoeff(si : u32, k : u32) -> vec3<f32> {
  let e = 1u + k * 3u;
  return vec3<f32>(
    featureAt(si, e),
    featureAt(si, e + 1u),
    featureAt(si, e + 2u),
  );
}

// Reconstruct Σ = R·diag(scale²)·Rᵀ. Rust normalizes the quaternion before
// packing; the defensive normalization keeps this contract safe for GPU input.
fn covarianceFromTransform(
  scale : vec3<f32>,
  quaternion : vec4<f32>,
) -> mat3x3<f32> {
  let norm2 = dot(quaternion, quaternion);
  let normalized = quaternion * inverseSqrt(max(norm2, 1e-20));
  var q = vec4<f32>(1.0, 0.0, 0.0, 0.0);
  if (norm2 > 1e-20) { q = normalized; }
  let w = q.x; let x = q.y; let y = q.z; let z = q.w;
  let xx = x * x; let yy = y * y; let zz = z * z;
  let xy = x * y; let xz = x * z; let yz = y * z;
  let wx = w * x; let wy = w * y; let wz = w * z;

  // Rotation columns. Covariance is the weighted sum of their outer products.
  let c0 = vec3<f32>(1.0 - 2.0 * (yy + zz), 2.0 * (xy + wz), 2.0 * (xz - wy));
  let c1 = vec3<f32>(2.0 * (xy - wz), 1.0 - 2.0 * (xx + zz), 2.0 * (yz + wx));
  let c2 = vec3<f32>(2.0 * (xz + wy), 2.0 * (yz - wx), 1.0 - 2.0 * (xx + yy));
  let s2 = scale * scale;
  return mat3x3<f32>(
    s2.x * c0.x * c0 + s2.y * c1.x * c1 + s2.z * c2.x * c2,
    s2.x * c0.y * c0 + s2.y * c1.y * c1 + s2.z * c2.y * c2,
    s2.x * c0.z * c0 + s2.y * c1.z * c1 + s2.z * c2.z * c2,
  );
}

// Evaluate view-dependent SH colour for direction \`dir\` (normalized).
fn evalSH(si : u32, degree : u32, dir : vec3<f32>) -> vec3<f32> {
  var c = SH_C0 * shCoeff(si, 0u);
  if (degree >= 1u) {
    let x = dir.x; let y = dir.y; let z = dir.z;
    c = c - SH_C1 * y * shCoeff(si, 1u)
          + SH_C1 * z * shCoeff(si, 2u)
          - SH_C1 * x * shCoeff(si, 3u);
    if (degree >= 2u) {
      let xx = x * x; let yy = y * y; let zz = z * z;
      let xy = x * y; let yz = y * z; let xz = x * z;
      c = c + SH_C2_0 * xy * shCoeff(si, 4u)
            + SH_C2_1 * yz * shCoeff(si, 5u)
            + SH_C2_2 * (2.0 * zz - xx - yy) * shCoeff(si, 6u)
            + SH_C2_3 * xz * shCoeff(si, 7u)
            + SH_C2_4 * (xx - yy) * shCoeff(si, 8u);
      if (degree >= 3u) {
        c = c + SH_C3_0 * y * (3.0 * xx - yy) * shCoeff(si, 9u)
              + SH_C3_1 * xy * z * shCoeff(si, 10u)
              + SH_C3_2 * y * (4.0 * zz - xx - yy) * shCoeff(si, 11u)
              + SH_C3_3 * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * shCoeff(si, 12u)
              + SH_C3_4 * x * (4.0 * zz - xx - yy) * shCoeff(si, 13u)
              + SH_C3_5 * z * (xx - yy) * shCoeff(si, 14u)
              + SH_C3_6 * x * (xx - 3.0 * yy) * shCoeff(si, 15u);
      }
    }
  }
  return clamp(c + vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(1.0));
}

@vertex
fn vs_main(@builtin(vertex_index) vtx : u32,
           @builtin(instance_index) inst : u32) -> VSOut {
  let degree = u32(u.sh_degree);
  let si = order[inst];
  let t0 = transformAt(si, 0u);
  let t1 = transformAt(si, 1u);
  let t2 = transformAt(si, 2u);
  let center = t0.xyz;
  let scale = vec3<f32>(t0.w, t1.x, t1.y);
  let quaternion = vec4<f32>(t1.z, t1.w, t2.x, t2.y);
  let opacityRaw = featureAt(si, 0u);

  let cam = u.view * vec4<f32>(center, 1.0);
  let clip = u.view_proj * vec4<f32>(center, 1.0);
  // The view convention looks down -Z. Reject means behind/on the eye plane
  // explicitly because orthographic clip.w does not encode this distinction.
  if (cam.z >= -1e-6 || clip.w <= 1e-6) { return culled(); }
  // Keep the Gaussian center inside WebGPU's reverse-Z depth range instead of
  // clipping the whole footprint when it crosses a near/far plane.
  let clipDepth = clamp(clip.z / clip.w, 0.0, 1.0);

  // View-dependent colour (dir points from camera to the splat mean).
  let dir = normalize(center - u.cam_pos);
  let color = evalSH(si, degree, dir);

  let Vrk = covarianceFromTransform(scale, quaternion);

  // The perspective Jacobian uses projection-matrix-derived pixel focal scales.
  // Orthographic projection has constant pixels/world-unit and no depth terms.
  var J = mat3x3<f32>(
    vec3<f32>(u.projection_scale.x, 0.0, 0.0),
    vec3<f32>(0.0, u.projection_scale.y, 0.0),
    vec3<f32>(0.0, 0.0, 0.0),
  );
  if (u.projection_kind < 0.5) {
    let viewDepth = -cam.z;
    let J1x = u.projection_scale.x / viewDepth;
    let J1y = u.projection_scale.y / viewDepth;
    let J2x = (u.projection_scale.x * cam.x) / (viewDepth * viewDepth);
    let J2y = (u.projection_scale.y * cam.y) / (viewDepth * viewDepth);
    // Perspective (J2) terms live in the third row (col0.z / col1.z).
    J = mat3x3<f32>(
      vec3<f32>(J1x, 0.0, J2x),
      vec3<f32>(0.0, J1y, J2y),
      vec3<f32>(0.0, 0.0, 0.0),
    );
  }

  let W = mat3x3<f32>(u.view[0].xyz, u.view[1].xyz, u.view[2].xyz);
  let T = transpose(W) * J;
  var cov2d = transpose(T) * Vrk * T;

  // 2D low-pass keeps splats >= ~1px (anti-aliasing). NO opacity compensation:
  // thin flat surface splats keep full opacity so they blend into a SOLID
  // surface instead of fading into a furry haze.
  cov2d[0][0] = cov2d[0][0] + u.dilation;
  cov2d[1][1] = cov2d[1][1] + u.dilation;
  let opacity = opacityRaw;
  if (opacity <= ALPHA_CUTOFF) { return culled(); }

  // Eigendecomposition of the 2×2 covariance.
  let a = cov2d[0][0];
  let bc = cov2d[0][1];
  let cc = cov2d[1][1];
  let mid = 0.5 * (a + cc);
  let disc = sqrt(max(0.0, mid * mid - (a * cc - bc * bc)));
  let lambda1 = mid + disc;
  // Floor the minor eigenvalue at 0.1 px² (matches PlayCanvas/SuperSplat). Without
  // it, edge-on / highly anisotropic splats collapse to zero-width needles that
  // render as bright hairy spikes; 0.1 keeps a ~0.45px minimum thickness.
  var lambda2 = max(0.1, mid - disc);
  if (lambda1 <= 0.0) { return culled(); }
  // Decimated preview only: cap anisotropy so exposed large splats round out
  // into ellipses instead of bright needles/spikes. Full mode is untouched.
  if (u.clamp_anisotropy > 0.5) {
    lambda2 = max(lambda2, lambda1 * ANISO_MIN_RATIO);
  }

  // Principal eigenvector (major axis). Fall back to the X axis for near-
  // isotropic splats so normalize never sees a zero vector.
  var ev = vec2<f32>(1.0, 0.0);
  if (abs(bc) > 1e-6) { ev = normalize(vec2<f32>(bc, lambda1 - a)); }

  // Pixel radii along each axis.
  let r1 = min(sqrt(2.0 * lambda1), 1024.0);
  let r2 = min(sqrt(2.0 * lambda2), 1024.0);
  let majorAxis = ev * r1;
  let minorAxis = vec2<f32>(-ev.y, ev.x) * r2;

  // Solve the normalized falloff for alpha=1/255 so low-opacity splats use a
  // smaller quad while retaining the exact same fragment result.
  let alphaEdge = EXP4 + ALPHA_CUTOFF * (1.0 - EXP4) / opacity;
  let quadRadius = sqrt(clamp(-log(clamp(alphaEdge, EXP4, 1.0)), 0.0, 4.0));
  let diameter = 2.0 * quadRadius * max(r1, r2);
  // Cull sub-pixel splats AND near-plane Jacobian blow-ups. As a splat approaches
  // the camera plane (viewDepth → 0) the perspective Jacobian J = focal/viewDepth
  // explodes, projecting the splat into a screen-spanning ~1024px streak (with the
  // eigenvector falling back to the horizontal axis). A legitimate splat never
  // needs to cover the whole viewport, so reject anything wider than the longest
  // viewport edge — this removes the streak/blob artefact when the camera sits
  // inside or grazes the cloud.
  let maxViewportDim = max(u.viewport.x, u.viewport.y);
  if (diameter < 2.0 || diameter > maxViewportDim) { return culled(); }

  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0),
  );
  let q = corners[vtx] * quadRadius;

  // NDC centre + displaced quad corner. Dividing by (viewport * 0.5) maps the
  // pixel-space ellipse axes into NDC correctly (NDC spans 2 over the viewport)
  // — dividing by the full viewport (as before) made splats HALF size, leaving
  // gaps between them (the sparse/furry look).
  let ndc = clip.xy / clip.w;
  let pixelRadius = quadRadius * (abs(majorAxis) + abs(minorAxis));
  let ndcRadius = pixelRadius / (u.viewport * 0.5);
  if (ndc.x + ndcRadius.x < -1.0 || ndc.x - ndcRadius.x > 1.0 ||
      ndc.y + ndcRadius.y < -1.0 || ndc.y - ndcRadius.y > 1.0) {
    return culled();
  }
  let offset = (q.x * majorAxis + q.y * minorAxis) / (u.viewport * 0.5);

  var out : VSOut;
  out.pos = vec4<f32>(ndc + offset, clipDepth, 1.0);
  out.color = vec4<f32>(color, opacity);
  out.quad = q;
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  // in.quad is the corner in [-2, 2]; r2 = dot(quad, quad) in [0, 8].
  // Decay matches the antimatter15/splat reference (exp(-r²) with cutoff at 4),
  // which is the mathematically correct falloff for our quad parametrisation:
  // quad unit = sqrt(2·λ) pixels, so at r²=4 we are at 2σ from the centre.
  let r2 = dot(in.quad, in.quad);
  if (r2 > 4.0) { discard; }
  // Normalized Gaussian falloff (SuperSplat/PlayCanvas normExp): subtract the
  // boundary value exp(-4) and renormalize so alpha reaches exactly 0 at the
  // r²=4 edge instead of ≈0.018 — removes the faint hard ring for a cleaner,
  // crisper splat edge.
  let falloff = (exp(-r2) - EXP4) / (1.0 - EXP4);
  let alpha = in.color.a * falloff;
  if (alpha < ALPHA_CUTOFF) { discard; }
  // Decoded 3DGS SH is gamma-space, so the reference linear tone-mapping/gamma
  // output path writes it directly. Encoding is retained only as an explicit
  // diagnostic for inputs known to contain linear SH colour.
  var rgb = in.color.rgb;
  if (u.linear_to_srgb > 0.5) {
    let lo = rgb * 12.92;
    let hi = 1.055 * pow(max(rgb, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.4)) - 0.055;
    rgb = select(hi, lo, rgb <= vec3<f32>(0.0031308));
  }
  // Premultiplied alpha for src=one, dst=one-minus-src-alpha blending.
  return vec4<f32>(rgb * alpha, alpha);
}
`;
