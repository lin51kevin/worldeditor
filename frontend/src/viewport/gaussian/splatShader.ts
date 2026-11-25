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
 * The upload transposes packed layout v2 into paged texture arrays: one
 * RGBA32UI transform layer (position f32 bits + smallest-three quaternion) and
 * `ceil((4 + SH_RGB_values) / 4)` RGBA16F feature layers per page (log-scale,
 * opacity, then SH). The only storage buffer is the single global sorted order.
 */
const FEATURE_LAYERS_MAX = 20;
const featureLayers = Array.from({ length: FEATURE_LAYERS_MAX }, (_, i) => i);
const FEATURE_PRIVATES = featureLayers
  .map((i) => `var<private> feat${i} : vec4<f32>;`)
  .join("\n");
const FEATURE_STORE_CHAIN = featureLayers
  .map((i) => `${i === 0 ? "if" : "else if"} (layer == ${i}u) { feat${i} = v; }`)
  .join("\n  ");
const FEATURE_SELECT_CHAIN = featureLayers
  .slice(1)
  .map((i) => `${i === 1 ? "if" : "else if"} (l == ${i}u) { v = feat${i}; }`)
  .join("\n  ");

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
  near_plane : f32,
  occluder_alpha_min : f32,
  occluder_sigma : f32,
  occluder_depth_bias : f32,
  splat_model : f32,
};

@group(0) @binding(0) var<uniform> u : SplatUniforms;
@group(0) @binding(1) var transforms : texture_2d_array<u32>;
@group(0) @binding(2) var features   : texture_2d_array<f32>;
@group(0) @binding(3) var<storage, read> order : array<u32>;

// Spherical-harmonic basis constants (bands 0..4).
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
const SH_C4_0 : f32 = 2.5033429417967046;
const SH_C4_1 : f32 = -1.7701307697799304;
const SH_C4_2 : f32 = 0.9461746957575601;
const SH_C4_3 : f32 = -0.6690465435572892;
const SH_C4_4 : f32 = 0.10578554691520431;
const SH_C4_5 : f32 = -0.6690465435572892;
const SH_C4_6 : f32 = 0.47308734787878004;
const SH_C4_7 : f32 = -1.7701307697799304;
const SH_C4_8 : f32 = 0.6258357354491761;
const ALPHA_CUTOFF : f32 = 0.00392156862745;
const EXP4 : f32 = 0.01831563889;
// SOG v3 opaque-core profile for opacity > 1 at this renderer's cutoff of 2*sqrt(2)
// sigma: core radius u0 = sqrt(R0^2 + Q*(A-1)) - R0 (fraction of the footprint).
const CORE_R0 : f32 = 0.53839315;
const CORE_Q : f32 = 0.62504992;
// Mip-Splatting screen-space filter of SOG models trained with antialiasing.
const ANTIALIAS_FILTER : f32 = 0.1;
// Decimated previews use an 8:1 guard because missing neighbours expose
// needles. Full-quality data keeps SuperSplat's natural anisotropy.
const PREVIEW_ANISO_MIN_RATIO : f32 = 0.015625;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) color : vec4<f32>,
  @location(1) quad  : vec2<f32>,
  // Opaque-core radius (fraction of the footprint) for opacity > 1; 0 otherwise.
  @location(2) core  : f32,
};

