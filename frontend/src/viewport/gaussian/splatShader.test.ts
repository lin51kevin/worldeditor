import { describe, expect, it } from "vitest";
import { GAUSSIAN_SPLAT_SHADER } from "./splatShader";

describe("GAUSSIAN_SPLAT_SHADER", () => {
  it("has explicit perspective and orthographic EWA projection paths", () => {
    expect(GAUSSIAN_SPLAT_SHADER).toContain("u.projection_kind");
    expect(GAUSSIAN_SPLAT_SHADER).toContain("if (u.projection_kind < 0.5)");
  });

  it("culls behind-camera, off-screen, and sub-2px splats while clamping depth", () => {
    expect(GAUSSIAN_SPLAT_SHADER).toContain("cam.z >= -1e-6");
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
