import { describe, it, expect } from "vitest";
import { buildSplatUniform, SPLAT_UNIFORM_FLOATS, splatFocal } from "./splatUniform";
import type { CameraState } from "../cameraController";

const camera: CameraState = {
  position: [0, -10, 5],
  target: [0, 0, 0],
  up: [0, 0, 1],
  fovY: Math.PI / 4,
  near: 0.1,
  far: 1000,
} as CameraState;

describe("splatFocal", () => {
  it("computes pixel focal length from vertical FOV", () => {
    const f = splatFocal(Math.PI / 2, 800);
    // fy = (height/2) / tan(fovY/2); tan(45°)=1 → 400.
    expect(f).toBeCloseTo(400, 3);
  });
});

describe("buildSplatUniform", () => {
  it("produces the fixed-size uniform array", () => {
    const u = buildSplatUniform(camera, "3d", 50, 800, 600, 1);
    expect(u.length).toBe(SPLAT_UNIFORM_FLOATS);
    expect(SPLAT_UNIFORM_FLOATS).toBe(44);
  });

  it("packs the dilation at index 40", () => {
    const u = buildSplatUniform(camera, "3d", 50, 800, 600, 1, 0.75);
    expect(u[40]).toBeCloseTo(0.75, 5);
  });

  it("packs camera position, sh degree, focal and viewport", () => {
    const u = buildSplatUniform(camera, "3d", 50, 800, 600, 2);
    // cam_pos at [32..35)
    expect([u[32], u[33], u[34]]).toEqual([0, -10, 5]);
    // sh_degree at [35]
    expect(u[35]).toBe(2);
    // focal at [36..38) — fx === fy for a symmetric perspective.
    const fy = splatFocal(camera.fovY, 600);
    expect(u[36]).toBeCloseTo(fy, 3);
    expect(u[37]).toBeCloseTo(fy, 3);
    // viewport at [38..40)
    expect([u[38], u[39]]).toEqual([800, 600]);
  });

  it("embeds the depth-corrected view-proj and the raw view matrix", () => {
    const u = buildSplatUniform(camera, "3d", 50, 800, 600, 1);
    // view_proj occupies [0..16), view occupies [16..32); both must be finite.
    for (let i = 0; i < 32; i++) {
      expect(Number.isFinite(u[i])).toBe(true);
    }
    // The view block should not be all zeros (a real look-at matrix).
    const viewBlock = Array.from(u.slice(16, 32));
    expect(viewBlock.some((v) => v !== 0)).toBe(true);
  });
});