fn culled() -> VSOut {
  var out : VSOut;
  // Push outside the clip volume so the primitive is discarded.
  out.pos = vec4<f32>(0.0, 0.0, 2.0, 1.0);
  out.color = vec4<f32>(0.0);
  out.quad = vec2<f32>(0.0);
  out.core = 0.0;
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

fn transformAt(address : vec3<u32>) -> vec4<u32> {
  return textureLoad(transforms, vec2<i32>(address.xy), i32(address.z), 0);
}

// Inverse of the smallest-three packing: 2-bit index of the dropped (largest)
// component, then the other three as 10-bit values (511 = 0) in [-1/sqrt2, 1/sqrt2].
// Returns (w, x, y, z).
fn unpackQuaternion(p : u32) -> vec4<f32> {
  let idx = p >> 30u;
  let k = 0.7071067811865476 / 511.0;
  let a = (f32(p & 1023u) - 511.0) * k;
  let b = (f32((p >> 10u) & 1023u) - 511.0) * k;
  let c = (f32((p >> 20u) & 1023u) - 511.0) * k;
  let m = sqrt(max(0.0, 1.0 - a * a - b * b - c * c));
  if (idx == 0u) { return vec4<f32>(m, a, b, c); }
  if (idx == 1u) { return vec4<f32>(a, m, b, c); }
  if (idx == 2u) { return vec4<f32>(a, b, m, c); }
  return vec4<f32>(a, b, c, m);
}

// Log-scale(3), opacity and SH halves of the current splat, four per RGBA16F layer (at most 20
// layers for degree 4). Each layer is fetched once, not once per coefficient.
// Plain privates, not an array: indexing a private array dynamically spills it to
// local memory, which made the colour stage ~12x slower than the whole rest of the draw.
${FEATURE_PRIVATES}

fn featureLayerCount() -> u32 {
  let coeffs = (u32(u.sh_degree) + 1u) * (u32(u.sh_degree) + 1u);
  return (4u + coeffs * 3u + 3u) / 4u;
}

fn loadFeatureLayer(address : vec3<u32>, layer : u32) {
  let v = textureLoad(
    features,
    vec2<i32>(address.xy),
    i32(address.z * featureLayerCount() + layer),
    0,
  );
  ${FEATURE_STORE_CHAIN}
}

// Opacity/SH half element \`e\` of the layers loaded into the \`feat*\` privates.
// Every caller passes a constant, so the selects fold away at compile time.
fn featureAt(e : u32) -> f32 {
  let l = e >> 2u;
  var v = feat0;
  ${FEATURE_SELECT_CHAIN}
  return v[e & 3u];
}

// Read SH coefficient k (a per-channel RGB triple) after the 4-element header.
fn shCoeff(k : u32) -> vec3<f32> {
  let e = 4u + k * 3u;
  return vec3<f32>(featureAt(e), featureAt(e + 1u), featureAt(e + 2u));
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
fn evalSH(degree : u32, dir : vec3<f32>) -> vec3<f32> {
  var c = SH_C0 * shCoeff(0u);
  if (degree >= 1u) {
    let x = dir.x; let y = dir.y; let z = dir.z;
    c = c - SH_C1 * y * shCoeff(1u)
          + SH_C1 * z * shCoeff(2u)
          - SH_C1 * x * shCoeff(3u);
    if (degree >= 2u) {
      let xx = x * x; let yy = y * y; let zz = z * z;
      let xy = x * y; let yz = y * z; let xz = x * z;
      c = c + SH_C2_0 * xy * shCoeff(4u)
            + SH_C2_1 * yz * shCoeff(5u)
            + SH_C2_2 * (2.0 * zz - xx - yy) * shCoeff(6u)
            + SH_C2_3 * xz * shCoeff(7u)
            + SH_C2_4 * (xx - yy) * shCoeff(8u);
      if (degree >= 3u) {
        c = c + SH_C3_0 * y * (3.0 * xx - yy) * shCoeff(9u)
              + SH_C3_1 * xy * z * shCoeff(10u)
              + SH_C3_2 * y * (4.0 * zz - xx - yy) * shCoeff(11u)
              + SH_C3_3 * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * shCoeff(12u)
              + SH_C3_4 * x * (4.0 * zz - xx - yy) * shCoeff(13u)
              + SH_C3_5 * z * (xx - yy) * shCoeff(14u)
              + SH_C3_6 * x * (xx - 3.0 * yy) * shCoeff(15u);
        if (degree >= 4u) {
          c = c + SH_C4_0 * xy * (xx - yy) * shCoeff(16u)
                + SH_C4_1 * yz * (3.0 * xx - yy) * shCoeff(17u)
                + SH_C4_2 * xy * (7.0 * zz - 1.0) * shCoeff(18u)
                + SH_C4_3 * yz * (7.0 * zz - 3.0) * shCoeff(19u)
                + SH_C4_4 * (zz * (35.0 * zz - 30.0) + 3.0) * shCoeff(20u)
                + SH_C4_5 * xz * (7.0 * zz - 3.0) * shCoeff(21u)
                + SH_C4_6 * (xx - yy) * (7.0 * zz - 1.0) * shCoeff(22u)
                + SH_C4_7 * xz * (xx - 3.0 * yy) * shCoeff(23u)
                + SH_C4_8 * (xx * (xx - 3.0 * yy) - yy * (3.0 * xx - yy)) * shCoeff(24u);
        }
      }
    }
  }
  return clamp(c + vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(1.0));
}

struct SplatQuad {
  culled  : bool,
  center  : vec3<f32>,
  ndc     : vec2<f32>,
  offset  : vec2<f32>,
  depth   : f32,
  opacity : f32,
  quad    : vec2<f32>,
};

fn culledQuad() -> SplatQuad {
  var q : SplatQuad;
  q.culled = true;
  q.center = vec3<f32>(0.0);
  q.ndc = vec2<f32>(0.0);
  q.offset = vec2<f32>(0.0);
  q.depth = 0.0;
  q.opacity = 0.0;
  q.quad = vec2<f32>(0.0);
  return q;
}

// EWA projection shared by the colour and depth-occluder vertex stages.
// A positive radiusLimit caps the quad radius (in quad units, where the colour
// pass' falloff cutoff sits at 2) so the depth pass covers only the splat's
// opaque core.
fn projectSplat(address : vec3<u32>, vtx : u32, radiusLimit : f32) -> SplatQuad {
  let t = transformAt(address);
  let center = bitcast<vec3<f32>>(t.xyz);
  let quaternion = unpackQuaternion(t.w);
  loadFeatureLayer(address, 0u);
  let scale = exp(vec3<f32>(featureAt(0u), featureAt(1u), featureAt(2u)));
  let opacityRaw = featureAt(3u);

  let cam = u.view * vec4<f32>(center, 1.0);
  let clip = u.view_proj * vec4<f32>(center, 1.0);
  let viewDepth = -cam.z;
  // Reject only centers at or behind the eye. The true view depth drives the
  // perspective Jacobian so close splats keep their real projected size
  // (SuperSplat parity); a per-axis screen cap below bounds the footprint.
  if (viewDepth <= 1e-6 || clip.w <= 1e-6) { return culledQuad(); }
  // Keep the Gaussian center inside WebGPU's reverse-Z depth range instead of
  // clipping the whole footprint when it crosses a near/far plane.
  let clipDepth = clamp(clip.z / clip.w, 0.0, 1.0);

  let Vrk = covarianceFromTransform(scale, quaternion);

  // The perspective Jacobian uses projection-matrix-derived pixel focal scales.
  // Orthographic projection has constant pixels/world-unit and no depth terms.
  var J = mat3x3<f32>(
    vec3<f32>(u.projection_scale.x, 0.0, 0.0),
    vec3<f32>(0.0, u.projection_scale.y, 0.0),
    vec3<f32>(0.0, 0.0, 0.0),
  );
  if (u.projection_kind < 0.5) {
    // Standard 3DGS perspective Jacobian evaluated at the true view depth
    // (matches PlayCanvas/SuperSplat). No near-plane flooring or FOV limiting:
    // those distort close and off-axis covariances into blur and needle streaks.
    let J1x = u.projection_scale.x / viewDepth;
    let J1y = u.projection_scale.y / viewDepth;
    let J2x = u.projection_scale.x * cam.x / (viewDepth * viewDepth);
    let J2y = u.projection_scale.y * cam.y / (viewDepth * viewDepth);
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
  // surface instead of fading into a furry haze. Models trained with the
  // Mip-Splatting filter (SOG model "antialiased") instead use that filter and scale
  // the opacity by sqrt(det / det(filtered)), as the SOG spec prescribes.
  var opacity = opacityRaw;
  if (u.splat_model > 0.5) {
    let det0 = max(cov2d[0][0] * cov2d[1][1] - cov2d[0][1] * cov2d[0][1], 0.0);
    cov2d[0][0] = cov2d[0][0] + ANTIALIAS_FILTER;
    cov2d[1][1] = cov2d[1][1] + ANTIALIAS_FILTER;
    let det1 = cov2d[0][0] * cov2d[1][1] - cov2d[0][1] * cov2d[0][1];
    opacity = opacityRaw * sqrt(det0 / max(det1, 1e-12));
  } else {
    cov2d[0][0] = cov2d[0][0] + u.dilation;
    cov2d[1][1] = cov2d[1][1] + u.dilation;
  }
  if (opacity <= ALPHA_CUTOFF) { return culledQuad(); }

  // Eigendecomposition of the 2×2 covariance.
  let a = cov2d[0][0];
  let bc = cov2d[0][1];
  let cc = cov2d[1][1];
  let mid = 0.5 * (a + cc);
  let disc = sqrt(max(0.0, mid * mid - (a * cc - bc * bc)));
  let lambda1 = mid + disc;
  if (lambda1 <= 0.0) { return culledQuad(); }
  // Floor the minor eigenvalue at 0.1 px² (matches PlayCanvas/SuperSplat). Without
  // it, edge-on / highly anisotropic splats collapse to zero-width needles that
  // render as bright hairy spikes; 0.1 keeps a ~0.45px minimum thickness.
  var lambda2 = max(0.1, mid - disc);
  if (u.clamp_anisotropy > 0.5) {
    lambda2 = max(lambda2, lambda1 * PREVIEW_ANISO_MIN_RATIO);
  }

  // Principal eigenvector (major axis). Fall back to the X axis for near-
  // isotropic splats so normalize never sees a zero vector.
  var ev = vec2<f32>(1.0, 0.0);
  if (abs(bc) > 1e-6) { ev = normalize(vec2<f32>(bc, lambda1 - a)); }

  // Solve the normalized falloff for alpha=1/255 so low-opacity splats use a
  // smaller quad while retaining the exact same fragment result.
  let alphaEdge = EXP4 + ALPHA_CUTOFF * (1.0 - EXP4) / min(opacity, 1.0);
  var quadRadius = sqrt(clamp(-log(clamp(alphaEdge, EXP4, 1.0)), 0.0, 4.0));
  if (radiusLimit > 0.0) { quadRadius = min(quadRadius, radiusLimit); }
  // Cap each screen-space axis independently at the smaller viewport dimension
  // (max 1024 px), exactly like SuperSplat/PlayCanvas. This bounds a near-camera
  // splat without distorting the covariances that remain on screen.
  let vmin = min(1024.0, min(u.viewport.x, u.viewport.y));
  let r1 = min(sqrt(2.0 * lambda1), vmin);
  let r2 = min(sqrt(2.0 * lambda2), vmin);
  let majorAxis = ev * r1;
  let minorAxis = vec2<f32>(-ev.y, ev.x) * r2;
  let diameter = 2.0 * quadRadius * max(r1, r2);
  if (diameter < 2.0) { return culledQuad(); }

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
    return culledQuad();
  }
  let offset = (q.x * majorAxis + q.y * minorAxis) / (u.viewport * 0.5);

  var out : SplatQuad;
  out.culled = false;
  out.center = center;
  out.ndc = ndc;
  out.offset = offset;
  out.depth = clipDepth;
  out.opacity = opacity;
  out.quad = q;
  return out;
}

@vertex
fn vs_main(@builtin(vertex_index) vtx : u32,
           @builtin(instance_index) inst : u32) -> VSOut {
  let si = order[inst];
  let address = splatAddress(si);
  let s = projectSplat(address, vtx, 0.0);
  if (s.culled) { return culled(); }

  // Layer 0 (scale, opacity, first SH halves) is already loaded; fetch the rest once.
  for (var layer = 1u; layer < featureLayerCount(); layer = layer + 1u) {
    loadFeatureLayer(address, layer);
  }
  // View-dependent colour (dir points from camera to the splat mean).
  let dir = normalize(s.center - u.cam_pos);
  let color = evalSH(u32(u.sh_degree), dir);

  var out : VSOut;
  out.pos = vec4<f32>(s.ndc + s.offset, s.depth, 1.0);
  // Opacity above 1 keeps peak alpha 1 and adds an opaque core of radius u0.
  var core = 0.0;
  if (s.opacity > 1.0) {
    core = sqrt(CORE_R0 * CORE_R0 + CORE_Q * min(s.opacity - 1.0, 0.5625)) - CORE_R0;
  }
  out.color = vec4<f32>(color, min(s.opacity, 1.0));
  out.quad = s.quad;
  out.core = core;
  return out;
}

struct DepthVSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) quad : vec2<f32>,
};

