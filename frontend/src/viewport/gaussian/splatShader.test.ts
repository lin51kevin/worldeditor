import { describe, expect, it } from "vitest";
import { GAUSSIAN_SPLAT_PACKED_SHADER } from "./splatPackedShader";
import { GAUSSIAN_SPLAT_SHADER } from "./splatShader";

describe("GAUSSIAN_SPLAT_SHADER", () => {
  it("addresses each splat through 2D texels and array-page layers", () => {
    expect(GAUSSIAN_SPLAT_SHADER).toContain("texture_2d_array<f32>");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("fn splatAddress");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("page * 3u + chunk");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("page * featureLayers + chunk");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("@binding(3) var<storage, read> order");
    expect(GAUSSIAN_SPLAT_SHADER).not.toContain(
      "@binding(1) var<storage, read> splats",
    );
  });

  it("reconstructs covariance from f32 scale and normalized quaternion", () => {
    expect(GAUSSIAN_SPLAT_SHADER).toContain("fn covarianceFromTransform");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("let scale = vec3<f32>");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("let quaternion = vec4<f32>");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("let s2 = scale * scale");
    expect(GAUSSIAN_SPLAT_SHADER).not.toContain("let sxx = halfAt");
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
      expect(shader).toContain("if (diameter < 2.0) { return culled(); }");
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
    expect(GAUSSIAN_SPLAT_SHADER).toContain("let quadRadius = sqrt");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("corners[vtx] * quadRadius");
  });

  it("only applies linear-to-sRGB encoding as an explicit diagnostic", () => {
    expect(GAUSSIAN_SPLAT_SHADER).toContain("u.linear_to_srgb > 0.5");
    expect(GAUSSIAN_SPLAT_SHADER).not.toContain("u.gamma");
  });
});
