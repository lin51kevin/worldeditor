import { describe, expect, it } from "vitest";
import { GAUSSIAN_SPLAT_PACKED_SHADER } from "./splatPackedShader";
import { GAUSSIAN_SPLAT_SHADER } from "./splatShader";

describe("GAUSSIAN_SPLAT_SHADER", () => {
  it("addresses each splat through 2D texels and array-page layers", () => {
    expect(GAUSSIAN_SPLAT_SHADER).toContain("texture_2d_array<u32>");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("fn splatAddress");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("i32(address.z), 0)");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("address.z * featureLayerCount() + layer");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("@binding(3) var<storage, read> order");
    expect(GAUSSIAN_SPLAT_SHADER).not.toContain(
      "@binding(1) var<storage, read> splats",
    );
  });

  it("keeps opacity/SH layers in plain privates, never a dynamically indexed array", () => {
    // A private array indexed at runtime spills to local memory: 12x slower on an RTX 3070.
    expect(GAUSSIAN_SPLAT_SHADER).not.toMatch(/var<private>\s+\w+\s*:\s*array</);
    for (let i = 0; i < 20; i++) expect(GAUSSIAN_SPLAT_SHADER).toContain(`var<private> feat${i} : vec4<f32>;`);
    expect(GAUSSIAN_SPLAT_SHADER).toContain("fn featureAt(e : u32)");
  });

  it("reconstructs covariance from log-scale and a smallest-three quaternion", () => {
    expect(GAUSSIAN_SPLAT_SHADER).toContain("fn covarianceFromTransform");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("fn unpackQuaternion(p : u32)");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("let scale = exp(vec3<f32>(featureAt(0u), featureAt(1u), featureAt(2u)))");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("let quaternion = unpackQuaternion(t.w)");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("bitcast<vec3<f32>>(t.xyz)");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("let s2 = scale * scale");
    expect(GAUSSIAN_SPLAT_SHADER).not.toContain("let sxx = halfAt");
  });

  it("evaluates SH up to band 4 and keeps the opaque-core profile for opacity above 1", () => {
    expect(GAUSSIAN_SPLAT_SHADER).toContain("if (degree >= 4u)");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("shCoeff(24u)");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("const CORE_R0 : f32 = 0.53839315");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("const CORE_Q : f32 = 0.62504992");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("@location(2) core  : f32");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("out.color = vec4<f32>(color, min(s.opacity, 1.0))");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("sqrt(r2) - 2.0 * in.core");
  });

  it("swaps the dilation for the Mip-Splatting filter and determinant opacity scale on antialiased models", () => {
    expect(GAUSSIAN_SPLAT_SHADER).toContain("if (u.splat_model > 0.5)");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("const ANTIALIAS_FILTER : f32 = 0.1");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("sqrt(det0 / max(det1, 1e-12))");
    // Standard models keep the 0.3 px^2 dilation without opacity compensation.
    expect(GAUSSIAN_SPLAT_SHADER).toContain("cov2d[0][0] = cov2d[0][0] + u.dilation;");
  });

  it("has explicit perspective and orthographic EWA projection paths", () => {
    expect(GAUSSIAN_SPLAT_SHADER).toContain("u.projection_kind");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("if (u.projection_kind < 0.5)");
  });

  it.each([GAUSSIAN_SPLAT_SHADER, GAUSSIAN_SPLAT_PACKED_SHADER])(
    "drives the perspective Jacobian from the true view depth without near-plane or FOV clamping (SuperSplat parity)",
    (shader) => {
      expect(shader).toContain("viewDepth <= 1e-6");
      expect(shader).not.toContain("viewDepth < u.near_plane");
      expect(shader).not.toContain("projectionDepth");
      expect(shader).not.toContain("FOV_CLAMP_MARGIN");
      expect(shader).toContain("let J1x = u.projection_scale.x / viewDepth");
      expect(shader).toContain("let J1y = u.projection_scale.y / viewDepth");
      expect(shader).toContain(
        "let J2x = u.projection_scale.x * cam.x / (viewDepth * viewDepth)",
      );
      expect(shader).toContain(
        "let J2y = u.projection_scale.y * cam.y / (viewDepth * viewDepth)",
      );
    },
  );

  it.each([GAUSSIAN_SPLAT_SHADER, GAUSSIAN_SPLAT_PACKED_SHADER])(
    "caps each screen-space axis at the smaller viewport dimension like SuperSplat",
    (shader) => {
      expect(shader).toContain(
        "let vmin = min(1024.0, min(u.viewport.x, u.viewport.y))",
      );
      expect(shader).toContain("let r1 = min(sqrt(2.0 * lambda1), vmin)");
      expect(shader).toContain("let r2 = min(sqrt(2.0 * lambda2), vmin)");
      // The texture-array shader shares its projection with the depth pass and
      // returns a SplatQuad; the packed fallback still returns VSOut directly.
      expect(shader).toMatch(/if \(diameter < 2\.0\) \{ return culled(Quad)?\(\); \}/);
      expect(shader).not.toContain("radiusScale");
      expect(shader).not.toContain("diameter > maxViewportDim");
    },
  );

  it.each([GAUSSIAN_SPLAT_SHADER, GAUSSIAN_SPLAT_PACKED_SHADER])(
    "matches SuperSplat's full-quality minor-axis floor and only tightens previews",
    (shader) => {
      expect(shader).toContain(
        "var lambda2 = max(0.1, mid - disc)",
      );
      expect(shader).not.toContain("PATHOLOGICAL_ANISO_MIN_RATIO");
      expect(shader).toContain("lambda1 * PREVIEW_ANISO_MIN_RATIO");
    },
  );

  it("culls behind-camera, off-screen, and sub-2px splats while clamping depth", () => {
    expect(GAUSSIAN_SPLAT_SHADER).toContain("viewDepth <= 1e-6");
    expect(GAUSSIAN_SPLAT_SHADER).toContain(
      "let clipDepth = clamp(clip.z / clip.w, 0.0, 1.0)",
    );
    expect(GAUSSIAN_SPLAT_SHADER).toContain("diameter < 2.0");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("ndc.x + ndcRadius.x < -1.0");
  });

  it("shrinks the quad to the 1/255 alpha threshold", () => {
    expect(GAUSSIAN_SPLAT_SHADER).toContain("const ALPHA_CUTOFF : f32 = 0.00392156862745");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("var quadRadius = sqrt");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("corners[vtx] * quadRadius");
  });

  it("exposes a colour-free depth-occluder stage gated on opacity and core radius", () => {
    expect(GAUSSIAN_SPLAT_SHADER).toContain("fn vs_depth(");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("fn fs_depth(");
    expect(GAUSSIAN_SPLAT_SHADER).toContain(
      "if (featureAt(3u) < u.occluder_alpha_min) { return out; }",
    );
    expect(GAUSSIAN_SPLAT_SHADER).toContain("projectSplat(address, vtx, u.occluder_sigma)");
    expect(GAUSSIAN_SPLAT_SHADER).toContain(
      "s.depth * (1.0 - u.occluder_depth_bias)",
    );
    expect(GAUSSIAN_SPLAT_SHADER).toContain(
      "if (dot(in.quad, in.quad) > u.occluder_sigma * u.occluder_sigma) { discard; }",
    );
    // The colour pass must keep its full footprint (no radius limit).
    expect(GAUSSIAN_SPLAT_SHADER).toContain("projectSplat(address, vtx, 0.0)");
  });

  it("only applies linear-to-sRGB encoding as an explicit diagnostic", () => {
    expect(GAUSSIAN_SPLAT_SHADER).toContain("u.linear_to_srgb > 0.5");
    expect(GAUSSIAN_SPLAT_SHADER).not.toContain("u.gamma");
  });
});