// Depth-only occluder pass: writes the depth of each splat's opaque core so
// geometry drawn afterwards (dynamic actor splats) is hidden behind walls,
// trees and buildings. Colour writes are masked off by the pipeline, so this
// never alters the scene's own appearance.
@vertex
fn vs_depth(@builtin(vertex_index) vtx : u32,
            @builtin(instance_index) inst : u32) -> DepthVSOut {
  var out : DepthVSOut;
  out.pos = vec4<f32>(0.0, 0.0, 2.0, 1.0);
  out.quad = vec2<f32>(0.0);
  let si = order[inst];
  let address = splatAddress(si);
  loadFeatureLayer(address, 0u);
  // Translucent splats (foliage edges, haze) must not occlude.
  if (featureAt(3u) < u.occluder_alpha_min) { return out; }
  let s = projectSplat(address, vtx, u.occluder_sigma);
  if (s.culled) { return out; }
  // Reverse-Z: scaling the depth down pushes the occluder slightly away from
  // the eye, so a surface never clips actors resting against it.
  out.pos = vec4<f32>(s.ndc + s.offset, s.depth * (1.0 - u.occluder_depth_bias), 1.0);
  out.quad = s.quad;
  return out;
}

@fragment
fn fs_depth(in : DepthVSOut) {
  // Elliptical core only — the quad corners outside it must not write depth or
  // thin splats would occlude as full rectangles.
  if (dot(in.quad, in.quad) > u.occluder_sigma * u.occluder_sigma) { discard; }
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
  var falloff : f32;
  if (in.core > 0.0) {
    // Opaque core: the falloff is stretched over the rest of the footprint.
    let s = max(0.0, sqrt(r2) - 2.0 * in.core) / (1.0 - in.core);
    falloff = (exp(-s * s) - EXP4) / (1.0 - EXP4);
  } else {
    falloff = (exp(-r2) - EXP4) / (1.0 - EXP4);
  }
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
